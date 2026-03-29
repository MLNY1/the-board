/**
 * News deduplication and title normalization utilities.
 *
 * Deduplication strategy (three layers):
 *  1. Normalize title → lowercase, strip punctuation, take first 6 words.
 *  2. Jaccard similarity on word sets — threshold 0.5 (50% overlap = duplicate).
 *  3. Key-noun check — if 3+ proper nouns/numbers/country names match, flag as
 *     duplicate even if Jaccard is below threshold.
 */

import type { RawArticle } from '@/types';

// ---------------------------------------------------------------------------
// Title normalization
// ---------------------------------------------------------------------------

/**
 * Normalizes a news headline for deduplication comparison.
 * Lowercases, strips punctuation, takes the first 6 words.
 * Using 6 words is intentionally tight — headlines that share their opening
 * 6 words almost always describe the same story.
 */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .slice(0, 6)
    .join(' ');
}

/**
 * Converts a normalized title string into a Set of unique words.
 */
export function titleToWordSet(normalizedTitle: string): Set<string> {
  return new Set(normalizedTitle.split(' ').filter(Boolean));
}

// ---------------------------------------------------------------------------
// Jaccard similarity
// ---------------------------------------------------------------------------

export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1.0;
  if (a.size === 0 || b.size === 0) return 0.0;

  const intersection = new Set(Array.from(a).filter((word) => b.has(word)));
  const union        = new Set([...Array.from(a), ...Array.from(b)]);

  return intersection.size / union.size;
}

// ---------------------------------------------------------------------------
// Key-noun extraction (secondary dedup signal)
// ---------------------------------------------------------------------------

const ENTITY_WORDS = new Set([
  'israel', 'israeli', 'iran', 'iranian', 'usa', 'america', 'american',
  'china', 'chinese', 'russia', 'russian', 'ukraine', 'ukrainian', 'gaza',
  'taiwan', 'india', 'indian', 'pakistan', 'korea', 'korean', 'japan', 'japanese',
  'germany', 'german', 'france', 'french', 'britain', 'british', 'uk', 'european',
  'nato', 'un', 'eu', 'saudi', 'turkey', 'turkish', 'syria', 'syrian',
  'iraq', 'iraqi', 'afghanistan', 'lebanon', 'lebanese', 'egypt', 'egyptian',
  'hamas', 'hezbollah', 'houthi', 'idf', 'pentagon', 'congress', 'senate',
  'white', 'house', 'kremlin', 'biden', 'trump', 'netanyahu', 'putin',
  'beijing', 'moscow', 'washington', 'jerusalem', 'tehran',
]);

/**
 * Extracts key nouns from the original (un-normalized) title:
 * - Capitalized words (proper nouns, excluding the first word which is always capitalized)
 * - Numeric tokens
 * - Known entity/country names
 */
export function extractKeyNouns(title: string): Set<string> {
  const nouns    = new Set<string>();
  const words    = title.trim().split(/\s+/);

  words.forEach((word, i) => {
    const clean = word.replace(/[^\w]/g, '').toLowerCase();
    if (clean.length < 2) return;

    // Numbers
    if (/^\d/.test(clean)) {
      nouns.add(clean);
      return;
    }

    // Known entities
    if (ENTITY_WORDS.has(clean)) {
      nouns.add(clean);
      return;
    }

    // Capitalized mid-sentence = proper noun (skip index 0, always capital)
    if (i > 0 && /^[A-Z]/.test(word)) {
      nouns.add(clean);
    }
  });

  return nouns;
}

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------

export interface DeduplicationResult {
  unique: Array<Omit<RawArticle, 'id' | 'fetched_at' | 'created_at' | 'processed'>>;
  duplicates: Array<{
    article: Omit<RawArticle, 'id' | 'fetched_at' | 'created_at' | 'processed'>;
    duplicate_of: string;
  }>;
}

/**
 * Deduplicates a batch of incoming articles against recently stored articles.
 *
 * Three-layer check (any hit = duplicate):
 *   1. Jaccard on first-6-word sets   ≥ threshold (default 0.5)
 *   2. Shared key nouns               ≥ 3
 */
export function deduplicateArticles(
  incoming: Array<{
    title: string;
    description: string | null;
    content: string | null;
    source_name: string | null;
    source_url: string | null;
    published_at: string | null;
    image_url: string | null;
    category: string | null;
    duplicate_of: string | null;
  }>,
  existing: Pick<RawArticle, 'id' | 'title'>[],
  threshold = 0.5
): DeduplicationResult {
  const result: DeduplicationResult = { unique: [], duplicates: [] };

  const existingSets = existing.map((a) => ({
    id:       a.id,
    wordSet:  titleToWordSet(normalizeTitle(a.title)),
    keyNouns: extractKeyNouns(a.title),
  }));

  const newSets: Array<{ idx: number; wordSet: Set<string>; keyNouns: Set<string> }> = [];

  for (const article of incoming) {
    const wordSet  = titleToWordSet(normalizeTitle(article.title));
    const keyNouns = extractKeyNouns(article.title);

    let duplicateId: string | null = null;

    // Check against DB articles
    for (const { id, wordSet: eWS, keyNouns: eKN } of existingSets) {
      if (jaccardSimilarity(wordSet, eWS) >= threshold) { duplicateId = id; break; }
      const shared = Array.from(keyNouns).filter(n => eKN.has(n)).length;
      if (shared >= 3)                                   { duplicateId = id; break; }
    }

    // Check within this batch
    if (!duplicateId) {
      for (const { idx, wordSet: nWS, keyNouns: nKN } of newSets) {
        if (jaccardSimilarity(wordSet, nWS) >= threshold) { duplicateId = `batch-${idx}`; break; }
        const shared = Array.from(keyNouns).filter(n => nKN.has(n)).length;
        if (shared >= 3)                                   { duplicateId = `batch-${idx}`; break; }
      }
    }

    if (duplicateId && !duplicateId.startsWith('batch-')) {
      result.duplicates.push({ article, duplicate_of: duplicateId });
    } else if (!duplicateId) {
      result.unique.push(article);
      newSets.push({ idx: result.unique.length - 1, wordSet, keyNouns });
    }
    // Within-batch duplicates are silently dropped
  }

  return result;
}

// ---------------------------------------------------------------------------
// Category rotation for NewsAPI
// ---------------------------------------------------------------------------

const NEWS_CATEGORIES = [
  'general', 'world', 'business', 'technology', 'science', 'health', 'politics',
] as const;

export type NewsCategory = (typeof NEWS_CATEGORIES)[number];

export function getCurrentCategory(): string {
  const hour = new Date().getUTCHours();
  const cat  = NEWS_CATEGORIES[hour % NEWS_CATEGORIES.length];
  return cat === 'politics' ? 'general' : cat;
}

// ---------------------------------------------------------------------------
// Source URL normalization
// ---------------------------------------------------------------------------

export function normalizeSourceUrl(url: string): string {
  try {
    const parsed      = new URL(url);
    const trackingParams = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'ref', 'cid'];
    trackingParams.forEach((p) => parsed.searchParams.delete(p));
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return url;
  }
}

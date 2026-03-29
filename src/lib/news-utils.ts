/**
 * News deduplication and title normalization utilities.
 *
 * Deduplication strategy:
 *  1. Normalize title → lowercase, strip punctuation, take first 12 words.
 *  2. Compare against recent articles using Jaccard similarity on word sets.
 *  3. If similarity > 0.7, mark the incoming article as a duplicate.
 *
 * This is intentionally simple and cheap — no embeddings, no external API calls.
 * It runs inside the ingest cron route on every batch.
 */

import type { RawArticle } from '@/types';

// ---------------------------------------------------------------------------
// Title normalization
// ---------------------------------------------------------------------------

/**
 * Normalizes a news headline for deduplication comparison.
 * Lowercases, strips all punctuation, and takes the first 12 words.
 */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\w\s]/g, '') // strip punctuation
    .replace(/\s+/g, ' ')   // collapse whitespace
    .trim()
    .split(' ')
    .slice(0, 12)
    .join(' ');
}

/**
 * Converts a normalized title string into a Set of unique words.
 * Used as the input to Jaccard similarity.
 */
export function titleToWordSet(normalizedTitle: string): Set<string> {
  return new Set(normalizedTitle.split(' ').filter(Boolean));
}

// ---------------------------------------------------------------------------
// Jaccard similarity
// ---------------------------------------------------------------------------

/**
 * Computes Jaccard similarity between two word sets.
 * Returns a value between 0.0 (no overlap) and 1.0 (identical sets).
 *
 * Jaccard = |intersection| / |union|
 */
export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1.0;
  if (a.size === 0 || b.size === 0) return 0.0;

  const intersection = new Set(Array.from(a).filter((word) => b.has(word)));
  const union = new Set([...Array.from(a), ...Array.from(b)]);

  return intersection.size / union.size;
}

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------

export interface DeduplicationResult {
  /** Articles that are not duplicates — safe to insert */
  unique: Array<Omit<RawArticle, 'id' | 'fetched_at' | 'created_at' | 'processed'>>;
  /** Articles identified as duplicates, with the ID they duplicate */
  duplicates: Array<{
    article: Omit<RawArticle, 'id' | 'fetched_at' | 'created_at' | 'processed'>;
    duplicate_of: string;
  }>;
}

/**
 * Deduplicates a batch of incoming articles against a set of recently stored articles.
 *
 * @param incoming   New articles to classify (no DB id yet)
 * @param existing   Articles from the DB fetched in the last 24h (have real ids)
 * @param threshold  Jaccard similarity threshold (default 0.7)
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
  threshold = 0.7
): DeduplicationResult {
  const result: DeduplicationResult = { unique: [], duplicates: [] };

  // Pre-compute normalized word sets for all existing articles
  const existingWordSets: Array<{ id: string; wordSet: Set<string> }> = existing.map((a) => ({
    id: a.id,
    wordSet: titleToWordSet(normalizeTitle(a.title)),
  }));

  // Track newly-added unique articles so we can deduplicate within the batch itself
  const newWordSets: Array<{ idx: number; wordSet: Set<string> }> = [];

  for (const article of incoming) {
    const normalizedIncoming = normalizeTitle(article.title);
    const incomingWordSet = titleToWordSet(normalizedIncoming);

    // Check against existing DB articles
    let duplicateId: string | null = null;

    for (const { id, wordSet } of existingWordSets) {
      if (jaccardSimilarity(incomingWordSet, wordSet) >= threshold) {
        duplicateId = id;
        break;
      }
    }

    // If not a DB duplicate, check within this same incoming batch
    if (!duplicateId) {
      for (const { idx, wordSet } of newWordSets) {
        if (jaccardSimilarity(incomingWordSet, wordSet) >= threshold) {
          // Mark as duplicate of the first unique article in this batch
          // We can't use an ID yet (it's not inserted), so we skip it from the duplicate list
          // and just don't add it to unique. Treat as a within-batch duplicate.
          duplicateId = `batch-${idx}`; // placeholder; we'll handle below
          break;
        }
      }
    }

    if (duplicateId && !duplicateId.startsWith('batch-')) {
      result.duplicates.push({ article, duplicate_of: duplicateId });
    } else if (!duplicateId) {
      result.unique.push(article);
      newWordSets.push({ idx: result.unique.length - 1, wordSet: incomingWordSet });
    }
    // Within-batch duplicates are silently dropped (not inserted at all)
  }

  return result;
}

// ---------------------------------------------------------------------------
// Category rotation for NewsAPI (stays within free 100 req/day limit)
// ---------------------------------------------------------------------------

const NEWS_CATEGORIES = [
  'general',
  'world',
  'business',
  'technology',
  'science',
  'health',
  'politics', // NewsAPI uses 'general' for politics, but we'll map this
] as const;

export type NewsCategory = (typeof NEWS_CATEGORIES)[number];

/**
 * Returns which NewsAPI category to fetch for the current cron run.
 * Uses the current hour mod the number of categories so each run fetches
 * a different category, rotating through all of them over the day.
 * This keeps us well within the 100 req/day free tier limit.
 */
export function getCurrentCategory(): string {
  const hour = new Date().getUTCHours();
  // Map 'politics' → 'general' since NewsAPI doesn't have a politics category
  const cat = NEWS_CATEGORIES[hour % NEWS_CATEGORIES.length];
  return cat === 'politics' ? 'general' : cat;
}

// ---------------------------------------------------------------------------
// Source URL normalization (strip UTM params, anchors, etc.)
// ---------------------------------------------------------------------------

/**
 * Strips tracking parameters and anchors from a URL for cleaner storage.
 * Returns the original URL if parsing fails.
 */
export function normalizeSourceUrl(url: string): string {
  try {
    const parsed = new URL(url);
    // Remove common tracking parameters
    const trackingParams = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'ref', 'cid'];
    trackingParams.forEach((p) => parsed.searchParams.delete(p));
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return url;
  }
}

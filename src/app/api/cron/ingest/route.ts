/**
 * Combined news ingestion + AI processing cron route.
 *
 * Execution order per run:
 *  1. Authenticate (CRON_SECRET header or query param)
 *  2. Fetch RSS feeds (primary — unlimited, free) via Promise.allSettled
 *  3. Fetch one NewsAPI category (rotated per hour to stay ≤100 req/day)
 *  4. Deduplicate against last-24h articles in DB
 *  5. Insert unique articles into raw_articles
 *  6. AI-process unprocessed articles in batches of 30 with Claude
 *  7. Insert resulting DigestStory rows into digest_stories
 *  8. Prune raw_articles older than 72h to keep DB lean
 *
 * Triggered by Vercel Cron every 20 minutes.
 * Can also be triggered manually: GET /api/cron/ingest?secret=<CRON_SECRET>
 */

import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import Parser from 'rss-parser';
import { createServerClient } from '@/lib/supabase';
import { deduplicateArticles, getCurrentCategory, normalizeSourceUrl } from '@/lib/news-utils';
import { isWeekdayYomTov } from '@/lib/yomtov-utils';
import type {
  RawArticle,
  NewsApiResponse,
  NewsApiArticle,
  RssItem,
  ClaudeBatchResponse,
  ClaudeStory,
} from '@/types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RSS_FEEDS: Array<{ url: string; source: string; isIsrael: boolean; headers?: Record<string, string> }> = [
  { url: 'https://rsshub.app/apnews/topics/apf-topnews',          source: 'AP News',          isIsrael: false },
  { url: 'https://feeds.reuters.com/reuters/worldNews',            source: 'Reuters',           isIsrael: false },
  { url: 'https://feeds.bbci.co.uk/news/rss.xml',                 source: 'BBC',               isIsrael: false },
  { url: 'https://feeds.npr.org/1001/rss.xml',                    source: 'NPR',               isIsrael: false },
  { url: 'http://rss.cnn.com/rss/edition.rss',                    source: 'CNN',               isIsrael: false },
  { url: 'https://moxie.foxnews.com/google-publisher/latest.xml', source: 'Fox News',          isIsrael: false },
  { url: 'https://feeds.nbcnews.com/nbcnews/public/news/world',   source: 'NBC News',          isIsrael: false },
  // Israel / Middle East feeds
  { url: 'https://www.jpost.com/rss/rssfeedsfrontpage.aspx',       source: 'Jerusalem Post',  isIsrael: true },
  { url: 'https://www.jta.org/feed',                               source: 'JTA',             isIsrael: true },
  { url: 'https://www.israelhayom.com/feed/',                      source: 'Israel Hayom',    isIsrael: true },
  { url: 'https://rss.nytimes.com/services/xml/rss/nyt/MiddleEast.xml', source: 'NYT Middle East', isIsrael: true },
  { url: 'https://feeds.washingtonpost.com/rss/world',             source: 'WashPost World',  isIsrael: true },
  { url: 'https://www.aljazeera.com/xml/rss/all.xml',              source: 'Al Jazeera',      isIsrael: true },
  { url: 'https://www.middleeasteye.net/rss',                      source: 'Middle East Eye', isIsrael: true },
  { url: 'https://www.972mag.com/feed/',                           source: '+972 Magazine',   isIsrael: true },
];

const AI_BATCH_SIZE = 20;

const CLAUDE_SYSTEM_PROMPT = `You are a senior news editor creating a live briefing board for Orthodox Jewish families
during Shabbos and Yom Tov. Your job is to deliver only the most important, factual news
people can safely glance at on a wall-mounted screen.

CRITICAL CLUSTERING RULE: If multiple articles describe the same underlying event or situation,
you MUST cluster them into a SINGLE story. Use the same topic_slug for all of them. For example,
if 6 articles all discuss the US considering ground operations in Iran, those are ONE story, not six.
Err heavily on the side of merging — it is far worse to show duplicates than to miss a minor
distinction between articles. When in doubt, MERGE. A wall-mounted news board showing the same
story 7 times with trivially different headlines is broken and unusable.

For every batch of articles:

1. Score each article 1-100 on "importance" using this exact guide:
   - 90-100: War outbreak, major terror attack, head of state death/resignation, massive
     natural disaster, market crash (>5% move)
   - 70-89: Significant geopolitical event, major policy change, large-scale protest,
     notable death, important election result, central bank decision
   - 50-69: Notable news informed people should know — cabinet shakeup, major corporate
     news, significant legal ruling, scientific breakthrough
   - 30-49: Interesting but non-essential — trending stories, cultural moments,
     entertainment, sports milestones
   - 1-29: Minor/local/routine updates

2. Assign tier: "breaking" (80+), "major" (60-79), "notable" (40-59), "background" (<40)

3. Write a concise, glanceable headline (8-14 words max) readable from across a room.

4. Write a 1-2 sentence summary that gives full context. Assume zero prior knowledge.
   State facts only. Never use "as reported" or "sources say".

5. If multiple articles cover the same event, cluster them into ONE story and list all
   source article_ids.

Tone: neutral, factual, respectful. No sensationalism, no editorializing, no gratuitous
details that would violate the spirit of Shabbos.

Respond ONLY with valid JSON. No other text, no markdown fences, no explanation.
{
  "stories": [
    {
      "article_ids": ["uuid1", "uuid2"],
      "importance_score": 85,
      "tier": "breaking",
      "headline": "Clear headline readable from 10 feet away",
      "summary": "Full-context 1-2 sentence summary.",
      "topic_slug": "unique-slug-for-this-event"
    }
  ]
}`;

// ---------------------------------------------------------------------------
// Dedup helpers
// ---------------------------------------------------------------------------

function jaccardSimilarity(a: string, b: string): number {
  const words = (s: string) =>
    new Set(s.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(Boolean));
  const aW = words(a);
  const bW = words(b);
  const intersection = Array.from(aW).filter(w => bW.has(w)).length;
  const union = new Set([...Array.from(aW), ...Array.from(bW)]).size;
  return union > 0 ? intersection / union : 0;
}

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'as', 'to', 'in', 'for', 'of', 'and', 'amid', 'after',
  'over', 'while', 'with', 'by', 'on', 'at', 'from', 'is', 'are', 'was',
  'were', 'its', 'it', 'but', 'or', 'into', 'about', 'up', 'out', 'be',
  'not', 'has', 'have', 'will', 'that', 'than', 'says', 'said', 'new',
]);

function extractKeyWords(headline: string): string[] {
  return headline
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w))
    .slice(0, 5);
}

// Crude stemmer: strips common suffixes so drone/drones, launch/launches match.
function stemWord(w: string): string {
  return w.replace(/(?:ing|ed|ers?|es|s)$/, '');
}

function stemmedKeyWords(headline: string): string[] {
  return extractKeyWords(headline).map(stemWord);
}

const KNOWN_ENTITIES = new Set([
  'UK', 'US', 'EU', 'UN', 'NATO', 'Iran', 'Israel', 'Gaza', 'Hamas',
  'Hezbollah', 'IDF', 'China', 'Russia', 'Ukraine', 'Syria', 'Lebanon',
  'Saudi', 'Egypt', 'Jordan', 'Turkey', 'Iraq', 'Yemen', 'West',
  'Trump', 'Biden', 'Netanyahu', 'Putin', 'Xi', 'Macron', 'Zelensky',
  'BBC', 'CNN', 'FBI', 'CIA', 'WHO', 'IMF', 'Fed', 'OPEC',
  'Congress', 'Senate', 'Pentagon', 'Kremlin', 'Knesset',
]);

function extractEntities(headline: string): Set<string> {
  const entities = new Set<string>();
  const words = headline.split(/\s+/);
  for (let i = 0; i < words.length; i++) {
    const word = words[i].replace(/[^A-Za-z]/g, '');
    if (!word) continue;
    if (KNOWN_ENTITIES.has(word)) { entities.add(word); continue; }
    // Capitalised words that aren't sentence-openers
    if (i > 0 && /^[A-Z]/.test(word) && word.length > 1) entities.add(word);
  }
  return entities;
}

// ---------------------------------------------------------------------------
// Auth helper
// ---------------------------------------------------------------------------

function isAuthorized(req: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false; // Fail closed if secret not set

  // Vercel Cron sends the secret as a Bearer token
  const authHeader = req.headers.get('authorization');
  if (authHeader === `Bearer ${cronSecret}`) return true;

  // Allow manual triggering via query param (for local dev/testing)
  const { searchParams } = new URL(req.url);
  if (searchParams.get('secret') === cronSecret) return true;

  return false;
}

// ---------------------------------------------------------------------------
// RSS ingestion
// ---------------------------------------------------------------------------

type RssArticle = {
  title: string;
  description: string | null;
  content: string | null;
  source_name: string;
  source_url: string | null;
  published_at: string | null;
  image_url: string | null;
  category: string;
  duplicate_of: string | null;
};

async function fetchRssArticles(): Promise<{ articles: RssArticle[]; debugLines: string[] }> {
  const parser = new Parser({ timeout: 10000 });
  const debugLines: string[] = [];

  const results = await Promise.allSettled(
    RSS_FEEDS.map(async ({ url, source, isIsrael, headers: extraHeaders }) => {
      let status = 0;
      let bodyPreview = '';
      try {
        const res = await fetch(url, {
          signal:  AbortSignal.timeout(10000),
          headers: extraHeaders ?? {},
        });
        status = res.status;
        const body = await res.text();
        bodyPreview = body.substring(0, 200);
        if (!res.ok) throw new Error(`HTTP ${status}`);
        const feed = await parser.parseString(body);
        const items = (feed.items ?? []).slice(0, 20).map((item: RssItem) => ({
          title:       item.title ?? '',
          description: item.contentSnippet ?? null,
          content:     item.content ?? null,
          source_name: source,
          source_url:  item.link ? normalizeSourceUrl(item.link) : null,
          published_at: item.isoDate ?? null,
          image_url:   item.enclosure?.url ?? null,
          category:    'rss',
          duplicate_of: null,
        })).filter((a: RssArticle) => a.title.length > 5);
        if (isIsrael) {
          debugLines.push(`[Israel Feed Debug] ${source}: status=${status}, items=${items.length}, error=none`);
        }
        return items;
      } catch (err) {
        const errMsg = String(err).substring(0, 100);
        if (isIsrael) {
          debugLines.push(`[Israel Feed Debug] ${source}: status=${status}, items=0, error=${errMsg}`);
          debugLines.push(`[Israel Feed Debug] ${source} body preview: ${bodyPreview || '(no body)'}`);
        }
        return [];
      }
    })
  );

  const articles: RssArticle[] = [];
  for (const result of results) {
    if (result.status === 'fulfilled') articles.push(...result.value);
  }
  return { articles, debugLines };
}

// ---------------------------------------------------------------------------
// NewsAPI ingestion (one category per run)
// ---------------------------------------------------------------------------

async function fetchNewsApiArticles(category: string): Promise<
  Array<{
    title: string;
    description: string | null;
    content: string | null;
    source_name: string;
    source_url: string | null;
    published_at: string | null;
    image_url: string | null;
    category: string;
    duplicate_of: string | null;
  }>
> {
  const apiKey = process.env.NEWSAPI_KEY;
  if (!apiKey) return [];

  const apiCategory = category === 'world' ? 'general' : category;
  const url = `https://newsapi.org/v2/top-headlines?category=${apiCategory}&pageSize=20&language=en&apiKey=${apiKey}`;

  try {
    const res = await fetch(url, { next: { revalidate: 0 } });
    if (!res.ok) {
      console.error(`NewsAPI returned ${res.status} for category ${category}`);
      return [];
    }
    const data: NewsApiResponse = await res.json();
    if (data.status !== 'ok') return [];

    return (data.articles ?? [])
      .filter((a: NewsApiArticle) => a.title && a.title !== '[Removed]')
      .map((a: NewsApiArticle) => ({
        title: a.title,
        description: a.description,
        content: a.content,
        source_name: a.source.name,
        source_url: normalizeSourceUrl(a.url),
        published_at: a.publishedAt,
        image_url: a.urlToImage,
        category,
        duplicate_of: null,
      }));
  } catch (err) {
    console.error('NewsAPI fetch error:', err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// AI processing
// ---------------------------------------------------------------------------

async function processWithClaude(
  articles: Pick<RawArticle, 'id' | 'title' | 'description' | 'content' | 'source_name' | 'source_url' | 'published_at'>[]
): Promise<ClaudeStory[]> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const articlesSummary = articles.map((a) => ({
    id: a.id,
    title: a.title,
    description: a.description ?? '',
    source: a.source_name ?? 'Unknown',
    published_at: a.published_at ?? '',
  }));

  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 4096,
    system: CLAUDE_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Process these ${articles.length} news articles and return the JSON response:\n\n${JSON.stringify(articlesSummary, null, 2)}`,
      },
    ],
  });

  const responseText = message.content[0].type === 'text' ? message.content[0].text : '';

  try {
    // Strip any accidental markdown fences before parsing
    const cleaned = responseText.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    const parsed: ClaudeBatchResponse = JSON.parse(cleaned);
    return parsed.stories ?? [];
  } catch (err) {
    console.error('Failed to parse Claude response:', err, '\nRaw:', responseText.slice(0, 500));
    return [];
  }
}

// ---------------------------------------------------------------------------
// Main route handler
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServerClient();
  const runStart = Date.now();
  const log: string[] = [];

  // TEMPORARY ONE-TIME CLEANUP — remove after first run
  await supabase.from('digest_stories').delete().neq('id', '00000000-0000-0000-0000-000000000000');

  try {
    // -----------------------------------------------------------------------
    // Step 1: Fetch articles from all sources
    // -----------------------------------------------------------------------
    const category = getCurrentCategory();
    log.push(`Using NewsAPI category: ${category}`);

    const [{ articles: rssArticles, debugLines }, newsApiArticles] = await Promise.all([
      fetchRssArticles(),
      fetchNewsApiArticles(category),
    ]);
    log.push(...debugLines);

    const ISRAEL_SOURCES = new Set([
      'Jerusalem Post', 'JTA', 'Israel Hayom',
      'NYT Middle East', 'WashPost World', 'Al Jazeera', 'Middle East Eye', '+972 Magazine',
    ]);
    const sixHoursAgo    = Date.now() -  6 * 60 * 60 * 1000;
    const twelveHoursAgo = Date.now() - 12 * 60 * 60 * 1000;
    const allFetched = [...rssArticles, ...newsApiArticles];
    const allIncoming = allFetched.filter(a => {
      if (!a.published_at) return true;
      const published = new Date(a.published_at).getTime();
      const cutoff = ISRAEL_SOURCES.has(a.source_name ?? '') ? twelveHoursAgo : sixHoursAgo;
      return published > cutoff;
    });
    const skippedOld = allFetched.length - allIncoming.length;
    log.push(`Fetched: ${rssArticles.length} RSS + ${newsApiArticles.length} NewsAPI = ${allFetched.length} total, skipped ${skippedOld} older than 6/12h`);

    const israelSourceList = ['Jerusalem Post', 'JTA', 'Israel Hayom', 'NYT Middle East', 'WashPost World', 'Al Jazeera', 'Middle East Eye', '+972 Magazine'];
    const israelCounts = israelSourceList.map(s => `${s}: ${allIncoming.filter(a => a.source_name === s).length}`).join(', ');
    log.push(`[Israel Feeds] ${israelCounts}`);

    // -----------------------------------------------------------------------
    // Step 2: Deduplication against last 24h of DB articles
    // -----------------------------------------------------------------------
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: recentArticles } = await supabase
      .from('raw_articles')
      .select('id, title')
      .gte('fetched_at', since24h);

    const { unique, duplicates } = deduplicateArticles(allIncoming, recentArticles ?? []);
    log.push(`Dedup: ${unique.length} unique, ${duplicates.length} duplicates`);

    // -----------------------------------------------------------------------
    // Step 3: Insert unique articles
    // -----------------------------------------------------------------------
    let insertedArticles: RawArticle[] = [];

    if (unique.length > 0) {
      const { data: inserted, error: insertError } = await supabase
        .from('raw_articles')
        .insert(unique)
        .select();

      if (insertError) {
        console.error('Insert error:', insertError);
        log.push(`Insert error: ${insertError.message}`);
      } else {
        insertedArticles = inserted ?? [];
        log.push(`Inserted ${insertedArticles.length} articles`);
      }
    }

    // Also insert duplicate markers (with duplicate_of set) — skip for brevity, DB handles null processed
    if (duplicates.length > 0) {
      await supabase.from('raw_articles').insert(
        duplicates.map(({ article, duplicate_of }) => ({ ...article, duplicate_of, processed: true }))
      );
    }

    // -----------------------------------------------------------------------
    // Step 4: AI-process unprocessed articles (up to AI_BATCH_SIZE)
    // -----------------------------------------------------------------------
    const since6h = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
    const { data: unprocessed } = await supabase
      .from('raw_articles')
      .select('id, title, description, content, source_name, source_url, published_at, image_url')
      .eq('processed', false)
      .is('duplicate_of', null)
      .gte('fetched_at', since6h)
      .order('fetched_at', { ascending: false })
      .limit(AI_BATCH_SIZE);

    const toProcess = unprocessed ?? [];
    log.push(`Articles to AI-process: ${toProcess.length}`);

    if (toProcess.length > 0) {
      // ── Guard 1: too few articles to bother ────────────────────────────────
      if (toProcess.length < 8) {
        console.log(`[Ingest] Only ${toProcess.length} new articles, skipping Claude processing`);
        log.push(`Skipping Claude: only ${toProcess.length} articles (< 8 threshold)`);
        // fall through to pruning
      } else {
      // ── Guard 2: recent digest + few new articles ──────────────────────────
      const { data: latestDigest } = await supabase
        .from('digest_stories')
        .select('created_at')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const digestAgeMs = latestDigest?.created_at
        ? Date.now() - new Date(latestDigest.created_at).getTime()
        : Infinity;

      if (digestAgeMs < 60 * 60 * 1000 && toProcess.length < 8) {
        console.log(`[Ingest] Recent digest exists and only ${toProcess.length} new articles, skipping`);
        log.push(`Skipping Claude: digest is ${Math.round(digestAgeMs / 60000)}min old + only ${toProcess.length} articles (< 8 threshold)`);
        // fall through to pruning
      } else {
      // ── Clean up stale digest stories before cap check ────────────────────
      const cutoff12h = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
      const { error: staleErr } = await supabase
        .from('digest_stories')
        .delete()
        .lt('created_at', cutoff12h);
      if (staleErr) log.push(`Stale digest clear error: ${staleErr.message}`);

      // ── Guard 3: hard cap on current live stories ─────────────────────────
      const { count: storiesToday } = await supabase
        .from('digest_stories')
        .select('*', { count: 'exact', head: true });

      if ((storiesToday ?? 0) >= 60) {
        console.log(`[Ingest] Story cap reached (${storiesToday} live stories), skipping Claude`);
        log.push(`Skipping Claude: story cap reached (${storiesToday}/60 live stories)`);
        // fall through to pruning
      } else {
      // ── Guard 4: pre-filter articles already covered by existing stories ───
      const { data: existingStories } = await supabase
        .from('digest_stories')
        .select('headline');

      const existingHeadlines = (existingStories ?? []).map(s => s.headline as string);
      const coveredIds: string[] = [];

      const toSendToClaude = toProcess.filter(article => {
        const articleKW = stemmedKeyWords(article.title);
        const covered = existingHeadlines.some(h => {
          if (jaccardSimilarity(article.title, h) > 0.4) return true;
          const storyKW = new Set(stemmedKeyWords(h));
          return articleKW.filter(w => storyKW.has(w)).length >= 3;
        });
        if (covered) coveredIds.push(article.id);
        return !covered;
      });

      if (coveredIds.length > 0) {
        console.log(`[Ingest] Skipped ${coveredIds.length} articles already covered by existing stories`);
        log.push(`Pre-filtered ${coveredIds.length} articles already covered by existing stories`);
        await supabase.from('raw_articles').update({ processed: true }).in('id', coveredIds);
      }

      if (toSendToClaude.length === 0) {
        log.push('All articles pre-filtered — skipping Claude');
      } else {
      log.push(`Sending ${toSendToClaude.length} articles to Claude`);
      const stories = await processWithClaude(toSendToClaude);
      log.push(`Claude returned ${stories.length} stories`);

      // ── Israel/ME importance boost (+15, capped at 100) ──────────────────
      const israelKeywords = [
        'israel', 'israeli', 'jerusalem', 'tel aviv', 'idf', 'gaza', 'hamas',
        'hezbollah', 'iran', 'iranian', 'houthi', 'west bank', 'netanyahu',
        'knesset', 'mossad', 'kibbutz', 'negev', 'golan', 'lebanon',
        'palestinian', 'intifada', 'shin bet', 'iron dome', 'tzahal',
        'hostage', 'hostages', 'sinwar', 'gallant', 'smotrich', 'ben gvir',
      ];
      let boostedCount = 0;
      for (const story of stories) {
        const text = `${story.headline} ${story.summary}`.toLowerCase();
        if (israelKeywords.some(kw => text.includes(kw))) {
          story.importance_score = Math.min(100, story.importance_score + 20);
          if (story.importance_score >= 80)      story.tier = 'breaking';
          else if (story.importance_score >= 60) story.tier = 'major';
          else if (story.importance_score >= 40) story.tier = 'notable';
          else                                   story.tier = 'background';
          boostedCount++;
        }
      }
      if (boostedCount > 0) log.push(`Israel boost applied to ${boostedCount} stories`);
      log.push(`[Scoring] Top 5: ${JSON.stringify(stories.slice(0, 5).map(s => ({ headline: s.headline.slice(0, 60), score: s.importance_score, tier: s.tier })))}`);

      // ── Market news boost (weekday Yom Tov only) ─────────────────────────
      const defaultZip = process.env.DEFAULT_ZIP ?? '11598';
      if (await isWeekdayYomTov(defaultZip)) {
        const marketKeywords = [
          'fed', 'federal reserve', 'rate cut', 'rate hike', 'interest rate',
          'inflation', 'cpi', 'pce', 'gdp', 'jobs report', 'payroll', 'unemployment',
          's&p', 'nasdaq', 'dow jones', 'wall street', 'stock market', 'equities',
          'treasury', 'yield', 'bond', 'deficit', 'debt ceiling',
          'earnings', 'ipo', 'merger', 'acquisition',
          'crude oil', 'opec', 'gold price', 'bitcoin', 'crypto',
          'dollar', 'euro', 'forex', 'currency', 'exchange rate',
          'recession', 'stimulus', 'tariff', 'trade war', 'sanctions',
        ];
        let marketBoosted = 0;
        for (const story of stories) {
          const text = `${story.headline} ${story.summary}`.toLowerCase();
          if (marketKeywords.some(kw => text.includes(kw))) {
            story.importance_score = Math.min(100, story.importance_score + 10);
            if (story.importance_score >= 80)      story.tier = 'breaking';
            else if (story.importance_score >= 60) story.tier = 'major';
            else if (story.importance_score >= 40) story.tier = 'notable';
            else                                   story.tier = 'background';
            marketBoosted++;
          }
        }
        if (marketBoosted > 0)
          log.push(`[MarketBoost] Weekday Yom Tov — boosted ${marketBoosted} financial stories`);
        console.log('[MarketBoost] Weekday yom tov detected — financial news boosted');
      }

      // ── Post-processing dedup ─────────────────────────────────────────────
      // Pass 1: group by topic_slug — keep only the highest-scored per topic.
      const topicMap = new Map<string, ClaudeStory>();
      for (const story of stories) {
        const key      = story.topic_slug || story.headline.slice(0, 40).toLowerCase();
        const existing = topicMap.get(key);
        if (!existing || story.importance_score > existing.importance_score) {
          topicMap.set(key, story);
        }
      }

      // Pass 2: pairwise headline Jaccard overlap check (≥50% = duplicate).
      const pass2Input   = Array.from(topicMap.values());
      const jaccardKept: ClaudeStory[] = [];
      for (const story of pass2Input) {
        let isDup  = false;
        let dupIdx = -1;
        for (let i = 0; i < jaccardKept.length; i++) {
          if (jaccardSimilarity(story.headline, jaccardKept[i].headline) >= 0.5) {
            isDup  = true;
            dupIdx = i;
            break;
          }
        }
        if (!isDup) {
          jaccardKept.push(story);
        } else if (story.importance_score > jaccardKept[dupIdx].importance_score) {
          jaccardKept[dupIdx] = story;
        }
      }

      // Pass 3: key-word overlap check — sort by score desc, then skip any story
      // where 3+ of its first 5 meaningful words already appear in a kept story.
      const pass3Input = jaccardKept.sort((a, b) => b.importance_score - a.importance_score);
      const finalStories: ClaudeStory[] = [];
      for (const story of pass3Input) {
        const keyWords = extractKeyWords(story.headline);
        let isDup = false;
        for (const kept of finalStories) {
          const keptKeyWords = new Set(extractKeyWords(kept.headline));
          const matches = keyWords.filter(w => keptKeyWords.has(w)).length;
          if (matches >= 3) { isDup = true; break; }
        }
        if (!isDup) finalStories.push(story);
      }

      // Pass 4: entity-based dedup — same primary source + 2+ shared entities = duplicate.
      // finalStories is already sorted desc by score from Pass 3; keep the first (highest).
      const articleSourceMap = new Map(toSendToClaude.map(a => [a.id, a.source_name ?? '']));
      const primarySource = (s: ClaudeStory) => articleSourceMap.get(s.article_ids[0]) ?? '';
      const entityKept: ClaudeStory[] = [];
      let entityDropped = 0;
      for (const story of finalStories) {
        const src      = primarySource(story);
        const entities = extractEntities(story.headline);
        let isDup = false;
        for (const kept of entityKept) {
          if (primarySource(kept) !== src) continue;
          const keptEntities = extractEntities(kept.headline);
          const shared = Array.from(entities).filter(e => keptEntities.has(e)).length;
          if (shared >= 2) { isDup = true; break; }
        }
        if (!isDup) entityKept.push(story);
        else entityDropped++;
      }
      if (entityDropped > 0) log.push(`[Dedup] Entity pass removed ${entityDropped} near-duplicate stories`);

      // Source cap: keep at most 3 stories per primary source, ranked by score.
      const SOURCE_CAP = 3;
      const sourceCounts = new Map<string, number>();
      const cappedStories: ClaudeStory[] = [];
      for (const story of entityKept) {
        const src = primarySource(story);
        const count = sourceCounts.get(src) ?? 0;
        if (count < SOURCE_CAP) {
          cappedStories.push(story);
          sourceCounts.set(src, count + 1);
        } else {
          if (count === SOURCE_CAP) {
            const dropped = entityKept.filter(s => primarySource(s) === src).length - SOURCE_CAP;
            log.push(`[SourceCap] Capped ${src || 'unknown'}: kept ${SOURCE_CAP}, dropped ${dropped}`);
            sourceCounts.set(src, SOURCE_CAP + 1); // prevent logging again for same source
          }
        }
      }

      // Cross-run dedup: drop new stories whose stemmed keywords (3+) match an
      // existing digest_stories headline — catches inter-run near-duplicates that
      // within-batch passes miss (e.g. 10 variations of "Iran launches X at Y").
      const existingTopicSlugs = new Set((existingStories ?? []).map(s => (s as { topic_slug?: string }).topic_slug).filter(Boolean));
      const crossRunFiltered = cappedStories.filter(story => {
        if (story.topic_slug && existingTopicSlugs.has(story.topic_slug)) return false;
        const newKW = stemmedKeyWords(story.headline);
        return !existingHeadlines.some(h => {
          const exKW = new Set(stemmedKeyWords(h));
          return newKW.filter(w => exKW.has(w)).length >= 3;
        });
      });
      const crossDropped = cappedStories.length - crossRunFiltered.length;
      if (crossDropped > 0) log.push(`[Dedup] Cross-run removed ${crossDropped} stories already in digest`);

      const removedCount = stories.length - crossRunFiltered.length;
      if (removedCount > 0) log.push(`[Dedup] ${removedCount} total removed (${stories.length} raw → ${crossRunFiltered.length} final)`);

      // Build a lookup: article_id → source info
      const articleLookup = new Map(toSendToClaude.map((a) => [a.id, a]));

      if (crossRunFiltered.length > 0) {
        const digestRows = crossRunFiltered.map((story) => {
          const sourceArticles = story.article_ids
            .map((id) => articleLookup.get(id))
            .filter(Boolean) as typeof toProcess;

          // Collect source names and URLs, dedup
          const sourceNames = Array.from(new Set(sourceArticles.map((a) => a.source_name).filter(Boolean)));
          const sourceUrls = Array.from(new Set(sourceArticles.map((a) => a.source_url).filter(Boolean)));

          // Use the most recent published_at from contributing articles
          const publishedAt = sourceArticles
            .map((a) => a.published_at)
            .filter(Boolean)
            .sort()
            .pop() ?? new Date().toISOString();

          // Pick an image from the first contributing article that has one
          const imageUrl = sourceArticles.find((a) => (a as RawArticle & { image_url?: string }).image_url)
            ? (sourceArticles.find((a) => (a as RawArticle & { image_url?: string }).image_url) as RawArticle & { image_url?: string }).image_url
            : null;

          return {
            headline: story.headline,
            summary: story.summary,
            importance_score: story.importance_score,
            tier: story.tier,
            topic_slug: story.topic_slug,
            source_article_ids: story.article_ids,
            source_names: sourceNames as string[],
            source_urls: sourceUrls as string[],
            image_url: imageUrl ?? null,
            published_at: publishedAt,
          };
        });

        const { error: digestError } = await supabase.from('digest_stories').insert(digestRows);
        if (digestError) {
          log.push(`Digest insert error: ${digestError.message}`);
        } else {
          log.push(`Inserted ${digestRows.length} digest stories`);
        }
      }

      // Mark all Claude-processed articles
      const processedIds = toSendToClaude.map((a) => a.id);
      await supabase
        .from('raw_articles')
        .update({ processed: true })
        .in('id', processedIds);
      } // end toSendToClaude.length > 0
      } // end guard 3 (daily cap)
      } // end guard 2 (recent digest)
      } // end guard 1 (min articles)
    }

    // -----------------------------------------------------------------------
    // Step 5: Prune raw_articles older than 72h to prevent DB bloat
    // -----------------------------------------------------------------------
    // Prune in batches of 500 to avoid statement timeouts on large tables.
    const cutoff72h = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
    let pruneTotal = 0;
    let pruneErr: string | null = null;
    for (let i = 0; i < 20; i++) {
      const { data: batch } = await supabase
        .from('raw_articles')
        .select('id')
        .lt('fetched_at', cutoff72h)
        .limit(500);
      if (!batch || batch.length === 0) break;
      const ids = batch.map((r) => r.id);
      const { error } = await supabase.from('raw_articles').delete().in('id', ids);
      if (error) { pruneErr = error.message; break; }
      pruneTotal += ids.length;
      if (ids.length < 500) break;
    }
    if (pruneErr) log.push(`Prune error: ${pruneErr}`);
    else log.push(`Pruned ${pruneTotal} old articles`);

    // -----------------------------------------------------------------------
    // Done
    // -----------------------------------------------------------------------
    const duration = Date.now() - runStart;
    return NextResponse.json({
      ok: true,
      duration_ms: duration,
      log,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Ingest cron error:', err);
    return NextResponse.json({ ok: false, error: message, log }, { status: 500 });
  }
}

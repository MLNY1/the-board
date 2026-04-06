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
import { getShabbosWindow, getYomTovWindows } from '@/lib/shabbos-times';
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
  // Major wire services & broadcast
  { url: 'https://rsshub.app/apnews/topics/apf-topnews',                    source: 'AP News',            isIsrael: false },
  { url: 'https://feeds.reuters.com/reuters/worldNews',                      source: 'Reuters',             isIsrael: false },
  { url: 'https://feeds.npr.org/1001/rss.xml',                              source: 'NPR',                 isIsrael: false },
  { url: 'http://rss.cnn.com/rss/edition.rss',                              source: 'CNN',                 isIsrael: false },
  { url: 'https://feeds.nbcnews.com/nbcnews/public/news/world',             source: 'NBC News',            isIsrael: false },
  // Prestige print & wire
  { url: 'https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml',       source: 'New York Times',      isIsrael: false },
  { url: 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml',          source: 'New York Times',      isIsrael: false },
  { url: 'https://feeds.bloomberg.com/markets/news.rss',                    source: 'Bloomberg',           isIsrael: false },
  { url: 'https://feeds.bloomberg.com/politics/news.rss',                   source: 'Bloomberg',           isIsrael: false },
  { url: 'http://online.wsj.com/xml/rss/3_7011.xml',                        source: 'Wall Street Journal', isIsrael: false },
  { url: 'https://www.economist.com/latest/rss.xml',                        source: 'The Economist',       isIsrael: false },
  // US politics & policy
  { url: 'https://api.axios.com/feed/',                                      source: 'Axios',               isIsrael: false },
  { url: 'https://www.politico.com/rss/politicopicks.xml',                   source: 'Politico',            isIsrael: false },
  { url: 'https://thehill.com/feed/',                                        source: 'The Hill',            isIsrael: false },
  // Business & markets
  { url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html',           source: 'CNBC',                isIsrael: false },
  { url: 'https://feeds.marketwatch.com/marketwatch/topstories/',            source: 'MarketWatch',         isIsrael: false },
  // International & analysis
  { url: 'https://www.theguardian.com/world/rss',                            source: 'The Guardian',        isIsrael: false },
  { url: 'https://feeds.washingtonpost.com/rss/world',                       source: 'Washington Post',     isIsrael: false },
  { url: 'https://rss.dw.com/xml/rss-en-all',                               source: 'Deutsche Welle',      isIsrael: false },
  { url: 'https://www.france24.com/en/rss',                                  source: 'France 24',           isIsrael: false },
  { url: 'https://feeds.bbci.co.uk/news/rss.xml',                           source: 'BBC',                 isIsrael: false },
  // Science & technology
  { url: 'https://feeds.arstechnica.com/arstechnica/index',                  source: 'Ars Technica',        isIsrael: false },
  { url: 'https://www.theverge.com/rss/index.xml',                           source: 'The Verge',           isIsrael: false },
  // Israel feeds
  { url: 'https://www.jpost.com/rss/rssfeedsfrontpage.aspx',                 source: 'Jerusalem Post',      isIsrael: true },
  { url: 'https://www.jta.org/feed',                                         source: 'JTA',                 isIsrael: true },
  { url: 'https://www.algemeiner.com/feed/',                                  source: 'Algemeiner',          isIsrael: true },
  { url: 'https://www.israelhayom.com/feed/',                                 source: 'Israel Hayom',        isIsrael: true },
  { url: 'https://rss.nytimes.com/services/xml/rss/nyt/MiddleEast.xml',      source: 'NYT Middle East',     isIsrael: true },
  // Al Jazeera, Middle East Eye, +972 Magazine removed — editorial slant distorts global balance
];

const AI_BATCH_SIZE = 40;

// ---------------------------------------------------------------------------
// Source prestige weights for heuristic pre-filter
// ---------------------------------------------------------------------------

const SOURCE_PRESTIGE: Record<string, number> = {
  // Tier 1 — high prestige (+35 pts)
  'Reuters':              35,
  'AP News':              35,
  'New York Times':       35,
  'NYT Middle East':      30,
  'Bloomberg':            35,
  'Wall Street Journal':  35,
  'The Economist':        30,
  // Tier 2 — medium prestige (+15 pts)
  'NPR':                  15,
  'Axios':                15,
  'Politico':             15,
  'CNBC':                 15,
  'Washington Post':      15,
  'Deutsche Welle':       15,
  'France 24':            15,
  'MarketWatch':          10,
  'NBC News':              5,
  // Tier 3 — lower prestige (0 pts)
  'BBC':                   0,
  'The Guardian':          0,
  'CNN':                   0,
  'Fox News':            -10,
  'The Hill':              0,
  // Israel/ME
  'Jerusalem Post':       10,
  'JTA':                  10,
  'Algemeiner':            5,
  'Israel Hayom':          5,
};

const IMPORTANCE_KEYWORDS = [
  // World events & politics
  'election', 'elected', 'vote', 'president', 'prime minister', 'chancellor',
  'war', 'attack', 'missile', 'strike', 'nuclear', 'troops', 'military',
  'ceasefire', 'peace', 'treaty', 'summit', 'diplomacy', 'sanction',
  'coup', 'protest', 'assassination', 'referendum',
  // Economy & markets
  'economy', 'gdp', 'inflation', 'recession', 'interest rate', 'federal reserve',
  'market', 'tariff', 'trade war', 'collapse', 'crisis', 'earnings', 'ipo',
  // Science, tech, climate
  'breakthrough', 'discovery', 'artificial intelligence', 'climate',
  'vaccine', 'earthquake', 'hurricane', 'wildfire', 'space',
  // Security & law
  'terrorism', 'cybersecurity', 'hack', 'supreme court', 'ruling', 'legislation',
  'congress', 'senate', 'parliament',
];

function heuristicScore(
  article: { title: string; description?: string | null; source_name?: string | null; published_at?: string | null },
  now: number,
): number {
  let score = 50; // base

  // Source prestige
  score += SOURCE_PRESTIGE[article.source_name ?? ''] ?? 0;

  // Recency: 0–25 pts (full at <1 h, slides to 0 at ~6 h)
  if (article.published_at) {
    const ageH = (now - new Date(article.published_at).getTime()) / 3_600_000;
    score += Math.max(0, Math.round(25 - ageH * 4.2));
  }

  // Keyword importance (up to 25 pts)
  const text = `${article.title} ${article.description ?? ''}`.toLowerCase();
  const kwMatches = IMPORTANCE_KEYWORDS.filter(kw => text.includes(kw)).length;
  score += Math.min(25, kwMatches * 5);

  return score;
}

const CLAUDE_SYSTEM_PROMPT = `You are curating global news stories for a high-quality always-on news dashboard. Your goal: give a well-informed reader 12-20 distinct stories that together paint a clear picture of what is happening in the world today — politics, economy, security, science/tech, international developments.

CRITICAL CLUSTERING RULE: If multiple articles describe the same underlying event, cluster them into ONE story with the same topic_slug. Six articles about the same ceasefire negotiation = ONE story. Err heavily toward merging. Showing the same story twice is far worse than missing a nuance.

For each article or cluster:
- Write a neutral, concise, fact-focused headline (8-14 words) readable from across a room.
- Write a 1-2 sentence summary with full context. No prior knowledge assumed. Facts only.
- Assign tier: breaking / major / notable / background
- Assign importance_score 1-100.
- Assign a short topic_slug (e.g. "us-election-2028", "middle-east-security", "global-markets").

Score rubric:
- 85-100 (breaking): War outbreak, head of state death/resignation, massive disaster, market crash >5%
- 65-84 (major): Major geopolitical event, significant policy shift, election result, central bank decision, large protest, notable death
- 45-64 (notable): Cabinet shakeup, important corporate news, legal ruling, scientific breakthrough, significant tech development
- 30-44 (background): Interesting to a well-informed reader — earnings, economic indicators, tech launches, cultural moments, sports milestones

Be INCLUSIVE at the bottom end. A story worth knowing about should be scored 30+.
Only score below 30 for things that are truly minor, local, or purely routine.
Do not drop stories just because they are not geopolitical — business, science, tech, and culture all belong on the board.
Do not favor any regional or editorial slant. Cover the world, not one region.
Tone: neutral, factual. No sensationalism, no editorializing.

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
    .slice(0, 8);
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
        const items = (feed.items ?? []).slice(0, 25).map((item: RssItem) => ({
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
    max_tokens: 8000,
    system: CLAUDE_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Process these ${articles.length} news articles and return the JSON response:\n\n${JSON.stringify(articlesSummary, null, 2)}`,
      },
    ],
  });

  const responseText = message.content[0].type === 'text' ? message.content[0].text : '';
  const stopReason = message.stop_reason;

  try {
    // Strip any accidental markdown fences before parsing
    const cleaned = responseText.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    if (!cleaned) {
      console.error('Claude returned empty response. stop_reason:', stopReason);
      return [];
    }
    const parsed: ClaudeBatchResponse = JSON.parse(cleaned);
    if (stopReason === 'max_tokens') {
      console.warn('Claude hit max_tokens — response may be truncated, partial stories returned');
    }
    return parsed.stories ?? [];
  } catch (err) {
    console.error('Failed to parse Claude response. stop_reason:', stopReason, '\nError:', err, '\nRaw:', responseText.slice(0, 500));
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

  // Manual override: ?deep=true forces the extended age window.
  // Automatic: if we are within 3 hours of candle lighting (Shabbat or Yom Tov),
  // activate the deep refresh so the last Shabbos run has a rich article pool.
  const manualDeep = new URL(req.url).searchParams.get('deep') === 'true';
  let isDeepRefresh = manualDeep;
  if (!isDeepRefresh) {
    try {
      const defaultZip = process.env.DEFAULT_ZIP ?? '11598';
      const THREE_HOURS_MS = 3 * 60 * 60 * 1000;
      const now = Date.now();

      // Check upcoming Shabbat candle lighting
      const shabbosWindow = await getShabbosWindow(defaultZip).catch(() => null);
      if (shabbosWindow && shabbosWindow.start.getTime() > now) {
        const msTilCandles = shabbosWindow.start.getTime() - now;
        if (msTilCandles <= THREE_HOURS_MS) isDeepRefresh = true;
      }

      // Check upcoming Yom Tov start
      if (!isDeepRefresh) {
        const ytWindows = await getYomTovWindows(defaultZip).catch(() => []);
        for (const yt of ytWindows) {
          if (yt.start.getTime() > now) {
            const msTilYT = yt.start.getTime() - now;
            if (msTilYT <= THREE_HOURS_MS) { isDeepRefresh = true; break; }
          }
        }
      }
    } catch {
      // Hebcal unavailable — skip auto deep refresh, normal window applies
    }
  }
  if (isDeepRefresh) log.push('[DeepRefresh] Extended age window active (15h general) — within 3h of candle lighting');

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
      'Jerusalem Post', 'JTA', 'Algemeiner', 'Israel Hayom', 'NYT Middle East',
    ]);
    const JP_FLOOR = 4; // guaranteed minimum Jerusalem Post stories on the board
    // Deep refresh extends the general window from 6h to 15h (pre-Shabbos sweep)
    const generalWindowH     = isDeepRefresh ? 15 : 6;
    const sixHoursAgo        = Date.now() -  generalWindowH * 60 * 60 * 1000;
    const twelveHoursAgo     = Date.now() - 12 * 60 * 60 * 1000;
    const twentyFourHoursAgo = Date.now() - 24 * 60 * 60 * 1000;
    const allFetched = [...rssArticles, ...newsApiArticles];
    const allIncoming = allFetched.filter(a => {
      if (!a.published_at) return true;
      const published = new Date(a.published_at).getTime();
      // JP gets a 24h window; other Israel sources 12h; general 6h (15h deep)
      const cutoff = a.source_name === 'Jerusalem Post' ? twentyFourHoursAgo
                   : ISRAEL_SOURCES.has(a.source_name ?? '') ? twelveHoursAgo
                   : sixHoursAgo;
      return published > cutoff;
    });
    const skippedOld = allFetched.length - allIncoming.length;
    log.push(`Fetched: ${rssArticles.length} RSS + ${newsApiArticles.length} NewsAPI = ${allFetched.length} total, skipped ${skippedOld} older than 6/12h`);

    const israelSourceList = ['Jerusalem Post', 'JTA', 'Algemeiner', 'Israel Hayom', 'NYT Middle East'];
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

    const toProcess = [...(unprocessed ?? [])];

    // Supplement with unprocessed JP articles from last 24h so JP always has raw material
    const since24hJP = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const existingToProcessIds = new Set(toProcess.map(a => a.id));
    const { data: jpExtra } = await supabase
      .from('raw_articles')
      .select('id, title, description, content, source_name, source_url, published_at, image_url')
      .eq('source_name', 'Jerusalem Post')
      .eq('processed', false)
      .is('duplicate_of', null)
      .gte('fetched_at', since24hJP)
      .order('fetched_at', { ascending: false })
      .limit(10);
    for (const a of jpExtra ?? []) {
      if (!existingToProcessIds.has(a.id)) toProcess.push(a);
    }
    if ((jpExtra ?? []).length > 0)
      log.push(`JP top-up: added ${(jpExtra ?? []).filter(a => !existingToProcessIds.has(a.id)).length} extra JP articles`);

    log.push(`Articles to AI-process: ${toProcess.length}`);

    if (toProcess.length > 0) {
      // ── Guard 1: too few articles to bother ────────────────────────────────
      if (toProcess.length < 3) {
        console.log(`[Ingest] Only ${toProcess.length} new articles, skipping Claude processing`);
        log.push(`Skipping Claude: only ${toProcess.length} articles (< 3 threshold)`);
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

      if (digestAgeMs < 90 * 60 * 1000 && toProcess.length < 10) {
        console.log(`[Ingest] Recent digest exists and only ${toProcess.length} new articles, skipping`);
        log.push(`Skipping Claude: digest is ${Math.round(digestAgeMs / 60000)}min old + only ${toProcess.length} articles (< 10 threshold)`);
        // fall through to pruning
      } else {
      // ── Clean up stale digest stories before cap check ────────────────────
      const cutoff12h = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
      const { error: staleErr } = await supabase
        .from('digest_stories')
        .delete()
        .lt('created_at', cutoff12h);
      if (staleErr) log.push(`Stale digest clear error: ${staleErr.message}`);

      // ── Enforce source cap retroactively ─────────────────────────────────
      // Fetch all live stories grouped by source; delete excess beyond SOURCE_CAP,
      // keeping the highest-scored ones. Fixes any over-cap state from before this
      // logic existed.
      const ENFORCE_CAP = 4;
      const SOURCE_CAP_OVERRIDES: Record<string, number> = { 'BBC': 2 };
      const { data: allLive } = await supabase
        .from('digest_stories')
        .select('id, source_names, importance_score')
        .order('importance_score', { ascending: false });

      const liveBySource = new Map<string, { id: string; importance_score: number }[]>();
      for (const s of allLive ?? []) {
        const src = ((s as { source_names?: string[] }).source_names ?? [])[0] ?? '';
        if (!src) continue;
        if (!liveBySource.has(src)) liveBySource.set(src, []);
        liveBySource.get(src)!.push({ id: s.id, importance_score: s.importance_score });
      }
      const overCapIds: string[] = [];
      Array.from(liveBySource.entries()).forEach(([src, srcStories]) => {
        if (src === 'Jerusalem Post') return; // JP has guaranteed floor, never auto-trimmed
        const cap = SOURCE_CAP_OVERRIDES[src] ?? ENFORCE_CAP;
        if (srcStories.length > cap) {
          const excess = srcStories.slice(cap);
          overCapIds.push(...excess.map(s => s.id));
          log.push(`[CapEnforce] ${src}: removing ${excess.length} over-cap stories (cap=${cap})`);
        }
      });
      if (overCapIds.length > 0) {
        await supabase.from('digest_stories').delete().in('id', overCapIds);
      }

      // ── Retroactive headline dedup ────────────────────────────────────────
      // Remove near-duplicate headlines from existing stories, keeping the
      // highest-scored version of each topic. Fixes duplicates that slipped
      // through in previous runs.
      const liveForDedup = (allLive ?? []).filter(s => !overCapIds.includes(s.id)) as
        { id: string; importance_score: number; source_names?: string[] }[];
      // Fetch headlines for dedup (allLive didn't include them)
      const { data: liveHeadlines } = await supabase
        .from('digest_stories')
        .select('id, headline, importance_score')
        .order('importance_score', { ascending: false });

      const headlineDupIds: string[] = [];
      const keptHeadlineStories: { id: string; headline: string; importance_score: number }[] = [];
      for (const s of liveHeadlines ?? []) {
        const story = s as { id: string; headline: string; importance_score: number };
        const isDup = keptHeadlineStories.some(
          k => jaccardSimilarity(story.headline, k.headline) >= 0.4
        );
        if (isDup) headlineDupIds.push(story.id);
        else keptHeadlineStories.push(story);
      }
      if (headlineDupIds.length > 0) {
        await supabase.from('digest_stories').delete().in('id', headlineDupIds);
        log.push(`[HeadlineDedup] Removed ${headlineDupIds.length} near-duplicate headlines`);
      }

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
        .select('id, headline, topic_slug, source_names, importance_score');

      type ExistingStory = { id: string; headline: string; topic_slug?: string; source_names?: string[]; importance_score: number };
      const existing = (existingStories ?? []) as ExistingStory[];

      const existingHeadlines = existing.map(s => s.headline);

      // Build per-source story list for displacement logic.
      const existingSourceStories = new Map<string, ExistingStory[]>();
      for (const s of existing) {
        const primary = (s.source_names ?? [])[0] ?? '';
        if (!primary) continue;
        if (!existingSourceStories.has(primary)) existingSourceStories.set(primary, []);
        existingSourceStories.get(primary)!.push(s);
      }
      const existingSourceCounts = new Map<string, number>(
        Array.from(existingSourceStories.entries()).map(([src, arr]) => [src, arr.length] as [string, number])
      );
      const coveredIds: string[] = [];
      const jpCurrentCount = existingSourceStories.get('Jerusalem Post')?.length ?? 0;

      const toSendToClaude = toProcess.filter(article => {
        const isJP = article.source_name === 'Jerusalem Post';
        // JP articles bypass coverage pre-filter when JP is below its guaranteed floor
        if (isJP && jpCurrentCount < JP_FLOOR) return true;

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
      // ── Heuristic scoring: pick top 30 before sending to Claude ─────────────
      // Scores articles by source prestige, recency, and importance keywords so
      // Claude receives the highest-quality slice rather than a random 40.
      const hNow = Date.now();
      const hScored = toSendToClaude
        .map(a => ({ article: a, hs: heuristicScore(a, hNow) }))
        .sort((x, y) => y.hs - x.hs);
      const TARGET_BATCH = 20;
      const batchForClaude = hScored.slice(0, TARGET_BATCH).map(x => x.article);
      const hDropped = hScored.slice(TARGET_BATCH).map(x => x.article);
      if (hDropped.length > 0) {
        log.push(`[Heuristic] Trimmed ${hDropped.length} lower-priority articles (kept ${batchForClaude.length})`);
        await supabase.from('raw_articles').update({ processed: true }).in('id', hDropped.map(a => a.id));
      }

      // ── Quality gate: skip Claude if top batch has nothing important ──────────
      // If the highest heuristic score in the batch is below 80, there are no
      // prestige-source or keyword-rich articles — nothing meaningful enough to
      // justify a Claude call.
      const topHScore = hScored[0]?.hs ?? 0;
      if (topHScore < 65) {
        log.push(`Skipping Claude: top heuristic score ${topHScore} < 65, no worthwhile articles in batch`);
        await supabase.from('raw_articles').update({ processed: true }).in('id', batchForClaude.map(a => a.id));
      } else {
      log.push(`Sending ${batchForClaude.length} articles to Claude (top heuristic score: ${topHScore})`);
      const stories = await processWithClaude(batchForClaude);
      log.push(`Claude returned ${stories.length} stories`);

      // ── Hard minimum: drop genuinely trivial stories (below 30) ─────────────
      const minScore = 30;
      const belowMin = stories.filter(s => s.importance_score < minScore);
      if (belowMin.length > 0) {
        log.push(`[ScoreFilter] Dropped ${belowMin.length} stories below score ${minScore}`);
      }
      const aboveMin = stories.filter(s => s.importance_score >= minScore);

      // ── Israel/ME importance boost (+15, capped at 100) ──────────────────
      const israelKeywords = [
        'israel', 'israeli', 'jerusalem', 'tel aviv', 'idf', 'gaza', 'hamas',
        'hezbollah', 'iran', 'iranian', 'houthi', 'west bank', 'netanyahu',
        'knesset', 'mossad', 'kibbutz', 'negev', 'golan', 'lebanon',
        'palestinian', 'intifada', 'shin bet', 'iron dome', 'tzahal',
        'hostage', 'hostages', 'sinwar', 'gallant', 'smotrich', 'ben gvir',
      ];
      let boostedCount = 0;
      for (const story of aboveMin) {
        const text = `${story.headline} ${story.summary}`.toLowerCase();
        if (israelKeywords.some(kw => text.includes(kw))) {
          story.importance_score = Math.min(100, story.importance_score + 15);
          if (story.importance_score >= 80)      story.tier = 'breaking';
          else if (story.importance_score >= 60) story.tier = 'major';
          else if (story.importance_score >= 40) story.tier = 'notable';
          else                                   story.tier = 'background';
          boostedCount++;
        }
      }
      if (boostedCount > 0) log.push(`Israel boost applied to ${boostedCount} stories`);
      log.push(`[Scoring] Top 5: ${JSON.stringify(aboveMin.slice(0, 5).map(s => ({ headline: s.headline.slice(0, 60), score: s.importance_score, tier: s.tier })))}`);

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
        for (const story of aboveMin) {
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
      // Pass 1: topic_slug soft cap — keep top 3 per slug (allows distinct sub-stories
      // while preventing one topic from flooding the board).
      const TOPIC_BATCH_CAP = 3;
      const topicCounts = new Map<string, number>();
      const topicCapped: ClaudeStory[] = [];
      for (const story of [...aboveMin].sort((a, b) => b.importance_score - a.importance_score)) {
        const key   = story.topic_slug || `_${story.headline.slice(0, 40).toLowerCase()}`;
        const count = topicCounts.get(key) ?? 0;
        if (count < TOPIC_BATCH_CAP) {
          topicCapped.push(story);
          topicCounts.set(key, count + 1);
        }
      }

      // Pass 2: pairwise headline Jaccard overlap check (≥50% = duplicate).
      const pass2Input   = topicCapped;
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
      const articleSourceMap = new Map(batchForClaude.map(a => [a.id, a.source_name ?? '']));
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

      // Cross-run filter: source cap + keyword dedup + topic_slug dedup,
      // all enforced against what's already in the digest (not just this batch).
      const SOURCE_CAP = 4;
      const getSourceCap = (src: string) => SOURCE_CAP_OVERRIDES[src] ?? SOURCE_CAP;
      // Track existing topic slug counts for per-topic diversity cap
      const TOPIC_CROSS_CAP = 4; // max stories with the same slug across all live stories
      const existingTopicSlugCounts = new Map<string, number>();
      for (const s of existing) {
        if (s.topic_slug) existingTopicSlugCounts.set(s.topic_slug, (existingTopicSlugCounts.get(s.topic_slug) ?? 0) + 1);
      }
      // Start source counts from what's already in the DB, then add this batch.
      const runSourceCounts = new Map(existingSourceCounts);
      // Track stories to displace (replaced by a higher-scored new story).
      const storiesToDisplace: string[] = [];

      // Track JP count as stories are added during this batch
      let jpBatchCount = jpCurrentCount;

      const crossRunFiltered = entityKept.filter(story => {
        const src = primarySource(story);
        const isJP = src === 'Jerusalem Post';
        const jpBelowFloor = isJP && jpBatchCount < JP_FLOOR;

        // 1. Per-source cap — JP below floor bypasses cap only
        if (!jpBelowFloor && (runSourceCounts.get(src) ?? 0) >= getSourceCap(src)) {
          const srcStories = existingSourceStories.get(src) ?? [];
          const weakest = srcStories.reduce((min, s) => s.importance_score < min.importance_score ? s : min, srcStories[0]);
          if (!weakest || story.importance_score <= weakest.importance_score) {
            log.push(`[SourceCap] Dropped (${src}): at cap, score ${story.importance_score} ≤ weakest ${weakest?.importance_score}`);
            return false;
          }
          storiesToDisplace.push(weakest.id);
          existingSourceStories.get(src)!.splice(existingSourceStories.get(src)!.indexOf(weakest), 1);
          log.push(`[SourceCap] Displaced (${src}) score ${weakest.importance_score} for new score ${story.importance_score}`);
        }

        // 2. Headline Jaccard similarity against all existing headlines (stricter: ≥0.45)
        if (existingHeadlines.some(h => jaccardSimilarity(story.headline, h) >= 0.45)) {
          log.push(`[Dedup] Jaccard drop: "${story.headline.slice(0, 60)}"`);
          return false;
        }

        // 3. topic_slug diversity cap — allow up to TOPIC_CROSS_CAP per slug
        if (story.topic_slug) {
          const slugCount = existingTopicSlugCounts.get(story.topic_slug) ?? 0;
          if (slugCount >= TOPIC_CROSS_CAP) return false;
          existingTopicSlugCounts.set(story.topic_slug, slugCount + 1);
        }

        // 4. Stemmed keyword overlap (3+ of 8 meaningful words)
        const newKW = stemmedKeyWords(story.headline);
        if (existingHeadlines.some(h => {
          const exKW = new Set(stemmedKeyWords(h));
          return newKW.filter(w => exKW.has(w)).length >= 3;
        })) return false;

        runSourceCounts.set(src, (runSourceCounts.get(src) ?? 0) + 1);
        existingHeadlines.push(story.headline);
        if (isJP) jpBatchCount++;
        return true;
      });

      const removedCount = aboveMin.length - crossRunFiltered.length;
      if (removedCount > 0) log.push(`[Dedup] ${removedCount} removed (${aboveMin.length} scored → ${crossRunFiltered.length} final)`);

      // Build a lookup: article_id → source info
      const articleLookup = new Map(batchForClaude.map((a) => [a.id, a]));

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

        // Delete any stories displaced by higher-scored replacements
        if (storiesToDisplace.length > 0) {
          const { error: displaceErr } = await supabase
            .from('digest_stories')
            .delete()
            .in('id', storiesToDisplace);
          if (displaceErr) log.push(`Displace delete error: ${displaceErr.message}`);
          else log.push(`[SourceCap] Displaced ${storiesToDisplace.length} weaker stories`);
        }
      }

      // Mark all Claude-processed articles
      const processedIds = batchForClaude.map((a) => a.id);
      await supabase
        .from('raw_articles')
        .update({ processed: true })
        .in('id', processedIds);
      } // end quality gate (topHScore >= 80)
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

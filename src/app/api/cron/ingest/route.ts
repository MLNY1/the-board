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

const RSS_FEEDS = [
  { url: 'https://rsshub.app/apnews/topics/apf-topnews', source: 'AP News' },
  { url: 'https://feeds.reuters.com/reuters/worldNews', source: 'Reuters' },
  { url: 'https://feeds.bbci.co.uk/news/rss.xml', source: 'BBC' },
  { url: 'https://feeds.npr.org/1001/rss.xml', source: 'NPR' },
  { url: 'https://www.timesofisrael.com/feed/', source: 'Times of Israel' },
  { url: 'https://www.aljazeera.com/xml/rss/all.xml', source: 'Al Jazeera' },
  { url: 'http://rss.cnn.com/rss/edition.rss', source: 'CNN' },
  { url: 'https://moxie.foxnews.com/google-publisher/latest.xml', source: 'Fox News' },
  { url: 'https://feeds.nbcnews.com/nbcnews/public/news/world', source: 'NBC News' },
  // Israel-focused feeds
  { url: 'https://www.jpost.com/rss/rssfeedsfrontpage.aspx', source: 'Jerusalem Post' },
  { url: 'https://www.ynetnews.com/Integration/StoryRss2.xml', source: 'Ynet' },
  { url: 'https://www.israelnationalnews.com/RSS', source: 'Arutz Sheva' },
  { url: 'https://www.i24news.tv/en/feed', source: 'i24NEWS' },
];

const AI_BATCH_SIZE = 30;

const CLAUDE_SYSTEM_PROMPT = `You are a senior news editor creating a live briefing board for Orthodox Jewish families
during Shabbos and Yom Tov. Your job is to deliver only the most important, factual news
people can safely glance at on a wall-mounted screen.

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

async function fetchRssArticles(): Promise<
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
  const parser = new Parser({ timeout: 10000 });

  // Use Promise.allSettled so one broken feed doesn't abort the whole run
  const results = await Promise.allSettled(
    RSS_FEEDS.map(async ({ url, source }) => {
      const feed = await parser.parseURL(url);
      return (feed.items ?? []).slice(0, 20).map((item: RssItem) => ({
        title: item.title ?? '',
        description: item.contentSnippet ?? null,
        content: item.content ?? null,
        source_name: source,
        source_url: item.link ? normalizeSourceUrl(item.link) : null,
        published_at: item.isoDate ?? null,
        image_url: item.enclosure?.url ?? null,
        category: 'rss',
        duplicate_of: null,
      }));
    })
  );

  const articles: ReturnType<typeof fetchRssArticles> extends Promise<infer T> ? T : never = [];

  for (const result of results) {
    if (result.status === 'fulfilled') {
      articles.push(...result.value.filter((a) => a.title.length > 5));
    }
    // Silently skip rejected feeds — log is sufficient
  }

  return articles;
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
    model: 'claude-sonnet-4-20250514',
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

  try {
    // -----------------------------------------------------------------------
    // Step 0: Prune digest_stories older than 48h (stale duplicates accumulate)
    // -----------------------------------------------------------------------
    const cutoff48h = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const { error: digestPruneError } = await supabase
      .from('digest_stories')
      .delete()
      .lt('created_at', cutoff48h);
    if (digestPruneError) log.push(`Digest prune error: ${digestPruneError.message}`);
    else log.push('Pruned digest_stories > 48h');

    // -----------------------------------------------------------------------
    // Step 1: Fetch articles from all sources
    // -----------------------------------------------------------------------
    const category = getCurrentCategory();
    log.push(`Using NewsAPI category: ${category}`);

    const [rssArticles, newsApiArticles] = await Promise.all([
      fetchRssArticles(),
      fetchNewsApiArticles(category),
    ]);

    const allIncoming = [...rssArticles, ...newsApiArticles];
    log.push(`Fetched: ${rssArticles.length} RSS + ${newsApiArticles.length} NewsAPI = ${allIncoming.length} total`);

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
    const { data: unprocessed } = await supabase
      .from('raw_articles')
      .select('id, title, description, content, source_name, source_url, published_at, image_url')
      .eq('processed', false)
      .is('duplicate_of', null)
      .order('fetched_at', { ascending: false })
      .limit(AI_BATCH_SIZE);

    const toProcess = unprocessed ?? [];
    log.push(`Articles to AI-process: ${toProcess.length}`);

    if (toProcess.length > 0) {
      const stories = await processWithClaude(toProcess);
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
          story.importance_score = Math.min(100, story.importance_score + 15);
          if (story.importance_score >= 80)      story.tier = 'breaking';
          else if (story.importance_score >= 60) story.tier = 'major';
          else if (story.importance_score >= 40) story.tier = 'notable';
          else                                   story.tier = 'background';
          boostedCount++;
        }
      }
      if (boostedCount > 0) log.push(`Israel boost applied to ${boostedCount} stories`);

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

      // Pass 2: pairwise headline word-overlap check (≥50% = duplicate).
      const pass2Input  = Array.from(topicMap.values());
      const finalStories: ClaudeStory[] = [];
      for (const story of pass2Input) {
        const words = new Set(
          story.headline.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(Boolean)
        );
        let isDup  = false;
        let dupIdx = -1;
        for (let i = 0; i < finalStories.length; i++) {
          const keptWords = new Set(
            finalStories[i].headline.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(Boolean)
          );
          const intersection = Array.from(words).filter(w => keptWords.has(w)).length;
          const union        = new Set([...Array.from(words), ...Array.from(keptWords)]).size;
          if (union > 0 && intersection / union >= 0.5) {
            isDup  = true;
            dupIdx = i;
            break;
          }
        }
        if (!isDup) {
          finalStories.push(story);
        } else if (story.importance_score > finalStories[dupIdx].importance_score) {
          finalStories[dupIdx] = story; // replace with higher-scored version
        }
      }

      const removedCount = stories.length - finalStories.length;
      if (removedCount > 0) log.push(`[Dedup] Removed ${removedCount} duplicate stories`);

      // Build a lookup: article_id → source info
      const articleLookup = new Map(toProcess.map((a) => [a.id, a]));

      if (finalStories.length > 0) {
        const digestRows = finalStories.map((story) => {
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
          log.push(`Inserted ${digestRows.length} digest stories (${stories.length} before dedup)`);
        }
      }

      // Mark all processed articles
      const processedIds = toProcess.map((a) => a.id);
      await supabase
        .from('raw_articles')
        .update({ processed: true })
        .in('id', processedIds);
    }

    // -----------------------------------------------------------------------
    // Step 5: Prune raw_articles older than 72h to prevent DB bloat
    // -----------------------------------------------------------------------
    const cutoff72h = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
    const { error: pruneError } = await supabase
      .from('raw_articles')
      .delete()
      .lt('fetched_at', cutoff72h);

    if (pruneError) log.push(`Prune error: ${pruneError.message}`);
    else log.push('Pruned old articles');

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

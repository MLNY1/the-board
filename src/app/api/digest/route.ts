/**
 * GET /api/digest
 * Returns the current set of active stories for the frontend to display.
 *
 * Query params:
 *  ?since=ISO_DATE  — only return stories created after this timestamp (for polling)
 *  ?zip=11598       — ZIP code for Shabbos times (default from env)
 *
 * Stories are sorted by importance_score desc.
 * Limited to the last 48h, or since Shabbos started if active (whichever gives more).
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { getActiveWindow, getShabbosWindow, type GeoParams } from '@/lib/shabbos-times';
import { isWeekdayYomTov } from '@/lib/yomtov-utils';
import { fetchMarketData } from '@/lib/market-data';
import type { DigestResponse, DigestStory, MarketData } from '@/types';

const DEFAULT_ZIP = process.env.DEFAULT_ZIP ?? '11598';
const NEXT_REFRESH_SECONDS = 60; // matches the frontend polling interval

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const zip         = searchParams.get('zip')    ?? DEFAULT_ZIP;
  const sinceParam  = searchParams.get('since');
  const forceMarket = searchParams.get('market') === 'true';

  const latParam    = searchParams.get('lat');
  const lngParam    = searchParams.get('lng');
  const tzidParam   = searchParams.get('tzid');
  const cityOverride = searchParams.get('city') ?? null; // reverse-geocoded label from browser
  const geo: GeoParams | undefined = (latParam && lngParam)
    ? { lat: parseFloat(latParam), lng: parseFloat(lngParam), tzid: tzidParam ?? 'America/New_York' }
    : undefined;

  const supabase = createServerClient();

  try {
    // -----------------------------------------------------------------------
    // Determine time window for story retrieval
    // -----------------------------------------------------------------------
    const now = new Date();
    const cutoff48h = new Date(now.getTime() - 48 * 60 * 60 * 1000);

    // Fetch Shabbos/YT state and market mode concurrently
    const [activeWindow, shabbosWindow, weekdayYomTov] = await Promise.allSettled([
      getActiveWindow(zip, geo),
      getShabbosWindow(zip, geo),
      isWeekdayYomTov(zip, geo),
    ]);

    const active         = activeWindow.status === 'fulfilled'   ? activeWindow.value   : null;
    const shabbos        = shabbosWindow.status === 'fulfilled'  ? shabbosWindow.value  : null;
    const marketActive   = forceMarket || (weekdayYomTov.status === 'fulfilled' && weekdayYomTov.value);

    // If Shabbos is active, show stories since Shabbos started (not just 48h).
    // Use whichever cutoff gives MORE stories.
    let storyCutoff: Date = cutoff48h;
    if (active?.start && active.start < cutoff48h) {
      storyCutoff = active.start;
    }

    // If ?since= is provided, use that as a stricter lower bound for incremental polling
    if (sinceParam) {
      const sinceDate = new Date(sinceParam);
      if (!isNaN(sinceDate.getTime()) && sinceDate > storyCutoff) {
        storyCutoff = sinceDate;
      }
    }

    // -----------------------------------------------------------------------
    // Fetch digest stories
    // -----------------------------------------------------------------------
    const { data: stories, error } = await supabase
      .from('digest_stories')
      .select('*')
      .gte('created_at', storyCutoff.toISOString())
      .order('importance_score', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      console.error('Digest query error:', error);
      return NextResponse.json({ error: 'Database error' }, { status: 500 });
    }

    // Deduplicate by topic_slug — keep the highest-scored version of each topic
    const seenSlugs = new Map<string, DigestStory>();
    const seenIds = new Set<string>();

    for (const story of (stories ?? []) as DigestStory[]) {
      if (seenIds.has(story.id)) continue;

      if (story.topic_slug) {
        const existing = seenSlugs.get(story.topic_slug);
        if (existing && existing.importance_score >= story.importance_score) continue;
        seenSlugs.set(story.topic_slug, story);
      }

      seenIds.add(story.id);
    }

    // Rebuild deduplicated list, preserving score order
    const deduped = (stories ?? []).filter(
      (s) => seenIds.has(s.id) && (!s.topic_slug || seenSlugs.get(s.topic_slug)?.id === s.id)
    ) as DigestStory[];

    // -----------------------------------------------------------------------
    // Market data (only when weekday yom tov or ?market=true)
    // -----------------------------------------------------------------------
    const marketDisabled: MarketData = { enabled: false, prices: [], last_updated: '' };
    const market: MarketData = marketActive ? await fetchMarketData() : marketDisabled;

    // -----------------------------------------------------------------------
    // Build response
    // -----------------------------------------------------------------------
    const response: DigestResponse = {
      stories: deduped.map((s) => ({
        id: s.id,
        headline: s.headline,
        summary: s.summary,
        importance_score: s.importance_score,
        tier: s.tier,
        sources: s.source_names ?? [],
        source_urls: s.source_urls ?? [],
        image_url: s.image_url,
        published_at: s.published_at ?? s.created_at,
        created_at: s.created_at,
      })),
      meta: {
        total_stories: deduped.length,
        last_updated: now.toISOString(),
        shabbos: {
          is_active: active !== null,
          // During Shabbos/YT: active.start = candle lighting, active.end = havdalah.
          // During weekday: fall back to upcoming Shabbos window from getShabbosWindow().
          // This ensures the header always has times to display.
          window_start: (active?.start ?? shabbos?.start)?.toISOString() ?? null,
          window_end:   (active?.end   ?? shabbos?.end  )?.toISOString() ?? null,
          parsha: shabbos?.parsha ?? null,
          location_label: cityOverride ?? shabbos?.locationLabel ?? null,
        },
        next_refresh_seconds: NEXT_REFRESH_SECONDS,
        market,
      },
    };

    // Cache for 30s — fresh enough for polling, reduces DB load
    return NextResponse.json(response, {
      headers: {
        'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=30',
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Digest route error:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

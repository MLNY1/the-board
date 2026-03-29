/**
 * Shared TypeScript types for TheBoard news dashboard.
 * All database shapes, API responses, and component props live here.
 */

// ---------------------------------------------------------------------------
// Database row shapes (snake_case to match Supabase/Postgres conventions)
// ---------------------------------------------------------------------------

export interface RawArticle {
  id: string;
  title: string;
  description: string | null;
  content: string | null;
  source_name: string | null;
  source_url: string | null;
  published_at: string | null;
  fetched_at: string;
  image_url: string | null;
  category: string | null;
  processed: boolean;
  duplicate_of: string | null;
  created_at: string;
}

export interface DigestStory {
  id: string;
  headline: string;
  summary: string;
  importance_score: number;
  tier: 'breaking' | 'major' | 'notable' | 'background';
  topic_slug: string | null;
  source_article_ids: string[];
  source_names: string[];
  source_urls: string[];
  image_url: string | null;
  published_at: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// API response shapes
// ---------------------------------------------------------------------------

export interface DigestStoryItem {
  id: string;
  headline: string;
  summary: string;
  importance_score: number;
  tier: 'breaking' | 'major' | 'notable' | 'background';
  sources: string[];
  source_urls: string[];
  image_url: string | null;
  published_at: string;
  created_at: string;
}

export interface ShabbosWindowMeta {
  is_active: boolean;
  /** ISO string for candle lighting time (current Shabbos if active, upcoming if weekday) */
  window_start: string | null;
  /** ISO string for havdalah time */
  window_end: string | null;
  parsha: string | null;
}

// ---------------------------------------------------------------------------
// Red Alert (Tzeva Adom / Pikud HaOref)
// ---------------------------------------------------------------------------

export interface RedAlertItem {
  cities: string[];
  time: string;   // human-readable local time
  threat: string; // "missiles", "hostile_aircraft", etc.
}

export interface RedAlertResponse {
  active: boolean;
  alerts: RedAlertItem[];
  last_checked: string; // ISO timestamp
}

export interface MarketPrice {
  symbol:    string;
  label:     string;
  price:     number;
  change:    number;   // percent change from prev close
  prevClose: number;
  isUp:      boolean;
  invert:    boolean;  // true for TLT — price down = yields up
}

export interface MarketData {
  enabled:      boolean;
  prices:       MarketPrice[];
  last_updated: string;
}

export interface DigestMeta {
  total_stories: number;
  last_updated: string;
  shabbos: ShabbosWindowMeta;
  next_refresh_seconds: number;
  market: MarketData;
}

export interface DigestResponse {
  stories: DigestStoryItem[];
  meta: DigestMeta;
}

// ---------------------------------------------------------------------------
// Shabbos / time awareness
// ---------------------------------------------------------------------------

export interface ShabbosWindow {
  start: Date;
  end: Date;
  parsha: string;
}

export interface YomTovWindow {
  start: Date;
  end: Date;
  name: string;
}

export interface ActiveWindow {
  start: Date;
  end: Date;
  name: string;
}

// ---------------------------------------------------------------------------
// Hebcal API response shapes (partial — only fields we use)
// ---------------------------------------------------------------------------

export interface HebcalShabbatItem {
  title: string;
  date: string;
  category: 'candles' | 'havdalah' | 'parashat' | 'holiday';
  hebrew?: string;
  memo?: string;
}

export interface HebcalShabbatResponse {
  title: string;
  date: string;
  location: {
    zip: string;
    city: string;
    tzid: string;
  };
  items: HebcalShabbatItem[];
}

export interface HebcalCalendarItem {
  title: string;
  date: string;
  category: string;
  yomtov?: boolean;
  hebrew?: string;
}

export interface HebcalCalendarResponse {
  items: HebcalCalendarItem[];
}

// ---------------------------------------------------------------------------
// Rotation state machine
// ---------------------------------------------------------------------------

export type RotationPhase = 'HERO' | 'NEXT_HERO' | 'OVERVIEW' | 'FADE';

export interface RotationState {
  phase: RotationPhase;
  heroIndex: number;
  isTransitioning: boolean;
}

// ---------------------------------------------------------------------------
// Ingest pipeline internals
// ---------------------------------------------------------------------------

export interface NewsApiArticle {
  title: string;
  description: string | null;
  content: string | null;
  url: string;
  urlToImage: string | null;
  publishedAt: string;
  source: { id: string | null; name: string };
}

export interface NewsApiResponse {
  status: string;
  totalResults: number;
  articles: NewsApiArticle[];
}

export interface RssItem {
  title?: string;
  link?: string;
  contentSnippet?: string;
  content?: string;
  isoDate?: string;
  enclosure?: { url?: string };
}

/** Shape Claude must return for each processed batch */
export interface ClaudeStory {
  article_ids: string[];
  importance_score: number;
  tier: 'breaking' | 'major' | 'notable' | 'background';
  headline: string;
  summary: string;
  topic_slug: string;
}

export interface ClaudeBatchResponse {
  stories: ClaudeStory[];
}

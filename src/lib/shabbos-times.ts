/**
 * Shabbos and Yom Tov time awareness via the Hebcal REST API.
 *
 * Caching strategy:
 *  - In-memory cache with a 6-hour TTL per ZIP code.
 *  - This module is server-only (imported only in API routes / server components).
 *  - The cache is keyed by ZIP and refreshes automatically when stale.
 *
 * Hebcal endpoints used:
 *  - /shabbat  → candle lighting, havdalah, parsha for the current/next Shabbos
 *  - /hebcal   → full calendar including Yom Tov entries
 */

import type {
  ShabbosWindow,
  YomTovWindow,
  ActiveWindow,
  HebcalShabbatResponse,
  HebcalShabbatItem,
  HebcalCalendarResponse,
  HebcalCalendarItem,
} from '@/types';

// ---------------------------------------------------------------------------
// In-memory cache
// ---------------------------------------------------------------------------

interface CacheEntry<T> {
  value: T;
  expiresAt: number; // epoch ms
}

const cache = new Map<string, CacheEntry<unknown>>();
const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

function getCached<T>(key: string): T | null {
  const entry = cache.get(key) as CacheEntry<T> | undefined;
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function setCached<T>(key: string, value: T, ttlMs = SIX_HOURS_MS): void {
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

// ---------------------------------------------------------------------------
// Hebcal API helpers
// ---------------------------------------------------------------------------

const HEBCAL_BASE = 'https://www.hebcal.com';

export interface GeoParams {
  lat: number;
  lng: number;
  tzid: string;
}

async function fetchShabbatData(zip: string, geo?: GeoParams): Promise<HebcalShabbatResponse> {
  const cacheKey = geo ? `shabbat:geo:${geo.lat},${geo.lng}` : `shabbat:${zip}`;
  const cached = getCached<HebcalShabbatResponse>(cacheKey);
  if (cached) return cached;

  const url = geo
    ? `${HEBCAL_BASE}/shabbat?cfg=json&latitude=${geo.lat}&longitude=${geo.lng}&tzid=${encodeURIComponent(geo.tzid)}&m=50`
    : `${HEBCAL_BASE}/shabbat?cfg=json&zip=${zip}&m=50`;
  const res = await fetch(url, { next: { revalidate: 21600 } }); // 6h Next.js cache
  if (!res.ok) throw new Error(`Hebcal /shabbat returned ${res.status}`);
  const data: HebcalShabbatResponse = await res.json();
  setCached(cacheKey, data);
  return data;
}

async function fetchCalendarData(zip: string, geo?: GeoParams): Promise<HebcalCalendarResponse> {
  const cacheKey = geo ? `calendar:geo:${geo.lat},${geo.lng}` : `calendar:${zip}`;
  const cached = getCached<HebcalCalendarResponse>(cacheKey);
  if (cached) return cached;

  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  const url = geo
    ? `${HEBCAL_BASE}/hebcal?cfg=json&v=1&year=${year}&month=${month}&c=on&latitude=${geo.lat}&longitude=${geo.lng}&tzid=${encodeURIComponent(geo.tzid)}&m=50&s=on&maj=on&mod=on`
    : `${HEBCAL_BASE}/hebcal?cfg=json&v=1&year=${year}&month=${month}&c=on&zip=${zip}&m=50&s=on&maj=on&mod=on`;
  const res = await fetch(url, { next: { revalidate: 21600 } });
  if (!res.ok) throw new Error(`Hebcal /hebcal returned ${res.status}`);
  const data: HebcalCalendarResponse = await res.json();
  setCached(cacheKey, data);
  return data;
}

// ---------------------------------------------------------------------------
// Parse helpers
// ---------------------------------------------------------------------------

function parseHebcalDate(dateStr: string): Date {
  // Hebcal returns ISO strings like "2024-04-05T19:12:00-04:00"
  return new Date(dateStr);
}

/**
 * Extracts parsha name from the Shabbat response items.
 * Hebcal returns a "parashat" category item like "Parashat Vayikra".
 */
function extractParsha(items: HebcalShabbatItem[]): string {
  const parashaItem = items.find(
    (item) => item.category === 'parashat' || item.title.toLowerCase().startsWith('parashat')
  );
  if (!parashaItem) return '';
  // Strip "Parashat " prefix to get just the parsha name
  return parashaItem.title.replace(/^Parashat\s+/i, '').trim();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns the current or most recent Shabbos window with candle lighting,
 * havdalah times, and the parsha name.
 */
export async function getShabbosWindow(zip: string, geo?: GeoParams): Promise<ShabbosWindow> {
  const data = await fetchShabbatData(zip, geo);
  const items = data.items ?? [];

  const candleItem = items.find((i) => i.category === 'candles');
  const havdalahItem = items.find((i) => i.category === 'havdalah');
  const parsha = extractParsha(items);

  if (!candleItem || !havdalahItem) {
    throw new Error('Could not find candle lighting or havdalah in Hebcal response');
  }

  // Build location label from Hebcal response.
  // For geo queries, Hebcal sometimes returns coordinates as the title (e.g. "40°37'N 73°43'W").
  // Detect and discard those — the client will supply a city name instead.
  const loc = data.location;
  let locationLabel = '';
  if (loc) {
    const title = loc.title ?? '';
    const looksLikeCoords = /\d+[°º']/.test(title) || /^\d+\.\d+/.test(title);
    if (title && !looksLikeCoords) {
      locationLabel = title;
    } else if (loc.city) {
      locationLabel = loc.state ? `${loc.city}, ${loc.state}` : loc.city;
    }
  }

  return {
    start: parseHebcalDate(candleItem.date),
    end: parseHebcalDate(havdalahItem.date),
    parsha,
    locationLabel,
  };
}

/**
 * Returns upcoming Yom Tov windows for the current month.
 * Uses the /hebcal calendar endpoint filtered to yomtov entries with candles/havdalah pairs.
 */
export async function getYomTovWindows(zip: string, geo?: GeoParams): Promise<YomTovWindow[]> {
  const data = await fetchCalendarData(zip, geo);
  const items: HebcalCalendarItem[] = data.items ?? [];

  const windows: YomTovWindow[] = [];

  // Find pairs of candle lighting → havdalah for major yom tov
  // The calendar returns them in chronological order with category "candles"/"havdalah"
  // and a holiday title for context
  const candles = items.filter((i) => i.category === 'candles');
  const havdalahs = items.filter((i) => i.category === 'havdalah');

  // Skip items that are just regular Shabbos (they have a "parashat" companion)
  // Yom Tov entries have yomtov: true or a holiday title
  for (let ci = 0; ci < candles.length; ci++) {
    const candleItem = candles[ci];
    const candleDate = parseHebcalDate(candleItem.date);

    // Find the matching havdalah (next havdalah after this candle lighting)
    const matchingHavdalah = havdalahs.find((h) => {
      const hDate = parseHebcalDate(h.date);
      return hDate > candleDate;
    });

    if (!matchingHavdalah) continue;

    // Check if any holiday item falls between candle and havdalah
    const holidayItem = items.find(
      (i) =>
        i.category === 'holiday' &&
        i.yomtov === true &&
        parseHebcalDate(i.date) >= candleDate &&
        parseHebcalDate(i.date) <= parseHebcalDate(matchingHavdalah.date)
    );

    if (holidayItem) {
      windows.push({
        start: candleDate,
        end: parseHebcalDate(matchingHavdalah.date),
        name: holidayItem.title,
      });
    }
  }

  return windows;
}

/**
 * Returns true if right now falls within Shabbos or Yom Tov for the given ZIP.
 */
export async function isShabbosNow(zip: string, geo?: GeoParams): Promise<boolean> {
  const active = await getActiveWindow(zip, geo);
  return active !== null;
}

/**
 * Returns the currently active Shabbos or Yom Tov window if one is in progress,
 * or null if it's a regular weekday.
 *
 * Checks Shabbos window first, then Yom Tov windows.
 */
export async function getActiveWindow(zip: string, geo?: GeoParams): Promise<ActiveWindow | null> {
  const now = new Date();

  // Check Shabbos
  try {
    const shabbos = await getShabbosWindow(zip, geo);
    if (now >= shabbos.start && now <= shabbos.end) {
      return {
        start: shabbos.start,
        end: shabbos.end,
        name: `Shabbat ${shabbos.parsha}`.trim(),
      };
    }
  } catch {
    // Hebcal may fail transiently — fall through to Yom Tov check
  }

  // Check Yom Tov
  try {
    const yomTovWindows = await getYomTovWindows(zip, geo);
    for (const ytWindow of yomTovWindows) {
      if (now >= ytWindow.start && now <= ytWindow.end) {
        return ytWindow;
      }
    }
  } catch {
    // Hebcal may fail transiently
  }

  return null;
}

// ---------------------------------------------------------------------------
// Formatting helpers (used by frontend via /api/shabbos-times)
// ---------------------------------------------------------------------------

/**
 * Returns a formatted countdown string "in Xh Ym" until the given target date.
 * Returns empty string if target is in the past.
 */
export function formatCountdown(target: Date): string {
  const diffMs = target.getTime() - Date.now();
  if (diffMs <= 0) return '';

  const totalMinutes = Math.floor(diffMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

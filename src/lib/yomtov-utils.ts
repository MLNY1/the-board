/**
 * Yom Tov market-mode detection.
 *
 * Market mode is active when:
 *  1. A Yom Tov (not Shabbos) is currently in effect, AND
 *  2. The underlying calendar day is Monday–Friday (markets are open)
 *
 * Logic: Shabbos always spans Fri evening → Sat night, so an active window
 * whose name starts with "Shabbat" cannot occur on Mon–Thu. If the window
 * name does NOT start with "Shabbat", it's Yom Tov, which can fall on any
 * day — including weekdays when markets are open.
 */

import { getActiveWindow, type GeoParams } from './shabbos-times';

/**
 * Returns true if we are currently in a weekday Yom Tov.
 * Uses the in-memory-cached Hebcal data from shabbos-times.ts.
 * Never throws — returns false on any error.
 */
export async function isWeekdayYomTov(zip: string, geo?: GeoParams): Promise<boolean> {
  try {
    const now       = new Date();
    const dayOfWeek = now.getDay(); // 0 Sun … 6 Sat
    const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;
    if (!isWeekday) return false;

    // Check Yom Tov windows directly — avoids a false negative when Hebcal
    // merges a Yom Tov + Shabbat into one combined window named "Shabbat"
    // (e.g. Pesach I starting Wednesday and ending Sunday).
    const { getYomTovWindows } = await import('./shabbos-times');
    const ytWindows = await getYomTovWindows(zip, geo);
    if (ytWindows.some(w => now >= w.start && now <= w.end)) return true;

    // Fallback: active window that isn't Shabbat
    const active = await getActiveWindow(zip, geo);
    if (!active) return false;
    return !active.name.startsWith('Shabbat');
  } catch {
    return false;
  }
}

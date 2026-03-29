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

import { getActiveWindow } from './shabbos-times';

/**
 * Returns true if we are currently in a weekday Yom Tov.
 * Uses the in-memory-cached Hebcal data from shabbos-times.ts.
 * Never throws — returns false on any error.
 */
export async function isWeekdayYomTov(zip: string): Promise<boolean> {
  try {
    const active = await getActiveWindow(zip);
    if (!active) return false;

    // Active window whose name doesn't start with "Shabbat" = Yom Tov
    const isYomTov  = !active.name.startsWith('Shabbat');
    const dayOfWeek = new Date().getDay(); // 0 Sun … 6 Sat
    const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;

    return isYomTov && isWeekday;
  } catch {
    return false;
  }
}

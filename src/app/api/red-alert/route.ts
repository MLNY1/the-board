/**
 * GET /api/red-alert
 *
 * Checks for active Tzeva Adom (Pikud HaOref rocket alerts) in Israel.
 * Returns { active, alerts, last_checked }.
 *
 * Sources (tried in order, first success wins):
 *  1. Pikud HaOref AlertsHistory endpoint — recent alert history, no geo-block
 *  2. tzevaadom.co.il community API — fallback
 *
 * If both fail or RED_ALERT_ENABLED != 'true', returns { active: false }.
 * Never throws — all errors are caught and silently ignored.
 *
 * An alert is considered "active" if any alert occurred within the last 10 minutes.
 */

import { NextResponse } from 'next/server';
import type { RedAlertResponse, RedAlertItem } from '@/types';

const ACTIVE_WINDOW_MS   = 10 * 60 * 1000; // 10 minutes
const FETCH_TIMEOUT_MS   = 5_000;

// ---------------------------------------------------------------------------
// Fetch helpers with timeout
// ---------------------------------------------------------------------------

/** Wraps fetch with an AbortController timeout. Throws on timeout or HTTP error. */
async function fetchWithTimeout(url: string, timeoutMs = FETCH_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        // Pikud HaOref requires these headers to not return 403
        'Referer': 'https://www.oref.org.il/',
        'X-Requested-With': 'XMLHttpRequest',
        'User-Agent': 'Mozilla/5.0',
      },
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Source 1: Pikud HaOref AlertsHistory
// ---------------------------------------------------------------------------

interface OrefHistoryItem {
  data: string;       // city name in Hebrew, e.g. "תל אביב - מרכז העיר"
  date: string;       // "2024-04-13"
  time: string;       // "14:23:00"
  alertDate: string;  // "2024-04-13 14:23:00"
  category?: number;
}

async function fetchOrefHistory(): Promise<RedAlertItem[]> {
  const res = await fetchWithTimeout(
    'https://www.oref.org.il/WarningMessages/History/AlertsHistory.json'
  );
  const raw: OrefHistoryItem[] = await res.json();
  if (!Array.isArray(raw)) return [];

  const cutoff = Date.now() - ACTIVE_WINDOW_MS;
  const recent: RedAlertItem[] = [];

  for (const item of raw.slice(0, 200)) { // cap parsing to first 200 entries
    // Parse alertDate: "2024-04-13 14:23:00" (Israel local time, UTC+3)
    const alertMs = Date.parse(item.alertDate.replace(' ', 'T') + '+03:00');
    if (isNaN(alertMs) || alertMs < cutoff) continue;

    const timeStr = new Date(alertMs).toLocaleTimeString('en-US', {
      hour: 'numeric', minute: '2-digit', hour12: true,
    });

    recent.push({
      cities: [item.data],
      time: timeStr,
      threat: item.category === 1 ? 'missiles' : 'alert',
    });
  }

  return recent;
}

// ---------------------------------------------------------------------------
// Source 2: tzevaadom.co.il community API
// ---------------------------------------------------------------------------

interface TzevaadomItem {
  cities: string[];
  threat: number | string;
  time: number; // Unix timestamp (seconds)
  id?: string;
}

async function fetchTzevaadom(): Promise<RedAlertItem[]> {
  const res = await fetchWithTimeout('https://api.tzevaadom.co.il/notifications');
  const raw: TzevaadomItem[] = await res.json();
  if (!Array.isArray(raw)) return [];

  const cutoff = (Date.now() - ACTIVE_WINDOW_MS) / 1000; // in seconds
  const recent: RedAlertItem[] = [];

  for (const item of raw.slice(0, 50)) {
    if (item.time < cutoff) continue;

    const timeStr = new Date(item.time * 1000).toLocaleTimeString('en-US', {
      hour: 'numeric', minute: '2-digit', hour12: true,
    });

    const threatLabel =
      item.threat === 1 || item.threat === 'missiles' ? 'missiles' :
      item.threat === 2 || item.threat === 'hostile_aircraft' ? 'hostile_aircraft' :
      'alert';

    recent.push({
      cities: Array.isArray(item.cities) ? item.cities : [],
      time: timeStr,
      threat: threatLabel,
    });
  }

  return recent;
}

// ---------------------------------------------------------------------------
// Merge + deduplicate alert items into a summary
// ---------------------------------------------------------------------------

/**
 * Collapses an array of RedAlertItems into a single item with all unique cities.
 * This gives the banner one consolidated object with the full city list.
 */
function consolidateAlerts(items: RedAlertItem[]): RedAlertItem[] {
  if (items.length === 0) return [];

  const allCities = Array.from(
    new Set(items.flatMap(i => i.cities).filter(Boolean))
  );
  const latestTime = items[0]?.time ?? '';
  const threat = items[0]?.threat ?? 'alert';

  return [{ cities: allCities, time: latestTime, threat }];
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(): Promise<NextResponse> {
  const empty: RedAlertResponse = {
    active: false,
    alerts: [],
    last_checked: new Date().toISOString(),
  };

  // Feature flag — return empty immediately if not enabled
  if (process.env.RED_ALERT_ENABLED !== 'true') {
    return NextResponse.json(empty, {
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  try {
    let items: RedAlertItem[] = [];

    // Try source 1: Pikud HaOref history
    try {
      items = await fetchOrefHistory();
    } catch {
      // Geo-blocked or unavailable — try fallback
    }

    // If source 1 returned nothing recent, try source 2
    if (items.length === 0) {
      try {
        items = await fetchTzevaadom();
      } catch {
        // Both sources failed — return inactive silently
      }
    }

    const consolidated = consolidateAlerts(items);
    const response: RedAlertResponse = {
      active: consolidated.length > 0,
      alerts: consolidated,
      last_checked: new Date().toISOString(),
    };

    return NextResponse.json(response, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch {
    // Never surface errors to the client — just return inactive
    return NextResponse.json(empty, {
      headers: { 'Cache-Control': 'no-store' },
    });
  }
}

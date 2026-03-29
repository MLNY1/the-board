import { NextResponse } from 'next/server';

export const dynamic    = 'force-dynamic';
export const revalidate = 0;

const TIMEOUT_MS        = 5_000;
const HISTORY_LIMIT     = 20;
const ACTIVE_WINDOW_MS  = 30 * 60 * 1000; // 30 minutes

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Returns true if the alertDate string is within the last 30 minutes */
function isRecent(alertDate: string): boolean {
  if (!alertDate) return false;
  try {
    // oref.org.il dates are Israel local time (UTC+3)
    const ms = alertDate.includes('T')
      ? Date.parse(alertDate)
      : Date.parse(alertDate.replace(' ', 'T') + '+03:00');
    return !isNaN(ms) && Date.now() - ms < ACTIVE_WINDOW_MS;
  } catch { return false; }
}

export async function GET() {
  const empty = {
    active: false,
    alerts: [] as object[],
    last_checked: new Date().toISOString(),
    source: 'disabled',
  };

  if (process.env.RED_ALERT_ENABLED !== 'true') {
    return NextResponse.json(empty, { headers: { 'Cache-Control': 'no-store' } });
  }

  // ── Source 1: Pikud HaOref AlertsHistory ─────────────────────────────────
  // Returns full history regardless of activity level. Often geo-blocked from US.
  try {
    const res = await fetchWithTimeout(
      'https://www.oref.org.il/WarningMessages/History/AlertsHistory.json',
      {
        headers: {
          'Referer':          'https://www.oref.org.il/',
          'X-Requested-With': 'XMLHttpRequest',
          'Accept':           'application/json',
          'User-Agent':       'Mozilla/5.0',
        },
      }
    );

    if (res.ok) {
      const raw = await res.json();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const alerts = (Array.isArray(raw) ? raw : []).slice(0, HISTORY_LIMIT).map((a: any) => ({
        cities:    a.data      ?? '',
        time:      a.time      ?? '',
        date:      a.date      ?? '',
        alertDate: a.alertDate ?? '',
        title:     a.title     ?? '',
        category:  String(a.cat ?? ''),
      }));

      const active = alerts.some(a => isRecent(a.alertDate));
      console.log(`[RedAlert] Source: oref.org.il — ${alerts.length} alerts, active=${active}`);

      return NextResponse.json(
        { active, alerts, last_checked: new Date().toISOString(), source: 'oref' },
        { headers: { 'Cache-Control': 'no-store' } }
      );
    }
    console.log(`[RedAlert] oref.org.il returned HTTP ${res.status} — trying tzevaadom`);
  } catch (err) {
    console.log(`[RedAlert] oref.org.il failed (${(err as Error).message}) — trying tzevaadom`);
  }

  // ── Source 2: tzevaadom community API ─────────────────────────────────────
  // Community mirror accessible from outside Israel.
  try {
    const res = await fetchWithTimeout('https://api.tzevaadom.co.il/notifications');

    if (res.ok) {
      const raw = await res.json();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const alerts = (Array.isArray(raw) ? raw : []).slice(0, HISTORY_LIMIT).map((a: any) => {
        const alertDate = a.alertDate
          ?? (a.timestamp ? new Date(a.timestamp * 1000).toISOString() : '');
        return {
          cities:    Array.isArray(a.cities) ? a.cities.join(' · ') : (a.cities ?? a.data ?? ''),
          time:      a.time  ?? '',
          date:      a.date  ?? '',
          alertDate,
          title:     a.threat ?? a.title ?? '',
          category:  '',
        };
      });

      const active = alerts.some(a => isRecent(a.alertDate));
      console.log(`[RedAlert] Source: tzevaadom — ${alerts.length} alerts, active=${active}`);

      return NextResponse.json(
        { active, alerts, last_checked: new Date().toISOString(), source: 'tzevaadom' },
        { headers: { 'Cache-Control': 'no-store' } }
      );
    }
    console.log(`[RedAlert] tzevaadom returned HTTP ${res.status}`);
  } catch (err) {
    console.log(`[RedAlert] tzevaadom failed (${(err as Error).message})`);
  }

  console.log('[RedAlert] All sources failed — returning empty');
  return NextResponse.json(
    { active: false, alerts: [], last_checked: new Date().toISOString(), source: 'all_sources_failed' },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

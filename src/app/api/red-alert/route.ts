import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';

export const dynamic    = 'force-dynamic';
export const revalidate = 0;

const TIMEOUT_MS       = 5_000;
const HISTORY_LIMIT    = 20;
const ACTIVE_WINDOW_MS = 30 * 60 * 1000; // 30 minutes

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function isRecent(alertDate: string): boolean {
  if (!alertDate) return false;
  try {
    const ms = alertDate.includes('T')
      ? Date.parse(alertDate)
      : Date.parse(alertDate.replace(' ', 'T') + '+03:00');
    return !isNaN(ms) && Date.now() - ms < ACTIVE_WINDOW_MS;
  } catch { return false; }
}

/** Deterministic ID from alert content so upserts are idempotent */
function alertId(alertDate: string, cities: string): string {
  return `${alertDate}__${cities}`.slice(0, 255);
}

interface AlertItem {
  cities: string; time: string; date: string;
  alertDate: string; title: string; category: string;
}

async function upsertAlerts(alerts: AlertItem[]): Promise<void> {
  if (alerts.length === 0) return;
  const supabase = createServerClient();
  const rows = alerts.map(a => ({
    id:         alertId(a.alertDate, a.cities),
    cities:     a.cities,
    time:       a.time,
    date:       a.date,
    alert_date: a.alertDate
      ? (a.alertDate.includes('T')
          ? a.alertDate
          : a.alertDate.replace(' ', 'T') + '+03:00')
      : null,
    title:    a.title,
    category: a.category,
  }));
  const { error } = await supabase
    .from('red_alerts')
    .upsert(rows, { onConflict: 'id', ignoreDuplicates: true });
  if (error) console.error('[RedAlert] Supabase upsert error:', error.message);
}

async function loadHistory(): Promise<AlertItem[]> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('red_alerts')
    .select('cities, time, date, alert_date, title, category')
    .order('alert_date', { ascending: false })
    .limit(HISTORY_LIMIT);
  if (error) { console.error('[RedAlert] Supabase load error:', error.message); return []; }
  return (data ?? []).map(r => ({
    cities:    r.cities,
    time:      r.time,
    date:      r.date,
    alertDate: r.alert_date ?? '',
    title:     r.title,
    category:  r.category,
  }));
}

export async function GET() {
  if (process.env.RED_ALERT_ENABLED !== 'true') {
    return NextResponse.json(
      { active: false, alerts: [], last_checked: new Date().toISOString(), source: 'disabled' },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  }

  // ── Fetch alerts from sources that work outside Israel ───────────────────

  // Source 1: oref.org.il history API — works outside Israel, returns recent alerts
  try {
    const fmt = (d: Date) =>
      `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
    const today     = fmt(new Date());
    const yesterday = fmt(new Date(Date.now() - 86_400_000));
    const orefUrl   =
      `https://alerts-history.oref.org.il/Shared/Ajax/GetAlarmsHistory.aspx` +
      `?lang=en&fromDate=${yesterday}&toDate=${today}&mode=0`;

    const res = await fetchWithTimeout(orefUrl, {
      headers: {
        'Accept':     'application/json',
        'Referer':    'https://www.oref.org.il/',
        'X-Requested-With': 'XMLHttpRequest',
      },
    });

    if (res.ok) {
      const text = await res.text();
      const raw  = text.trim() ? JSON.parse(text) : [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fresh: AlertItem[] = (Array.isArray(raw) ? raw : []).slice(0, HISTORY_LIMIT).map((a: any) => {
        // alertDate comes as "YYYY-MM-DD HH:MM:SS" — isRecent handles this format
        const alertDate = a.alertDate ?? '';
        const [datePart, timePart] = (alertDate as string).split(' ');
        return {
          cities:    a.data ?? '',
          time:      timePart ?? '',
          date:      datePart ?? '',
          alertDate,
          title:     a.title ?? 'Rocket and missile fire',
          category:  String(a.cat ?? ''),
        };
      }).filter((a: AlertItem) => a.alertDate);

      if (fresh.length > 0) {
        console.log(`[RedAlert] oref history — ${fresh.length} alerts, persisting`);
        await upsertAlerts(fresh);
      } else {
        console.log('[RedAlert] oref history — no alerts in range');
      }
    } else {
      console.log(`[RedAlert] oref history returned HTTP ${res.status}`);
    }
  } catch (err) {
    console.log(`[RedAlert] oref history failed (${(err as Error).message})`);
  }

  // Source 2: tzevaadom /notifications — live active alerts (backup)
  try {
    const res = await fetchWithTimeout('https://api.tzevaadom.co.il/notifications', {
      headers: { 'Accept': 'application/json', 'Referer': 'https://www.tzevaadom.co.il/' },
    });

    if (res.ok) {
      const raw = await res.json();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fresh: AlertItem[] = (Array.isArray(raw) ? raw : []).map((a: any) => {
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
      }).filter((a: AlertItem) => a.alertDate);

      if (fresh.length > 0) {
        console.log(`[RedAlert] tzevaadom /notifications — ${fresh.length} live alerts, persisting`);
        await upsertAlerts(fresh);
      } else {
        console.log('[RedAlert] tzevaadom /notifications — quiet');
      }
    } else {
      console.log(`[RedAlert] tzevaadom /notifications returned HTTP ${res.status}`);
    }
  } catch (err) {
    console.log(`[RedAlert] tzevaadom /notifications failed (${(err as Error).message})`);
  }

  // ── Always serve from Supabase history ────────────────────────────────────
  const alerts = await loadHistory();
  const active = alerts.some(a => isRecent(a.alertDate));
  console.log(`[RedAlert] Serving ${alerts.length} stored alerts, active=${active}`);

  return NextResponse.json(
    { active, alerts, last_checked: new Date().toISOString(), source: 'supabase' },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

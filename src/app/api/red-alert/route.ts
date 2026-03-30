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

export async function GET(request: Request) {
  // ── Test mode — ?test=true returns hardcoded sample data ─────────────────
  if (request.url.includes('test=true')) {
    const now = Date.now();
    return NextResponse.json(
      {
        active: true,
        alerts: [
          { cities: 'תל אביב - מרכז העיר', time: '23:14', date: '29.03.2026', alertDate: new Date(now - 2  * 60000).toISOString(), title: 'ירי רקטות וטילים',  category: '1' },
          { cities: 'רמת גן · גבעתיים',    time: '23:12', date: '29.03.2026', alertDate: new Date(now - 4  * 60000).toISOString(), title: 'ירי רקטות וטילים',  category: '1' },
          { cities: 'חיפה · קריות',         time: '23:08', date: '29.03.2026', alertDate: new Date(now - 8  * 60000).toISOString(), title: 'ירי רקטות וטילים',  category: '1' },
          { cities: 'באר שבע · אופקים',     time: '22:58', date: '29.03.2026', alertDate: new Date(now - 18 * 60000).toISOString(), title: 'ירי רקטות וטילים',  category: '1' },
          { cities: 'ירושלים · בית שמש',    time: '22:45', date: '29.03.2026', alertDate: new Date(now - 30 * 60000).toISOString(), title: 'ירי רקטות וטילים',  category: '1' },
          { cities: 'אשדוד · אשקלון',       time: '22:38', date: '29.03.2026', alertDate: new Date(now - 38 * 60000).toISOString(), title: 'ירי רקטות וטילים',  category: '1' },
          { cities: 'שדרות · עוטף עזה',     time: '22:30', date: '29.03.2026', alertDate: new Date(now - 45 * 60000).toISOString(), title: 'ירי רקטות וטילים',  category: '1' },
          { cities: 'קריית שמונה · מטולה',  time: '22:20', date: '29.03.2026', alertDate: new Date(now - 55 * 60000).toISOString(), title: 'ירי רקטות וטילים',  category: '1' },
          { cities: 'נתניה · הרצליה',        time: '22:10', date: '29.03.2026', alertDate: new Date(now - 65 * 60000).toISOString(), title: 'חדירת כלי טיס עוין', category: '2' },
          { cities: 'צפון הגולן',             time: '22:00', date: '29.03.2026', alertDate: new Date(now - 75 * 60000).toISOString(), title: 'חדירת כלי טיס עוין', category: '2' },
        ],
        last_checked: new Date().toISOString(),
        source: 'test',
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  }

  if (process.env.RED_ALERT_ENABLED !== 'true') {
    return NextResponse.json(
      { active: false, alerts: [], last_checked: new Date().toISOString(), source: 'disabled' },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  }

  // ── Source 1: tzevaadom /alerts-history — PRIMARY, has historical data ──────
  try {
    const res = await fetchWithTimeout('https://api.tzevaadom.co.il/alerts-history', {
      headers: { 'Accept': 'application/json', 'Referer': 'https://www.tzevaadom.co.il/' },
    });

    if (res.ok) {
      const raw = await res.json();
      const arr = Array.isArray(raw) ? raw : (raw?.alerts ?? raw?.data ?? raw?.notifications ?? []);

      if (arr.length > 0) {
        // Log first item so we can see the real field structure
        console.log('[RedAlert] alerts-history sample:', JSON.stringify(arr[0]));
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fresh: AlertItem[] = arr.slice(0, HISTORY_LIMIT).map((a: any) => {
        const alertDate = a.alertDate
          ?? a.alert_date
          ?? (a.timestamp ? new Date(a.timestamp * 1000).toISOString() : '')
          ?? (a.time && a.date ? `${a.date}T${a.time}+03:00` : '');

        // City name: prefer Hebrew, append English in parens if available
        const cityHe  = Array.isArray(a.cities) ? a.cities.join(' · ')
                      : (a.cities ?? a.city ?? a.name ?? a.data ?? '');
        const cityEn  = a.name_en ?? a.city_en ?? a.cities_en ?? '';
        const cities  = cityHe && cityEn && cityHe !== cityEn
          ? `${cityHe} (${cityEn})`
          : (cityHe || cityEn);

        const [datePart, timePart] = typeof alertDate === 'string' && alertDate.includes(' ')
          ? alertDate.split(' ')
          : [a.date ?? '', a.time ?? ''];

        return {
          cities,
          time:     a.time     ?? timePart ?? '',
          date:     a.date     ?? datePart ?? '',
          alertDate,
          title:    a.threat   ?? a.title ?? a.type ?? '',
          category: String(a.category ?? a.cat ?? a.threat_id ?? ''),
        };
      }).filter((a: AlertItem) => a.alertDate && a.cities);

      if (fresh.length > 0) {
        console.log(`[RedAlert] alerts-history — ${fresh.length} alerts, persisting`);
        await upsertAlerts(fresh);
      } else {
        console.log('[RedAlert] alerts-history — parsed 0 valid alerts');
      }
    } else {
      console.log(`[RedAlert] alerts-history returned HTTP ${res.status}`);
    }
  } catch (err) {
    console.log(`[RedAlert] alerts-history failed (${(err as Error).message})`);
  }

  // ── Source 2: tzevaadom /notifications — active alerts only, supplements history
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
          category:  String(a.category ?? a.cat ?? ''),
        };
      }).filter((a: AlertItem) => a.alertDate && a.cities);

      if (fresh.length > 0) {
        console.log(`[RedAlert] /notifications — ${fresh.length} active alerts, persisting`);
        await upsertAlerts(fresh);
      } else {
        console.log('[RedAlert] /notifications — quiet (no active alerts)');
      }
    } else {
      console.log(`[RedAlert] /notifications returned HTTP ${res.status}`);
    }
  } catch (err) {
    console.log(`[RedAlert] /notifications failed (${(err as Error).message})`);
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

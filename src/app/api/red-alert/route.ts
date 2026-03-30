import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';

export const dynamic    = 'force-dynamic';
export const revalidate = 0;

const TIMEOUT_MS       = 5_000;
const HISTORY_LIMIT    = 20;
const ACTIVE_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

// Hebrew → English city name map (startsWith matching handles suffixes like "- דרום")
const CITY_MAP: Record<string, string> = {
  'תל אביב':           'Tel Aviv',
  'ירושלים':           'Jerusalem',
  'חיפה':              'Haifa',
  'באר שבע':           "Be'er Sheva",
  'אשדוד':             'Ashdod',
  'אשקלון':            'Ashkelon',
  'קריית שמונה':       'Kiryat Shmona',
  'נהריה':             'Nahariya',
  'שדרות':             'Sderot',
  'עכו':               'Akko',
  'רמת גן':            'Ramat Gan',
  'גבעתיים':           'Givatayim',
  'נתניה':             'Netanya',
  'הרצליה':            'Herzliya',
  'ראשון לציון':       'Rishon LeZion',
  'פתח תקווה':         'Petah Tikva',
  'אילת':              'Eilat',
  'מטולה':             'Metula',
  'מרגליות':           'Margaliot',
  'צפת':               'Tzfat',
  'טבריה':             'Tiberias',
  'עפולה':             'Afula',
  'יראון':             "Yir'on",
  'אביבים':            'Avivim',
  'דימונה':            'Dimona',
  'ערד':               'Arad',
  'קצרין':             'Katzrin',
  'נצרת':              'Nazareth',
  'כרמיאל':            'Karmiel',
  'עקרון':             'Ekron',
  'לוד':               'Lod',
  'רמלה':              'Ramla',
  'מלכיה':             'Malkia',
  'שומרה':             'Shomera',
  'שתולה':             'Shtula',
  'זרעית':             "Zar'it",
  'דוב\'\'ב':          'Dovev',
  'ברעם':              "Bar'am",
  'קיסריה':            'Caesarea',
  'חדרה':              'Hadera',
  'אור עקיבא':         'Or Akiva',
  'פרדס חנה כרכור':   'Pardes Hanna',
  'בנימינה':           'Binyamina',
  'זכרון יעקב':        "Zikhron Ya'akov",
};

/** Translate a single Hebrew city name (with possible suffix) to English. */
function translateCity(he: string): string {
  const trimmed = he.trim();
  for (const [key, en] of Object.entries(CITY_MAP)) {
    if (trimmed.startsWith(key)) return en;
  }
  return trimmed; // no match — keep Hebrew
}

/** Translate a ' · '-delimited list of Hebrew city names. */
function translateCities(heStr: string): string {
  if (!heStr) return '';
  return heStr.split(' · ').map(translateCity).join(' · ');
}

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
  cities_he: string; cities_en: string;
  time: string; date: string;
  alertDate: string; title: string; category: string;
}

async function upsertAlerts(alerts: AlertItem[]): Promise<void> {
  if (alerts.length === 0) return;
  const supabase = createServerClient();
  const rows = alerts.map(a => ({
    id:         alertId(a.alertDate, a.cities_he),
    cities:     a.cities_he,
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
    cities_he: r.cities ?? '',
    cities_en: translateCities(r.cities ?? ''),
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
          { cities_he: 'תל אביב - מרכז העיר', cities_en: 'Tel Aviv',              alertDate: new Date(now - 2  * 60000).toISOString(), time: '23:14', date: '29.03.2026', title: 'Rocket and missile fire',      category: '0' },
          { cities_he: 'רמת גן · גבעתיים',    cities_en: 'Ramat Gan · Givatayim', alertDate: new Date(now - 4  * 60000).toISOString(), time: '23:12', date: '29.03.2026', title: 'Rocket and missile fire',      category: '0' },
          { cities_he: 'חיפה · קריות',         cities_en: 'Haifa',                 alertDate: new Date(now - 8  * 60000).toISOString(), time: '23:08', date: '29.03.2026', title: 'Rocket and missile fire',      category: '0' },
          { cities_he: 'באר שבע · אופקים',     cities_en: "Be'er Sheva",           alertDate: new Date(now - 18 * 60000).toISOString(), time: '22:58', date: '29.03.2026', title: 'Rocket and missile fire',      category: '0' },
          { cities_he: 'ירושלים · בית שמש',    cities_en: 'Jerusalem',             alertDate: new Date(now - 30 * 60000).toISOString(), time: '22:45', date: '29.03.2026', title: 'Rocket and missile fire',      category: '0' },
          { cities_he: 'קיסריה',               cities_en: 'Caesarea',              alertDate: new Date(now - 38 * 60000).toISOString(), time: '22:38', date: '29.03.2026', title: 'Rocket and missile fire',      category: '0' },
          { cities_he: 'שדרות · עוטף עזה',     cities_en: 'Sderot',                alertDate: new Date(now - 45 * 60000).toISOString(), time: '22:30', date: '29.03.2026', title: 'Rocket and missile fire',      category: '0' },
          { cities_he: 'קריית שמונה · מטולה',  cities_en: 'Kiryat Shmona · Metula',alertDate: new Date(now - 55 * 60000).toISOString(), time: '22:20', date: '29.03.2026', title: 'Rocket and missile fire',      category: '0' },
          { cities_he: 'נתניה · הרצליה',        cities_en: 'Netanya · Herzliya',    alertDate: new Date(now - 65 * 60000).toISOString(), time: '22:10', date: '29.03.2026', title: 'Hostile aircraft intrusion',   category: '5' },
          { cities_he: 'צפון הגולן',             cities_en: 'צפון הגולן',            alertDate: new Date(now - 75 * 60000).toISOString(), time: '22:00', date: '29.03.2026', title: 'Hostile aircraft intrusion',   category: '5' },
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
  // Response: [{ id, alerts: [{ time (unix seconds), cities (string[]), threat (0=rockets,5=aircraft), isDrill }] }]
  try {
    const res = await fetchWithTimeout('https://api.tzevaadom.co.il/alerts-history', {
      headers: { 'Accept': 'application/json', 'Referer': 'https://www.tzevaadom.co.il/' },
    });

    if (res.ok) {
      const raw = await res.json();

      // Flatten nested structure: outer events → inner alerts
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const flattened: any[] = [];
      for (const event of (Array.isArray(raw) ? raw : [])) {
        for (const alert of (event.alerts ?? [])) {
          if (alert.isDrill) continue;
          flattened.push(alert);
        }
      }

      // Sort most-recent first, take top 30
      flattened.sort((a, b) => b.time - a.time);
      const top30 = flattened.slice(0, 30);

      const fresh: AlertItem[] = top30.map(a => {
        const d         = new Date(a.time * 1000);
        const alertDate = d.toISOString();
        const timeStr   = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Jerusalem' });
        const dateStr   = d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Jerusalem' }).replace(/\//g, '.');
        const title     = a.threat === 5 ? 'Hostile aircraft intrusion' : 'Rocket and missile fire';

        const cities_he = (Array.isArray(a.cities) ? a.cities : [a.cities ?? '']).join(' · ');
        return {
          cities_he,
          cities_en: translateCities(cities_he),
          time:     timeStr,
          date:     dateStr,
          alertDate,
          title,
          category: String(a.threat ?? 0),
        };
      }).filter(a => a.cities_he);

      if (fresh.length > 0) {
        console.log(`[RedAlert] alerts-history — ${fresh.length} alerts parsed, persisting`);
        await upsertAlerts(fresh);
      } else {
        console.log('[RedAlert] alerts-history — parsed 0 valid alerts from', Array.isArray(raw) ? raw.length : 0, 'events');
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
        const alertDate  = a.alertDate ?? (a.timestamp ? new Date(a.timestamp * 1000).toISOString() : '');
        const cities_he  = Array.isArray(a.cities) ? a.cities.join(' · ') : (a.cities ?? a.data ?? '');
        return {
          cities_he,
          cities_en: translateCities(cities_he),
          time:      a.time  ?? '',
          date:      a.date  ?? '',
          alertDate,
          title:     a.threat ?? a.title ?? '',
          category:  String(a.category ?? a.cat ?? ''),
        };
      }).filter((a: AlertItem) => a.alertDate && a.cities_he);

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

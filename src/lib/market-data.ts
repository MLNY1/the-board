/**
 * Market data fetching via Twelve Data API.
 *
 * Free tier: 800 credits/day, 8 per API call (7 symbols in one batch).
 * In-memory cache with 15-min TTL keeps usage ≈ 96 calls/day well within limits,
 * even when the digest polls every 60s.
 *
 * Symbols used (all ETF/crypto proxies accessible on free tier):
 *   SPY   — S&P 500
 *   QQQ   — Nasdaq 100
 *   TLT   — 20Y Treasury (invert: price ↓ = yields ↑)
 *   UUP   — Dollar index proxy
 *   USO   — Crude oil proxy
 *   GLD   — Gold proxy
 *   BTC/USD — Bitcoin
 */

import type { MarketPrice, MarketData } from '@/types';

const SYMBOLS: Array<{ symbol: string; label: string; invert: boolean }> = [
  { symbol: 'SPY',     label: 'S&P 500',    invert: false },
  { symbol: 'QQQ',     label: 'Nasdaq',     invert: false },
  { symbol: 'TLT',     label: '10Y Yields', invert: true  },
  { symbol: 'UUP',     label: 'DXY',        invert: false },
  { symbol: 'USO',     label: 'Crude Oil',  invert: false },
  { symbol: 'GLD',     label: 'Gold',       invert: false },
  { symbol: 'BTC/USD', label: 'Bitcoin',    invert: false },
];

// ---------------------------------------------------------------------------
// 15-minute in-memory cache (serverless — resets on cold start, acceptable)
// ---------------------------------------------------------------------------

let cachedResult: MarketData | null  = null;
let cacheExpiresAt: number           = 0;
const CACHE_TTL_MS                   = 15 * 60 * 1000; // 15 minutes

// ---------------------------------------------------------------------------
// Core fetch
// ---------------------------------------------------------------------------

export async function fetchMarketData(): Promise<MarketData> {
  if (cachedResult && Date.now() < cacheExpiresAt) {
    return cachedResult;
  }

  const apiKey = process.env.TWELVE_DATA_API_KEY;
  if (!apiKey) {
    return { enabled: false, prices: [], last_updated: new Date().toISOString() };
  }

  try {
    const symbolString = SYMBOLS.map(s => s.symbol).join(',');
    const url = `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(symbolString)}&apikey=${apiKey}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    let res: Response;
    try {
      res = await fetch(url, { signal: controller.signal, cache: 'no-store' });
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) throw new Error(`Twelve Data HTTP ${res.status}`);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw: Record<string, any> = await res.json();

    const prices: MarketPrice[] = SYMBOLS.flatMap(s => {
      // Batch response is keyed by symbol; fall back to raw itself for single-symbol
      const q = raw[s.symbol] ?? raw;

      // Skip symbols that returned an error object
      if (!q || typeof q !== 'object' || q.code || q.status === 'error') return [];

      const price     = parseFloat(q.close ?? q.price ?? '0') || 0;
      const prevClose = parseFloat(q.previous_close ?? '0')   || 0;
      const change    = prevClose > 0
        ? Math.round((price - prevClose) / prevClose * 10_000) / 100
        : 0;

      return [{
        symbol:    s.symbol,
        label:     s.label,
        price,
        change,
        prevClose,
        isUp:   change >= 0,
        invert: s.invert,
      }];
    });

    console.log(`[MarketData] Fetched ${prices.length}/${SYMBOLS.length} symbols`);

    const result: MarketData = {
      enabled:      prices.length > 0,
      prices,
      last_updated: new Date().toISOString(),
    };

    cachedResult    = result;
    cacheExpiresAt  = Date.now() + CACHE_TTL_MS;
    return result;

  } catch (err) {
    console.error('[MarketData] Fetch failed:', (err as Error).message);
    return { enabled: false, prices: [], last_updated: new Date().toISOString() };
  }
}

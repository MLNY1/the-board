/**
 * Market data via Yahoo Finance quote API (no API key required).
 *
 * Symbols use Yahoo Finance format:
 *   ES=F  — S&P 500 E-mini futures
 *   NQ=F  — Nasdaq 100 E-mini futures
 *   YM=F  — Dow Jones E-mini futures
 *   ZN=F  — 10-Year Treasury Note futures
 *   CL=F  — WTI Crude Oil futures
 *   GC=F  — Gold futures
 *   BTC-USD — Bitcoin
 *   DX-Y.NYB — US Dollar Index
 *
 * Each price carries its own timestamp (regularMarketTime) from Yahoo,
 * so the display can show exactly when each quote is from.
 *
 * 15-minute in-memory cache prevents hammering the API on every digest poll.
 */

import type { MarketPrice, MarketData } from '@/types';

const SYMBOLS: Array<{ symbol: string; label: string; invert: boolean; isFuture?: boolean }> = [
  { symbol: 'ES=F',     label: 'S&P Fut',  invert: false, isFuture: true  },
  { symbol: 'NQ=F',     label: 'NQ Fut',   invert: false, isFuture: true  },
  { symbol: 'YM=F',     label: 'Dow Fut',  invert: false, isFuture: true  },
  { symbol: 'ZN=F',     label: 'Bond Fut', invert: false, isFuture: true  },
  { symbol: 'CL=F',     label: 'Oil Fut',  invert: false, isFuture: true  },
  { symbol: 'GC=F',     label: 'Gold',     invert: false, isFuture: true  },
  { symbol: 'BTC-USD',  label: 'Bitcoin',  invert: false, isFuture: false },
  { symbol: 'DX-Y.NYB', label: 'DXY',      invert: false, isFuture: false },
];

// ---------------------------------------------------------------------------
// 15-minute in-memory cache
// ---------------------------------------------------------------------------

let cachedResult: MarketData | null = null;
let cacheExpiresAt: number          = 0;
const CACHE_TTL_MS                  = 15 * 60 * 1000;

// ---------------------------------------------------------------------------
// Core fetch
// ---------------------------------------------------------------------------

export async function fetchMarketData(): Promise<MarketData> {
  if (cachedResult && Date.now() < cacheExpiresAt) {
    return cachedResult;
  }

  try {
    // Encode each symbol individually (handles BTC-USD, DX-Y.NYB etc.)
    // but keep commas raw — Yahoo Finance rejects %2C between symbols.
    const symbolString = SYMBOLS.map(s => encodeURIComponent(s.symbol)).join(',');
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbolString}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    let res: Response;
    try {
      res = await fetch(url, {
        signal: controller.signal,
        cache:  'no-store',
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; TheBoard/1.0)',
          'Accept':     'application/json',
        },
      });
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) throw new Error(`Yahoo Finance HTTP ${res.status}`);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json: any = await res.json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const results: any[] = json?.quoteResponse?.result ?? [];

    if (results.length === 0) throw new Error('Yahoo Finance returned empty result');

    // Build a map from Yahoo symbol → quote
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const quoteMap = new Map<string, any>(results.map((q: any) => [q.symbol, q]));

    const prices: MarketPrice[] = SYMBOLS.flatMap(s => {
      const q = quoteMap.get(s.symbol);
      if (!q) return [];

      const price     = q.regularMarketPrice     ?? 0;
      const prevClose = q.regularMarketPreviousClose ?? 0;
      const change    = q.regularMarketChangePercent ?? 0;

      // Yahoo gives regularMarketTime as Unix seconds
      const priceTime = q.regularMarketTime
        ? new Date(q.regularMarketTime * 1000).toISOString()
        : undefined;

      if (!price) return [];

      return [{
        symbol:    s.symbol,
        label:     s.label,
        price,
        change:    Math.round(change * 100) / 100,
        prevClose,
        isUp:      change >= 0,
        invert:    s.invert,
        isFuture:  s.isFuture ?? false,
        timestamp: priceTime,
      }];
    });

    console.log(`[MarketData] Fetched ${prices.length}/${SYMBOLS.length} symbols via Yahoo Finance`);

    const result: MarketData = {
      enabled:      prices.length > 0,
      prices,
      last_updated: new Date().toISOString(),
    };

    cachedResult   = result;
    cacheExpiresAt = Date.now() + CACHE_TTL_MS;
    return result;

  } catch (err) {
    console.error('[MarketData] Fetch failed:', (err as Error).message);
    return { enabled: false, prices: [], last_updated: new Date().toISOString() };
  }
}

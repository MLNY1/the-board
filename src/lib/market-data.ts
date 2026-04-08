/**
 * Market data via Yahoo Finance v8 chart API (no API key required).
 *
 * v7 quote API now requires auth — v8 chart endpoint still works freely.
 * One request per symbol, all fetched in parallel via Promise.allSettled.
 *
 * Symbols (Yahoo Finance format):
 *   ES=F      — S&P 500 E-mini futures
 *   NQ=F      — Nasdaq 100 E-mini futures
 *   YM=F      — Dow Jones E-mini futures
 *   ZN=F      — 10-Year Treasury Note futures
 *   CL=F      — WTI Crude Oil futures
 *   GC=F      — Gold futures
 *   BTC-USD   — Bitcoin / USD
 *   DX-Y.NYB  — US Dollar Index
 *
 * 15-minute in-memory cache prevents hammering the API on every digest poll.
 */

import type { MarketPrice, MarketData } from '@/types';

const SYMBOLS: Array<{ symbol: string; label: string; invert: boolean }> = [
  { symbol: 'ES=F',     label: 'S&P Fut',  invert: false },
  { symbol: 'NQ=F',     label: 'NQ Fut',   invert: false },
  { symbol: 'YM=F',     label: 'Dow Fut',  invert: false },
  { symbol: 'ZN=F',     label: 'Bond Fut', invert: false },
  { symbol: 'CL=F',     label: 'Oil Fut',  invert: false },
  { symbol: 'GC=F',     label: 'Gold',     invert: false },
  { symbol: 'BTC-USD',  label: 'Bitcoin',  invert: false },
  { symbol: 'DX-Y.NYB', label: 'DXY',      invert: false },
];

const YAHOO_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json',
};

// ---------------------------------------------------------------------------
// 15-minute in-memory cache
// ---------------------------------------------------------------------------

let cachedResult: MarketData | null = null;
let cacheExpiresAt: number          = 0;
const CACHE_TTL_MS                  = 15 * 60 * 1000;

// ---------------------------------------------------------------------------
// Fetch one symbol via v8 chart endpoint
// ---------------------------------------------------------------------------

async function fetchSymbol(s: typeof SYMBOLS[0]): Promise<MarketPrice | null> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s.symbol)}?interval=1m&range=1d`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const res = await fetch(url, { signal: controller.signal, cache: 'no-store', headers: YAHOO_HEADERS });
    if (!res.ok) return null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json: any = await res.json();
    const meta = json?.chart?.result?.[0]?.meta;
    if (!meta) return null;

    const price     = meta.regularMarketPrice     ?? 0;
    const prevClose = meta.chartPreviousClose ?? meta.previousClose ?? 0;
    if (!price) return null;

    const change = prevClose > 0
      ? Math.round((price - prevClose) / prevClose * 10_000) / 100
      : 0;

    const timestamp = meta.regularMarketTime
      ? new Date(meta.regularMarketTime * 1000).toISOString()
      : undefined;

    return {
      symbol:    s.symbol,
      label:     s.label,
      price,
      change,
      prevClose,
      isUp:      change >= 0,
      invert:    s.invert,
      isFuture:  true,
      timestamp,
    };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function fetchMarketData(): Promise<MarketData> {
  if (cachedResult && Date.now() < cacheExpiresAt) {
    return cachedResult;
  }

  try {
    const results = await Promise.allSettled(SYMBOLS.map(fetchSymbol));

    const prices: MarketPrice[] = results
      .filter((r): r is PromiseFulfilledResult<MarketPrice> => r.status === 'fulfilled' && r.value !== null)
      .map(r => r.value);

    console.log(`[MarketData] Fetched ${prices.length}/${SYMBOLS.length} symbols via Yahoo Finance v8`);

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

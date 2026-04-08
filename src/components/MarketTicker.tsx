'use client';

/**
 * MarketTicker — horizontal strip shown only during weekday Yom Tov
 * (or when ?market=true for testing). Prices come from digest meta.market.
 *
 * Each cell shows: label / price / % change / time of quote.
 * Prices are sourced from Yahoo Finance and carry per-symbol timestamps.
 */

import type { MarketPrice } from '@/types';

interface MarketTickerProps {
  prices: MarketPrice[];
  lastUpdated?: string;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatPrice(p: MarketPrice): string {
  const { symbol, price } = p;

  if (symbol === 'BTC-USD') {
    return `$${(price / 1000).toFixed(1)}K`;
  }
  if (symbol === 'CL=F') {
    return `$${price.toFixed(2)}`;         // oil: dollars per barrel
  }
  if (symbol === 'ZN=F') {
    return price.toFixed(2);               // bond futures: price per $100 face
  }
  if (symbol === 'GC=F') {
    return `$${Math.round(price).toLocaleString('en-US')}`; // gold: $ per oz
  }
  if (symbol === 'DX-Y.NYB') {
    return price.toFixed(2);               // dollar index
  }
  if (symbol === 'ES=F' || symbol === 'NQ=F' || symbol === 'YM=F') {
    return Math.round(price).toLocaleString('en-US'); // index futures: whole number
  }
  return Math.round(price).toLocaleString('en-US');
}

function formatChange(change: number): string {
  const sign = change >= 0 ? '+' : '';
  return `${sign}${change.toFixed(2)}%`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour:   'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

// ---------------------------------------------------------------------------
// Single instrument cell
// ---------------------------------------------------------------------------

function Cell({ p }: { p: MarketPrice }) {
  const changeColor = p.isUp ? '#4a8c5c' : '#c0392b';

  return (
    <div style={{
      textAlign:  'center',
      minWidth:   '88px',
      flex:       '0 0 auto',
      padding:    '0 6px',
      borderRight: '1px solid rgba(255,255,255,0.06)',
    }}>
      {/* Label */}
      <div style={{
        fontFamily:    'var(--font-body)',
        fontSize:      '10px',
        color:         'var(--text-muted)',
        letterSpacing: '1px',
        textTransform: 'uppercase',
        marginBottom:  '1px',
      }}>
        {p.label}
      </div>

      {/* Price */}
      <div style={{
        fontFamily: 'var(--font-mono)',
        fontSize:   '14px',
        color:      'var(--text-primary)',
        fontWeight: 500,
        lineHeight: 1,
      }}>
        {formatPrice(p)}
      </div>

      {/* % change */}
      <div style={{
        fontFamily: 'var(--font-mono)',
        fontSize:   '11px',
        fontWeight: 600,
        color:      changeColor,
        marginTop:  '1px',
      }}>
        {formatChange(p.change)}
      </div>

      {/* Per-price timestamp */}
      {p.timestamp && (
        <div style={{
          fontFamily: 'var(--font-body)',
          fontSize:   '9px',
          color:      'var(--text-dim)',
          marginTop:  '2px',
          whiteSpace: 'nowrap',
        }}>
          {formatTime(p.timestamp)}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ticker strip
// ---------------------------------------------------------------------------

export default function MarketTicker({ prices }: MarketTickerProps) {
  if (!prices.length) return null;

  return (
    <div
      className="market-ticker"
      style={{
        display:      'flex',
        alignItems:   'center',
        padding:      '6px 16px',
        borderBottom: '1px solid var(--border-card)',
        background:   'rgba(26, 22, 16, 0.6)',
        minHeight:    '62px',
        flexShrink:   0,
        overflowX:    'auto',
        gap:          '0',
      }}
    >
      {prices.map(p => <Cell key={p.symbol} p={p} />)}
    </div>
  );
}

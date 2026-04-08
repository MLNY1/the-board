'use client';

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
  if (symbol === 'BTC-USD')  return `$${(price / 1000).toFixed(1)}K`;
  if (symbol === 'CL=F')     return `$${price.toFixed(2)}`;
  if (symbol === 'ZN=F')     return price.toFixed(2);
  if (symbol === 'GC=F')     return `$${Math.round(price).toLocaleString('en-US')}`;
  if (symbol === 'DX-Y.NYB') return price.toFixed(2);
  return Math.round(price).toLocaleString('en-US');
}

function formatChange(change: number): string {
  const sign = change >= 0 ? '+' : '';
  return `${sign}${change.toFixed(2)}%`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour:         'numeric',
    minute:       '2-digit',
    timeZoneName: 'short',
  });
}

// ---------------------------------------------------------------------------
// Single instrument cell
// ---------------------------------------------------------------------------

function Cell({ p }: { p: MarketPrice }) {
  const isUp        = p.isUp;
  const changeColor = isUp ? '#4ead6a' : '#e05252';
  const changeBg    = isUp ? 'rgba(78,173,106,0.10)' : 'rgba(224,82,82,0.10)';

  return (
    <div style={{
      flex:           '1 1 0',
      display:        'flex',
      flexDirection:  'column',
      alignItems:     'center',
      justifyContent: 'center',
      padding:        '8px 4px',
      gap:            '3px',
      borderRight:    '1px solid rgba(255,255,255,0.05)',
      minWidth:       0,
    }}>
      {/* Label */}
      <div style={{
        fontFamily:    'var(--font-body)',
        fontSize:      '10px',
        letterSpacing: '1.2px',
        textTransform: 'uppercase',
        color:         'var(--text-dim)',
        whiteSpace:    'nowrap',
      }}>
        {p.label}
      </div>

      {/* Price */}
      <div style={{
        fontFamily:  'var(--font-mono)',
        fontSize:    '16px',
        fontWeight:  600,
        color:       'var(--text-primary)',
        lineHeight:  1,
        whiteSpace:  'nowrap',
      }}>
        {formatPrice(p)}
      </div>

      {/* % change pill */}
      <div style={{
        fontFamily:   'var(--font-mono)',
        fontSize:     '11px',
        fontWeight:   700,
        color:        changeColor,
        background:   changeBg,
        borderRadius: '3px',
        padding:      '1px 5px',
        whiteSpace:   'nowrap',
      }}>
        {formatChange(p.change)}
      </div>

      {/* Timestamp */}
      {p.timestamp && (
        <div style={{
          fontFamily: 'var(--font-body)',
          fontSize:   '9px',
          color:      'var(--text-dim)',
          whiteSpace: 'nowrap',
          opacity:    0.7,
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
      style={{
        display:      'flex',
        alignItems:   'stretch',
        width:        '100%',
        borderBottom: '1px solid var(--border-card)',
        background:   'rgba(18, 15, 10, 0.85)',
        flexShrink:   0,
        minHeight:    '70px',
      }}
    >
      {prices.map((p, i) => (
        <Cell key={p.symbol} p={p} />
      ))}
    </div>
  );
}

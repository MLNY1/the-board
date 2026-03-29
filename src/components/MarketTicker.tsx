'use client';

/**
 * MarketTicker — 52px horizontal strip shown only during weekday Yom Tov
 * (or when ?market=true for testing). Prices come from digest meta.market.
 *
 * TLT is inverted: price ↓ = yields ↑, so colors are flipped.
 * Bitcoin is abbreviated ($67.2K). Gold/Oil show $. SPY/QQQ: comma ints.
 */

import type { MarketPrice } from '@/types';

interface MarketTickerProps {
  prices: MarketPrice[];
}

// ---------------------------------------------------------------------------
// Price formatting
// ---------------------------------------------------------------------------

function formatPrice(p: MarketPrice): string {
  const { symbol, price } = p;

  if (symbol === 'BTC/USD') {
    if (price >= 1000) return `$${(price / 1000).toFixed(1)}K`;
    return `$${Math.round(price)}`;
  }
  if (symbol === 'GLD') {
    return `$${Math.round(price).toLocaleString('en-US')}`;
  }
  if (symbol === 'USO') {
    return `$${price.toFixed(1)}`;
  }
  if (symbol === 'UUP') {
    return price.toFixed(2);
  }
  // SPY, QQQ — comma int
  return Math.round(price).toLocaleString('en-US');
}

function formatChange(p: MarketPrice): string {
  const sign = p.change >= 0 ? '+' : '';
  return `${sign}${p.change.toFixed(1)}%`;
}

// ---------------------------------------------------------------------------
// Single instrument cell
// ---------------------------------------------------------------------------

function Cell({ p }: { p: MarketPrice }) {
  // For inverted instruments (TLT), flip the visual signal:
  //   TLT price ↑ = yields ↓ = good (green)
  //   TLT price ↓ = yields ↑ = bad  (red)
  // The `isUp` flag reflects ETF price direction, so we invert it for color.
  const visuallyUp = p.invert ? !p.isUp : p.isUp;
  const changeColor = visuallyUp ? '#4a8c5c' : '#c0392b';

  // For TLT, replace the price with yield direction label
  const priceDisplay = p.invert
    ? (p.isUp ? 'Yields ↓' : 'Yields ↑')
    : formatPrice(p);

  const priceColor = p.invert
    ? changeColor   // yield direction inherits the color signal
    : 'var(--text-primary)';

  return (
    <div style={{ textAlign: 'center', minWidth: '90px', flex: '0 0 auto' }}>
      <div style={{
        fontFamily:    'var(--font-body)',
        fontSize:      '11px',
        color:         'var(--text-muted)',
        letterSpacing: '1px',
        textTransform: 'uppercase',
        marginBottom:  '2px',
      }}>
        {p.label}
      </div>
      <div style={{
        fontFamily: 'var(--font-mono)',
        fontSize:   '15px',
        color:      priceColor,
        fontWeight: 500,
        lineHeight: 1,
      }}>
        {priceDisplay}
      </div>
      {!p.invert && (
        <div style={{
          fontFamily: 'var(--font-mono)',
          fontSize:   '12px',
          fontWeight: 600,
          color:      changeColor,
          marginTop:  '1px',
        }}>
          {formatChange(p)}
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
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'space-around',
        padding:        '8px 28px',
        borderBottom:   '1px solid var(--border-card)',
        background:     'rgba(26, 22, 16, 0.6)',
        height:         '52px',
        flexShrink:     0,
        overflowX:      'auto',
        maxWidth:       '100%',
      }}
    >
      {prices.map(p => <Cell key={p.symbol} p={p} />)}
    </div>
  );
}

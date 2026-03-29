'use client';

import { useEffect, useRef, useState } from 'react';
import type { ShabbosWindowMeta } from '@/types';

interface ShabbosHeaderProps {
  shabbos: ShabbosWindowMeta;
  countdownToShabbos: string | null;
  isShabbosMode: boolean;
}

function formatClock(d: Date): string {
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function formatShabbosTime(iso: string, showDay: boolean): string {
  const d    = new Date(iso);
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  if (!showDay) return time;
  const day  = d.toLocaleDateString('en-US', { weekday: 'short' });
  return `${day} ${time}`;
}

const YOM_TOV_PARSHAS = new Set([
  'pesach', 'passover', 'shavuot', 'shavuos', 'rosh hashana', 'rosh hashanah',
  'yom kippur', 'sukkot', 'sukkos', 'shemini atzeret', 'shemini atzeres',
  'simchat torah', 'simchas torah', 'purim', 'chanukah', 'hanukkah',
]);

function isYomTov(parsha: string | null): boolean {
  if (!parsha) return false;
  return YOM_TOV_PARSHAS.has(parsha.toLowerCase());
}

export default function ShabbosHeader({ shabbos, isShabbosMode }: ShabbosHeaderProps) {
  const [clock, setClock] = useState(() => formatClock(new Date()));
  const ref = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    ref.current = setInterval(() => setClock(formatClock(new Date())), 1000);
    return () => { if (ref.current) clearInterval(ref.current); };
  }, []);

  const parshaDisplay = shabbos.parsha
    ? (isShabbosMode ? `Shabbat ${shabbos.parsha}` : shabbos.parsha)
    : null;

  const showDay      = !isShabbosMode;
  const yomTov       = isYomTov(shabbos.parsha);
  const candleTime   = shabbos.window_start ? formatShabbosTime(shabbos.window_start, showDay) : null;
  const havdalahTime = shabbos.window_end   ? formatShabbosTime(shabbos.window_end, showDay)   : null;
  const hasTimes     = candleTime !== null && havdalahTime !== null;

  const sep = <span style={{ margin: '0 6px', color: 'var(--text-dim)' }}>·</span>;

  return (
    <header
      className="shabbos-header"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 28px',
        borderBottom: '1px solid var(--border-card)',
        background: 'linear-gradient(180deg, rgba(160,110,40,0.05) 0%, transparent 100%)',
        flexShrink: 0,
        minHeight: '56px',
      }}
    >
      {/* Left — TheBoard logotype */}
      <div className="header-logo" style={{ minWidth: '160px' }}>
        <span style={{
          fontFamily: 'var(--font-headline)',
          fontStyle: 'italic',
          fontSize: '20px',
          color: '#c9b88a',
          letterSpacing: '0.5px',
        }}>
          TheBoard
        </span>
      </div>

      {/* Center — parsha (if known) + candle/havdalah times */}
      <div className="header-center" style={{ textAlign: 'center' }}>
        {parshaDisplay && (
          <div style={{
            fontFamily: 'var(--font-headline)',
            fontSize: '17px',
            color: 'var(--accent-amber)',
            marginBottom: hasTimes ? '3px' : 0,
          }}>
            {parshaDisplay}
          </div>
        )}

        {hasTimes && (
          <div style={{
            fontFamily: 'var(--font-body)',
            fontSize: '13px',
            color: 'var(--text-secondary)',
            whiteSpace: 'nowrap',
            display: 'flex',
            alignItems: 'center',
            gap: '20px',
          }}>
            <span>
              🕯 Candles{sep}{candleTime}
            </span>
            <span style={isShabbosMode ? { color: 'var(--accent-amber)', fontWeight: 600 } : {}}>
              ✨ {yomTov ? 'Yom Tov Ends' : 'Havdalah'}{sep}{havdalahTime}
            </span>
          </div>
        )}
      </div>

      {/* Right — live clock */}
      <div className="header-clock" style={{ minWidth: '160px', textAlign: 'right' }}>
        <span style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '17px',
          color: '#b8b0a0',
        }}>
          {clock}
        </span>
      </div>
    </header>
  );
}

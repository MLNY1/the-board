'use client';

import { useEffect, useRef, useState } from 'react';
import type { ShabbosWindowMeta } from '@/types';

interface ShabbosHeaderProps {
  shabbos: ShabbosWindowMeta;
  countdownToShabbos: string | null;
  isShabbosMode: boolean;
}

function formatClock(date: Date): string {
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
}

/**
 * Formats a candle-lighting or havdalah ISO timestamp for display.
 * During weekday (showDay=true), prepends the abbreviated day: "Fri 7:15 PM".
 * During Shabbos (showDay=false), shows time only: "7:15 PM".
 */
function formatShabbosTime(iso: string, showDay: boolean): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  if (!showDay) return time;
  const day = d.toLocaleDateString('en-US', { weekday: 'short' });
  return `${day} ${time}`;
}

export default function ShabbosHeader({ shabbos, isShabbosMode }: ShabbosHeaderProps) {
  const [clock, setClock] = useState(() => formatClock(new Date()));
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    intervalRef.current = setInterval(() => setClock(formatClock(new Date())), 1000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, []);

  // During active Shabbos: "Shabbat Vayikra"; during weekday: just the parsha name
  const parshaDisplay = shabbos.parsha
    ? (isShabbosMode ? `Shabbat ${shabbos.parsha}` : shabbos.parsha)
    : null;

  // Candle lighting / havdalah — show day name on weekdays
  const showDay = !isShabbosMode;
  const candleLighting = shabbos.window_start
    ? formatShabbosTime(shabbos.window_start, showDay)
    : null;
  const havdalah = shabbos.window_end
    ? formatShabbosTime(shabbos.window_end, showDay)
    : null;

  const hasTimes = candleLighting !== null && havdalah !== null;

  return (
    <header
      className="relative flex items-center justify-between border-b shrink-0"
      style={{
        backgroundColor: 'var(--bg-primary)',
        borderBottomColor: 'var(--border-subtle)',
        height: '72px',
        paddingLeft: '2.5rem',
        paddingRight: '2.5rem',
      }}
    >
      {/* Shabbos warm edge glow */}
      {isShabbosMode && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: 'linear-gradient(90deg, rgba(196,146,46,0.07) 0%, transparent 35%, transparent 65%, rgba(196,146,46,0.05) 100%)',
          }}
        />
      )}

      {/* ── Left: TheBoard logotype ── */}
      <div className="flex items-center min-w-[200px] shrink-0">
        <span
          className="font-serif italic select-none"
          style={{
            fontSize: 'clamp(1.25rem, 1.5vw, 1.5rem)',
            color: 'var(--accent-breaking)',
            letterSpacing: '-0.01em',
          }}
        >
          TheBoard
        </span>
      </div>

      {/* ── Center: Parsha + Shabbos times ── */}
      <div className="absolute left-1/2 -translate-x-1/2 flex flex-col items-center gap-0.5">

        {/* Row 1 — Parsha name */}
        {parshaDisplay ? (
          <span
            className="font-serif font-semibold"
            style={{
              fontSize: 'clamp(0.9375rem, 1.2vw, 1.125rem)',
              color: 'var(--accent-breaking)',
              whiteSpace: 'nowrap',
            }}
          >
            {parshaDisplay}
          </span>
        ) : (
          /* No parsha — show label so center isn't empty */
          <span
            className="font-sans font-bold uppercase tracking-widest"
            style={{ fontSize: '0.6875rem', color: 'var(--text-dim)', letterSpacing: '0.14em' }}
          >
            Live News
          </span>
        )}

        {/* Row 2 — Candle lighting + Havdalah times */}
        {hasTimes ? (
          <div
            className="flex items-center font-sans"
            style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', gap: '0.625rem' }}
          >
            {/* Candle lighting */}
            <span className="flex items-center gap-1">
              <span style={{ fontSize: '0.75rem' }}>🕯</span>
              <span style={{ color: 'var(--text-dim)', fontSize: '0.6875rem', marginRight: '1px' }}>
                {isShabbosMode ? '' : 'Candles'}
              </span>
              <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>
                {candleLighting}
              </span>
            </span>

            <span style={{ color: 'var(--text-dim)', fontSize: '0.625rem' }}>·</span>

            {/* Havdalah */}
            <span className="flex items-center gap-1">
              <span style={{ fontSize: '0.75rem' }}>✨</span>
              <span style={{ color: 'var(--text-dim)', fontSize: '0.6875rem', marginRight: '1px' }}>
                {isShabbosMode ? '' : 'Havdalah'}
              </span>
              <span
                style={{
                  // Highlight havdalah during active Shabbos — most relevant time
                  color: isShabbosMode ? 'var(--accent-breaking)' : 'var(--text-secondary)',
                  fontWeight: isShabbosMode ? 600 : 500,
                }}
              >
                {havdalah}
              </span>
            </span>
          </div>
        ) : (
          /* No times available yet — show nothing extra */
          null
        )}
      </div>

      {/* ── Right: Live clock ── */}
      <div className="min-w-[200px] flex justify-end shrink-0">
        <span
          className="font-mono tabular-nums"
          style={{
            fontSize: 'clamp(0.9375rem, 1.1vw, 1.0625rem)',
            color: 'var(--text-primary)',
            letterSpacing: '0.02em',
          }}
        >
          {clock}
        </span>
      </div>
    </header>
  );
}

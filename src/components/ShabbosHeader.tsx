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

function formatWindowTime(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

export default function ShabbosHeader({ shabbos, countdownToShabbos, isShabbosMode }: ShabbosHeaderProps) {
  const [clock, setClock] = useState(() => formatClock(new Date()));
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    intervalRef.current = setInterval(() => setClock(formatClock(new Date())), 1000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, []);

  const parshaDisplay = shabbos.parsha
    ? (isShabbosMode ? `Shabbat ${shabbos.parsha}` : shabbos.parsha)
    : null;

  return (
    <header
      className="relative flex items-center justify-between border-b shrink-0"
      style={{
        backgroundColor: 'var(--bg-primary)',
        borderBottomColor: 'var(--border-subtle)',
        height: '68px',
        paddingLeft: '2.5rem',
        paddingRight: '2.5rem',
      }}
    >
      {/* Shabbos warm glow overlay — only visible during Shabbos */}
      {isShabbosMode && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: 'linear-gradient(90deg, rgba(196,146,46,0.07) 0%, transparent 40%, transparent 60%, rgba(196,146,46,0.05) 100%)',
          }}
        />
      )}

      {/* ── Left: TheBoard logotype ── */}
      <div className="flex items-center min-w-[200px]">
        <span
          className="font-serif italic tracking-tight select-none"
          style={{
            fontSize: 'clamp(1.25rem, 1.5vw, 1.5rem)',
            color: 'var(--accent-breaking)',
            letterSpacing: '-0.01em',
          }}
        >
          TheBoard
        </span>
      </div>

      {/* ── Center: Parsha / Shabbos info ── */}
      <div className="absolute left-1/2 -translate-x-1/2 flex flex-col items-center gap-0.5">
        {parshaDisplay && (
          <span
            className="font-serif font-semibold tracking-wide"
            style={{
              fontSize: 'clamp(1rem, 1.25vw, 1.25rem)',
              color: 'var(--accent-breaking)',
            }}
          >
            {parshaDisplay}
          </span>
        )}

        {isShabbosMode && shabbos.window_start && shabbos.window_end ? (
          <span
            className="font-sans tracking-wide"
            style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}
          >
            {formatWindowTime(shabbos.window_start)}
            <span style={{ color: 'var(--text-dim)', margin: '0 6px' }}>–</span>
            {formatWindowTime(shabbos.window_end)}
          </span>
        ) : countdownToShabbos ? (
          <span
            className="font-sans"
            style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}
          >
            Shabbat in{' '}
            <span style={{ color: 'var(--accent-breaking)', fontWeight: 600 }}>
              {countdownToShabbos}
            </span>
          </span>
        ) : !parshaDisplay ? (
          <span
            className="font-sans tracking-widest uppercase"
            style={{ fontSize: '0.75rem', color: 'var(--text-dim)', letterSpacing: '0.12em' }}
          >
            Live News
          </span>
        ) : null}
      </div>

      {/* ── Right: Live clock ── */}
      <div className="min-w-[200px] flex justify-end">
        <span
          className="font-mono tabular-nums"
          style={{
            fontSize: 'clamp(1rem, 1.2vw, 1.125rem)',
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

'use client';

/**
 * Top header bar for TheBoard.
 *
 * Weekday mode: "TheBoard" logo | Parsha name + countdown to Shabbos | Live clock
 * Shabbos mode: "TheBoard" logo | "Shabbat [Parsha]" + window times | Live clock
 *
 * The clock updates every second via setInterval. All intervals are cleaned up on unmount.
 */

import { useEffect, useRef, useState } from 'react';
import type { ShabbosWindowMeta } from '@/types';

interface ShabbosHeaderProps {
  shabbos: ShabbosWindowMeta;
  /** Countdown string like "6h 42m" — provided by parent so it doesn't re-fetch */
  countdownToShabbos: string | null;
  isShabbosMode: boolean;
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short',
  });
}

function formatWindowTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

export default function ShabbosHeader({
  shabbos,
  countdownToShabbos,
  isShabbosMode,
}: ShabbosHeaderProps) {
  const [currentTime, setCurrentTime] = useState<string>(() => formatTime(new Date()));
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    intervalRef.current = setInterval(() => {
      setCurrentTime(formatTime(new Date()));
    }, 1000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  const parshaDisplay = shabbos.parsha ? `Shabbat ${shabbos.parsha}` : 'Shabbat';

  return (
    <header
      className={`
        flex items-center justify-between px-8 py-4 border-b
        ${isShabbosMode
          ? 'bg-[#0d0a07] border-[#2a2015] text-[#d4cfc8]'
          : 'bg-[#0a0a0f] border-[#1e1e24] text-[#e8e4de]'
        }
      `}
    >
      {/* Logo */}
      <div className="flex items-center gap-3 min-w-[180px]">
        <span
          className={`
            text-2xl font-bold tracking-tight font-serif
            ${isShabbosMode ? 'text-[#c4922e]' : 'text-[#d4a24e]'}
          `}
        >
          TheBoard
        </span>
      </div>

      {/* Center: Parsha + Shabbos info */}
      <div className="flex flex-col items-center gap-0.5">
        {shabbos.parsha && (
          <span
            className={`
              text-xl font-semibold tracking-wide
              ${isShabbosMode ? 'text-[#d4cfc8]' : 'text-[#e8e4de]'}
            `}
          >
            {parshaDisplay}
          </span>
        )}

        {isShabbosMode && shabbos.window_start && shabbos.window_end ? (
          <span className="text-sm text-[#8a8680]">
            {formatWindowTime(shabbos.window_start)} – {formatWindowTime(shabbos.window_end)}
          </span>
        ) : countdownToShabbos ? (
          <span className="text-sm text-[#8a8680]">
            Shabbat in{' '}
            <span className={isShabbosMode ? 'text-[#c4922e]' : 'text-[#d4a24e]'}>
              {countdownToShabbos}
            </span>
          </span>
        ) : null}
      </div>

      {/* Right: Live clock */}
      <div className="min-w-[180px] flex justify-end">
        <span
          className={`
            text-xl font-mono tabular-nums
            ${isShabbosMode ? 'text-[#d4cfc8]' : 'text-[#e8e4de]'}
          `}
        >
          {currentTime}
        </span>
      </div>
    </header>
  );
}

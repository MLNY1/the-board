'use client';

import { useEffect, useState } from 'react';

interface WeatherData {
  current: { temp: number; code: number; description: string; emoji: string };
  daily: Array<{
    date: string;
    high: number;
    low: number;
    precip_chance: number;
    description: string;
    emoji: string;
  }>;
}

const DEFAULT_LAT = 40.6326;
const DEFAULT_LNG = -73.7154;

export default function WeatherWidget({ mobile = false }: { mobile?: boolean }) {
  const [data, setData] = useState<WeatherData | null>(null);

  useEffect(() => {
    const lat = parseFloat(localStorage.getItem('theboard_lat') ?? String(DEFAULT_LAT));
    const lng = parseFloat(localStorage.getItem('theboard_lng') ?? String(DEFAULT_LNG));

    const load = () => {
      fetch(`/api/weather?lat=${lat}&lng=${lng}`)
        .then(r => r.ok ? r.json() : null)
        .then(d => d && setData(d))
        .catch(() => {});
    };

    load();
    const timer = setInterval(load, 7_200_000);
    return () => clearInterval(timer);
  }, []);

  if (!data) return null;

  // ── Mobile: single compact row ──────────────────────────────────────────────
  if (mobile) {
    return (
      <div style={{
        overflowX:    'auto',
        whiteSpace:   'nowrap',
        padding:      '6px 16px',
        fontSize:     '12px',
        color:        'var(--text-secondary)',
        borderBottom: '1px solid var(--border-subtle)',
        background:   'var(--bg-primary)',
      }}>
        <span style={{ marginRight: 12, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
          {data.current.emoji} {data.current.temp}°F
        </span>
        {data.daily.map((d, i) => (
          <span key={i} style={{ marginRight: 12 }}>
            {d.date}&nbsp;
            <span style={{ fontFamily: 'var(--font-mono)' }}>{d.high}°/{d.low}°</span>
            {d.precip_chance >= 10 && (
              <span style={{ color: d.precip_chance >= 50 ? '#d4a24e' : 'var(--text-muted)', marginLeft: 4 }}>
                {d.precip_chance}%
              </span>
            )}
          </span>
        ))}
      </div>
    );
  }

  // ── Desktop: full sidebar widget ────────────────────────────────────────────
  return (
    <div style={{
      padding:      '12px 16px',
      borderBottom: '1px solid #2a1a14',
      flexShrink:   0,
    }}>
      {/* Current conditions */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 8 }}>
        <span style={{ fontSize: 16 }}>{data.current.emoji}</span>
        <span style={{
          fontFamily: 'var(--font-mono)',
          fontSize:   18,
          fontWeight: 700,
          color:      'var(--text-primary)',
        }}>
          {data.current.temp}°F
        </span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 2 }}>Now</span>
      </div>

      {/* Daily rows */}
      {data.daily.map((d, i) => (
        <div key={i} style={{
          display:        'flex',
          alignItems:     'center',
          fontSize:       12,
          color:          'var(--text-secondary)',
          marginBottom:   i < data.daily.length - 1 ? 4 : 0,
        }}>
          <span style={{ width: 36, flexShrink: 0 }}>{d.date}</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, marginRight: 'auto' }}>
            {d.high}°/{d.low}°
          </span>
          {d.precip_chance >= 10 && (
            <span style={{ color: d.precip_chance >= 50 ? '#d4a24e' : 'var(--text-muted)' }}>
              {d.precip_chance}%
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

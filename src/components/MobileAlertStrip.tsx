'use client';

/**
 * Mobile-only horizontal alert strip.
 * Shown only on viewports < 1024px via CSS (.mobile-alert-strip { display: none }).
 * Fetches /api/red-alert every 30s. Returns null (no DOM) if no alerts.
 */

import { useEffect, useRef, useState } from 'react';

interface AlertItem {
  cities: string; time: string; alertDate: string;
  title: string; category: string;
}

interface AlertData { alerts: AlertItem[]; }

function threatEmoji(title: string, category: string): string {
  const t = `${title}${category}`.toLowerCase();
  if (t.includes('aircraft') || category === '2') return '✈';
  if (t.includes('earthquake'))                   return '🌍';
  if (t.includes('infiltrat'))                    return '⚠';
  return '🚀';
}

export default function MobileAlertStrip() {
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const mountedRef          = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    const fetch_ = async () => {
      try {
        const res = await fetch('/api/red-alert');
        if (res.ok && mountedRef.current) {
          const data: AlertData = await res.json();
          setAlerts(data.alerts ?? []);
        }
      } catch {}
    };
    fetch_();
    const iv = setInterval(fetch_, 30_000);
    return () => { mountedRef.current = false; clearInterval(iv); };
  }, []);

  if (alerts.length === 0) return null;

  return (
    <div
      className="mobile-alert-strip"
      style={{
        width: '100%',
        maxHeight: '120px',
        overflowX: 'auto',
        overflowY: 'hidden',
        background: 'rgba(120,30,20,0.06)',
        borderBottom: '1px solid #2a1a14',
        padding: '8px 12px',
        flexShrink: 0,
        gap: '8px',
        alignItems: 'center',
        flexWrap: 'nowrap',
      }}
    >
      {alerts.map((alert, i) => (
        <div
          key={i}
          style={{
            display: 'inline-flex',
            flexShrink: 0,
            alignItems: 'center',
            gap: '6px',
            padding: '6px 12px',
            background: 'rgba(180,40,30,0.08)',
            border: '1px solid rgba(180,40,30,0.18)',
            borderRadius: '20px',
            whiteSpace: 'nowrap',
          }}
        >
          <span style={{ fontSize: '12px' }}>{threatEmoji(alert.title, alert.category)}</span>
          <span style={{
            fontSize: '13px',
            color: '#d4c4b4',
            direction: 'rtl',
            maxWidth: '120px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}>
            {alert.cities}
          </span>
          {alert.time && (
            <span style={{ fontSize: '11px', color: '#5a4a44' }}>{alert.time}</span>
          )}
        </div>
      ))}
    </div>
  );
}

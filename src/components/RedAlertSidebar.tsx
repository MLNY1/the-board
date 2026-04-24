'use client';

/**
 * RedAlertSidebar — always shows last 20 alerts from Pikud HaOref history.
 *
 * When active  (any alert < 30 min): red pulse, header tint, brighter rows
 * When inactive (all alerts > 30 min): dim static dot, all 20 still render
 * When empty   (API returned zero):   "No recent alerts" message
 */

import { useEffect, useRef, useState } from 'react';

interface AlertItem {
  cities_he: string;
  cities_en: string;
  time:      string;
  date:      string;
  alertDate: string;
  title:     string;
  category:  string;
}

const PRIORITY_CITIES = ['Caesarea', 'Hadera', 'קיסריה', 'חדרה'];

function isPriority(alert: AlertItem): boolean {
  const combined = `${alert.cities_he} ${alert.cities_en}`;
  return PRIORITY_CITIES.some(c => combined.includes(c));
}

function formatLocalTime(alertDate: string): string {
  if (!alertDate) return '';
  try {
    const d    = new Date(alertDate);
    const date = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return `${date} · ${time}`;
  } catch { return ''; }
}

interface AlertData {
  active:       boolean;
  alerts:       AlertItem[];
  last_checked: string;
  source?:      string;
}

function isRecent(alertDate: string): boolean {
  if (!alertDate) return false;
  try {
    const ms = alertDate.includes('T')
      ? Date.parse(alertDate)
      : Date.parse(alertDate.replace(' ', 'T') + '+03:00');
    return !isNaN(ms) && Date.now() - ms < 5 * 60 * 1000;
  } catch { return false; }
}

function threatEmoji(title: string, category: string): string {
  const t = `${title}${category}`.toLowerCase();
  if (t.includes('aircraft') || t.includes('plane') || t === '2') return '✈';
  if (t.includes('earthquake'))                                      return '🌍';
  if (t.includes('infiltrat'))                                       return '⚠';
  return '🚀'; // default: rockets (most common)
}

function threatLabel(title: string, category: string): string {
  const t = `${title}${category}`.toLowerCase();
  if (t.includes('aircraft') || category === '2') return 'Aircraft';
  if (t.includes('earthquake'))                   return 'Earthquake';
  if (t.includes('infiltrat'))                    return 'Infiltration';
  if (t.includes('missile') || category === '1')  return 'Rockets';
  if (title && !title.match(/^\d+$/))             return title;
  return 'Rockets';
}

function formatLastChecked(iso: string): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  } catch { return ''; }
}

export default function RedAlertSidebar() {
  const [data, setData] = useState<AlertData>({ active: false, alerts: [], last_checked: '' });
  const mountedRef      = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    const testMode = typeof window !== 'undefined' && window.location.search.includes('test=true');
    const apiUrl   = testMode ? '/api/red-alert?test=true' : '/api/red-alert';

    const fetch_ = async () => {
      try {
        const res = await fetch(apiUrl);
        if (res.ok && mountedRef.current) setData(await res.json());
      } catch {}
    };

    fetch_();
    const iv = setInterval(fetch_, 30_000);
    return () => { mountedRef.current = false; clearInterval(iv); };
  }, []);

  const { active, alerts, last_checked } = data;
  const lastCheckedStr = formatLastChecked(last_checked);

  return (
    <div style={{
      borderLeft:     '1px solid #2a1a14',
      background:     'linear-gradient(180deg, rgba(120,30,20,0.06) 0%, var(--bg-primary) 100%)',
      display:        'flex',
      flexDirection:  'column',
      height:         '100%',
      overflow:       'hidden',
      fontFamily:     'var(--font-body)',
    }}>
      {/* ── Header ── */}
      <div style={{
        padding:       '12px 16px',
        borderBottom:  '1px solid #2a1a14',
        display:       'flex',
        alignItems:    'center',
        gap:           '8px',
        flexShrink:    0,
        minHeight:     '48px',
        background:    active ? 'rgba(180,40,30,0.10)' : 'transparent',
        transition:    'background 1s ease',
      }}>
        {/* Pulsing dot */}
        <span style={{
          display:      'inline-block',
          width:        '8px',
          height:       '8px',
          background:   active ? '#c0392b' : '#9a3a30',
          borderRadius: '50%',
          flexShrink:   0,
          animation:    active ? 'redPulseFast 1.4s ease-in-out infinite' : 'none',
          transition:   'background 1s ease',
        }} />
        <span style={{
          fontSize:      '12px',
          letterSpacing: '2px',
          textTransform: 'uppercase',
          color:         active ? '#c0392b' : '#9a3a30',
          fontWeight:    600,
          transition:    'color 1s ease',
        }}>
          Red Alerts
        </span>
        <span style={{ fontSize: '11px', color: '#5a4a44', marginLeft: 'auto' }}>
          Israel
        </span>
      </div>

      {/* ── Alert list ── */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        {alerts.length === 0 ? (
          /* Empty state — API returned zero history */
          <div style={{
            fontSize:   '13px',
            color:      '#5a4a44',
            textAlign:  'center',
            paddingTop: '40px',
            lineHeight: 1.9,
          }}>
            <div>No recent alerts</div>
            {lastCheckedStr && (
              <div style={{ fontSize: '11px', marginTop: '4px', color: '#3a3028' }}>
                Last checked: {lastCheckedStr}
              </div>
            )}
          </div>
        ) : (
          /* Always render all alerts — visual dimming when inactive */
          alerts.map((alert, i) => {
            const recent      = isRecent(alert.alertDate);
            const priority    = isPriority(alert);
            const threatColor = recent ? '#c0392b' : '#9a3a30';
            const bgColor     = priority
              ? 'rgba(180,40,30,0.12)'
              : recent ? 'rgba(180,40,30,0.06)' : 'transparent';
            const enColor     = recent || priority ? 'var(--text-primary)' : '#a89888';
            const hasEn       = alert.cities_en && alert.cities_en !== alert.cities_he;

            return (
              <div
                key={i}
                style={{
                  padding:      '10px 16px',
                  borderBottom: '1px solid #1e1812',
                  background:   bgColor,
                }}
              >
                {/* Threat type + time */}
                <div style={{
                  display:        'flex',
                  justifyContent: 'space-between',
                  alignItems:     'baseline',
                }}>
                  <span style={{ fontSize: '11px', color: threatColor, fontWeight: 600 }}>
                    {threatEmoji(alert.title, alert.category)}{' '}
                    {threatLabel(alert.title, alert.category)}
                  </span>
                  <span style={{ fontSize: '13px', color: '#a08070' }}>
                    {formatLocalTime(alert.alertDate)}
                  </span>
                </div>

                {/* English city name — primary */}
                {hasEn && (
                  <div style={{
                    fontSize:     '13px',
                    fontWeight:   priority ? 700 : 400,
                    color:        enColor,
                    marginTop:    '3px',
                    whiteSpace:   'nowrap',
                    overflow:     'hidden',
                    textOverflow: 'ellipsis',
                  }}>
                    {alert.cities_en}
                  </div>
                )}

                {/* Hebrew city name — secondary (or primary if no English) */}
                <div style={{
                  fontSize:     hasEn ? '11px' : '13px',
                  color:        hasEn ? '#5a4a44' : enColor,
                  marginTop:    hasEn ? '1px' : '3px',
                  direction:    'rtl',
                  textAlign:    'right',
                  whiteSpace:   'nowrap',
                  overflow:     'hidden',
                  textOverflow: 'ellipsis',
                }}>
                  {alert.cities_he}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* ── Footer ── */}
      <div style={{
        padding:      '6px 16px',
        borderTop:    '1px solid #2a1a14',
        fontSize:     '10px',
        color:        '#5a4a44',
        textAlign:    'center',
        flexShrink:   0,
      }}>
        Pikud HaOref · Updated every 30s
      </div>
    </div>
  );
}

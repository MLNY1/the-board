'use client';

/**
 * RedAlertBanner — Tzeva Adom / Pikud HaOref rocket alert display.
 *
 * Polls /api/red-alert every 30 seconds independently of the news digest.
 * Renders nothing (zero height) when no active alerts.
 * Animates in with a max-height transition when alerts are detected.
 *
 * The "NEW" badge uses a subtle pulse — not aggressive, since this may
 * be displayed during Shabbos when calm matters even during an emergency.
 *
 * City names are shown in Hebrew as returned by the Pikud HaOref API.
 * If more than 5 cities, shows first 5 + "and X more".
 */

import { useEffect, useRef, useState } from 'react';
import type { RedAlertResponse } from '@/types';

const POLL_INTERVAL_MS = 30_000;
const MAX_CITIES_SHOWN = 5;

export default function RedAlertBanner() {
  const [alertData, setAlertData]   = useState<RedAlertResponse | null>(null);
  const pollRef                     = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef                  = useRef(true);

  const fetchAlerts = async () => {
    try {
      const res = await fetch('/api/red-alert', { cache: 'no-store' });
      if (!res.ok) return;
      const data: RedAlertResponse = await res.json();
      if (mountedRef.current) setAlertData(data);
    } catch {
      // Fail silently — never show an error state
    }
  };

  useEffect(() => {
    mountedRef.current = true;
    fetchAlerts();
    pollRef.current = setInterval(fetchAlerts, POLL_INTERVAL_MS);
    return () => {
      mountedRef.current = false;
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const isActive = alertData?.active === true;
  const alert    = alertData?.alerts[0];
  const cities   = alert?.cities ?? [];

  const displayCities = cities.slice(0, MAX_CITIES_SHOWN);
  const extraCount    = cities.length - MAX_CITIES_SHOWN;

  return (
    /* max-height transition: collapses to 0 when inactive, expands when active */
    <div
      aria-live="assertive"
      aria-atomic="true"
      style={{
        maxHeight: isActive ? '80px' : '0px',
        overflow: 'hidden',
        transition: 'max-height 0.5s ease-in-out',
        flexShrink: 0,
      }}
    >
      {/* Inner content — always rendered so transition has something to show/hide */}
      <div
        className="alert-banner-pulse flex items-center justify-between"
        style={{
          height: '72px',
          backgroundColor: '#7a0000',
          borderBottom: '2px solid #a00000',
          paddingLeft: '2.5rem',
          paddingRight: '2.5rem',
          gap: '1.5rem',
        }}
      >
        {/* ── Left: Alert label ── */}
        <div className="flex items-center gap-3 shrink-0">
          <span style={{ fontSize: '1.25rem' }} role="img" aria-label="alert">🚨</span>
          <div className="flex flex-col">
            <span
              className="font-sans font-bold uppercase"
              style={{
                fontSize: '0.875rem',
                letterSpacing: '0.12em',
                color: '#ffffff',
                lineHeight: 1.2,
              }}
            >
              Tzeva Adom
            </span>
            <span
              className="font-sans"
              style={{ fontSize: '0.6875rem', color: 'rgba(255,255,255,0.65)', letterSpacing: '0.06em' }}
            >
              {alert?.threat === 'missiles' ? 'Rocket Alert' :
               alert?.threat === 'hostile_aircraft' ? 'Hostile Aircraft' :
               'Red Alert'}
            </span>
          </div>
        </div>

        {/* ── Center: City names ── */}
        <div
          className="flex-1 flex items-center justify-center flex-wrap"
          style={{ gap: '0 0.75rem', minWidth: 0 }}
        >
          {displayCities.length > 0 ? (
            <>
              {displayCities.map((city, i) => (
                <span key={city} className="font-sans flex items-center gap-2">
                  {i > 0 && (
                    <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.625rem' }}>•</span>
                  )}
                  <span
                    style={{
                      fontSize: 'clamp(0.9375rem, 1.2vw, 1.0625rem)',
                      color: '#ffffff',
                      fontWeight: 600,
                      direction: 'rtl',
                    }}
                  >
                    {city}
                  </span>
                </span>
              ))}
              {extraCount > 0 && (
                <span style={{ fontSize: '0.875rem', color: 'rgba(255,255,255,0.65)', fontWeight: 400 }}>
                  +{extraCount} more
                </span>
              )}
            </>
          ) : (
            <span
              className="font-sans"
              style={{ fontSize: '1rem', color: 'rgba(255,255,255,0.8)' }}
            >
              Multiple locations under alert
            </span>
          )}
        </div>

        {/* ── Right: Time ── */}
        <div className="shrink-0 flex flex-col items-end">
          {alert?.time && (
            <span
              className="font-mono tabular-nums"
              style={{ fontSize: '0.9375rem', color: 'rgba(255,255,255,0.75)', letterSpacing: '0.04em' }}
            >
              {alert.time}
            </span>
          )}
          <span
            className="font-sans"
            style={{ fontSize: '0.6875rem', color: 'rgba(255,255,255,0.45)', marginTop: '2px' }}
          >
            Pikud HaOref
          </span>
        </div>
      </div>
    </div>
  );
}

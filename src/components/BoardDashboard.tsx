'use client';

/**
 * BoardDashboard — orchestrates the left (news) column.
 *
 * Rotation state machine (self-scheduling timer chain):
 *   HERO(0) → [20s breaking / 12s major] → HERO(1) → ... → OVERVIEW(15s) → LOOP
 *
 * Transitions: 800ms opacity fade — set isVisible=false, wait FADE_OUT_MS,
 * swap content, wait FADE_IN_DELAY_MS, set isVisible=true, call scheduleNext.
 *
 * Offline detection: 3 consecutive poll failures → isStale=true → "Using cached data".
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import ShabbosHeader from './ShabbosHeader';
import HeroStory from './HeroStory';
import StoryCard from './StoryCard';
import OverviewPanel from './OverviewPanel';
import MarketTicker from './MarketTicker';
import type { DigestResponse, DigestStoryItem, MarketData, ShabbosWindowMeta } from '@/types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS    = 60_000;
const HERO_BREAKING_MS    = 20_000;
const HERO_MAJOR_MS       = 12_000;
const OVERVIEW_MS         = 15_000;
const FADE_OUT_MS         = 800;
const FADE_IN_DELAY_MS    = 100;
const INTERRUPT_THRESHOLD = 80;
const STALE_FAIL_COUNT    = 3;

type Phase = 'HERO' | 'OVERVIEW';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface BoardDashboardProps {
  initialData: DigestResponse | null;
}

export default function BoardDashboard({ initialData }: BoardDashboardProps) {
  // ── Render state ──────────────────────────────────────────────────────────
  const [data, setData]                    = useState<DigestResponse | null>(initialData);
  const [isStale, setIsStale]              = useState(false);
  const [countdownToShabbos, setCountdown] = useState<string | null>(null);

  const [phase, setPhase]           = useState<Phase>('HERO');
  const [heroIndex, setHeroIndex]   = useState(0);
  const [isVisible, setIsVisible]   = useState(true);
  const [newStoryId, setNewStoryId] = useState<string | null>(null);

  // ── Refs ──────────────────────────────────────────────────────────────────
  const mountedRef    = useRef(true);
  const storiesRef    = useRef<DigestStoryItem[]>(initialData?.stories ?? []);
  const seenIdsRef    = useRef<Set<string>>(new Set(initialData?.stories.map(s => s.id) ?? []));
  const zipRef        = useRef('');
  const marketRef     = useRef(false);
  const latRef        = useRef<number | null>(null);
  const lngRef        = useRef<number | null>(null);
  const tzidRef       = useRef<string>('');
  const cityLabelRef  = useRef<string>('');
  const failCountRef  = useRef(0);

  const rotationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fadeTimers    = useRef<ReturnType<typeof setTimeout>[]>([]);
  const pollTimer     = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Timer helpers ─────────────────────────────────────────────────────────

  function clearRotationTimer() {
    if (rotationTimer.current) clearTimeout(rotationTimer.current);
    rotationTimer.current = null;
  }

  function clearFadeTimers() {
    fadeTimers.current.forEach(clearTimeout);
    fadeTimers.current = [];
  }

  // ── Fade transition ───────────────────────────────────────────────────────

  function doFade(swapContent: () => void, onComplete?: () => void) {
    clearFadeTimers();
    setIsVisible(false);

    const t1 = setTimeout(() => {
      if (!mountedRef.current) return;
      swapContent();
      const t2 = setTimeout(() => {
        if (!mountedRef.current) return;
        setIsVisible(true);
        onComplete?.();
      }, FADE_IN_DELAY_MS);
      fadeTimers.current.push(t2);
    }, FADE_OUT_MS);

    fadeTimers.current.push(t1);
  }

  // ── Self-scheduling rotation loop ─────────────────────────────────────────

  const scheduleNext = useCallback((currentPhase: Phase, currentHeroIndex: number) => {
    clearRotationTimer();

    const stories = storiesRef.current;
    const heroes  = stories
      .filter(s => s.tier === 'breaking' || s.tier === 'major')
      .sort((a, b) => b.importance_score - a.importance_score);

    const displayMs = currentPhase === 'HERO'
      ? (heroes[currentHeroIndex]?.tier === 'breaking' ? HERO_BREAKING_MS : HERO_MAJOR_MS)
      : OVERVIEW_MS;

    rotationTimer.current = setTimeout(() => {
      if (!mountedRef.current) return;

      const latest       = storiesRef.current;
      const latestHeroes = latest
        .filter(s => s.tier === 'breaking' || s.tier === 'major')
        .sort((a, b) => b.importance_score - a.importance_score);

      let nextPhase: Phase;
      let nextIdx: number;

      if (currentPhase === 'HERO') {
        const next        = currentHeroIndex + 1;
        const hasOverview = latest.some(s => s.tier === 'notable' || s.tier === 'background');

        if (next < latestHeroes.length) {
          nextPhase = 'HERO'; nextIdx = next;
        } else if (hasOverview) {
          nextPhase = 'OVERVIEW'; nextIdx = 0;
        } else {
          nextPhase = 'HERO'; nextIdx = 0;
        }
      } else {
        nextPhase = 'HERO'; nextIdx = 0;
      }

      doFade(
        () => { setPhase(nextPhase); setHeroIndex(nextIdx); setNewStoryId(null); },
        () => scheduleNext(nextPhase, nextIdx)
      );
    }, displayMs);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Data polling ──────────────────────────────────────────────────────────

  const fetchDigest = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (latRef.current !== null && lngRef.current !== null) {
        params.set('lat',  String(latRef.current));
        params.set('lng',  String(lngRef.current));
        if (tzidRef.current)  params.set('tzid', tzidRef.current);
        if (cityLabelRef.current) params.set('city', cityLabelRef.current);
      } else if (zipRef.current) {
        params.set('zip', zipRef.current);
      }
      if (marketRef.current) params.set('market', 'true');

      const res = await fetch(`/api/digest?${params}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const fresh: DigestResponse = await res.json();
      if (!mountedRef.current) return;

      // Reset offline counter
      failCountRef.current = 0;
      setIsStale(false);

      storiesRef.current = fresh.stories;
      setData(fresh);

      // Interrupt rotation for new high-importance story
      const newHero = fresh.stories.find(
        s => !seenIdsRef.current.has(s.id) && s.importance_score >= INTERRUPT_THRESHOLD
      );
      fresh.stories.forEach(s => seenIdsRef.current.add(s.id));

      if (newHero) {
        const heroes = fresh.stories
          .filter(s => s.tier === 'breaking' || s.tier === 'major')
          .sort((a, b) => b.importance_score - a.importance_score);
        const idx = Math.max(0, heroes.findIndex(s => s.id === newHero.id));

        clearRotationTimer();
        doFade(
          () => { setPhase('HERO'); setHeroIndex(idx); setNewStoryId(newHero.id); },
          () => scheduleNext('HERO', idx)
        );
      }

      // Shabbos countdown
      const { shabbos } = fresh.meta;
      if (shabbos.window_start && !shabbos.is_active) {
        const diffMs = new Date(shabbos.window_start).getTime() - Date.now();
        if (diffMs > 0) {
          const totalMin = Math.floor(diffMs / 60000);
          const hrs  = Math.floor(totalMin / 60);
          const mins = totalMin % 60;
          setCountdown(hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`);
        }
      } else {
        setCountdown(null);
      }
    } catch {
      if (!mountedRef.current) return;
      failCountRef.current++;
      if (failCountRef.current >= STALE_FAIL_COUNT) setIsStale(true);
    }
  }, [scheduleNext]);

  // ── Mount / unmount ───────────────────────────────────────────────────────

  useEffect(() => {
    mountedRef.current = true;
    const sp           = new URLSearchParams(window.location.search);
    zipRef.current     = sp.get('zip')    ?? '';
    marketRef.current  = sp.get('market') === 'true';

    // Geolocation: check localStorage first, then request from browser
    const storedLat   = localStorage.getItem('theboard_lat');
    const storedLng   = localStorage.getItem('theboard_lng');
    const storedTzid  = localStorage.getItem('theboard_tzid');
    const storedCity  = localStorage.getItem('theboard_city');
    if (storedLat && storedLng) {
      latRef.current       = parseFloat(storedLat);
      lngRef.current       = parseFloat(storedLng);
      tzidRef.current      = storedTzid ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
      cityLabelRef.current = storedCity ?? '';
    } else if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          if (!mountedRef.current) return;
          const lat  = pos.coords.latitude;
          const lng  = pos.coords.longitude;
          const tzid = Intl.DateTimeFormat().resolvedOptions().timeZone;
          latRef.current  = lat;
          lngRef.current  = lng;
          tzidRef.current = tzid;
          localStorage.setItem('theboard_lat',  String(lat));
          localStorage.setItem('theboard_lng',  String(lng));
          localStorage.setItem('theboard_tzid', tzid);

          // Reverse geocode to get a human-readable city name
          try {
            const geoRes = await fetch(
              `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`,
              { headers: { 'User-Agent': 'TheBoard/1.0 (news dashboard)' } }
            );
            if (geoRes.ok) {
              const geoData = await geoRes.json();
              const addr    = geoData.address ?? {};
              const city    = addr.city ?? addr.town ?? addr.village ?? addr.hamlet ?? '';
              const state   = addr.state_code ?? addr.state ?? '';
              const label   = city ? (state ? `${city}, ${state}` : city) : '';
              cityLabelRef.current = label;
              if (label) localStorage.setItem('theboard_city', label);
            }
          } catch { /* reverse geocode failed — city label will be empty */ }

          if (mountedRef.current) fetchDigest();
        },
        () => { /* denied or unavailable — silently use default zip */ },
        { timeout: 5000 }
      );
    }

    scheduleNext('HERO', 0);
    pollTimer.current = setInterval(fetchDigest, POLL_INTERVAL_MS);

    return () => {
      mountedRef.current = false;
      clearRotationTimer();
      clearFadeTimers();
      if (pollTimer.current) clearInterval(pollTimer.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Derived values ────────────────────────────────────────────────────────

  const stories = data?.stories ?? [];
  const heroes  = stories
    .filter(s => s.tier === 'breaking' || s.tier === 'major')
    .sort((a, b) => b.importance_score - a.importance_score);

  const displayHeroes = heroes.length > 0
    ? heroes
    : stories.filter(s => s.tier === 'notable').slice(0, 3);

  const currentHero     = displayHeroes[heroIndex] ?? displayHeroes[0] ?? null;
  const supportingCards = displayHeroes
    .filter(s => s.id !== currentHero?.id)
    .slice(0, 8);

  // Notable list: stories not shown in hero or supporting cards
  const shownIds    = new Set([currentHero?.id, ...supportingCards.map(s => s.id)].filter(Boolean));
  const notableList = stories
    .filter(s => !shownIds.has(s.id) && (s.tier === 'notable' || s.tier === 'background'))
    .slice(0, 20);

  const isShabbosMode: boolean = data?.meta.shabbos.is_active ?? false;
  const marketData: MarketData = data?.meta.market ?? { enabled: false, prices: [], last_updated: '' };
  const claudeUnavailable: boolean = data?.meta.claude_unavailable ?? false;
  const shabbosWindowMeta: ShabbosWindowMeta = data?.meta.shabbos ?? {
    is_active: false, window_start: null, window_end: null, parsha: null, location_label: null,
  };

  const lastUpdated = data?.meta.last_updated
    ? new Date(data.meta.last_updated).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    : null;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      className={`board-root${isShabbosMode ? ' shabbos-mode' : ''}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        background: 'var(--bg-primary)',
      }}
    >
      <ShabbosHeader
        shabbos={shabbosWindowMeta}
        countdownToShabbos={countdownToShabbos}
        isShabbosMode={isShabbosMode}
      />

      {/* Claude credit exhaustion warning */}
      {claudeUnavailable && (
        <div style={{
          flexShrink:   0,
          background:   'rgba(224,82,82,0.12)',
          borderBottom: '1px solid rgba(224,82,82,0.25)',
          color:        '#e05252',
          fontFamily:   'var(--font-body)',
          fontSize:     '11px',
          letterSpacing:'0.8px',
          textTransform:'uppercase',
          padding:      '5px 16px',
          textAlign:    'center',
        }}>
          AI credit balance exhausted — feed updates paused
        </div>
      )}

      {/* Market ticker — hidden during Shabbos/Yom Tov, shown on weekdays */}
      {marketData.enabled && !isShabbosMode && <MarketTicker prices={marketData.prices} lastUpdated={marketData.last_updated} />}

      {/* Content area — fades on transitions */}
      <div
        className="story-fade"
        style={{
          flex: 1,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          opacity: isVisible ? 1 : 0,
        }}
      >
        {stories.length === 0 ? (

          /* Empty state */
          <div style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
          }}>
            <p style={{ fontFamily: 'var(--font-headline)', fontSize: '24px', color: 'var(--text-secondary)' }}>
              Gathering stories…
            </p>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: '16px', color: 'var(--text-dim)' }}>
              First update arrives within 20 minutes.
            </p>
          </div>

        ) : phase === 'OVERVIEW' ? (

          /* OVERVIEW phase */
          <OverviewPanel stories={stories} isShabbosMode={isShabbosMode} />

        ) : (

          /* HERO phase */
          <>
            {/* Hero story */}
            <div style={{ flexShrink: 0 }}>
              {currentHero ? (
                <HeroStory
                  story={currentHero}
                  isNew={currentHero.id === newStoryId}
                  isShabbosMode={isShabbosMode}
                />
              ) : (
                <div style={{
                  padding: '40px 28px',
                  fontFamily: 'var(--font-headline)',
                  fontSize: '22px',
                  color: 'var(--text-dim)',
                }}>
                  Loading stories…
                </div>
              )}
            </div>

            {/* Supporting cards — desktop 4×2 grid, mobile 1-col (first 2 via CSS) */}
            {supportingCards.length > 0 && (
              <div className="cards-grid cards-outer-pad" style={{ flexShrink: 0 }}>
                {supportingCards.map(story => (
                  <StoryCard key={story.id} story={story} isShabbosMode={isShabbosMode} />
                ))}
              </div>
            )}

            {/* Notable list — 2-col desktop, 1-col mobile */}
            {notableList.length > 0 && (() => {
              const mid           = Math.ceil(notableList.length / 2);
              const leftNotables  = notableList.slice(0, mid);
              const rightNotables = notableList.slice(mid);
              return (
                <div className="notable-container">
                  {[leftNotables, rightNotables].map((col, ci) => (
                    <div key={ci} className="notable-col">
                      {col.map(story => (
                        <div key={story.id} className="notable-row">
                          <span style={{ color: 'var(--accent-amber)', fontSize: '5px', flexShrink: 0 }}>●</span>
                          <span
                            className="notable-text"
                            style={{
                              fontFamily: 'var(--font-body)',
                              color: 'var(--text-body)',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}
                          >
                            {story.headline}
                          </span>
                          <span style={{ fontFamily: 'var(--font-body)', color: 'var(--text-dim)', fontSize: '11px', flexShrink: 0, marginLeft: '6px' }}>
                            {(() => { const m = Math.floor((Date.now() - new Date(story.published_at).getTime()) / 60000); return m < 60 ? `${m}m` : `${Math.floor(m/60)}h`; })()}
                          </span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              );
            })()}
          </>
        )}
      </div>

      {/* Footer */}
      <div
        className="board-footer"
        style={{
          flexShrink: 0,
          borderTop: '1px solid var(--border-subtle)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '8px',
          fontFamily: 'var(--font-body)',
          color: 'var(--text-dim)',
        }}
      >
        <span>{stories.length} stor{stories.length !== 1 ? 'ies' : 'y'}</span>

        {lastUpdated && (
          <>
            <span style={{ color: 'var(--border-card)' }}>·</span>
            <span>Updated {lastUpdated}</span>
          </>
        )}

        <span style={{ color: 'var(--border-card)' }}>·</span>

        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
          <span style={{
            display: 'inline-block',
            width: '6px',
            height: '6px',
            background: isStale ? '#5a5448' : 'var(--accent-green)',
            borderRadius: '50%',
            animation: isStale ? 'none' : 'greenPulse 3s ease-in-out infinite',
          }} />
          <span style={{ color: isStale ? 'var(--text-dim)' : 'var(--accent-green)' }}>
            {isStale ? 'Using cached data' : 'Live'}
          </span>
        </span>

        <span style={{ color: 'var(--border-card)' }}>·</span>
        <span>Next refresh {data?.meta.next_refresh_seconds ?? 60}s</span>
      </div>
    </div>
  );
}

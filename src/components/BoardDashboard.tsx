'use client';

/**
 * BoardDashboard — orchestrating client component for TheBoard.
 *
 * Rotation state machine (self-scheduling timer loop):
 *   HERO(0) → [20s breaking / 12s major] → HERO(1) → ... → HERO(n) → OVERVIEW(15s) → LOOP
 *
 * Bug that was here before: scheduleNextTransition was called from a useEffect
 * whose deps included heroIndex. Fades update heroIndex mid-transition, which
 * re-triggered the effect, which called clearAllTimers() — killing the pending
 * fade-in timer. isVisible got stuck at false → blank screen forever.
 *
 * Fix: the rotation loop is a purely imperative self-scheduling timer chain.
 * It holds a ref to the latest stories (storiesRef) so it doesn't need to be
 * recreated on every poll. isVisible is separate state, never in effect deps.
 * No useEffect re-runs the scheduler — only the mount effect starts it once.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import ShabbosHeader from './ShabbosHeader';
import HeroStory from './HeroStory';
import StoryCard from './StoryCard';
import OverviewPanel from './OverviewPanel';
import type { DigestResponse, DigestStoryItem, ShabbosWindowMeta } from '@/types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS    = 60_000;
const HERO_BREAKING_MS    = 20_000;
const HERO_MAJOR_MS       = 12_000;
const OVERVIEW_MS         = 15_000;
const FADE_OUT_MS         = 600;   // opacity → 0
const FADE_IN_DELAY_MS    = 80;    // brief pause after content swap before opacity → 1

const INTERRUPT_THRESHOLD = 80;

type Phase = 'HERO' | 'OVERVIEW';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface BoardDashboardProps {
  initialData: DigestResponse | null;
}

export default function BoardDashboard({ initialData }: BoardDashboardProps) {
  // ── Render state ───────────────────────────────────────────────────────────
  const [data, setData]                   = useState<DigestResponse | null>(initialData);
  const [isOffline, setIsOffline]         = useState(false);
  const [countdownToShabbos, setCountdown] = useState<string | null>(null);

  // Rotation display state — what's currently visible
  const [phase, setPhase]         = useState<Phase>('HERO');
  const [heroIndex, setHeroIndex] = useState(0);
  const [isVisible, setIsVisible] = useState(true);
  const [newStoryId, setNewStoryId] = useState<string | null>(null);

  // ── Refs (never trigger re-renders) ───────────────────────────────────────
  const mountedRef       = useRef(true);
  const storiesRef       = useRef<DigestStoryItem[]>(initialData?.stories ?? []);
  const seenIdsRef       = useRef<Set<string>>(new Set(initialData?.stories.map(s => s.id) ?? []));
  const zipRef           = useRef('');

  // Single rotation timer — the self-scheduling loop handle
  const rotationTimer    = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Short-lived fade timers — independent of rotation, never cleared by rotation
  const fadeTimers       = useRef<ReturnType<typeof setTimeout>[]>([]);

  const pollTimer        = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Timer helpers ──────────────────────────────────────────────────────────

  function clearRotationTimer() {
    if (rotationTimer.current) clearTimeout(rotationTimer.current);
    rotationTimer.current = null;
  }

  function clearFadeTimers() {
    fadeTimers.current.forEach(clearTimeout);
    fadeTimers.current = [];
  }

  // ── Fade transition helper ─────────────────────────────────────────────────
  /**
   * Fades out, swaps content, fades in — then calls onComplete.
   * Uses its own dedicated fadeTimers ref so rotation timers don't kill it.
   */
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
  /**
   * Schedules the NEXT transition from the current display state.
   * After the delay, fades to the next state, then calls itself again.
   * This is entirely imperative — no useEffect deps, no stale closures on stories
   * because it always reads storiesRef.current at call time.
   */
  const scheduleNext = useCallback((currentPhase: Phase, currentHeroIndex: number) => {
    clearRotationTimer();

    const stories = storiesRef.current;
    const heroes = stories.filter(s => s.tier === 'breaking' || s.tier === 'major')
                          .sort((a, b) => b.importance_score - a.importance_score);

    let displayMs: number;
    if (currentPhase === 'HERO') {
      const hero = heroes[currentHeroIndex];
      displayMs = hero?.tier === 'breaking' ? HERO_BREAKING_MS : HERO_MAJOR_MS;
    } else {
      displayMs = OVERVIEW_MS;
    }

    rotationTimer.current = setTimeout(() => {
      if (!mountedRef.current) return;

      // Recompute stories at transition time (may have been updated by poll)
      const latestStories = storiesRef.current;
      const latestHeroes = latestStories
        .filter(s => s.tier === 'breaking' || s.tier === 'major')
        .sort((a, b) => b.importance_score - a.importance_score);

      let nextPhase: Phase;
      let nextHeroIndex: number;

      if (currentPhase === 'HERO') {
        const nextIdx = currentHeroIndex + 1;
        const hasOverview = latestStories.some(s => s.tier === 'notable' || s.tier === 'background');

        if (nextIdx < latestHeroes.length) {
          nextPhase = 'HERO';
          nextHeroIndex = nextIdx;
        } else if (hasOverview) {
          nextPhase = 'OVERVIEW';
          nextHeroIndex = 0;
        } else {
          nextPhase = 'HERO';
          nextHeroIndex = 0;
        }
      } else {
        // OVERVIEW → back to first hero
        nextPhase = 'HERO';
        nextHeroIndex = 0;
      }

      doFade(
        () => {
          setPhase(nextPhase);
          setHeroIndex(nextHeroIndex);
          setNewStoryId(null);
        },
        () => scheduleNext(nextPhase, nextHeroIndex)
      );
    }, displayMs);
  }, []); // stable — reads refs at call time, never re-created

  // ── Data polling ───────────────────────────────────────────────────────────

  const fetchDigest = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (zipRef.current) params.set('zip', zipRef.current);

      const res = await fetch(`/api/digest?${params}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const fresh: DigestResponse = await res.json();
      if (!mountedRef.current) return;

      setIsOffline(false);
      storiesRef.current = fresh.stories;
      setData(fresh);

      // Detect a new high-importance story that hasn't been seen yet
      const newHero = fresh.stories.find(
        s => !seenIdsRef.current.has(s.id) && s.importance_score >= INTERRUPT_THRESHOLD
      );
      fresh.stories.forEach(s => seenIdsRef.current.add(s.id));

      if (newHero) {
        // Interrupt rotation — jump to this story immediately
        const heroes = fresh.stories
          .filter(s => s.tier === 'breaking' || s.tier === 'major')
          .sort((a, b) => b.importance_score - a.importance_score);
        const idx = Math.max(0, heroes.findIndex(s => s.id === newHero.id));

        clearRotationTimer();
        doFade(
          () => {
            setPhase('HERO');
            setHeroIndex(idx);
            setNewStoryId(newHero.id);
          },
          () => scheduleNext('HERO', idx)
        );
      }

      // Update Shabbos countdown
      const { shabbos } = fresh.meta;
      if (shabbos.window_start && !shabbos.is_active) {
        const diffMs = new Date(shabbos.window_start).getTime() - Date.now();
        if (diffMs > 0) {
          const totalMin = Math.floor(diffMs / 60000);
          const hrs = Math.floor(totalMin / 60);
          const mins = totalMin % 60;
          setCountdown(hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`);
        }
      } else {
        setCountdown(null);
      }
    } catch {
      if (mountedRef.current) setIsOffline(true);
    }
  }, [scheduleNext]);

  // ── Mount / unmount ────────────────────────────────────────────────────────

  useEffect(() => {
    mountedRef.current = true;

    // Read ZIP from URL
    zipRef.current = new URLSearchParams(window.location.search).get('zip') ?? '';

    // Start the rotation loop
    scheduleNext('HERO', 0);

    // Start polling
    pollTimer.current = setInterval(fetchDigest, POLL_INTERVAL_MS);

    return () => {
      mountedRef.current = false;
      clearRotationTimer();
      clearFadeTimers();
      if (pollTimer.current) clearInterval(pollTimer.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Derived render values ──────────────────────────────────────────────────

  const stories    = data?.stories ?? [];
  const heroes     = stories
    .filter(s => s.tier === 'breaking' || s.tier === 'major')
    .sort((a, b) => b.importance_score - a.importance_score);

  // Fallback: if no breaking/major stories, promote top notable as hero
  const displayHeroes = heroes.length > 0
    ? heroes
    : stories.filter(s => s.tier === 'notable').slice(0, 3);

  const currentHero = displayHeroes[heroIndex] ?? displayHeroes[0] ?? null;

  // Supporting cards: other heroes (excluding currentHero), or top notables
  const supportingCards = displayHeroes.length > 1
    ? displayHeroes.filter(s => s.id !== currentHero?.id).slice(0, 2)
    : stories.filter(s => s.tier === 'notable').slice(0, 2);

  const isShabbosMode = data?.meta.shabbos.is_active ?? false;
  const shabbosWindowMeta: ShabbosWindowMeta = data?.meta.shabbos ?? {
    is_active: false,
    window_start: null,
    window_end: null,
    parsha: null,
  };

  const bgPrimary    = isShabbosMode ? 'bg-[#0d0a07]' : 'bg-[#0a0a0f]';
  const borderSubtle = isShabbosMode ? 'border-[#2a2015]' : 'border-[#1e1e24]';
  const textMuted    = isShabbosMode ? 'text-[#8a8070]' : 'text-[#8a8680]';

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className={`flex flex-col h-screen ${bgPrimary} overflow-hidden`}>
      {/* Header */}
      <ShabbosHeader
        shabbos={shabbosWindowMeta}
        countdownToShabbos={countdownToShabbos}
        isShabbosMode={isShabbosMode}
      />

      {/* Main content — opacity controlled by isVisible for smooth fades */}
      <main
        className="flex-1 flex flex-col min-h-0"
        style={{
          opacity: isVisible ? 1 : 0,
          transition: `opacity ${FADE_OUT_MS}ms ease-in-out`,
        }}
      >
        {stories.length === 0 ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <p className={`text-2xl font-serif ${textMuted}`}>Gathering stories…</p>
              <p className={`text-base mt-2 ${textMuted}`}>
                First update arrives within 20 minutes.
              </p>
            </div>
          </div>

        ) : phase === 'OVERVIEW' ? (
          <OverviewPanel stories={stories} isShabbosMode={isShabbosMode} />

        ) : (
          /* HERO phase */
          <div className="flex-1 flex flex-col gap-4 p-6 min-h-0">
            {currentHero ? (
              <HeroStory
                story={currentHero}
                isNew={currentHero.id === newStoryId}
                isShabbosMode={isShabbosMode}
              />
            ) : (
              /* Shouldn't happen with displayHeroes fallback, but be safe */
              <div className="flex-1 flex items-center justify-center">
                <p className={`text-xl font-serif ${textMuted}`}>Loading stories…</p>
              </div>
            )}

            {supportingCards.length > 0 && (
              <div className="grid grid-cols-2 gap-4 h-52 shrink-0">
                {supportingCards.slice(0, 2).map(story => (
                  <StoryCard key={story.id} story={story} isShabbosMode={isShabbosMode} />
                ))}
                {/* Fill second slot if only one card */}
                {supportingCards.length === 1 && <div className={`rounded-lg border ${borderSubtle}`} />}
              </div>
            )}
          </div>
        )}
      </main>

      {/* Footer status bar */}
      <footer className={`flex items-center justify-between px-8 py-2 border-t text-sm ${borderSubtle} ${textMuted}`}>
        <span>
          {stories.length} stor{stories.length !== 1 ? 'ies' : 'y'} ·{' '}
          Updated{' '}
          {data?.meta.last_updated
            ? new Date(data.meta.last_updated).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
            : '—'}
        </span>

        <span className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full inline-block ${isOffline ? 'bg-amber-500' : 'bg-green-600'}`} />
          <span>{isOffline ? 'Offline — showing last update' : 'Live'}</span>
        </span>

        <span>Next refresh in {data?.meta.next_refresh_seconds ?? 60}s</span>
      </footer>
    </div>
  );
}

'use client';

/**
 * Overview panel — shown during the OVERVIEW rotation phase.
 * Left column: top breaking/major stories as a recap.
 * Right column: compact bullet list of all notable/background stories.
 *
 * Uses slide-up animation (CSS class) when first rendered.
 */

import type { DigestStoryItem } from '@/types';

interface OverviewPanelProps {
  stories: DigestStoryItem[];
  isShabbosMode: boolean;
}

function formatAge(iso: string): string {
  const diffMin = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (diffMin < 1)  return 'now';
  if (diffMin < 60) return `${diffMin}m`;
  return `${Math.floor(diffMin / 60)}h`;
}

export default function OverviewPanel({ stories }: OverviewPanelProps) {
  const topStories     = stories.filter(s => s.tier === 'breaking' || s.tier === 'major').slice(0, 3);
  const notableStories = stories.filter(s => s.tier === 'notable' || s.tier === 'background').slice(0, 12);

  return (
    <div
      className="animate-slide-up flex flex-col h-full"
      style={{ padding: 'clamp(1.5rem, 3vh, 2.5rem) clamp(2rem, 4vw, 3.5rem)' }}
    >
      {/* ── Section header ── */}
      <div
        className="flex items-center gap-4 mb-6 pb-4"
        style={{ borderBottom: '1px solid var(--border-subtle)' }}
      >
        <span
          className="font-sans font-bold uppercase tracking-widest"
          style={{ fontSize: '0.6875rem', letterSpacing: '0.16em', color: 'var(--text-dim)' }}
        >
          All Stories
        </span>
        <div style={{ flex: 1, height: '1px', backgroundColor: 'var(--border-subtle)' }} />
        <span
          className="font-sans"
          style={{ fontSize: '0.8125rem', color: 'var(--text-dim)' }}
        >
          {stories.length} update{stories.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* ── Two-column body ── */}
      <div className="flex gap-8 flex-1 min-h-0">

        {/* Left: top stories recap */}
        {topStories.length > 0 && (
          <div
            className="shrink-0 flex flex-col gap-6"
            style={{
              width: 'clamp(240px, 22vw, 320px)',
              paddingRight: 'clamp(1.5rem, 2.5vw, 2.5rem)',
              borderRight: '1px solid var(--border-subtle)',
            }}
          >
            <p
              className="font-sans font-bold uppercase tracking-widest"
              style={{ fontSize: '0.625rem', letterSpacing: '0.14em', color: 'var(--text-dim)' }}
            >
              Top Stories
            </p>

            {topStories.map(story => {
              const isBreaking = story.tier === 'breaking';
              const accentVar  = isBreaking ? 'var(--accent-breaking)' : 'var(--accent-major)';
              return (
                <div key={story.id} className="flex flex-col gap-1.5">
                  <span
                    className="font-sans font-bold uppercase"
                    style={{ fontSize: '0.625rem', letterSpacing: '0.14em', color: accentVar }}
                  >
                    {story.tier}
                  </span>
                  <p
                    className="font-serif font-bold leading-snug"
                    style={{
                      fontSize: 'clamp(1rem, 1.2vw, 1.125rem)',
                      color: 'var(--text-primary)',
                    }}
                  >
                    {story.headline}
                  </p>
                  <p
                    className="font-sans line-clamp-2"
                    style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}
                  >
                    {story.summary}
                  </p>
                </div>
              );
            })}
          </div>
        )}

        {/* Right: notable bullet list */}
        <div className="flex-1 flex flex-col min-h-0">
          <p
            className="font-sans font-bold uppercase tracking-widest mb-3"
            style={{ fontSize: '0.625rem', letterSpacing: '0.14em', color: 'var(--text-dim)' }}
          >
            Notable
          </p>

          {notableStories.length === 0 ? (
            <p className="font-sans" style={{ fontSize: '1.125rem', color: 'var(--text-dim)' }}>
              No additional stories at this time.
            </p>
          ) : (
            <ul className="flex flex-col flex-1 min-h-0">
              {notableStories.map((story, idx) => (
                <li
                  key={story.id}
                  className="flex items-baseline gap-3 py-2.5"
                  style={{
                    borderBottom: idx < notableStories.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                    /* Subtle alternating background for readability */
                    backgroundColor: idx % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)',
                  }}
                >
                  {/* Dot */}
                  <span style={{ color: 'var(--accent-breaking)', fontSize: '0.5rem', flexShrink: 0, marginTop: '2px' }}>
                    ●
                  </span>

                  {/* Headline */}
                  <span
                    className="font-sans line-clamp-1 flex-1"
                    style={{
                      fontSize: 'clamp(1rem, 1.3vw, 1.25rem)',
                      color: 'var(--text-primary)',
                      lineHeight: 1.35,
                    }}
                  >
                    {story.headline}
                  </span>

                  {/* Source + age */}
                  <span
                    className="font-sans shrink-0 flex items-center gap-2"
                    style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}
                  >
                    {story.sources[0] && (
                      <span style={{ color: 'var(--text-dim)' }}>{story.sources[0]}</span>
                    )}
                    <span style={{ color: 'var(--text-dim)', fontSize: '0.6875rem' }}>
                      {formatAge(story.published_at)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

'use client';

/**
 * Full-screen hero story — the centerpiece of TheBoard.
 * Breaking: amber gradient left-border, large Newsreader headline.
 * Major:    blue-grey gradient left-border, slightly smaller headline.
 * Font sizes use clamp() for graceful 1080p→4K scaling.
 */

import type { DigestStoryItem } from '@/types';

interface HeroStoryProps {
  story: DigestStoryItem;
  isNew?: boolean;
  isShabbosMode: boolean;
}

function formatRelativeTime(iso: string): string {
  const diffMin = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (diffMin < 1)  return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const h = Math.floor(diffMin / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function HeroStory({ story, isNew = false, isShabbosMode }: HeroStoryProps) {
  const isBreaking = story.tier === 'breaking';
  const accentVar   = isBreaking ? 'var(--accent-breaking)'     : 'var(--accent-major)';
  const glowVar     = isBreaking ? 'var(--accent-breaking-glow)' : 'var(--accent-major-glow)';

  return (
    <div
      className={`hero-card ${isBreaking ? 'hero-card-breaking' : 'hero-card-major'} flex flex-col justify-center flex-1 min-h-0 rounded-lg`}
      style={{
        backgroundColor: 'var(--bg-card)',
        border: '1px solid var(--border-card)',
        /* Subtle glow from the accent color in the bottom-left corner */
        background: `radial-gradient(ellipse 60% 50% at 0% 100%, ${glowVar} 0%, var(--bg-card) 60%)`,
        paddingTop:    'clamp(1.5rem, 3vh, 2.5rem)',
        paddingBottom: 'clamp(1.5rem, 3vh, 2.5rem)',
        paddingRight:  'clamp(2rem, 4vw, 4rem)',
      }}
    >
      {/* ── Tier badge + NEW badge ── */}
      <div className="flex items-center gap-3 mb-5">
        <span
          className="font-sans font-bold uppercase tracking-widest"
          style={{
            fontSize: '0.6875rem',
            letterSpacing: '0.15em',
            color: 'var(--bg-primary)',
            backgroundColor: accentVar,
            padding: '4px 10px',
            borderRadius: '3px',
          }}
        >
          {isBreaking ? 'Breaking' : 'Major'}
        </span>

        {isNew && (
          <span
            className="new-badge font-sans font-bold uppercase"
            style={{
              fontSize: '0.6875rem',
              letterSpacing: '0.15em',
              color: 'var(--accent-breaking)',
              backgroundColor: 'var(--accent-breaking-glow)',
              border: '1px solid var(--accent-breaking)',
              padding: '3px 10px',
              borderRadius: '3px',
            }}
          >
            New
          </span>
        )}
      </div>

      {/* ── Headline ── */}
      <h1
        className="font-serif font-bold leading-tight mb-5"
        style={{
          fontSize: isBreaking
            ? 'clamp(2.5rem, 3.75vw, 3.5rem)'   /* 40px → 56px */
            : 'clamp(2rem,   3vw,   2.75rem)',    /* 32px → 44px */
          color: 'var(--text-primary)',
          lineHeight: 1.1,
          maxWidth: '90%',
          fontStyle: 'normal',
        }}
      >
        {story.headline}
      </h1>

      {/* ── Summary ── */}
      <p
        className="font-sans leading-relaxed mb-7"
        style={{
          fontSize: 'clamp(1.125rem, 1.5vw, 1.375rem)', /* 18px → 22px */
          color: 'var(--text-secondary)',
          maxWidth: 'min(820px, 85%)',
          lineHeight: 1.55,
        }}
      >
        {story.summary}
      </p>

      {/* ── Sources + time ── */}
      <div className="flex items-center gap-3 font-sans flex-wrap">
        {story.sources.slice(0, 3).map((src, i) => (
          <span key={src} className="flex items-center gap-3">
            {i > 0 && (
              <span style={{ color: 'var(--text-dim)', fontSize: '0.75rem' }}>·</span>
            )}
            <span style={{ fontSize: '0.9375rem', color: accentVar, fontWeight: 500 }}>
              {src}
            </span>
          </span>
        ))}
        {story.sources.length > 0 && (
          <span style={{ color: 'var(--text-dim)', fontSize: '0.75rem' }}>•</span>
        )}
        <span style={{ fontSize: '0.9375rem', color: 'var(--text-secondary)' }}>
          {formatRelativeTime(story.published_at)}
        </span>
      </div>
    </div>
  );
}

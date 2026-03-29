'use client';

/**
 * Compact secondary story card — shown in the two-up grid below the hero.
 * Designed to be readable from across a room at ~28-32px headline.
 */

import type { DigestStoryItem } from '@/types';

interface StoryCardProps {
  story: DigestStoryItem;
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

export default function StoryCard({ story }: StoryCardProps) {
  const isBreaking = story.tier === 'breaking';
  const isMajor    = story.tier === 'major';
  const hasAccent  = isBreaking || isMajor;

  const accentVar = isBreaking
    ? 'var(--accent-breaking)'
    : isMajor
    ? 'var(--accent-major)'
    : 'var(--accent-notable)';

  const badgeBg = isBreaking
    ? 'var(--accent-breaking-glow)'
    : isMajor
    ? 'var(--accent-major-glow)'
    : 'rgba(82,82,90,0.15)';

  return (
    <div
      className="flex flex-col justify-between h-full rounded-lg overflow-hidden"
      style={{
        backgroundColor: 'var(--bg-card)',
        border: '1px solid var(--border-card)',
        padding: 'clamp(1rem, 1.5vw, 1.5rem)',
      }}
    >
      {/* ── Tier badge ── */}
      <div className="mb-3">
        <span
          className="font-sans font-bold uppercase"
          style={{
            fontSize: '0.625rem',
            letterSpacing: '0.14em',
            color: hasAccent ? accentVar : 'var(--text-dim)',
            backgroundColor: badgeBg,
            padding: '3px 8px',
            borderRadius: '2px',
          }}
        >
          {story.tier}
        </span>
      </div>

      {/* ── Headline ── */}
      <h2
        className="font-serif font-bold line-clamp-3 flex-1"
        style={{
          fontSize: 'clamp(1.25rem, 1.75vw, 1.75rem)', /* 20px → 28px */
          color: 'var(--text-primary)',
          lineHeight: 1.25,
          marginBottom: '0.625rem',
        }}
      >
        {story.headline}
      </h2>

      {/* ── Summary ── */}
      <p
        className="font-sans line-clamp-2"
        style={{
          fontSize: 'clamp(0.875rem, 1vw, 1rem)',
          color: 'var(--text-secondary)',
          lineHeight: 1.5,
          marginBottom: '0.875rem',
        }}
      >
        {story.summary}
      </p>

      {/* ── Metadata ── */}
      <div className="flex items-center justify-between font-sans">
        <span
          className="truncate"
          style={{
            fontSize: '0.8125rem',
            color: hasAccent ? accentVar : 'var(--text-secondary)',
            fontWeight: hasAccent ? 500 : 400,
            maxWidth: '65%',
          }}
        >
          {story.sources[0] ?? ''}
        </span>
        <span style={{ fontSize: '0.8125rem', color: 'var(--text-dim)' }}>
          {formatRelativeTime(story.published_at)}
        </span>
      </div>
    </div>
  );
}

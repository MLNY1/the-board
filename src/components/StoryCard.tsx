'use client';

/**
 * Secondary story card.
 * Desktop (4-col grid): compact — 15px headline, no summary, 11px source.
 * Mobile (1-col):       larger  — 20px headline, 14px summary, 13px source.
 * CSS classes in globals.css handle all responsive sizing.
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

  const accentColor = isBreaking ? 'var(--accent-amber)'
    : isMajor ? 'var(--accent-major)'
    : 'var(--text-muted)';

  const accentBorder = isBreaking ? 'var(--accent-amber-soft)'
    : isMajor ? 'var(--accent-major-soft)'
    : 'rgba(107,98,86,0.3)';

  return (
    <div
      className="card-wrapper"
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border-card)',
        borderRadius: '8px',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Tier badge */}
      <div style={{ marginBottom: '6px' }}>
        <span
          className="card-badge-text"
          style={{
            fontFamily: 'var(--font-body)',
            letterSpacing: '1.5px',
            textTransform: 'uppercase',
            color: accentColor,
            border: `1px solid ${accentBorder}`,
            borderRadius: '3px',
            background: 'transparent',
          }}
        >
          {story.tier}
        </span>
      </div>

      {/* Headline — 2-line clamp, size from CSS */}
      <h2
        className="card-headline line-clamp-2"
        style={{
          fontFamily: 'var(--font-headline)',
          color: 'var(--text-primary)',
        }}
      >
        {story.headline}
      </h2>

      {/* Summary — 1 line clamp */}
      <p className="card-summary">
        {story.summary}
      </p>

      {/* Source + time */}
      <div
        className="card-source"
        style={{
          fontFamily: 'var(--font-body)',
          color: 'var(--text-muted)',
          display: 'flex',
          justifyContent: 'space-between',
          marginTop: 'auto',
          paddingTop: '4px',
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '65%' }}>
          {story.sources[0] ?? ''}
        </span>
        <span style={{ flexShrink: 0 }}>
          {formatRelativeTime(story.published_at)}
        </span>
      </div>
    </div>
  );
}

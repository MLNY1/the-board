'use client';

/**
 * Compact secondary story card — shown 1-2 at a time below the hero.
 * 28px Georgia headline (weight 500), 18px summary, 16px source.
 * Outlined badge. No image.
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
    <div style={{
      background: 'var(--bg-card)',
      border: '1px solid var(--border-card)',
      borderRadius: '10px',
      padding: '18px 20px',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }}>
      {/* Tier badge */}
      <div style={{ marginBottom: '8px' }}>
        <span style={{
          fontFamily: 'var(--font-body)',
          fontSize: '9px',
          letterSpacing: '1.5px',
          textTransform: 'uppercase',
          color: accentColor,
          border: `1px solid ${accentBorder}`,
          padding: '2px 8px',
          borderRadius: '3px',
          background: 'transparent',
        }}>
          {story.tier}
        </span>
      </div>

      {/* Headline (max 2 lines) */}
      <h2 style={{
        fontFamily: 'var(--font-headline)',
        fontSize: '28px',
        fontWeight: 500,
        lineHeight: 1.2,
        color: 'var(--text-primary)',
        marginBottom: '8px',
        display: '-webkit-box',
        WebkitLineClamp: 2,
        WebkitBoxOrient: 'vertical',
        overflow: 'hidden',
        flex: 1,
      } as React.CSSProperties}>
        {story.headline}
      </h2>

      {/* Summary (max 2 lines) */}
      <p style={{
        fontFamily: 'var(--font-body)',
        fontSize: '18px',
        lineHeight: 1.45,
        color: 'var(--text-body)',
        marginBottom: '10px',
        display: '-webkit-box',
        WebkitLineClamp: 2,
        WebkitBoxOrient: 'vertical',
        overflow: 'hidden',
      } as React.CSSProperties}>
        {story.summary}
      </p>

      {/* Source + time */}
      <div style={{
        fontFamily: 'var(--font-body)',
        fontSize: '16px',
        color: 'var(--text-muted)',
        display: 'flex',
        justifyContent: 'space-between',
        marginTop: 'auto',
      }}>
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

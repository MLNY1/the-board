'use client';

/**
 * Full-screen hero story — the centerpiece of TheBoard.
 * Desktop: 52px breaking / 36px major. Mobile: 34px / 30px.
 * CSS classes handle responsive sizing; inline styles for non-responsive props.
 */

import { useState } from 'react';
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

export default function HeroStory({ story, isNew = false }: HeroStoryProps) {
  const [imgHidden, setImgHidden] = useState(false);

  const isBreaking  = story.tier === 'breaking';
  const accentColor = isBreaking ? 'var(--accent-amber)' : 'var(--accent-major)';
  const accentSoft  = isBreaking ? 'var(--accent-amber-soft)' : 'var(--accent-major-soft)';
  const borderColor = isBreaking ? 'var(--accent-amber)' : 'var(--accent-major)';
  const bgGradient  = isBreaking
    ? 'linear-gradient(135deg, var(--accent-amber-glow) 0%, transparent 60%)'
    : 'linear-gradient(135deg, rgba(143,167,191,0.03) 0%, transparent 60%)';

  const showImage = !!story.image_url && !imgHidden;

  return (
    <div className="hero-outer-pad">
      <div
        className="hero-inner-pad"
        style={{
          borderLeft: `3px solid ${borderColor}`,
          background: bgGradient,
          borderRadius: '0 10px 10px 0',
          position: 'relative',
        }}
      >
        {/* Image thumbnail — top-right float */}
        {showImage && (
          <img
            src={story.image_url!}
            alt=""
            onError={() => setImgHidden(true)}
            style={{
              float: 'right',
              marginLeft: '20px',
              marginBottom: '8px',
              width: '160px',
              height: '100px',
              objectFit: 'cover',
              borderRadius: '8px',
              opacity: 0.7,
              flexShrink: 0,
            }}
          />
        )}

        {/* Badge row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
          <span style={{
            fontFamily: 'var(--font-body)',
            fontSize: '10px',
            letterSpacing: '2px',
            textTransform: 'uppercase',
            color: accentColor,
            border: `1px solid ${accentSoft}`,
            padding: '3px 12px',
            borderRadius: '4px',
            background: 'transparent',
          }}>
            {isBreaking ? 'Breaking' : 'Major'}
          </span>

          {isNew && (
            <span style={{
              fontFamily: 'var(--font-body)',
              fontSize: '10px',
              letterSpacing: '2px',
              textTransform: 'uppercase',
              color: 'var(--accent-amber)',
              border: '1px solid var(--accent-amber-soft)',
              padding: '2px 10px',
              borderRadius: '4px',
              background: 'transparent',
              animation: 'fadeNewBadge 5s ease-in-out forwards',
            }}>
              New
            </span>
          )}
        </div>

        {/* Headline — font-size from CSS class */}
        <h1
          className={`line-clamp-2 ${isBreaking ? 'hero-headline' : 'hero-headline-major'}`}
          style={{
            fontFamily: 'var(--font-headline)',
            fontWeight: 500,
            lineHeight: 1.12,
            color: 'var(--text-primary)',
            marginBottom: '14px',
          }}
        >
          {story.headline}
        </h1>

        {/* Summary */}
        <p
          className="line-clamp-2 hero-summary"
          style={{
            fontFamily: 'var(--font-body)',
            lineHeight: 1.55,
            color: 'var(--text-body)',
            maxWidth: '750px',
          }}
        >
          {story.summary}
        </p>

        {/* Source + time */}
        <div
          className="hero-source-line"
          style={{
            marginTop: '14px',
            fontFamily: 'var(--font-body)',
            color: 'var(--text-muted)',
          }}
        >
          {story.sources.slice(0, 3).join(' · ')}
          {story.sources.length > 0 && ' · '}
          {formatRelativeTime(story.published_at)}
        </div>
      </div>
    </div>
  );
}

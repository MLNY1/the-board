'use client';

/**
 * Overview panel — OVERVIEW rotation phase.
 * Full 2-column layout of all stories. Slides up on entrance.
 * Amber dot · 18px Georgia headline · muted source.
 */

import type { DigestStoryItem } from '@/types';

interface OverviewPanelProps {
  stories: DigestStoryItem[];
  isShabbosMode: boolean;
}

function formatAge(iso: string): string {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1)  return 'now';
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h`;
}

const TIER_ORDER: Record<string, number> = { breaking: 0, major: 1, notable: 2, background: 3 };

export default function OverviewPanel({ stories }: OverviewPanelProps) {
  const sorted = [...stories]
    .sort((a, b) => {
      const t = (TIER_ORDER[a.tier] ?? 4) - (TIER_ORDER[b.tier] ?? 4);
      return t !== 0 ? t : b.importance_score - a.importance_score;
    })
    .slice(0, 20);

  const mid      = Math.ceil(sorted.length / 2);
  const leftCol  = sorted.slice(0, mid);
  const rightCol = sorted.slice(mid);

  const Row = ({ story }: { story: DigestStoryItem }) => (
    <div style={{
      display: 'flex',
      alignItems: 'baseline',
      gap: '10px',
      padding: '7px 0',
      borderBottom: '1px solid rgba(30,26,20,0.4)',
    }}>
      <span style={{ color: 'var(--accent-amber)', fontSize: '6px', flexShrink: 0, lineHeight: 1, marginTop: '2px' }}>●</span>
      <span style={{
        fontFamily: 'var(--font-headline)',
        fontSize: '18px',
        color: '#d4cfc5',
        flex: 1,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}>
        {story.headline}
      </span>
      <span style={{
        fontFamily: 'var(--font-body)',
        fontSize: '13px',
        color: 'var(--text-muted)',
        whiteSpace: 'nowrap',
        flexShrink: 0,
      }}>
        {story.sources[0] ?? ''}
        {story.sources[0] ? ` · ${formatAge(story.published_at)}` : formatAge(story.published_at)}
      </span>
    </div>
  );

  return (
    <div
      className="animate-slide-up"
      style={{
        flex: 1,
        overflow: 'hidden',
        padding: '16px 28px 0',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Section header */}
      <div style={{
        fontFamily: 'var(--font-body)',
        fontSize: '11px',
        letterSpacing: '2.5px',
        textTransform: 'uppercase',
        color: 'var(--text-muted)',
        paddingBottom: '8px',
        borderBottom: '1px solid var(--border-subtle)',
        marginBottom: '10px',
        display: 'flex',
        justifyContent: 'space-between',
        flexShrink: 0,
      }}>
        <span>All Stories</span>
        <span>{stories.length} update{stories.length !== 1 ? 's' : ''}</span>
      </div>

      {/* 2-column grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '3px 32px',
        flex: 1,
        overflow: 'hidden',
        alignContent: 'start',
      }}>
        <div>
          {leftCol.map(s => <Row key={s.id} story={s} />)}
        </div>
        <div>
          {rightCol.map(s => <Row key={s.id} story={s} />)}
        </div>
      </div>
    </div>
  );
}

'use client';

/**
 * Compact story card for major/notable tier stories shown in the two-up grid
 * beneath the hero story. Displays a truncated headline and minimal metadata.
 */

import type { DigestStoryItem } from '@/types';

interface StoryCardProps {
  story: DigestStoryItem;
  isShabbosMode: boolean;
}

function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString);
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function StoryCard({ story, isShabbosMode }: StoryCardProps) {
  const isMajor = story.tier === 'major';

  const badgeColor = isShabbosMode
    ? (isMajor ? 'text-[#7aaccb] border-[#5a7a9a]' : 'text-[#8a8680] border-[#3a3a3a]')
    : (isMajor ? 'text-[#8eadcb] border-[#6b8cae]' : 'text-[#8a8680] border-[#5a5a5a]');

  const bgCard = isShabbosMode ? 'bg-[#130e09] border-[#2a2015]' : 'bg-[#141419] border-[#1e1e24]';

  return (
    <div
      className={`
        flex flex-col justify-between p-6 rounded-lg border
        ${bgCard}
        h-full
      `}
    >
      {/* Tier badge */}
      <div className="mb-3">
        <span
          className={`
            text-xs font-bold tracking-widest uppercase border rounded-sm px-2 py-0.5
            ${badgeColor}
          `}
        >
          {story.tier}
        </span>
      </div>

      {/* Headline — clamp to 3 lines to keep cards uniform */}
      <h2
        className={`
          font-serif font-bold leading-snug mb-4
          text-2xl xl:text-3xl
          line-clamp-3
          ${isShabbosMode ? 'text-[#d4cfc8]' : 'text-[#e8e4de]'}
        `}
      >
        {story.headline}
      </h2>

      {/* Summary — clamp to 2 lines */}
      <p
        className={`
          text-base leading-relaxed line-clamp-2 mb-4 flex-1
          ${isShabbosMode ? 'text-[#a09b94]' : 'text-[#a8a39c]'}
        `}
      >
        {story.summary}
      </p>

      {/* Metadata */}
      <div className="flex items-center gap-3">
        {story.sources.length > 0 && (
          <span
            className={`
              text-sm font-sans truncate
              ${isMajor
                ? (isShabbosMode ? 'text-[#7aaccb]' : 'text-[#8eadcb]')
                : 'text-[#8a8680]'
              }
            `}
          >
            {story.sources[0]}
          </span>
        )}
        <span className="text-sm text-[#8a8680] font-sans ml-auto shrink-0">
          {formatRelativeTime(story.published_at)}
        </span>
      </div>
    </div>
  );
}

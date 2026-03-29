'use client';

/**
 * Full-screen hero story display for breaking/major tier stories.
 *
 * Breaking tier: amber/gold accent border, BREAKING badge, 48-56px headline
 * Major tier: blue-grey accent border, MAJOR badge, 36-48px headline
 *
 * Rendered inside BoardDashboard during the HERO phase of the rotation.
 */

import type { DigestStoryItem } from '@/types';

interface HeroStoryProps {
  story: DigestStoryItem;
  isNew?: boolean; // show "NEW" badge when story arrived via interrupt
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

export default function HeroStory({ story, isNew = false, isShabbosMode }: HeroStoryProps) {
  const isBreaking = story.tier === 'breaking';

  const accentColor = isShabbosMode
    ? (isBreaking ? 'border-[#c4922e]' : 'border-[#5a7a9a]')
    : (isBreaking ? 'border-[#d4a24e]' : 'border-[#6b8cae]');

  const accentText = isShabbosMode
    ? (isBreaking ? 'text-[#c4922e]' : 'text-[#7aaccb]')
    : (isBreaking ? 'text-[#d4a24e]' : 'text-[#8eadcb]');

  const accentBg = isShabbosMode
    ? (isBreaking ? 'bg-[#c4922e]' : 'bg-[#5a7a9a]')
    : (isBreaking ? 'bg-[#d4a24e]' : 'bg-[#6b8cae]');

  const bgCard = isShabbosMode ? 'bg-[#130e09]' : 'bg-[#141419]';

  return (
    <div
      className={`
        flex flex-col justify-center px-12 py-10 rounded-lg border-l-8
        ${accentColor} ${bgCard}
        min-h-0 flex-1
        transition-opacity duration-700 ease-in-out
      `}
    >
      {/* Tier badge + NEW badge */}
      <div className="flex items-center gap-3 mb-6">
        <span
          className={`
            ${accentBg} text-[#0a0a0f] text-sm font-bold tracking-widest
            px-3 py-1 rounded-sm uppercase
          `}
        >
          {isBreaking ? 'Breaking' : 'Major'}
        </span>

        {isNew && (
          <span className="bg-red-500 text-white text-sm font-bold tracking-widest px-3 py-1 rounded-sm uppercase animate-pulse">
            New
          </span>
        )}
      </div>

      {/* Headline */}
      <h1
        className={`
          font-serif font-bold leading-tight mb-6
          ${isBreaking ? 'text-5xl xl:text-6xl' : 'text-4xl xl:text-5xl'}
          ${isShabbosMode ? 'text-[#d4cfc8]' : 'text-[#e8e4de]'}
        `}
      >
        {story.headline}
      </h1>

      {/* Summary */}
      <p
        className={`
          text-xl xl:text-2xl leading-relaxed font-sans mb-8 max-w-5xl
          ${isShabbosMode ? 'text-[#b8b3ac]' : 'text-[#c4bfb8]'}
        `}
      >
        {story.summary}
      </p>

      {/* Sources + time */}
      <div className="flex items-center gap-4">
        {story.sources.length > 0 && (
          <span className={`text-base font-sans ${accentText}`}>
            {story.sources.slice(0, 3).join(' · ')}
          </span>
        )}
        <span className="text-base text-[#8a8680] font-sans">
          {formatRelativeTime(story.published_at)}
        </span>
      </div>
    </div>
  );
}

'use client';

/**
 * Overview panel shown during the OVERVIEW phase of the rotation.
 * Displays a compact bullet list of all notable + background stories.
 * Each row is one line — headline only — readable from across a room.
 *
 * Also shows the two most recent major/breaking stories as secondary context
 * at the top so viewers who missed the HERO phase can see what the big stories are.
 */

import type { DigestStoryItem } from '@/types';

interface OverviewPanelProps {
  stories: DigestStoryItem[];
  isShabbosMode: boolean;
}

function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString);
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 60) return `${diffMin}m`;
  return `${Math.floor(diffMin / 60)}h`;
}

export default function OverviewPanel({ stories, isShabbosMode }: OverviewPanelProps) {
  const heroStories = stories.filter((s) => s.tier === 'breaking' || s.tier === 'major').slice(0, 2);
  const overviewStories = stories.filter((s) => s.tier === 'notable' || s.tier === 'background');

  const textPrimary = isShabbosMode ? 'text-[#d4cfc8]' : 'text-[#e8e4de]';
  const textMuted = isShabbosMode ? 'text-[#8a8070]' : 'text-[#8a8680]';
  const accentBreaking = isShabbosMode ? 'text-[#c4922e]' : 'text-[#d4a24e]';
  const accentMajor = isShabbosMode ? 'text-[#7aaccb]' : 'text-[#8eadcb]';
  const borderColor = isShabbosMode ? 'border-[#2a2015]' : 'border-[#1e1e24]';
  const bgPanel = isShabbosMode ? 'bg-[#0d0a07]' : 'bg-[#0a0a0f]';

  return (
    <div className={`flex flex-col h-full px-10 py-8 ${bgPanel}`}>
      {/* Section header */}
      <div className={`flex items-center gap-4 mb-6 pb-4 border-b ${borderColor}`}>
        <h2 className={`text-lg font-bold tracking-widest uppercase ${textMuted}`}>
          All Stories
        </h2>
        <span className={`text-sm ${textMuted}`}>
          {stories.length} update{stories.length !== 1 ? 's' : ''}
        </span>
      </div>

      <div className="flex gap-8 flex-1 min-h-0">
        {/* Left: Top stories recap */}
        {heroStories.length > 0 && (
          <div className={`w-80 shrink-0 border-r ${borderColor} pr-8 flex flex-col gap-6`}>
            <p className={`text-xs font-bold tracking-widest uppercase ${textMuted} mb-2`}>
              Top Stories
            </p>
            {heroStories.map((story) => (
              <div key={story.id} className="flex flex-col gap-2">
                <span
                  className={`
                    text-xs font-bold tracking-widest uppercase
                    ${story.tier === 'breaking' ? accentBreaking : accentMajor}
                  `}
                >
                  {story.tier}
                </span>
                <p className={`text-lg font-serif font-bold leading-snug ${textPrimary}`}>
                  {story.headline}
                </p>
                <p className={`text-sm leading-relaxed line-clamp-3 ${textMuted}`}>
                  {story.summary}
                </p>
              </div>
            ))}
          </div>
        )}

        {/* Right: Notable / background bullet list */}
        <div className="flex-1 overflow-hidden">
          <p className={`text-xs font-bold tracking-widest uppercase ${textMuted} mb-4`}>
            Notable
          </p>
          {overviewStories.length === 0 ? (
            <p className={`text-lg ${textMuted}`}>No additional stories at this time.</p>
          ) : (
            <ul className="flex flex-col gap-0">
              {overviewStories.slice(0, 14).map((story, idx) => (
                <li
                  key={story.id}
                  className={`
                    flex items-baseline gap-4 py-3
                    ${idx < overviewStories.slice(0, 14).length - 1 ? `border-b ${borderColor}` : ''}
                  `}
                >
                  {/* Bullet */}
                  <span className={`text-sm shrink-0 ${textMuted}`}>•</span>

                  {/* Headline */}
                  <span
                    className={`
                      text-lg font-sans leading-snug flex-1 line-clamp-1
                      ${textPrimary}
                    `}
                  >
                    {story.headline}
                  </span>

                  {/* Source + time */}
                  <span className={`text-sm shrink-0 ${textMuted}`}>
                    {story.sources[0] && (
                      <span className="mr-2">{story.sources[0]}</span>
                    )}
                    {formatRelativeTime(story.published_at)}
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

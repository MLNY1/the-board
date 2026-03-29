import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        serif: ['Newsreader', 'Georgia', 'Times New Roman', 'serif'],
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['ui-monospace', 'SF Mono', 'Cascadia Code', 'monospace'],
      },
      colors: {
        board: {
          // Weekday palette
          'bg-primary': '#0a0a0f',
          'bg-card': '#141419',
          'text-primary': '#e8e4de',
          'text-secondary': '#8a8680',
          'accent-breaking': '#d4a24e',
          'accent-major': '#6b8cae',
          'accent-notable': '#5a5a5a',
          'border-subtle': '#1e1e24',
          // Shabbos palette
          'shabbos-bg': '#0d0a07',
          'shabbos-card': '#130e09',
          'shabbos-text': '#d4cfc8',
          'shabbos-muted': '#8a8070',
          'shabbos-breaking': '#c4922e',
          'shabbos-major': '#5a7a9a',
          'shabbos-border': '#2a2015',
        },
      },
      fontSize: {
        // Kiosk-optimized type scale for 1080p displays
        'hero-breaking': ['3.5rem', { lineHeight: '1.1', fontWeight: '700' }], // 56px
        'hero-major': ['2.75rem', { lineHeight: '1.15', fontWeight: '700' }],  // 44px
        'card-headline': ['1.875rem', { lineHeight: '1.2', fontWeight: '700' }], // 30px
        'summary': ['1.375rem', { lineHeight: '1.6' }],                         // 22px
        'metadata': ['1rem', { lineHeight: '1.5' }],                            // 16px
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
      screens: {
        // 1080p target
        'fhd': '1920px',
        // 4K target
        '4k': '3840px',
      },
    },
  },
  plugins: [],
};

export default config;

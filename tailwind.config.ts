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
        // References CSS variables set by next/font/google in layout.tsx
        serif: ['var(--font-newsreader)', 'Georgia', 'Times New Roman', 'serif'],
        sans:  ['var(--font-inter)', 'ui-sans-serif', 'system-ui', '-apple-system', 'sans-serif'],
        mono:  ['ui-monospace', 'SF Mono', 'Cascadia Code', 'Consolas', 'monospace'],
      },
      animation: {
        'pulse-dot':  'pulse-dot 2.5s ease-in-out infinite',
        'pulse-slow': 'pulse 4s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fade-in':    'fade-in 0.7s ease-out forwards',
        'slide-up':   'slide-up 0.5s ease-out forwards',
      },
      keyframes: {
        'pulse-dot': {
          '0%, 100%': { opacity: '1', transform: 'scale(1)' },
          '50%':      { opacity: '0.4', transform: 'scale(0.8)' },
        },
        'fade-in': {
          from: { opacity: '0' },
          to:   { opacity: '1' },
        },
        'slide-up': {
          from: { opacity: '0', transform: 'translateY(12px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
      },
      screens: {
        'fhd': '1920px',
        '4k':  '3840px',
      },
    },
  },
  plugins: [],
};

export default config;

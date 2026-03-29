/**
 * Root layout — loads fonts via next/font/google (zero FOUC, self-hosted by Vercel)
 * and wraps the app in the crash-safe ErrorBoundary.
 */

import type { Metadata, Viewport } from 'next';
import { Newsreader, Inter } from 'next/font/google';
import ErrorBoundary from '@/components/ErrorBoundary';
import './globals.css';

const newsreader = Newsreader({
  subsets: ['latin'],
  weight: ['400', '600', '700'],
  style: ['normal', 'italic'],
  variable: '--font-newsreader',
  display: 'swap',
});

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-inter',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'TheBoard',
  description: 'Automated news dashboard',
  robots: 'noindex, nofollow',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0a0a0f',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Safety net: full reload every hour in case JS crashes unrecoverably */}
        <meta httpEquiv="refresh" content="3600" />
      </head>
      <body className={`${newsreader.variable} ${inter.variable} h-screen overflow-hidden`}>
        <ErrorBoundary>
          {children}
        </ErrorBoundary>
      </body>
    </html>
  );
}

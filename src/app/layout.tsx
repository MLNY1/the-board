/**
 * Root layout — system fonts only (Georgia + system sans), zero FOUC.
 * Safety net: full reload every hour in case JS crashes unrecoverably.
 */

import type { Metadata, Viewport } from 'next';
import ErrorBoundary from '@/components/ErrorBoundary';
import './globals.css';

export const metadata: Metadata = {
  title: 'TheBoard',
  description: 'Automated news dashboard',
  robots: 'noindex, nofollow',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0f0c08',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta httpEquiv="refresh" content="3600" />
      </head>
      <body className="h-screen overflow-hidden">
        <ErrorBoundary>
          {children}
        </ErrorBoundary>
      </body>
    </html>
  );
}

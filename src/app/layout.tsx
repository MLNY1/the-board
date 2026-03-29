/**
 * Root layout for TheBoard.
 *
 * - Sets up full-viewport, overflow-hidden layout for kiosk mode
 * - Wraps content in ErrorBoundary to catch crashes without blank screens
 * - Meta http-equiv refresh every 3600s as a safety net for JS crashes
 * - Minimal meta tags (this is a private wall display, not a public web page)
 */

import type { Metadata, Viewport } from 'next';
import ErrorBoundary from '@/components/ErrorBoundary';
import './globals.css';

export const metadata: Metadata = {
  title: 'TheBoard',
  description: 'Automated news dashboard',
  robots: 'noindex, nofollow', // Private display — don't index
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0a0a0f',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Safety net: force full page reload every hour in case JS crashes unrecoverably */}
        <meta httpEquiv="refresh" content="3600" />

        {/* Preconnect to Google Fonts for faster font loading */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body className="h-screen overflow-hidden bg-[#0a0a0f]">
        <ErrorBoundary>
          {children}
        </ErrorBoundary>
      </body>
    </html>
  );
}

'use client';

/**
 * React Error Boundary for TheBoard.
 * If the dashboard component tree crashes, this catches it and renders
 * the last known good data (or a minimal fallback) instead of a blank screen.
 *
 * The board is designed to run unattended for 25-48 hours, so we must
 * never show a completely blank screen.
 */

import { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[TheBoard] Dashboard crashed:', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div className="flex flex-col items-center justify-center h-screen bg-[#0a0a0f] text-[#e8e4de]">
          <div className="text-center max-w-md px-8">
            <p className="text-4xl font-serif font-bold text-[#d4a24e] mb-4">TheBoard</p>
            <p className="text-lg text-[#8a8680] mb-2">Connection interrupted</p>
            <p className="text-sm text-[#5a5a5a]">
              The display will automatically recover. No action required.
            </p>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

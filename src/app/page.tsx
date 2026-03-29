/**
 * Main page — the always-on dashboard.
 *
 * Fetches initial digest data on the server (no loading flash on first paint),
 * then hands off to BoardDashboard for client-side polling and rotation.
 *
 * The server fetch uses no-store so each SSR render gets fresh data.
 * After that, the client polls every 60 seconds autonomously.
 */

import { headers } from 'next/headers';
import BoardDashboard from '@/components/BoardDashboard';
import type { DigestResponse } from '@/types';

async function getInitialDigest(zip: string): Promise<DigestResponse | null> {
  try {
    // Build absolute URL for server-side fetch
    const headersList = await headers();
    const host = headersList.get('host') ?? 'localhost:3000';
    const protocol = process.env.NODE_ENV === 'production' ? 'https' : 'http';
    const params = zip ? `?zip=${encodeURIComponent(zip)}` : '';

    const res = await fetch(`${protocol}://${host}/api/digest${params}`, {
      cache: 'no-store',
    });

    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

interface PageProps {
  searchParams: Promise<{ zip?: string }>;
}

export default async function Page({ searchParams }: PageProps) {
  const resolvedParams = await searchParams;
  const zip = resolvedParams.zip ?? process.env.DEFAULT_ZIP ?? '11598';

  const initialData = await getInitialDigest(zip);

  return <BoardDashboard initialData={initialData} />;
}

/**
 * Main page — 2-column grid (news left, red alert sidebar right).
 * Server-renders initial digest data for zero loading flash.
 */

import { headers } from 'next/headers';
import BoardDashboard from '@/components/BoardDashboard';
import RedAlertSidebar from '@/components/RedAlertSidebar';
import type { DigestResponse } from '@/types';

async function getInitialDigest(zip: string): Promise<DigestResponse | null> {
  try {
    const headersList = await headers();
    const host        = headersList.get('host') ?? 'localhost:3000';
    const protocol    = process.env.NODE_ENV === 'production' ? 'https' : 'http';
    const params      = zip ? `?zip=${encodeURIComponent(zip)}` : '';

    const res = await fetch(`${protocol}://${host}/api/digest${params}`, { cache: 'no-store' });
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
  const { zip = process.env.DEFAULT_ZIP ?? '11598' } = await searchParams;
  const initialData = await getInitialDigest(zip);

  return (
    <div className="page-grid">
      <BoardDashboard initialData={initialData} />
      <div className="alert-sidebar">
        <RedAlertSidebar />
      </div>
    </div>
  );
}

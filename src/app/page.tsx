/**
 * Main page — 2-column grid (news left, red alert sidebar right).
 * Server-renders initial digest data for zero loading flash.
 * Mobile: single column with horizontal alert strip at top.
 */

import { headers } from 'next/headers';
import BoardDashboard from '@/components/BoardDashboard';
import RedAlertSidebar from '@/components/RedAlertSidebar';
import MobileAlertStrip from '@/components/MobileAlertStrip';
import type { DigestResponse } from '@/types';

async function getInitialDigest(zip: string, market: boolean): Promise<DigestResponse | null> {
  try {
    const headersList = await headers();
    const host        = headersList.get('host') ?? 'localhost:3000';
    const protocol    = process.env.NODE_ENV === 'production' ? 'https' : 'http';
    const params      = new URLSearchParams();
    if (zip)    params.set('zip', zip);
    if (market) params.set('market', 'true');
    const qs = params.toString() ? `?${params}` : '';

    const res = await fetch(`${protocol}://${host}/api/digest${qs}`, { cache: 'no-store' });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

interface PageProps {
  searchParams: Promise<{ zip?: string; market?: string }>;
}

export default async function Page({ searchParams }: PageProps) {
  const { zip = process.env.DEFAULT_ZIP ?? '11598', market } = await searchParams;
  const initialData = await getInitialDigest(zip, market === 'true');

  return (
    <div className="page-grid">
      {/* Left column: mobile alert strip (hidden on desktop) + main board */}
      <div className="board-left-col" style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
        <MobileAlertStrip />
        <BoardDashboard initialData={initialData} />
      </div>

      {/* Right column: sidebar (hidden on mobile) */}
      <div className="alert-sidebar">
        <RedAlertSidebar />
      </div>
    </div>
  );
}

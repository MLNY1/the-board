import { NextResponse } from 'next/server';
import { fetchMarketData } from '@/lib/market-data';

export const dynamic    = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  const data = await fetchMarketData();
  return NextResponse.json(data, {
    headers: { 'Cache-Control': 'no-store' },
  });
}

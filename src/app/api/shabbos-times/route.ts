/**
 * GET /api/shabbos-times
 * Returns Shabbos window, active status, parsha, and Yom Tov windows.
 *
 * Query params:
 *  ?zip=11598  — ZIP code (default from env)
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getShabbosWindow,
  getActiveWindow,
  getYomTovWindows,
  formatCountdown,
  type GeoParams,
} from '@/lib/shabbos-times';

const DEFAULT_ZIP = process.env.DEFAULT_ZIP ?? '11598';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const zip = searchParams.get('zip') ?? DEFAULT_ZIP;

  const latParam  = searchParams.get('lat');
  const lngParam  = searchParams.get('lng');
  const tzidParam = searchParams.get('tzid');
  const geo: GeoParams | undefined = (latParam && lngParam)
    ? { lat: parseFloat(latParam), lng: parseFloat(lngParam), tzid: tzidParam ?? 'America/New_York' }
    : undefined;

  try {
    const [shabbosResult, activeResult, yomTovResult] = await Promise.allSettled([
      getShabbosWindow(zip, geo),
      getActiveWindow(zip, geo),
      getYomTovWindows(zip, geo),
    ]);

    const shabbos = shabbosResult.status === 'fulfilled' ? shabbosResult.value : null;
    const active = activeResult.status === 'fulfilled' ? activeResult.value : null;
    const yomTovWindows = yomTovResult.status === 'fulfilled' ? yomTovResult.value : [];

    // Compute countdown to next Shabbos start (for weekday mode header)
    const countdownToShabbos = shabbos && !active ? formatCountdown(shabbos.start) : null;

    return NextResponse.json(
      {
        shabbos: shabbos
          ? {
              start: shabbos.start.toISOString(),
              end: shabbos.end.toISOString(),
              parsha: shabbos.parsha,
            }
          : null,
        active: active
          ? {
              start: active.start.toISOString(),
              end: active.end.toISOString(),
              name: active.name,
            }
          : null,
        is_active: active !== null,
        countdown_to_shabbos: countdownToShabbos,
        yom_tov_windows: yomTovWindows.map((w) => ({
          start: w.start.toISOString(),
          end: w.end.toISOString(),
          name: w.name,
        })),
      },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=3600',
        },
      }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

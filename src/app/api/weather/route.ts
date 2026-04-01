import { NextRequest, NextResponse } from 'next/server';

const DEFAULT_LAT = 40.6326;
const DEFAULT_LNG = -73.7154;

function wmoDescription(code: number): { description: string; emoji: string } {
  if (code === 0)                          return { description: 'Clear',         emoji: '☀️' };
  if (code <= 3)                           return { description: 'Partly Cloudy', emoji: '⛅' };
  if (code === 45 || code === 48)          return { description: 'Foggy',         emoji: '🌫️' };
  if (code >= 51 && code <= 57)            return { description: 'Drizzle',       emoji: '🌦️' };
  if (code >= 61 && code <= 67)            return { description: 'Rain',          emoji: '🌧️' };
  if (code >= 71 && code <= 77)            return { description: 'Snow',          emoji: '❄️' };
  if (code >= 80 && code <= 82)            return { description: 'Showers',       emoji: '🌧️' };
  if (code >= 85 && code <= 86)            return { description: 'Snow',          emoji: '❄️' };
  if (code >= 95 && code <= 99)            return { description: 'Thunderstorm',  emoji: '⛈️' };
  return { description: 'Cloudy', emoji: '☁️' };
}

function dayLabel(dateStr: string, index: number): string {
  if (index === 0) return 'Today';
  const date = new Date(dateStr + 'T12:00:00');
  return date.toLocaleDateString('en-US', { weekday: 'short' });
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const lat = parseFloat(searchParams.get('lat') ?? String(DEFAULT_LAT));
  const lng = parseFloat(searchParams.get('lng') ?? String(DEFAULT_LNG));

  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
    `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code` +
    `&current=temperature_2m,weather_code` +
    `&temperature_unit=fahrenheit&timezone=auto&forecast_days=3`;

  try {
    const res = await fetch(url, { next: { revalidate: 7200 } });
    if (!res.ok) return NextResponse.json({ error: 'Weather fetch failed' }, { status: 502 });

    const data = await res.json();
    const current = data.current;
    const daily   = data.daily;

    const response = {
      current: {
        temp:        Math.round(current.temperature_2m),
        code:        current.weather_code,
        ...wmoDescription(current.weather_code),
      },
      daily: (daily.time as string[]).map((date: string, i: number) => ({
        date:          dayLabel(date, i),
        high:          Math.round(daily.temperature_2m_max[i]),
        low:           Math.round(daily.temperature_2m_min[i]),
        precip_chance: daily.precipitation_probability_max[i] ?? 0,
        code:          daily.weather_code[i],
        ...wmoDescription(daily.weather_code[i]),
      })),
    };

    return NextResponse.json(response, {
      headers: { 'Cache-Control': 'public, s-maxage=7200, stale-while-revalidate=3600' },
    });
  } catch {
    return NextResponse.json({ error: 'Weather unavailable' }, { status: 502 });
  }
}

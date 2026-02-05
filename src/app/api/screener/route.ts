import { NextResponse } from 'next/server';
import { getBestOpportunities } from '../../../lib/utils/screener';

/**
 * Returns cached opportunities immediately. Data is refreshed in background by the scheduler every 60s.
 * Dashboard loads instantly without waiting for exchange API.
 */
export async function GET() {
  const opportunities = getBestOpportunities({ forceRefresh: false });
  return NextResponse.json(opportunities, {
    headers: {
      'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=59',
      'X-Cached': 'true',
    },
  });
}

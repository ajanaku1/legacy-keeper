import { NextRequest, NextResponse } from 'next/server';
import { toPublicActivityEntries } from '@/lib/activity-ledger';
import {
  InvalidActivityRequestError,
  loadWalletActivity,
} from '@/lib/activity-route';
import { serverActivityRepository } from '@/lib/activity-server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const owner = request.nextUrl.searchParams.get('owner');
  const requestedPage = Number(request.nextUrl.searchParams.get('page') ?? '1');
  try {
    const activity = await loadWalletActivity(
      owner ?? '',
      requestedPage,
      serverActivityRepository()
    );
    return NextResponse.json({
      ...activity,
      entries: toPublicActivityEntries(activity.entries),
    });
  } catch (error) {
    if (error instanceof InvalidActivityRequestError) {
      return NextResponse.json(
        { entries: [], error: error.message },
        { status: 400 }
      );
    }
    console.error('Unable to read wallet activity.', error);
    return NextResponse.json(
      { entries: [], error: 'Activity unavailable.' },
      { status: 503 }
    );
  }
}

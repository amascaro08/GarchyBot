import { NextRequest, NextResponse } from 'next/server';
import { getUserId } from '@/lib/auth';
import { getActivityLogs } from '@/lib/db';

/**
 * GET /api/activity
 * Fetch activity logs for the current user
 */
export async function GET(request: NextRequest) {
  try {
    const userId = await getUserId();

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get limit from query params
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '50', 10);

    // Fetch activity logs
    const logs = await getActivityLogs(userId, limit);

    return NextResponse.json({
      success: true,
      logs,
    });
  } catch (error) {
    console.error('[Activity API] Error:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to fetch activity logs',
      },
      { status: 500 }
    );
  }
}

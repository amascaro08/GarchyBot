import { NextRequest, NextResponse } from 'next/server';
import { destroySession } from '@/lib/auth';

/**
 * Logout the current user
 * POST /api/auth/logout
 */
export async function POST(request: NextRequest) {
  try {
    await destroySession();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error logging out:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to logout' },
      { status: 500 }
    );
  }
}


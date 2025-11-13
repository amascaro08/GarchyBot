import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';

/**
 * Get current authenticated user
 * GET /api/auth/me
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getSessionUser();
    
    if (!user) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    return NextResponse.json({
      success: true,
      user,
    });
  } catch (error) {
    console.error('Error getting current user:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get user' },
      { status: 500 }
    );
  }
}


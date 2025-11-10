import { NextRequest, NextResponse } from 'next/server';
import { get } from '@vercel/edge-config';

/**
 * Verify authentication token
 * GET /api/auth/verify?token=xxx
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const token = searchParams.get('token');

    if (!token) {
      return NextResponse.json(
        { error: 'Token required' },
        { status: 400 }
      );
    }

    const userKey = `user:${token}`;
    const userConfig = await get<any>(userKey);

    if (!userConfig) {
      return NextResponse.json(
        { error: 'Invalid token' },
        { status: 401 }
      );
    }

    // Update last active time
    const updatedConfig = {
      ...userConfig,
      lastActive: Date.now(),
    };

    // Note: Updating requires Edge Config API, which we'll handle in a separate endpoint
    // For now, just return the config

    return NextResponse.json({
      success: true,
      user: {
        token: userConfig.token,
        hasCredentials: !!(userConfig.bybitApiKey && userConfig.bybitApiSecret),
        testnet: userConfig.testnet !== undefined ? userConfig.testnet : true,
        createdAt: userConfig.createdAt,
        lastActive: userConfig.lastActive,
      },
    });
  } catch (error) {
    console.error('Verify error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Verification failed' },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { get } from '@vercel/edge-config';

/**
 * Get bot state
 * GET /api/bot/state?token=xxx
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

    // Verify token first
    const userKey = `user:${token}`;
    const userConfig = await get<any>(userKey);

    if (!userConfig) {
      return NextResponse.json(
        { error: 'Invalid token' },
        { status: 401 }
      );
    }

    // Get bot state
    const botKey = `bot:${token}`;
    const botState = await get<any>(botKey);

    return NextResponse.json({
      success: true,
      state: botState || null,
    });
  } catch (error) {
    console.error('Get bot state error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get bot state' },
      { status: 500 }
    );
  }
}

/**
 * Update bot state
 * POST /api/bot/state
 * Body: { token: string, state: Partial<BotState> }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { token, state } = body;

    if (!token) {
      return NextResponse.json(
        { error: 'Token required' },
        { status: 400 }
      );
    }

    // Verify token
    const userKey = `user:${token}`;
    const userConfig = await get<any>(userKey);

    if (!userConfig) {
      return NextResponse.json(
        { error: 'Invalid token' },
        { status: 401 }
      );
    }

    // Update bot state via Edge Config API
    const edgeConfigToken = process.env.EDGE_CONFIG_TOKEN;
    const edgeConfigUrl = process.env.EDGE_CONFIG_URL;

    if (!edgeConfigToken || !edgeConfigUrl) {
      return NextResponse.json(
        { error: 'Edge Config not configured' },
        { status: 500 }
      );
    }

    const botKey = `bot:${token}`;
    
    // Get existing state and merge
    const existingState = await get<any>(botKey);
    const updatedState = {
      ...existingState,
      ...state,
      userId: token,
      lastPollTime: Date.now(),
    };

    try {
      // Extract connection string ID from URL
      const connectionStringId = edgeConfigUrl.split('/').pop()?.split('?')[0];
      
      const response = await fetch(
        `https://api.vercel.com/v1/edge-config/${connectionStringId}/items`,
        {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${edgeConfigToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            items: [
              {
                operation: 'upsert',
                key: botKey,
                value: updatedState,
              },
            ],
          }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Edge Config API error:', errorText);
        return NextResponse.json(
          { error: 'Failed to update bot state' },
          { status: 500 }
        );
      }

      return NextResponse.json({
        success: true,
        state: updatedState,
      });
    } catch (error) {
      console.error('Error updating bot state:', error);
      return NextResponse.json(
        { error: 'Failed to update bot state' },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('Update bot state error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update bot state' },
      { status: 500 }
    );
  }
}

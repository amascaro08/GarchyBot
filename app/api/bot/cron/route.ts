import { NextRequest, NextResponse } from 'next/server';
import { get } from '@vercel/edge-config';

/**
 * Cron endpoint for automated bot execution
 * This endpoint is called by Vercel Cron and runs bots for all active users
 * GET /api/bot/cron
 * 
 * Note: This endpoint should be protected with a secret header in production
 */
export async function GET(request: NextRequest) {
  try {
    // Optional: Verify cron secret header for security
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;
    
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Get all user tokens from Edge Config
    // Note: Edge Config doesn't support listing all keys directly
    // We'll need to maintain a list of active tokens or use a different approach
    // For now, we'll use a special key that stores active tokens
    
    const activeTokensKey = 'active_tokens';
    let activeTokens: string[] = [];
    try {
      const activeTokensStr = await get<string>(activeTokensKey);
      if (activeTokensStr) {
        activeTokens = JSON.parse(activeTokensStr);
      }
    } catch (e) {
      // No active tokens yet
    }

    if (activeTokens.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No active bots to run',
        count: 0,
      });
    }

    // Run bot for each active token
    const results = [];
    for (const token of activeTokens) {
      try {
        // Check if bot is running for this token
        const botKey = `bot:${token}`;
        const botState = await get<any>(botKey);
        
        if (!botState || !botState.botRunning) {
          continue;
        }

        // Trigger bot run
        const baseUrl = process.env.VERCEL_URL 
          ? `https://${process.env.VERCEL_URL}` 
          : request.nextUrl.origin;
        
        const runResponse = await fetch(`${baseUrl}/api/bot/run?token=${token}`, {
          headers: {
            'Authorization': `Bearer ${cronSecret || 'internal'}`,
          },
        });

        if (runResponse.ok) {
          const runData = await runResponse.json();
          results.push({
            token: token.substring(0, 8) + '...',
            success: true,
            signal: runData.signal,
            openTrades: runData.openTrades,
          });
        } else {
          results.push({
            token: token.substring(0, 8) + '...',
            success: false,
            error: await runResponse.text(),
          });
        }
      } catch (error) {
        results.push({
          token: token.substring(0, 8) + '...',
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return NextResponse.json({
      success: true,
      message: `Ran ${results.length} bots`,
      results,
    });
  } catch (error) {
    console.error('Cron error:', error);
    return NextResponse.json(
      { 
        success: false,
        error: error instanceof Error ? error.message : 'Cron execution failed' 
      },
      { status: 500 }
    );
  }
}

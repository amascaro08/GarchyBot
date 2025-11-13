import { NextRequest, NextResponse } from 'next/server';
import { getUserEmail, getUserId } from '@/lib/auth';
import { 
  getBotConfig, 
  getOpenTrades, 
  getAllTrades, 
  getActivityLogs,
  getOrCreateUser,
  calculateSessionPnL
} from '@/lib/db';

/**
 * Get the bot status, configuration, trades, and logs for the authenticated user
 * GET /api/bot/status
 */
export async function GET(request: NextRequest) {
  try {
    const userId = await getUserId();
    const userEmail = await getUserEmail();
    
    if (!userId || !userEmail) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Ensure user exists in database
    const user = await getOrCreateUser(userEmail, userId);

    // Get bot config, create if it doesn't exist
    let botConfig = await getBotConfig(user.id);
    
    if (!botConfig) {
      // Create default bot config if it doesn't exist
      const { createBotConfig } = await import('@/lib/db');
      botConfig = await createBotConfig(user.id);
    }

    // Get trades and logs
    const [openTrades, allTrades, activityLogs, sessionPnL] = await Promise.all([
      getOpenTrades(user.id, botConfig.id),
      getAllTrades(user.id, 100),
      getActivityLogs(user.id, 50),
      calculateSessionPnL(user.id),
    ]);

    return NextResponse.json({
      success: true,
      botConfig,
      openTrades,
      allTrades,
      activityLogs,
      sessionPnL,
    }, {
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      },
    });
  } catch (error) {
    console.error('Error getting bot status:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get bot status' },
      { status: 500 }
    );
  }
}

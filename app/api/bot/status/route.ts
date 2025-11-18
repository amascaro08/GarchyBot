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

    // Fetch ALL active positions from Bybit if API keys are configured
    let bybitPositions: any[] = [];
    let totalActivePositions = openTrades.length;
    
    if (botConfig.api_key && botConfig.api_secret) {
      try {
        const { fetchAllPositions } = await import('@/lib/bybit');
        const positionsData = await fetchAllPositions({
          testnet: botConfig.api_mode !== 'live',
          apiKey: botConfig.api_key,
          apiSecret: botConfig.api_secret,
          settleCoin: 'USDT',
        });
        
        // Filter for actual open positions (size > 0)
        if (positionsData?.result?.list) {
          bybitPositions = positionsData.result.list
            .filter((pos: any) => parseFloat(pos.size || '0') !== 0)
            .map((pos: any) => ({
              symbol: pos.symbol,
              side: pos.side === 'Buy' ? 'LONG' : 'SHORT',
              size: parseFloat(pos.size || '0'),
              avgPrice: parseFloat(pos.avgPrice || '0'),
              markPrice: parseFloat(pos.markPrice || '0'),
              leverage: parseFloat(pos.leverage || '1'),
              unrealisedPnl: parseFloat(pos.unrealisedPnl || '0'),
              takeProfit: parseFloat(pos.takeProfit || '0') || null,
              stopLoss: parseFloat(pos.stopLoss || '0') || null,
              positionValue: parseFloat(pos.positionValue || '0'),
              createdTime: pos.createdTime,
            }));
          
          // Total active positions = database positions + Bybit positions not in database
          // Count unique positions (some may be in both database and Bybit)
          const dbSymbols = new Set(openTrades.map(t => t.symbol));
          const externalPositions = bybitPositions.filter(p => !dbSymbols.has(p.symbol));
          totalActivePositions = openTrades.length + externalPositions.length;
          
          console.log(`[BOT STATUS] Active positions: ${totalActivePositions} (DB: ${openTrades.length}, Bybit external: ${externalPositions.length})`);
        }
      } catch (error) {
        console.warn('[BOT STATUS] Failed to fetch Bybit positions:', error);
        // Continue without Bybit positions - will only show database trades
      }
    }

    return NextResponse.json({
      success: true,
      botConfig,
      openTrades,
      allTrades,
      activityLogs,
      sessionPnL,
      bybitPositions,
      totalActivePositions,
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

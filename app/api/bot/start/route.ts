import { NextRequest, NextResponse } from 'next/server';
import { getUserEmail, getUserId } from '@/lib/auth';
import { getBotConfig, startBot, getOrCreateUser, addActivityLog, resetDailyPnLForUser } from '@/lib/db';

/**
 * Start the trading bot for the authenticated user
 * POST /api/bot/start
 */
export async function POST(request: NextRequest) {
  try {
    const userId = await getUserId();
    const userEmail = await getUserEmail();
    
    if (!userId || !userEmail) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Ensure user exists in database
    const user = await getOrCreateUser(userEmail, userId);

    let overrideLimits = false;
    try {
      const body = await request.json();
      overrideLimits = Boolean(body?.overrideDailyLimits);
    } catch {
      // no body provided
    }

    // Get bot config, create if it doesn't exist
    let botConfig = await getBotConfig(user.id);
    
    if (!botConfig) {
      // Create default bot config if it doesn't exist
      const { createBotConfig } = await import('@/lib/db');
      botConfig = await createBotConfig(user.id);
    }

    // Check daily limits - if hit, automatically reset and start new session
    const dailyTargetValue = botConfig.daily_target_type === 'percent'
      ? (botConfig.capital * botConfig.daily_target_amount) / 100
      : botConfig.daily_target_amount;

    const dailyStopValue = botConfig.daily_stop_type === 'percent'
      ? (botConfig.capital * botConfig.daily_stop_amount) / 100
      : botConfig.daily_stop_amount;

    const dailyPnL = Number(botConfig.daily_pnl) || 0;
    const isDailyTargetHit = dailyPnL >= dailyTargetValue && dailyTargetValue > 0;
    const isDailyStopHit = dailyPnL <= -dailyStopValue && dailyStopValue > 0;

    // If user explicitly clicks "Start Bot", always allow it - reset limits and start new session
    if (isDailyTargetHit || isDailyStopHit) {
      const limitType = isDailyTargetHit ? 'target' : 'stop loss';
      const previousPnL = Number(botConfig.daily_pnl) || 0;
      
      // Always reset when user explicitly starts the bot
      botConfig = await resetDailyPnLForUser(user.id);
      await addActivityLog(
        user.id,
        'info',
        `Daily ${limitType} reached (P&L: $${previousPnL.toFixed(2)}). Starting new session with P&L reset to $0`,
        { previousPnL, limitType },
        botConfig.id
      );
      
      console.log(`[BOT START] Daily ${limitType} hit (P&L: $${previousPnL.toFixed(2)}), resetting and starting new session`);
    }

    // Start the bot
    botConfig = await startBot(user.id);
    await addActivityLog(user.id, 'success', `Bot started for ${botConfig.symbol}`, null, botConfig.id);

    return NextResponse.json({
      success: true,
      botConfig,
    });
  } catch (error) {
    console.error('Error starting bot:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to start bot' },
      { status: 500 }
    );
  }
}

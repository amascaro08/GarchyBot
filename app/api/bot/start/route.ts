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

    // Get bot config
    let botConfig = await getBotConfig(user.id);
    
    if (!botConfig) {
      return NextResponse.json({ error: 'Bot configuration not found' }, { status: 404 });
    }

    // Check daily limits
    const dailyTargetValue = botConfig.daily_target_type === 'percent'
      ? (botConfig.capital * botConfig.daily_target_amount) / 100
      : botConfig.daily_target_amount;

    const dailyStopValue = botConfig.daily_stop_type === 'percent'
      ? (botConfig.capital * botConfig.daily_stop_amount) / 100
      : botConfig.daily_stop_amount;

    const isDailyTargetHit = botConfig.daily_pnl >= dailyTargetValue && dailyTargetValue > 0;
    const isDailyStopHit = botConfig.daily_pnl <= -dailyStopValue && dailyStopValue > 0;

    if (isDailyTargetHit || isDailyStopHit) {
      if (!overrideLimits) {
        const errorMsg = isDailyTargetHit
          ? 'Daily target reached. Cannot start bot.'
          : 'Daily stop loss hit. Cannot start bot.';
        return NextResponse.json(
          { error: errorMsg },
          { status: 400 }
        );
      }

      botConfig = await resetDailyPnLForUser(user.id);
      await addActivityLog(
        user.id,
        'info',
        `Daily limits reset manually. New session started with P&L = 0`,
        null,
        botConfig.id
      );
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

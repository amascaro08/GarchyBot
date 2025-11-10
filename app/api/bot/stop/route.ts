import { NextRequest, NextResponse } from 'next/server';
import { getUserEmail, getUserId } from '@/lib/auth';
import { stopBot, getOrCreateUser, addActivityLog, getBotConfig } from '@/lib/db';

/**
 * Stop the trading bot for the authenticated user
 * POST /api/bot/stop
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

    // Stop the bot
    const botConfig = await stopBot(user.id);
    await addActivityLog(user.id, 'warning', 'Bot stopped by user', null, botConfig.id);

    return NextResponse.json({
      success: true,
      botConfig,
    });
  } catch (error) {
    console.error('Error stopping bot:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to stop bot' },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { getUserEmail, getUserId } from '@/lib/auth';
import { getBotConfig, updateBotConfig, getOrCreateUser, addActivityLog } from '@/lib/db';
import type { BotConfig } from '@/lib/db';

/**
 * Get or update bot configuration for the authenticated user
 * GET /api/bot/config - Get current config
 * POST /api/bot/config - Update config
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

    // Get bot config
    const botConfig = await getBotConfig(user.id);
    
    if (!botConfig) {
      return NextResponse.json({ error: 'Bot configuration not found' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      botConfig,
    });
  } catch (error) {
    console.error('Error getting bot config:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get bot config' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = await getUserId();
    const userEmail = await getUserEmail();
    
    if (!userId || !userEmail) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Ensure user exists in database
    const user = await getOrCreateUser(userEmail, userId);

    // Get update payload
    const body = await request.json();
    
    // Validate and sanitize updates (only allow safe fields)
    const allowedUpdates: Partial<BotConfig> = {};
    const safeFields = [
      'symbol', 'candle_interval', 'max_trades', 'leverage', 'capital',
      'risk_amount', 'risk_type', 'daily_target_type', 'daily_target_amount',
      'daily_stop_type', 'daily_stop_amount', 'garch_mode', 'custom_k_pct',
      'use_orderbook_confirm', 'use_daily_open_entry', 'subdivisions', 'no_trade_band_pct'
    ];

    for (const field of safeFields) {
      if (body[field] !== undefined) {
        (allowedUpdates as any)[field] = body[field];
      }
    }

    // Update bot config
    const botConfig = await updateBotConfig(user.id, allowedUpdates);
    await addActivityLog(user.id, 'info', 'Bot configuration updated', allowedUpdates, botConfig.id);

    return NextResponse.json({
      success: true,
      botConfig,
    });
  } catch (error) {
    console.error('Error updating bot config:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update bot config' },
      { status: 500 }
    );
  }
}

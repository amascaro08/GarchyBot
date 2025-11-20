import { NextRequest, NextResponse } from 'next/server';
import { fetchWalletBalance } from '@/lib/bybit';
import { getUserByEmail } from '@/lib/db';
import { auth } from '@clerk/nextjs/server';

/**
 * GET /api/bybit/balance
 * Fetch Bybit wallet balance for the current user
 */
export async function GET(request: NextRequest) {
  try {
    const { userId: clerkUserId } = await auth();

    if (!clerkUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get user from database using Clerk ID
    const { user } = await getUserByEmail(clerkUserId);

    if (!user || !user.api_key || !user.api_secret) {
      return NextResponse.json(
        { error: 'API credentials not configured' },
        { status: 400 }
      );
    }

    // Fetch wallet balance from Bybit
    const balanceData = await fetchWalletBalance({
      apiKey: user.api_key,
      apiSecret: user.api_secret,
      testnet: user.api_mode !== 'live',
      accountType: 'UNIFIED', // Use unified trading account
    });

    if (balanceData.retCode !== 0) {
      throw new Error(`Bybit API error: ${balanceData.retMsg}`);
    }

    // Extract USDT balance
    const account = balanceData.result?.list?.[0];
    if (!account) {
      return NextResponse.json(
        { error: 'No account data found' },
        { status: 404 }
      );
    }

    // Find USDT coin balance
    const usdtCoin = account.coin?.find((c: any) => c.coin === 'USDT');
    const totalBalance = parseFloat(account.totalEquity || '0');
    const availableBalance = parseFloat(usdtCoin?.availableToWithdraw || usdtCoin?.walletBalance || '0');
    const totalWalletBalance = parseFloat(usdtCoin?.walletBalance || '0');
    const unrealizedPnL = parseFloat(usdtCoin?.unrealisedPnl || '0');

    return NextResponse.json({
      success: true,
      balance: {
        total: totalBalance,
        available: availableBalance,
        wallet: totalWalletBalance,
        unrealizedPnL: unrealizedPnL,
        currency: 'USDT',
      },
    });
  } catch (error) {
    console.error('[Bybit Balance API] Error:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to fetch balance',
      },
      { status: 500 }
    );
  }
}

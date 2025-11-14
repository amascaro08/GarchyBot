import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserEmail, getUserId } from '@/lib/auth';
import {
  addActivityLog,
  createTrade,
  getBotConfig,
  getOrCreateUser,
  BotConfig,
  Trade as DbTrade,
} from '@/lib/db';
import { placeOrder } from '@/lib/bybit';

const CreateTradeSchema = z.object({
  symbol: z.string(),
  side: z.enum(['LONG', 'SHORT']),
  entry: z.number().positive(),
  tp: z.number().positive(),
  sl: z.number().positive(),
  positionSize: z.number().nonnegative(),
  leverage: z.number().positive().optional(),
  reason: z.string().max(500).optional(),
});

type CreateTradePayload = z.infer<typeof CreateTradeSchema>;

function serializeTrade(record: DbTrade): {
  id: string;
  time: string;
  side: 'LONG' | 'SHORT';
  entry: number;
  tp: number;
  sl: number;
  initialSl: number;
  reason: string;
  status: DbTrade['status'];
  symbol: string;
  leverage: number;
  positionSize: number;
  exitPrice?: number;
} {
  return {
    id: record.id,
    time: record.entry_time.toISOString(),
    side: record.side,
    entry: Number(record.entry_price),
    tp: Number(record.tp_price),
    sl: Number(record.current_sl ?? record.sl_price),
    initialSl: Number(record.sl_price),
    reason: record.reason || '',
    status: record.status,
    symbol: record.symbol,
    leverage: Number(record.leverage),
    positionSize: Number(record.position_size),
    exitPrice: record.exit_price !== null ? Number(record.exit_price) : undefined,
  };
}

async function ensureUserAndConfig(): Promise<{ userId: string; email: string; botConfig: BotConfig }> {
  const authId = await getUserId();
  const email = await getUserEmail();

  if (!authId || !email) {
    throw new Error('Unauthorized');
  }

  const user = await getOrCreateUser(email, authId);
  const botConfig = await getBotConfig(user.id);

  if (!botConfig) {
    throw new Error('Bot configuration not found');
  }

  return { userId: user.id, email, botConfig };
}

export async function POST(request: NextRequest) {
  try {
    const { userId, botConfig } = await ensureUserAndConfig();

    const payloadJson = await request.json();
    const payload: CreateTradePayload = CreateTradeSchema.parse(payloadJson);

    const now = new Date();
    const leverage = payload.leverage ?? botConfig.leverage;

    let tradeRecord = await createTrade({
      user_id: userId,
      bot_config_id: botConfig.id,
      symbol: payload.symbol,
      side: payload.side,
      status: 'pending',
      entry_price: payload.entry,
      tp_price: payload.tp,
      sl_price: payload.sl,
      current_sl: payload.sl,
      exit_price: null,
      position_size: payload.positionSize,
      leverage,
      pnl: 0,
      reason: payload.reason || null,
      order_id: null, // Will be set after order is placed
      entry_time: now,
      exit_time: null,
    });

    await addActivityLog(
      userId,
      'success',
      `Limit order placed: ${payload.side} @ $${payload.entry.toFixed(2)}, TP $${payload.tp.toFixed(2)}, SL $${payload.sl.toFixed(2)}`,
      {
        symbol: payload.symbol,
        positionSize: payload.positionSize,
        leverage,
      },
      botConfig.id
    );

    let orderResult: any = null;
    // Recalculate trade value and position size from capital and leverage (the source of truth)
    // Trade value = capital * leverage (e.g., $2 * 50x = $100 USDT)
    // Position size = trade value / entry price (e.g., $100 / $99,629 = 0.001003 BTC)
    const tradeValueUSDT = botConfig.capital * leverage;
    const entryPrice = payload.entry;
    const calculatedPositionSize = entryPrice > 0 ? tradeValueUSDT / entryPrice : 0;
    const orderQty = Math.max(0, Number.isFinite(calculatedPositionSize) ? calculatedPositionSize : 0);
    const requiredMargin = tradeValueUSDT / leverage;
    
    // Log the calculation to verify it's correct
    console.log(`[TRADE] Position size calculation: capital=$${botConfig.capital}, leverage=${leverage}x, tradeValue=$${tradeValueUSDT.toFixed(2)} USDT, entryPrice=$${entryPrice.toFixed(2)}, calculatedPositionSize=${calculatedPositionSize.toFixed(8)}, orderQty=${orderQty.toFixed(8)}`);
    
    console.log(`[TRADE] Attempting to place order: symbol=${payload.symbol}, side=${payload.side}, qty=${orderQty}, price=${payload.entry}, tradeValue=$${tradeValueUSDT.toFixed(2)} USDT, leverage=${leverage}x, requiredMargin=$${requiredMargin.toFixed(2)} USDT, testnet=${botConfig.api_mode !== 'live'}, hasApiKey=${!!botConfig.api_key}, hasApiSecret=${!!botConfig.api_secret}`);
    
    // Check available balance before attempting order
    if (botConfig.api_key && botConfig.api_secret) {
      try {
        const { fetchWalletBalance } = await import('@/lib/bybit');
        const walletInfo = await fetchWalletBalance({
          apiKey: botConfig.api_key,
          apiSecret: botConfig.api_secret,
          testnet: botConfig.api_mode !== 'live',
          accountType: 'UNIFIED',
        });
        
        // Extract available USDT balance
        const usdtCoin = walletInfo.result?.list?.[0]?.coin?.find((c: any) => c.coin === 'USDT');
        const availableBalance = parseFloat(usdtCoin?.availableToWithdraw || usdtCoin?.availableBalance || '0');
        const equity = parseFloat(usdtCoin?.equity || '0');
        
        console.log(`[TRADE] Account balance check: Available: $${availableBalance.toFixed(2)} USDT, Equity: $${equity.toFixed(2)} USDT, Required margin: $${requiredMargin.toFixed(2)} USDT`);
        
        // For futures, we need initial margin which might be higher than just notional/leverage
        // Bybit typically requires a bit more than the calculated margin for safety
        // Also account for potential maintenance margin and fees (typically 10-20% buffer needed)
        const marginBuffer = 1.15; // 15% buffer for fees and safety margin
        const totalRequiredMargin = requiredMargin * marginBuffer;
        
        if (availableBalance < totalRequiredMargin) {
          const errorMsg = `Insufficient balance. Available: $${availableBalance.toFixed(2)} USDT, Required margin: $${requiredMargin.toFixed(2)} USDT + buffer (total: $${totalRequiredMargin.toFixed(2)} USDT needed)`;
          console.warn(`[TRADE] ${errorMsg}`);
          await addActivityLog(
            userId,
            'warning',
            `Balance check warning: ${errorMsg}. Will still attempt order - Bybit will reject if insufficient.`,
            { symbol: payload.symbol, side: payload.side, availableBalance, requiredMargin, leverage, tradeValueUSDT, totalRequiredMargin },
            botConfig.id
          );
          // Don't throw - let Bybit decide if there's enough balance
        } else {
          console.log(`[TRADE] Balance check passed. Available: $${availableBalance.toFixed(2)} USDT, Required: $${totalRequiredMargin.toFixed(2)} USDT. Proceeding with order placement...`);
        }
      } catch (balanceError) {
        console.warn(`[TRADE] Failed to check balance, proceeding anyway:`, balanceError);
        // Continue with order placement if balance check fails
      }
    }
    
    if (botConfig.api_key && botConfig.api_secret && orderQty > 0) {
      try {
        console.log(`[TRADE] Calling placeOrder with qty=${orderQty}...`);
        orderResult = await placeOrder({
          symbol: payload.symbol,
          side: payload.side === 'LONG' ? 'Buy' : 'Sell',
          qty: orderQty,
          price: payload.entry,
          testnet: botConfig.api_mode !== 'live',
          apiKey: botConfig.api_key,
          apiSecret: botConfig.api_secret,
          timeInForce: 'GTC', // Good Till Cancel - matches Bybit API format
          positionIdx: 0, // One-way mode
        });

        console.log(`[TRADE] Order placement response:`, JSON.stringify(orderResult, null, 2));

        // Check if order was actually created successfully on Bybit
        // For mainnet, ONLY mark as 'open' if order was confirmed by Bybit
        if (orderResult?.retCode === 0 && orderResult?.result?.orderId) {
          const { updateTrade } = await import('@/lib/db');
          const orderId = orderResult.result.orderId;
          
          // Only mark as 'open' if we're in live mode (mainnet) and order was successfully placed
          // For demo/testnet, we can still mark as open for testing purposes
          if (botConfig.api_mode === 'live') {
            // On mainnet, only mark as open if order was successfully placed
            tradeRecord = await updateTrade(tradeRecord.id, {
              status: 'open',
              order_id: orderId,
            } as any);
            
            console.log(`[TRADE] Trade marked as 'open' on mainnet. Order ID: ${orderId}`);
          } else {
            // For testnet/demo, still mark as open but note it's not real
            tradeRecord = await updateTrade(tradeRecord.id, {
              status: 'open',
              order_id: orderId,
            } as any);
            
            console.log(`[TRADE] Trade marked as 'open' on testnet. Order ID: ${orderId}`);
          }

          await addActivityLog(
            userId,
            'success',
            `Limit order sent to Bybit (${botConfig.api_mode.toUpperCase()}): ${payload.side} ${payload.symbol} qty ${payload.positionSize}, Order ID: ${orderId}`,
            { orderResult, orderId },
            botConfig.id
          );
        } else {
          // Order was rejected by Bybit - keep status as 'pending' and log error
          const errorMsg = orderResult?.retMsg || 'Unknown error';
          const retCode = orderResult?.retCode || 'N/A';
          console.error(`[TRADE] Bybit rejected order - keeping trade as 'pending'. retCode: ${retCode}, retMsg: ${errorMsg}`);
          throw new Error(`Bybit rejected order (retCode: ${retCode}): ${errorMsg}`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error placing order';
        const errorDetails = error instanceof Error ? error.stack : String(error);
        console.error(`[TRADE] Order placement failed:`, message);
        console.error(`[TRADE] Error details:`, errorDetails);
        
        // Check for insufficient balance error and provide helpful message
        let userFriendlyMessage = message;
        if (message.includes('110007') || message.includes('not enough')) {
          const requiredMargin = tradeValueUSDT / leverage;
          userFriendlyMessage = `Insufficient balance. Trade value: $${tradeValueUSDT.toFixed(2)} USDT, Required margin (${leverage}x leverage): ~$${requiredMargin.toFixed(2)} USDT. Please check your available balance on Bybit.`;
        }
        
        // On mainnet, ensure trade stays as 'pending' if order placement failed
        // Only mark as 'open' when order is actually confirmed by Bybit
        await addActivityLog(
          userId,
          'error',
          `Bybit order failed (trade remains 'pending'): ${userFriendlyMessage}`,
          { symbol: payload.symbol, side: payload.side, qty: payload.positionSize, error: message, errorDetails, tradeValueUSDT, apiMode: botConfig.api_mode },
          botConfig.id
        );
        
        // For mainnet, ensure trade status is NOT 'open' if order failed
        if (botConfig.api_mode === 'live' && tradeRecord.status === 'open') {
          console.warn(`[TRADE] Order failed on mainnet but trade status was 'open'. Reverting to 'pending'.`);
          const { updateTrade } = await import('@/lib/db');
          tradeRecord = await updateTrade(tradeRecord.id, {
            status: 'pending',
          } as any);
        }
        // Don't throw - allow trade to remain in 'pending' status
        // This way user can see the error in activity logs
      }
    }

    return NextResponse.json({
      success: true,
      trade: serializeTrade(tradeRecord),
      orderResult,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: 'Invalid request body', details: error.errors },
        { status: 400 }
      );
    }

    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    if (error instanceof Error && error.message === 'Bot configuration not found') {
      return NextResponse.json({ success: false, error: error.message }, { status: 404 });
    }

    console.error('Error creating trade:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to create trade' },
      { status: 500 }
    );
  }
}


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
  pnl?: number;
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
    pnl: record.pnl !== null && record.pnl !== undefined ? Number(record.pnl) : undefined,
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

    // Calculate actual capital to use based on risk_type and risk_amount
    // If risk_type is 'percent', use percentage of capital
    // If risk_type is 'fixed', use fixed risk_amount
    let capitalToUse: number;
    if (botConfig.risk_type === 'percent') {
      // risk_amount is a percentage (e.g., 20 means 20%)
      capitalToUse = botConfig.capital * (botConfig.risk_amount / 100);
    } else {
      // risk_type is 'fixed', risk_amount is the fixed amount to use
      capitalToUse = botConfig.risk_amount;
    }
    
    // Ensure we don't exceed available capital
    capitalToUse = Math.min(capitalToUse, botConfig.capital);
    
    // Calculate position size from capital and leverage (the source of truth)
    // Trade value = capital * leverage (e.g., $4 * 50x = $200 USDT)
    // Position size = trade value / entry price (e.g., $200 / $99,629 = 0.002006 BTC)
    const tradeValueUSDT = capitalToUse * leverage;
    const entryPrice = payload.entry;
    const calculatedPositionSize = entryPrice > 0 ? tradeValueUSDT / entryPrice : 0;
    const storedPositionSize = calculatedPositionSize > 0 ? calculatedPositionSize : payload.positionSize;
    
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
      position_size: storedPositionSize, // Use calculated position size
      leverage,
      pnl: 0,
      reason: payload.reason || null,
      order_id: null, // Will be set after order is placed
      entry_time: now,
      exit_time: null,
    });
    
    console.log(`[TRADE] Trade created with position_size: ${storedPositionSize.toFixed(8)} (risk_type: ${botConfig.risk_type}, capital: $${botConfig.capital}, risk_amount: ${botConfig.risk_amount}${botConfig.risk_type === 'percent' ? '%' : '$'}, capital_to_use: $${capitalToUse.toFixed(2)}, leverage: ${leverage}x, entry: $${payload.entry.toFixed(2)})`);

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
    // Use the already calculated position size (calculated above)
    const orderQty = Math.max(0, Number.isFinite(calculatedPositionSize) ? calculatedPositionSize : 0);
    const requiredMargin = tradeValueUSDT / leverage;
    
    // Log the calculation to verify it's correct
    console.log(`[TRADE] Position size calculation: risk_type=${botConfig.risk_type}, capital=$${botConfig.capital}, risk_amount=${botConfig.risk_amount}${botConfig.risk_type === 'percent' ? '%' : '$'}, capital_to_use=$${capitalToUse.toFixed(2)}, leverage=${leverage}x, tradeValue=$${tradeValueUSDT.toFixed(2)} USDT, entryPrice=$${entryPrice.toFixed(2)}, calculatedPositionSize=${calculatedPositionSize.toFixed(8)}, orderQty=${orderQty.toFixed(8)}, requiredMargin=$${requiredMargin.toFixed(2)} USDT`);
    
    console.log(`[TRADE] Attempting to place order: symbol=${payload.symbol}, side=${payload.side}, qty=${orderQty}, price=${payload.entry}, tradeValue=$${tradeValueUSDT.toFixed(2)} USDT (capital_to_use: $${capitalToUse.toFixed(2)} * leverage: ${leverage}x), requiredMargin=$${requiredMargin.toFixed(2)} USDT, testnet=${botConfig.api_mode !== 'live'}, hasApiKey=${!!botConfig.api_key}, hasApiSecret=${!!botConfig.api_secret}`);
    
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
        
        // For Bybit futures, the required margin is the notional value / leverage
        // Bybit may add a small maintenance margin buffer, but typically it's close to notional/leverage
        // Add a small 5% buffer for fees and safety (reduced from 15% which was too conservative)
        const marginBuffer = 1.05; // 5% buffer for fees and safety margin
        const totalRequiredMargin = requiredMargin * marginBuffer;
        
        console.log(`[TRADE] Account balance check: Available: $${availableBalance.toFixed(2)} USDT, Equity: $${equity.toFixed(2)} USDT, Capital to use: $${capitalToUse.toFixed(2)}, Required margin: $${requiredMargin.toFixed(2)} USDT, With buffer (5%): $${totalRequiredMargin.toFixed(2)} USDT`);
        
        if (availableBalance < totalRequiredMargin) {
          const errorMsg = `Insufficient balance. Available: $${availableBalance.toFixed(2)} USDT, Required margin: $${requiredMargin.toFixed(2)} USDT + 5% buffer = $${totalRequiredMargin.toFixed(2)} USDT needed`;
          console.warn(`[TRADE] ${errorMsg}`);
          console.warn(`[TRADE] Calculation breakdown: capital=$${botConfig.capital}, risk_type=${botConfig.risk_type}, risk_amount=${botConfig.risk_amount}, capital_to_use=$${capitalToUse.toFixed(2)}, leverage=${leverage}x, trade_value=$${tradeValueUSDT.toFixed(2)} USDT, margin=$${requiredMargin.toFixed(2)}`);
          
          await addActivityLog(
            userId,
            'warning',
            `Balance check: ${errorMsg}. Will still attempt order - Bybit will reject if insufficient.`,
            { 
              symbol: payload.symbol, 
              side: payload.side, 
              availableBalance, 
              requiredMargin, 
              totalRequiredMargin,
              capital: botConfig.capital,
              capitalToUse,
              riskType: botConfig.risk_type,
              riskAmount: botConfig.risk_amount,
              leverage, 
              tradeValueUSDT 
            },
            botConfig.id
          );
          // Don't throw - let Bybit decide if there's enough balance
        } else {
          console.log(`[TRADE] Balance check passed. Available: $${availableBalance.toFixed(2)} USDT, Required: $${totalRequiredMargin.toFixed(2)} USDT (margin: $${requiredMargin.toFixed(2)} + 5% buffer). Proceeding with order placement...`);
        }
      } catch (balanceError) {
        console.warn(`[TRADE] Failed to check balance, proceeding anyway:`, balanceError);
        // Continue with order placement if balance check fails
      }
    }
    
    if (botConfig.api_key && botConfig.api_secret && orderQty > 0) {
      try {
        // Round entry price to match Bybit's tick size (price precision)
        // This ensures the order price exactly matches the calculated level
        let roundedEntryPrice = payload.entry;
        try {
          const { getInstrumentInfo, roundPrice } = await import('@/lib/bybit');
          const instrumentInfo = await getInstrumentInfo(payload.symbol, botConfig.api_mode !== 'live');
          if (instrumentInfo && instrumentInfo.tickSize) {
            roundedEntryPrice = roundPrice(payload.entry, instrumentInfo.tickSize);
            if (Math.abs(roundedEntryPrice - payload.entry) > 0.0001) {
              console.log(`[TRADE] Rounded entry price from ${payload.entry.toFixed(8)} to ${roundedEntryPrice.toFixed(8)} to match Bybit tick size ${instrumentInfo.tickSize}`);
            }
          }
        } catch (priceRoundError) {
          console.warn(`[TRADE] Failed to round price, using original:`, priceRoundError);
          // Continue with original price if rounding fails
        }
        
        console.log(`[TRADE] Calling placeOrder with qty=${orderQty}, price=${roundedEntryPrice} (original: ${payload.entry})...`);
        orderResult = await placeOrder({
          symbol: payload.symbol,
          side: payload.side === 'LONG' ? 'Buy' : 'Sell',
          qty: orderQty,
          price: roundedEntryPrice, // Use rounded price to match Bybit precision
          testnet: botConfig.api_mode !== 'live',
          apiKey: botConfig.api_key,
          apiSecret: botConfig.api_secret,
          timeInForce: 'GTC', // Good Till Cancel - matches Bybit API format
          positionIdx: 0, // One-way mode
        });

        console.log(`[TRADE] Order placement response:`, JSON.stringify(orderResult, null, 2));

        // Check if order was actually created successfully on Bybit
        // IMPORTANT: Don't mark as 'open' yet - LIMIT orders are pending until filled!
        // Status should remain 'pending' until the order is actually filled
        if (orderResult?.retCode === 0 && orderResult?.result?.orderId) {
          const { updateTrade } = await import('@/lib/db');
          const orderId = orderResult.result.orderId;
          
          // Store order ID but keep status as 'pending' - order hasn't filled yet
          tradeRecord = await updateTrade(tradeRecord.id, {
            order_id: orderId,
            // Keep status as 'pending' - will be updated to 'open' when order fills
          } as any);
          
          console.log(`[TRADE] Limit order placed on Bybit (${botConfig.api_mode.toUpperCase()}). Order ID: ${orderId}, Status: PENDING (will update to OPEN when filled)`);
          console.log(`[TRADE] Note: TP/SL will be set automatically when the order fills and position is opened`);

          await addActivityLog(
            userId,
            'success',
            `Limit order sent to Bybit (${botConfig.api_mode.toUpperCase()}): ${payload.side} ${payload.symbol} qty ${orderQty.toFixed(8)}, Order ID: ${orderId}`,
            { orderResult, orderId, orderQty },
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


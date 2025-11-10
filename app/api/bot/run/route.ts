import { NextRequest, NextResponse } from 'next/server';
import { get } from '@vercel/edge-config';
import { getKlines } from '@/lib/bybit';
import { dailyOpenUTC, vwapFromOHLCV, gridLevels, strictSignalWithDailyOpen, applyBreakeven } from '@/lib/strategy';
import { garch11 } from '@/lib/vol';
import type { Candle } from '@/lib/types';

/**
 * Background bot runner endpoint
 * This endpoint runs the bot logic server-side and can be triggered by Vercel Cron
 * GET /api/bot/run?token=xxx
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const token = searchParams.get('token');

    if (!token) {
      return NextResponse.json(
        { error: 'Token required' },
        { status: 400 }
      );
    }

    // Verify token and get user config
    const userKey = `user:${token}`;
    const userConfig = await get<any>(userKey);

    if (!userConfig) {
      return NextResponse.json(
        { error: 'Invalid token' },
        { status: 401 }
      );
    }

    // Get bot state
    const botKey = `bot:${token}`;
    const botState = await get<any>(botKey);

    if (!botState || !botState.botRunning) {
      return NextResponse.json({
        success: true,
        message: 'Bot is not running',
        state: botState,
      });
    }

    // Extract bot configuration
    const {
      symbol = 'BTCUSDT',
      candleInterval = '5',
      maxTrades = 3,
      leverage = 1,
      capital = 10000,
      riskAmount = 100,
      riskType = 'fixed',
      dailyTargetType = 'percent',
      dailyTargetAmount = 5,
      dailyStopType = 'percent',
      dailyStopAmount = 3,
      dailyPnL = 0,
      dailyStartDate,
      sessionPnL = 0,
      trades = [],
      garchMode = 'auto',
      customKPct = 0.03,
      useOrderBookConfirm = true,
    } = botState;

    // Check daily reset
    const today = new Date().toISOString().split('T')[0];
    let currentDailyPnL = dailyPnL;
    let currentDailyStartDate = dailyStartDate || today;
    let currentTrades = trades || [];
    let currentSessionPnL = sessionPnL;

    if (today !== currentDailyStartDate) {
      // Reset daily P&L
      currentDailyPnL = 0;
      currentDailyStartDate = today;
      currentTrades = [];
      currentSessionPnL = 0;
    }

    // Calculate daily limits
    const dailyTargetValue = dailyTargetType === 'percent' 
      ? (capital * dailyTargetAmount) / 100 
      : dailyTargetAmount;
    const dailyStopValue = dailyStopType === 'percent' 
      ? (capital * dailyStopAmount) / 100 
      : dailyStopAmount;

    // Check if daily limits are hit
    const isDailyTargetHit = currentDailyPnL >= dailyTargetValue && dailyTargetValue > 0;
    const isDailyStopHit = currentDailyPnL <= -dailyStopValue && dailyStopValue > 0;
    const canTrade = !isDailyTargetHit && !isDailyStopHit;

    if (!canTrade) {
      // Auto-stop bot
      const edgeConfigToken = process.env.EDGE_CONFIG_TOKEN;
      const edgeConfigUrl = process.env.EDGE_CONFIG_URL;

      if (edgeConfigToken && edgeConfigUrl) {
        // Extract connection string ID from URL
        const connectionStringId = edgeConfigUrl.split('/').pop()?.split('?')[0];
        
        await fetch(
          `https://api.vercel.com/v1/edge-config/${connectionStringId}/items`,
          {
            method: 'PATCH',
            headers: {
              'Authorization': `Bearer ${edgeConfigToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              items: [
                {
                  operation: 'upsert',
                  key: botKey,
                  value: {
                    ...botState,
                    botRunning: false,
                  },
                },
              ],
            }),
          }
        );
      }

      return NextResponse.json({
        success: true,
        message: isDailyTargetHit ? 'Daily target reached' : 'Daily stop loss hit',
        botRunning: false,
      });
    }

    // Fetch klines
    const testnet = userConfig.testnet !== undefined ? userConfig.testnet : true;
    let candles: Candle[];
    try {
      candles = await getKlines(symbol, candleInterval as any, 200, false); // Try mainnet first
    } catch (error) {
      candles = await getKlines(symbol, candleInterval as any, 200, testnet);
    }

    if (!candles || candles.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'No candle data available',
      });
    }

    // Fetch levels
    let daily, intraday;
    try {
      daily = await getKlines(symbol, 'D', 60, false);
      intraday = await getKlines(symbol, '5', 288, false);
    } catch (error) {
      daily = await getKlines(symbol, 'D', 60, testnet);
      intraday = await getKlines(symbol, '5', 288, testnet);
    }

    const intradayAsc = intraday.slice().reverse();
    const dailyAsc = daily.slice().reverse();
    
    let kPct: number;
    if (garchMode === 'custom') {
      kPct = customKPct;
    } else {
      const dailyCloses = dailyAsc.map(c => c.close);
      kPct = garch11(dailyCloses);
    }

    const dOpen = dailyOpenUTC(intradayAsc);
    const vwap = vwapFromOHLCV(intradayAsc);
    const { upLevels, dnLevels } = gridLevels(dOpen, kPct, 5); // Default subdivisions

    // Apply breakeven to open trades
    const lastClose = candles[candles.length - 1].close;
    currentTrades = currentTrades.map((t: any) => {
      if (t.status !== 'open') return t;
      const newSL = applyBreakeven(t.side, t.entry, t.sl, lastClose, vwap);
      return newSL !== t.sl ? { ...t, sl: newSL } : t;
    });

    // Calculate signal
    const signal = strictSignalWithDailyOpen({
      candles,
      vwap,
      dOpen,
      upLevels,
      dnLevels,
      noTradeBandPct: 0.001,
    });

    // Check for TP/SL hits
    const lastCandle = candles[candles.length - 1];
    let updatedTrades = [...currentTrades];
    let updatedDailyPnL = currentDailyPnL;
    let updatedSessionPnL = currentSessionPnL;

    updatedTrades = updatedTrades.map((trade: any) => {
      if (trade.status !== 'open') return trade;

      let newStatus = trade.status;
      let exitPrice: number | undefined;

      if (trade.side === 'LONG') {
        if (lastCandle.high >= trade.tp) {
          newStatus = 'tp';
          exitPrice = trade.tp;
        } else if (lastCandle.low <= trade.sl) {
          newStatus = 'sl';
          exitPrice = trade.sl;
        }
      } else {
        if (lastCandle.low <= trade.tp) {
          newStatus = 'tp';
          exitPrice = trade.tp;
        } else if (lastCandle.high >= trade.sl) {
          newStatus = 'sl';
          exitPrice = trade.sl;
        }
      }

      if (newStatus !== 'open' && exitPrice) {
        const positionSize = trade.positionSize || 0;
        const pnl = trade.side === 'LONG'
          ? (exitPrice - trade.entry) * positionSize
          : (trade.entry - exitPrice) * positionSize;
        updatedDailyPnL += pnl;
        updatedSessionPnL += pnl;
      }

      return { ...trade, status: newStatus, exitPrice };
    });

    // Check for new signal
    const openTrades = updatedTrades.filter((t: any) => t.status === 'open');
    if (canTrade && signal.side && signal.entry !== null && signal.tp !== null && signal.sl !== null && openTrades.length < maxTrades) {
      // Check for duplicate trade
      const duplicateTrade = openTrades.find(
        (t: any) =>
          t.symbol === symbol &&
          t.side === signal.side &&
          Math.abs(t.entry - signal.entry) < 0.01
      );

      if (!duplicateTrade) {
        // Calculate position size
        const riskPerTrade = riskType === 'percent' 
          ? (capital * riskAmount) / 100 
          : riskAmount;
        const stopLossDistance = Math.abs(signal.entry - signal.sl);
        const positionSize = stopLossDistance > 0 
          ? riskPerTrade / stopLossDistance 
          : 0;

        const newTrade = {
          time: new Date().toISOString(),
          side: signal.side,
          entry: signal.entry,
          tp: signal.tp,
          sl: signal.sl,
          reason: signal.reason,
          status: 'open',
          symbol: symbol,
          leverage: leverage,
          positionSize: positionSize,
        };

        updatedTrades.push(newTrade);
      }
    }

    // Update bot state
    const edgeConfigToken = process.env.EDGE_CONFIG_TOKEN;
    const edgeConfigUrl = process.env.EDGE_CONFIG_URL;

    if (edgeConfigToken && edgeConfigUrl) {
      const updatedState = {
        ...botState,
        dailyPnL: updatedDailyPnL,
        dailyStartDate: currentDailyStartDate,
        trades: updatedTrades,
        sessionPnL: updatedSessionPnL,
        lastPollTime: Date.now(),
      };

      // Extract connection string ID from URL
      const connectionStringId = edgeConfigUrl.split('/').pop()?.split('?')[0];

      await fetch(
        `https://api.vercel.com/v1/edge-config/${connectionStringId}/items`,
        {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${edgeConfigToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            items: [
              {
                operation: 'upsert',
                key: botKey,
                value: updatedState,
              },
            ],
          }),
        }
      );
    }

    return NextResponse.json({
      success: true,
      signal: signal.side,
      touchedLevel: signal.entry,
      trades: updatedTrades,
      dailyPnL: updatedDailyPnL,
      sessionPnL: updatedSessionPnL,
      openTrades: openTrades.length,
    });
  } catch (error) {
    console.error('Bot run error:', error);
    return NextResponse.json(
      { 
        success: false,
        error: error instanceof Error ? error.message : 'Bot run failed' 
      },
      { status: 500 }
    );
  }
}

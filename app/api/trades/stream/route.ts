import { NextRequest } from 'next/server';
import { getUserEmail, getUserId } from '@/lib/auth';
import { getOrCreateUser, getBotConfig, getAllTrades } from '@/lib/db';

// Server-Sent Events stream for real-time trade updates
export async function GET(request: NextRequest) {
  const authId = await getUserId();
  const email = await getUserEmail();

  if (!authId || !email) {
    return new Response('Unauthorized', { status: 401 });
  }

  const user = await getOrCreateUser(email, authId);
  const botConfig = await getBotConfig(user.id);

  if (!botConfig) {
    return new Response('Bot configuration not found', { status: 404 });
  }

  // Create a readable stream for SSE
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      
      // Send initial connection message
      controller.enqueue(encoder.encode(': connected\n\n'));

      let lastTradeCount = 0;
      let lastTradeIds: Set<string> = new Set();
      let lastUpdateTime = Date.now();

      const pollTrades = async () => {
        try {
          const allTrades = await getAllTrades(user.id);
          const currentTradeIds = new Set(allTrades.map(t => t.id));
          let currentTradeCount = allTrades.length;

          // Serialize trades from database
          let serializedTrades = allTrades.map(t => ({
            id: t.id,
            time: t.entry_time.toISOString(),
            side: t.side,
            entry: Number(t.entry_price),
            tp: Number(t.tp_price),
            sl: Number(t.current_sl ?? t.sl_price),
            initialSl: Number(t.sl_price),
            reason: t.reason || '',
            status: t.status,
            symbol: t.symbol,
            leverage: Number(t.leverage),
            positionSize: Number(t.position_size),
            exitPrice: t.exit_price ? Number(t.exit_price) : undefined,
            pnl: t.pnl !== null && t.pnl !== undefined ? Number(t.pnl) : undefined,
          }));

          // Fetch ALL active positions from Bybit if API keys are configured
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
                const bybitPositions = positionsData.result.list
                  .filter((pos: any) => parseFloat(pos.size || '0') !== 0);
                
                // Add external positions not tracked in database
                const dbSymbols = new Set(allTrades.filter(t => t.status === 'open').map(t => t.symbol));
                const externalPositions = bybitPositions.filter((p: any) => !dbSymbols.has(p.symbol));
                
                // Add external positions as virtual trades
                externalPositions.forEach((pos: any) => {
                  serializedTrades.push({
                    id: `bybit-${pos.symbol}`,
                    time: pos.createdTime || new Date().toISOString(),
                    side: pos.side === 'Buy' ? 'LONG' : 'SHORT',
                    entry: parseFloat(pos.avgPrice || '0'),
                    tp: parseFloat(pos.takeProfit || '0') || parseFloat(pos.avgPrice || '0') * (pos.side === 'Buy' ? 1.05 : 0.95),
                    sl: parseFloat(pos.stopLoss || '0') || parseFloat(pos.avgPrice || '0') * (pos.side === 'Buy' ? 0.95 : 1.05),
                    initialSl: parseFloat(pos.stopLoss || '0') || parseFloat(pos.avgPrice || '0') * (pos.side === 'Buy' ? 0.95 : 1.05),
                    reason: 'External Position (Bybit)',
                    status: 'open' as const,
                    symbol: pos.symbol,
                    leverage: parseFloat(pos.leverage || '1'),
                    positionSize: parseFloat(pos.size || '0'),
                    exitPrice: undefined,
                    pnl: parseFloat(pos.unrealisedPnl || '0'),
                  });
                });
                
                currentTradeCount = serializedTrades.length;
              }
            } catch (error) {
              // Continue without Bybit positions - will only show database trades
            }
          }

          // Check if trades changed (new trade, status change, or count change)
          const tradesChanged = 
            currentTradeCount !== lastTradeCount ||
            !allTrades.every(t => lastTradeIds.has(t.id)) ||
            allTrades.some(t => {
              const lastTrade = Array.from(lastTradeIds).find(id => id === t.id);
              return !lastTrade; // New trade
            });

          if (tradesChanged || Date.now() - lastUpdateTime > 1000) {
            // Send trade update
            const data = JSON.stringify({
              type: 'trades',
              trades: serializedTrades,
              timestamp: Date.now(),
            });

            controller.enqueue(encoder.encode(`data: ${data}\n\n`));

            lastTradeCount = currentTradeCount;
            lastTradeIds = currentTradeIds;
            lastUpdateTime = Date.now();
          }

          // Also send session P&L updates
          const sessionPnL = allTrades
            .filter(t => t.status !== 'open' && t.pnl !== null)
            .reduce((sum, t) => sum + Number(t.pnl || 0), 0);

          const dailyPnL = allTrades
            .filter(t => {
              const tradeDate = new Date(t.entry_time).toISOString().split('T')[0];
              const today = new Date().toISOString().split('T')[0];
              return tradeDate === today && t.status !== 'open' && t.pnl !== null;
            })
            .reduce((sum, t) => sum + Number(t.pnl || 0), 0);

          const pnlData = JSON.stringify({
            type: 'pnl',
            sessionPnL,
            dailyPnL,
            timestamp: Date.now(),
          });

          controller.enqueue(encoder.encode(`data: ${pnlData}\n\n`));

        } catch (error) {
          console.error('Error polling trades in SSE stream:', error);
          // Send error but don't close connection
          const errorData = JSON.stringify({
            type: 'error',
            message: error instanceof Error ? error.message : 'Unknown error',
          });
          controller.enqueue(encoder.encode(`data: ${errorData}\n\n`));
        }
      };

      // Poll every 500ms for real-time updates
      const intervalId = setInterval(pollTrades, 500);
      
      // Initial fetch
      pollTrades();

      // Cleanup on close
      request.signal.addEventListener('abort', () => {
        clearInterval(intervalId);
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable buffering in nginx
    },
  });
}


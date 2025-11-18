# Complete TP/SL Sync Manager Integration

This document provides the remaining code changes needed to complete the TP/SL synchronization fix.

## Remaining Replacements in `/workspace/app/api/cron/bot-runner/route.ts`

### 1. Replace lines ~695-723 (Setting TP/SL for open positions)

**Find:**
```typescript
                        if (shouldSetTP || shouldSetSL) {
                          try {
                            const { setTakeProfitStopLoss } = await import('@/lib/bybit');
                            const tpToSet = shouldSetTP ? tradeTP : undefined;
                            const slToSet = shouldSetSL ? tradeSL : undefined;
                            
                            await setTakeProfitStopLoss({
                              symbol: trade.symbol,
                              takeProfit: tpToSet,
                              stopLoss: slToSet,
                              testnet: false,
                              apiKey: botConfig.api_key,
                              apiSecret: botConfig.api_secret,
                              positionIdx: 0,
                            });
                            
                            const setMsg = [];
                            if (shouldSetTP) setMsg.push(`TP=$${tradeTP.toFixed(2)}`);
                            if (shouldSetSL) setMsg.push(`SL=$${tradeSL.toFixed(2)}`);
                            
                            console.log(`[CRON] TP/SL set on Bybit for trade ${trade.id}: ${setMsg.join(', ')}`);
                            await addActivityLog(
                              botConfig.user_id,
                              'success',
                              `TP/SL set on Bybit: ${trade.side} ${trade.symbol} ${setMsg.join(', ')}`,
                              { orderId: trade.order_id, tp: tpToSet, sl: slToSet },
                              botConfig.id
                            );
                          } catch (tpSlError) {
                            // Handle error 34040 (not modified) gracefully - it's not really an error
                            const errorMsg = tpSlError instanceof Error ? tpSlError.message : String(tpSlError);
                            if (errorMsg.includes('34040') || errorMsg.includes('not modified')) {
                              console.log(`[CRON] TP/SL already set to same values on Bybit for trade ${trade.id} - ignoring`);
                              // Don't log this as an error since it's expected behavior
                            } else {
                              console.error(`[CRON] Failed to set TP/SL for open position ${trade.id}:`, tpSlError);
                              await addActivityLog(
                                botConfig.user_id,
                                'warning',
                                `Failed to set TP/SL on Bybit for ${trade.side} ${trade.symbol}: ${errorMsg}`,
                                { orderId: trade.order_id, error: errorMsg },
                                botConfig.id
                              );
                            }
                          }
                        }
```

**Replace with:**
```typescript
                        if (shouldSetTP || shouldSetSL) {
                          const result = await tpslSyncManager.setTPSL({
                            tradeId: trade.id,
                            symbol: trade.symbol,
                            takeProfit: shouldSetTP ? tradeTP : undefined,
                            stopLoss: shouldSetSL ? tradeSL : undefined,
                            testnet: false,
                            apiKey: botConfig.api_key,
                            apiSecret: botConfig.api_secret,
                            positionIdx: 0,
                          });
                          
                          if (result.success) {
                            const setMsg = [];
                            if (shouldSetTP) setMsg.push(`TP=$${tradeTP.toFixed(2)}`);
                            if (shouldSetSL) setMsg.push(`SL=$${tradeSL.toFixed(2)}`);
                            console.log(`[CRON] TP/SL set on Bybit for trade ${trade.id}: ${setMsg.join(', ')}`);
                            await addActivityLog(
                              botConfig.user_id,
                              'success',
                              `TP/SL set on Bybit: ${trade.side} ${trade.symbol} ${setMsg.join(', ')}`,
                              { orderId: trade.order_id },
                              botConfig.id
                            );
                          } else if (!result.skipped) {
                            console.error(`[CRON] Failed to set TP/SL for trade ${trade.id}:`, result.error);
                            await addActivityLog(
                              botConfig.user_id,
                              'warning',
                              `Failed to set TP/SL on Bybit: ${result.error}`,
                              { orderId: trade.order_id, error: result.error },
                              botConfig.id
                            );
                          }
                        }
```

### 2. Replace lines ~784-803 (Breakeven SL update)

**Find:**
```typescript
                          try {
                            const { setTakeProfitStopLoss } = await import('@/lib/bybit');
                            await setTakeProfitStopLoss({
                              symbol: trade.symbol,
                              stopLoss: breakevenSl,
                              testnet: false,
                              apiKey: botConfig.api_key,
                              apiSecret: botConfig.api_secret,
                              positionIdx: 0,
                            });
                            await addActivityLog(
                              botConfig.user_id,
                              'warning',
                              `Breakeven applied: ${trade.side} ${trade.symbol} SL → $${breakevenSl.toFixed(2)} (price invalidated trade - moved against VWAP direction)`,
                              { currentPrice: currentMarkPrice, vwap: currentVWAP, entry: entryPrice },
                              botConfig.id
                            );
                            console.log(`[CRON] Breakeven applied for trade ${trade.id}: ${trade.side} ${trade.symbol}, price ${currentMarkPrice.toFixed(2)} vs VWAP ${currentVWAP.toFixed(2)}`);
                          } catch (slError) {
                            console.error(`[CRON] Failed to update SL to breakeven on Bybit:`, slError);
                          }
```

**Replace with:**
```typescript
                          const result = await tpslSyncManager.setTPSL({
                            tradeId: trade.id,
                            symbol: trade.symbol,
                            stopLoss: breakevenSl,
                            testnet: false,
                            apiKey: botConfig.api_key,
                            apiSecret: botConfig.api_secret,
                            positionIdx: 0,
                          });
                          
                          if (result.success) {
                            await addActivityLog(
                              botConfig.user_id,
                              'warning',
                              `Breakeven applied: ${trade.side} ${trade.symbol} SL → $${breakevenSl.toFixed(2)}`,
                              { currentPrice: currentMarkPrice, vwap: currentVWAP, entry: entryPrice },
                              botConfig.id
                            );
                            console.log(`[CRON] Breakeven applied for trade ${trade.id}`);
                          } else if (!result.skipped) {
                            console.error(`[CRON] Failed to set breakeven SL:`, result.error);
                          }
```

### 3. Replace lines ~818-837 (Trailing SL update)

**Find:**
```typescript
                            try {
                              const { setTakeProfitStopLoss } = await import('@/lib/bybit');
                              await setTakeProfitStopLoss({
                                symbol: trade.symbol,
                                stopLoss: trailingSl,
                                testnet: false,
                                apiKey: botConfig.api_key,
                                apiSecret: botConfig.api_secret,
                                positionIdx: 0,
                              });
                              await addActivityLog(
                                botConfig.user_id,
                                'info',
                                `Stop moved: ${trade.side} ${trade.symbol} SL → $${trailingSl.toFixed(2)}`,
                                null,
                                botConfig.id
                              );
                            } catch (slError) {
                              console.error(`[CRON] Failed to update SL on Bybit:`, slError);
                            }
```

**Replace with:**
```typescript
                            const result = await tpslSyncManager.setTPSL({
                              tradeId: trade.id,
                              symbol: trade.symbol,
                              stopLoss: trailingSl,
                              testnet: false,
                              apiKey: botConfig.api_key,
                              apiSecret: botConfig.api_secret,
                              positionIdx: 0,
                            });
                            
                            if (result.success) {
                              await addActivityLog(
                                botConfig.user_id,
                                'info',
                                `Stop moved: ${trade.side} ${trade.symbol} SL → $${trailingSl.toFixed(2)}`,
                                null,
                                botConfig.id
                              );
                            } else if (!result.skipped) {
                              console.error(`[CRON] Failed to update trailing SL:`, result.error);
                            }
```

### 4. Replace lines ~1302-1341 (Market order immediate TP/SL)

**Find:**
```typescript
                          try {
                            await new Promise(resolve => setTimeout(resolve, 1000));
                            
                            await setTakeProfitStopLoss({
                              symbol: botConfig.symbol,
                              takeProfit: roundedTP,
                              stopLoss: roundedSL,
                              testnet: botConfig.api_mode !== 'live',
                              apiKey: botConfig.api_key,
                              apiSecret: botConfig.api_secret,
                              positionIdx: 0,
                            });
                            console.log(`[CRON] ✓ TP/SL set immediately: TP=$${roundedTP.toFixed(2)}, SL=$${roundedSL.toFixed(2)}`);
                          } catch (tpSlError) {
                            console.error(`[CRON] Failed to set TP/SL, retrying...`, tpSlError);
                            // Retry after another delay
                            try {
                              await new Promise(resolve => setTimeout(resolve, 2000));
                              await setTakeProfitStopLoss({
                                symbol: botConfig.symbol,
                                takeProfit: roundedTP,
                                stopLoss: roundedSL,
                                testnet: botConfig.api_mode !== 'live',
                                apiKey: botConfig.api_key,
                                apiSecret: botConfig.api_secret,
                                positionIdx: 0,
                              });
                              console.log(`[CRON] ✓ TP/SL set on retry: TP=$${roundedTP.toFixed(2)}, SL=$${roundedSL.toFixed(2)}`);
                            } catch (retryError) {
                              console.error(`[CRON] Failed to set TP/SL on retry:`, retryError);
                              // Log but continue - cron job will retry on next run
                              await addActivityLog(
                                botConfig.user_id,
                                'warning',
                                `TP/SL not set yet for ${signal.side} ${botConfig.symbol}, will retry on next cron run`,
                                { orderId, tp: roundedTP, sl: roundedSL, error: retryError instanceof Error ? retryError.message : String(retryError) },
                                botConfig.id
                              );
                            }
                          }
```

**Replace with:**
```typescript
                          await new Promise(resolve => setTimeout(resolve, 1000));
                          
                          const result = await tpslSyncManager.setTPSL({
                            tradeId: tradeRecord.id,
                            symbol: botConfig.symbol,
                            takeProfit: roundedTP,
                            stopLoss: roundedSL,
                            testnet: botConfig.api_mode !== 'live',
                            apiKey: botConfig.api_key,
                            apiSecret: botConfig.api_secret,
                            positionIdx: 0,
                          });
                          
                          if (result.success) {
                            console.log(`[CRON] ✓ TP/SL set: TP=$${roundedTP.toFixed(2)}, SL=$${roundedSL.toFixed(2)}`);
                          } else if (!result.skipped) {
                            console.error(`[CRON] Failed to set TP/SL:`, result.error);
                            await addActivityLog(
                              botConfig.user_id,
                              'warning',
                              `TP/SL not set yet, will retry on next cron run: ${result.error}`,
                              { orderId, error: result.error },
                              botConfig.id
                            );
                          }
```

### 5. Replace lines ~1395-1410 (Order status check TP/SL)

**Find:**
```typescript
                                try {
                                  await setTakeProfitStopLoss({
                                    symbol: botConfig.symbol,
                                    takeProfit: roundedTP,
                                    stopLoss: roundedSL,
                                    testnet: botConfig.api_mode !== 'live',
                                    apiKey: botConfig.api_key,
                                    apiSecret: botConfig.api_secret,
                                    positionIdx: 0,
                                  });
                                  console.log(`[CRON] ✓ TP/SL set after status check: TP=$${roundedTP.toFixed(2)}, SL=$${roundedSL.toFixed(2)}`);
                                } catch (tpSlError) {
                                  console.error(`[CRON] Failed to set TP/SL:`, tpSlError);
                                }
```

**Replace with:**
```typescript
                                const result = await tpslSyncManager.setTPSL({
                                  tradeId: tradeRecord.id,
                                  symbol: botConfig.symbol,
                                  takeProfit: roundedTP,
                                  stopLoss: roundedSL,
                                  testnet: botConfig.api_mode !== 'live',
                                  apiKey: botConfig.api_key,
                                  apiSecret: botConfig.api_secret,
                                  positionIdx: 0,
                                });
                                
                                if (result.success) {
                                  console.log(`[CRON] ✓ TP/SL set after verification`);
                                } else if (!result.skipped) {
                                  console.error(`[CRON] Failed to set TP/SL:`, result.error);
                                }
```

## Testing Checklist

After applying these changes, test the following scenarios:

1. ✅ **Order Fill → TP/SL Set:** Verify TP/SL is set once after market order fills
2. ✅ **No Duplicate Calls:** Check logs for duplicate TP/SL API calls (should be prevented)
3. ✅ **"Not Modified" Error:** Verify error 34040 is handled gracefully
4. ✅ **Retry Logic:** Test that failed TP/SL calls are retried (max 2 times)
5. ✅ **Rate Limiting:** Ensure requests are spaced at least 1 second apart
6. ✅ **Breakeven Updates:** Verify SL is updated to entry when price invalidates trade
7. ✅ **Trailing Stop:** Confirm trailing stop updates work correctly
8. ✅ **Front-End Sync:** Check that TP/SL changes appear in UI promptly

## Deployment Steps

1. Apply all code changes above
2. Run linter: `npm run lint`
3. Test locally with testnet API keys
4. Deploy to production
5. Monitor logs for TP/SL synchronization
6. Verify no duplicate API calls in Bybit API dashboard

## Benefits After Completion

- ✅ **No more duplicate TP/SL calls** (reduces API rate limiting)
- ✅ **Graceful error handling** (34040 "not modified" treated as success)
- ✅ **Automatic retries** (transient failures recovered)
- ✅ **Better logging** (clear distinction between skipped/failed/successful)
- ✅ **Front-end sync** (UI stays in sync with Bybit positions)

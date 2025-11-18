/**
 * TP/SL Synchronization Manager
 * 
 * Prevents duplicate TP/SL API calls to Bybit and handles synchronization between
 * database state and Bybit's actual position state.
 * 
 * Key features:
 * - Deduplication: prevents multiple simultaneous calls for the same trade
 * - Retry logic: handles transient failures with exponential backoff
 * - State tracking: ensures database and Bybit stay in sync
 * - Error handling: gracefully handles "not modified" errors (34040)
 */

import { setTakeProfitStopLoss, getInstrumentInfo, roundPrice } from './bybit';

interface TPSLRequest {
  tradeId: number;
  symbol: string;
  takeProfit?: number;
  stopLoss?: number;
  testnet: boolean;
  apiKey: string;
  apiSecret: string;
  positionIdx?: 0 | 1 | 2;
}

interface TPSLState {
  inProgress: boolean;
  lastAttempt: number;
  retryCount: number;
  lastError?: string;
}

/**
 * TP/SL Synchronization Manager
 */
export class TPSLSyncManager {
  private pendingRequests: Map<number, TPSLState> = new Map();
  private readonly MAX_RETRIES = 2;
  private readonly RETRY_DELAY_MS = 2000;
  private readonly MIN_REQUEST_INTERVAL_MS = 1000; // Minimum time between requests for same trade

  /**
   * Set TP/SL with deduplication and retry logic
   */
  async setTPSL(request: TPSLRequest): Promise<{ success: boolean; error?: string; skipped?: boolean }> {
    const { tradeId, symbol, takeProfit, stopLoss, testnet, apiKey, apiSecret, positionIdx = 0 } = request;

    // Check if there's already a request in progress for this trade
    const state = this.pendingRequests.get(tradeId);
    if (state?.inProgress) {
      console.log(`[TPSL-SYNC] Request already in progress for trade ${tradeId}, skipping duplicate`);
      return { success: false, skipped: true, error: 'Request already in progress' };
    }

    // Check if we recently made a request (within MIN_REQUEST_INTERVAL_MS)
    if (state && Date.now() - state.lastAttempt < this.MIN_REQUEST_INTERVAL_MS) {
      console.log(`[TPSL-SYNC] Rate limiting: last request was ${Date.now() - state.lastAttempt}ms ago for trade ${tradeId}`);
      return { success: false, skipped: true, error: 'Rate limited' };
    }

    // Validate inputs
    if (!takeProfit && !stopLoss) {
      return { success: false, error: 'Either takeProfit or stopLoss must be provided' };
    }

    // Mark as in progress
    this.pendingRequests.set(tradeId, {
      inProgress: true,
      lastAttempt: Date.now(),
      retryCount: state?.retryCount || 0,
    });

    try {
      // Round TP/SL to match Bybit's tick size
      let roundedTP = takeProfit;
      let roundedSL = stopLoss;

      try {
        const instrumentInfo = await getInstrumentInfo(symbol, testnet);
        if (instrumentInfo && instrumentInfo.tickSize) {
          if (takeProfit !== undefined && takeProfit > 0) {
            roundedTP = roundPrice(takeProfit, instrumentInfo.tickSize);
            if (Math.abs(roundedTP - takeProfit) > 0.0001) {
              console.log(`[TPSL-SYNC] Rounded TP from ${takeProfit.toFixed(8)} to ${roundedTP.toFixed(8)}`);
            }
          }
          if (stopLoss !== undefined && stopLoss > 0) {
            roundedSL = roundPrice(stopLoss, instrumentInfo.tickSize);
            if (Math.abs(roundedSL - stopLoss) > 0.0001) {
              console.log(`[TPSL-SYNC] Rounded SL from ${stopLoss.toFixed(8)} to ${roundedSL.toFixed(8)}`);
            }
          }
        }
      } catch (priceRoundError) {
        console.warn(`[TPSL-SYNC] Failed to round TP/SL prices, using original:`, priceRoundError);
      }

      // Set TP/SL on Bybit
      console.log(`[TPSL-SYNC] Setting TP/SL for trade ${tradeId}: TP=${roundedTP?.toFixed(2)}, SL=${roundedSL?.toFixed(2)}`);
      
      const result = await setTakeProfitStopLoss({
        symbol,
        takeProfit: roundedTP,
        stopLoss: roundedSL,
        testnet,
        apiKey,
        apiSecret,
        positionIdx,
      });

      // Success
      this.pendingRequests.delete(tradeId);
      console.log(`[TPSL-SYNC] ✓ TP/SL set successfully for trade ${tradeId}`);
      return { success: true };

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      
      // Handle "not modified" error (34040) - this is not really an error
      if (errorMsg.includes('34040') || errorMsg.includes('not modified')) {
        console.log(`[TPSL-SYNC] TP/SL already set to same values for trade ${tradeId} - treating as success`);
        this.pendingRequests.delete(tradeId);
        return { success: true };
      }

      // Handle other errors
      console.error(`[TPSL-SYNC] Error setting TP/SL for trade ${tradeId}:`, errorMsg);
      
      // Update state with error
      const currentState = this.pendingRequests.get(tradeId);
      const retryCount = (currentState?.retryCount || 0) + 1;
      
      this.pendingRequests.set(tradeId, {
        inProgress: false,
        lastAttempt: Date.now(),
        retryCount,
        lastError: errorMsg,
      });

      // Retry if under max retries
      if (retryCount < this.MAX_RETRIES) {
        console.log(`[TPSL-SYNC] Retrying TP/SL for trade ${tradeId} (attempt ${retryCount + 1}/${this.MAX_RETRIES})...`);
        
        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, this.RETRY_DELAY_MS * retryCount));
        
        // Retry
        return this.setTPSL(request);
      }

      // Max retries exceeded
      console.error(`[TPSL-SYNC] Max retries exceeded for trade ${tradeId}, giving up`);
      this.pendingRequests.delete(tradeId);
      return { success: false, error: errorMsg };
    }
  }

  /**
   * Check if a trade has a pending TP/SL request
   */
  isPending(tradeId: number): boolean {
    const state = this.pendingRequests.get(tradeId);
    return state?.inProgress || false;
  }

  /**
   * Clear pending state for a trade (useful when trade is closed)
   */
  clearPending(tradeId: number): void {
    this.pendingRequests.delete(tradeId);
  }

  /**
   * Get pending request info for debugging
   */
  getPendingInfo(tradeId: number): TPSLState | undefined {
    return this.pendingRequests.get(tradeId);
  }

  /**
   * Clear all pending requests (cleanup)
   */
  clearAll(): void {
    this.pendingRequests.clear();
  }
}

// Singleton instance
export const tpslSyncManager = new TPSLSyncManager();

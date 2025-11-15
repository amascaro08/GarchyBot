import { sql as vercelSql } from '@vercel/postgres';
import { VolatilityModelsResult } from './vol';

/**
 * Database utility functions for the trading bot
 * Uses STORAGE_POSTGRES_URL from Vercel Storage
 * 
 * Note: @vercel/postgres checks these env vars in order:
 * 1. POSTGRES_URL
 * 2. Falls back to connection string in process.env
 * 
 * To use STORAGE_POSTGRES_URL, we set POSTGRES_URL to it at runtime
 */

// Ensure POSTGRES_URL is set from STORAGE_POSTGRES_URL if needed
if (!process.env.POSTGRES_URL && process.env.STORAGE_POSTGRES_URL) {
  process.env.POSTGRES_URL = process.env.STORAGE_POSTGRES_URL;
}

export const sql = vercelSql;

// ============================================
// TYPE DEFINITIONS
// ============================================

export interface User {
  id: string;
  auth_user_id: string | null;
  email: string;
  created_at: Date;
  updated_at: Date;
}

export interface BotConfig {
  id: string;
  user_id: string;
  symbol: string;
  candle_interval: string;
  is_running: boolean;
  max_trades: number;
  leverage: number;
  capital: number;
  risk_amount: number;
  risk_type: 'fixed' | 'percent';
  daily_target_type: 'fixed' | 'percent';
  daily_target_amount: number;
  daily_stop_type: 'fixed' | 'percent';
  daily_stop_amount: number;
  daily_pnl: number;
  daily_start_date: string;
  garch_mode: 'auto' | 'custom';
  custom_k_pct: number | null;
  use_orderbook_confirm: boolean;
  use_daily_open_entry: boolean;
  subdivisions: number;
  no_trade_band_pct: number;
  api_mode: 'demo' | 'live';
  api_key: string | null;
  api_secret: string | null;
  created_at: Date;
  updated_at: Date;
  last_polled_at: Date | null;
}

export interface Trade {
  id: string;
  user_id: string;
  bot_config_id: string;
  symbol: string;
  side: 'LONG' | 'SHORT';
  status: 'pending' | 'open' | 'tp' | 'sl' | 'breakeven' | 'cancelled';
  entry_price: number;
  tp_price: number;
  sl_price: number;
  exit_price: number | null;
  current_sl: number;
  position_size: number;
  leverage: number;
  pnl: number;
  reason: string | null;
  order_id: string | null; // Bybit order ID for tracking and cancellation
  entry_time: Date;
  exit_time: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface ActivityLog {
  id: string;
  user_id: string;
  bot_config_id: string | null;
  level: 'info' | 'success' | 'warning' | 'error';
  message: string;
  metadata: any | null;
  created_at: Date;
}

export interface VolatilityData {
  id: string;
  symbol: string;
  date: string;
  calculated_volatility: number;
  garch11_volatility: number;
  egarch11_volatility: number;
  gjrgarch11_volatility: number;
  data_points_used: number;
  calculation_timestamp: Date;
}

export interface DailyLevels {
  id: string;
  symbol: string;
  date: string;
  daily_open_price: number;
  upper_range: number;
  lower_range: number;
  up_levels: number[];
  dn_levels: number[];
  calculated_volatility: number;
  subdivisions: number;
  calculation_timestamp: Date;
  last_updated: Date;
}

export interface DailyPhase {
  id: string;
  symbol: string;
  date: string;
  phase1_completed: boolean;
  phase2_completed: boolean;
  phase1_timestamp: Date | null;
  phase2_timestamp: Date | null;
  last_error: string | null;
  error_timestamp: Date | null;
}

// ============================================
// USER FUNCTIONS
// ============================================

export async function getUserByEmail(email: string): Promise<User | null> {
  try {
    const result = await sql<User>`
      SELECT * FROM users WHERE email = ${email} LIMIT 1
    `;
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error getting user by email:', error);
    throw error;
  }
}

export async function getUserByAuthId(authUserId: string): Promise<User | null> {
  try {
    const result = await sql<User>`
      SELECT * FROM users WHERE auth_user_id = ${authUserId} LIMIT 1
    `;
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error getting user by auth ID:', error);
    throw error;
  }
}

export async function createUser(email: string, authUserId?: string): Promise<User> {
  try {
    const result = await sql<User>`
      INSERT INTO users (email, auth_user_id)
      VALUES (${email}, ${authUserId || null})
      RETURNING *
    `;
    return result.rows[0];
  } catch (error) {
    console.error('Error creating user:', error);
    throw error;
  }
}

// ============================================
// BOT CONFIG FUNCTIONS
// ============================================

export async function getBotConfig(userId: string): Promise<BotConfig | null> {
  try {
    const result = await sql<BotConfig>`
      SELECT * FROM bot_configs WHERE user_id = ${userId} LIMIT 1
    `;
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error getting bot config:', error);
    throw error;
  }
}

export async function createBotConfig(userId: string, config: Partial<BotConfig> = {}): Promise<BotConfig> {
  try {
    const result = await sql<BotConfig>`
      INSERT INTO bot_configs (
        user_id, symbol, candle_interval, is_running, max_trades, leverage,
        capital, risk_amount, risk_type, daily_target_type, daily_target_amount,
        daily_stop_type, daily_stop_amount, garch_mode, custom_k_pct,
        use_orderbook_confirm, use_daily_open_entry, subdivisions, no_trade_band_pct,
        api_mode, api_key, api_secret
      ) VALUES (
        ${userId},
        ${config.symbol || 'BTCUSDT'},
        ${config.candle_interval || '5'},
        ${config.is_running || false},
        ${config.max_trades || 3},
        ${config.leverage || 1},
        ${config.capital || 10000},
        ${config.risk_amount || 100},
        ${config.risk_type || 'fixed'},
        ${config.daily_target_type || 'percent'},
        ${config.daily_target_amount || 5},
        ${config.daily_stop_type || 'percent'},
        ${config.daily_stop_amount || 3},
        ${config.garch_mode || 'auto'},
        ${config.custom_k_pct || 0.03},
        ${config.use_orderbook_confirm !== false},
        ${config.use_daily_open_entry !== false},
        ${config.subdivisions || 5},
        ${config.no_trade_band_pct || 0.001},
        ${config.api_mode || 'demo'},
        ${config.api_key || null},
        ${config.api_secret || null}
      )
      RETURNING *
    `;
    return result.rows[0];
  } catch (error) {
    console.error('Error creating bot config:', error);
    throw error;
  }
}

export async function updateBotConfig(userId: string, updates: Partial<BotConfig>): Promise<BotConfig> {
  try {
    // Get existing config first to ensure it exists
    let existing = await getBotConfig(userId);
    if (!existing) {
      // If bot config doesn't exist, create a default one
      console.log(`[DB] Bot config not found for user ${userId}, creating default config`);
      existing = await createBotConfig(userId);
    }

    // Filter out undefined values and protected fields
    const validUpdates: Record<string, any> = {};
    Object.entries(updates).forEach(([key, value]) => {
      if (value !== undefined && key !== 'id' && key !== 'user_id' && key !== 'created_at') {
        validUpdates[key] = value;
      }
    });

    if (Object.keys(validUpdates).length === 0) {
      return existing;
    }

    // Build SET clauses - using template literals with sql.unsafe for dynamic column names
    // Column names are safe since they come from our code, not user input
    const setParts: string[] = [];
    const values: any[] = [];

    // Allowed column names (whitelist for safety)
    const allowedColumns = [
      'symbol', 'candle_interval', 'is_running', 'max_trades', 'leverage',
      'capital', 'risk_amount', 'risk_type', 'daily_target_type', 'daily_target_amount',
      'daily_stop_type', 'daily_stop_amount', 'daily_pnl', 'daily_start_date',
      'garch_mode', 'custom_k_pct', 'use_orderbook_confirm', 'use_daily_open_entry',
      'subdivisions', 'no_trade_band_pct', 'api_mode', 'api_key', 'api_secret', 'last_polled_at'
    ];

    for (const [key, value] of Object.entries(validUpdates)) {
      if (allowedColumns.includes(key)) {
        setParts.push(`${key} = $${values.length + 1}`);
        values.push(value);
      }
    }

    if (setParts.length === 0) {
      return existing;
    }

    // Add updated_at and userId
    setParts.push('updated_at = NOW()');
    values.push(userId);

    // Build query string
    const query = `UPDATE bot_configs SET ${setParts.join(', ')} WHERE user_id = $${values.length} RETURNING *`;

    // Execute using sql.query (same pattern as updateTrade function)
    const result = await sql.query(query, values);
    
    if (!result || !result.rows || result.rows.length === 0) {
      // Fallback to existing if update didn't return a row
      return existing;
    }
    
    return result.rows[0];
  } catch (error) {
    console.error('Error updating bot config:', error);
    throw error;
  }
}

export async function startBot(userId: string): Promise<BotConfig> {
  return updateBotConfig(userId, { is_running: true, last_polled_at: new Date() } as any);
}

export async function stopBot(userId: string): Promise<BotConfig> {
  return updateBotConfig(userId, { is_running: false } as any);
}

export async function getRunningBots(): Promise<BotConfig[]> {
  try {
    const result = await sql<BotConfig>`
      SELECT * FROM bot_configs WHERE is_running = true
    `;
    return result.rows;
  } catch (error) {
    console.error('Error getting running bots:', error);
    throw error;
  }
}

export async function updateLastPolled(botConfigId: string): Promise<void> {
  try {
    await sql`
      UPDATE bot_configs 
      SET last_polled_at = NOW()
      WHERE id = ${botConfigId}
    `;
  } catch (error) {
    console.error('Error updating last polled:', error);
    throw error;
  }
}

// ============================================
// TRADE FUNCTIONS
// ============================================

export async function createTrade(trade: Omit<Trade, 'id' | 'created_at' | 'updated_at'>): Promise<Trade> {
  try {
    console.log(`[DB] Creating trade for user ${trade.user_id}: ${trade.side} ${trade.symbol} @ ${trade.entry_price}, reason: ${trade.reason}`);
    const result = await sql<Trade>`
      INSERT INTO trades (
        user_id, bot_config_id, symbol, side, status,
        entry_price, tp_price, sl_price, current_sl,
        position_size, leverage, reason, order_id
      ) VALUES (
        ${trade.user_id}, ${trade.bot_config_id}, ${trade.symbol},
        ${trade.side}, ${trade.status}, ${trade.entry_price},
        ${trade.tp_price}, ${trade.sl_price}, ${trade.current_sl},
        ${trade.position_size}, ${trade.leverage}, ${trade.reason || null}, ${trade.order_id || null}
      )
      RETURNING *
    `;
    console.log(`[DB] Trade created successfully with ID: ${result.rows[0].id}`);
    return result.rows[0];
  } catch (error) {
    console.error('Error creating trade:', error);
    throw error;
  }
}

export async function getOpenTrades(userId: string, botConfigId?: string): Promise<Trade[]> {
  try {
    const result = botConfigId
      ? await sql<Trade>`
          SELECT * FROM trades 
          WHERE user_id = ${userId} 
          AND bot_config_id = ${botConfigId}
          AND status = 'open'
          ORDER BY entry_time DESC
        `
      : await sql<Trade>`
          SELECT * FROM trades 
          WHERE user_id = ${userId} 
          AND status = 'open'
          ORDER BY entry_time DESC
        `;
    return result.rows;
  } catch (error) {
    console.error('Error getting open trades:', error);
    throw error;
  }
}

export async function getPendingTrades(userId: string, botConfigId?: string): Promise<Trade[]> {
  try {
    const result = botConfigId
      ? await sql<Trade>`
          SELECT * FROM trades
          WHERE user_id = ${userId}
          AND bot_config_id = ${botConfigId}
          AND status = 'pending'
          ORDER BY entry_time DESC
        `
      : await sql<Trade>`
          SELECT * FROM trades
          WHERE user_id = ${userId}
          AND status = 'pending'
          ORDER BY entry_time DESC
        `;
    return result.rows;
  } catch (error) {
    console.error('Error getting pending trades:', error);
    throw error;
  }
}

/**
 * Get pending trades older than specified hours
 * Used for order expiry cancellation
 * Returns trades with bot config info needed for cancellation
 */
export async function getExpiredPendingTrades(hours: number = 1): Promise<Array<Trade & { api_key: string | null; api_secret: string | null; api_mode: string }>> {
  try {
    // Use SQL with parameterized INTERVAL - PostgreSQL supports interval arithmetic
    // For simplicity, we'll construct the interval string
    const hoursParam = hours;
    const result = await sql.query(`
      SELECT 
        t.*,
        bc.api_key,
        bc.api_secret,
        bc.api_mode
      FROM trades t
      JOIN bot_configs bc ON t.bot_config_id = bc.id
      WHERE t.status = 'pending'
      AND t.entry_time < NOW() - INTERVAL '1 hour' * $1
      AND t.order_id IS NOT NULL
      AND bc.api_key IS NOT NULL
      AND bc.api_secret IS NOT NULL
      ORDER BY t.entry_time ASC
    `, [hoursParam]);
    return result.rows;
  } catch (error) {
    console.error('Error getting expired pending trades:', error);
    throw error;
  }
}

export async function getAllTrades(userId: string, limit = 100): Promise<Trade[]> {
  try {
    console.log(`[DB] Fetching all trades for user ${userId}, limit: ${limit}`);
    const result = await sql<Trade>`
      SELECT * FROM trades
      WHERE user_id = ${userId}
      ORDER BY entry_time DESC
      LIMIT ${limit}
    `;
    console.log(`[DB] Retrieved ${result.rows.length} trades for user ${userId}`);
    return result.rows;
  } catch (error) {
    console.error('Error getting all trades:', error);
    throw error;
  }
}

export async function getTradeById(tradeId: string): Promise<Trade | null> {
  try {
    const result = await sql<Trade>`
      SELECT * FROM trades
      WHERE id = ${tradeId}
      LIMIT 1
    `;
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error getting trade by ID:', error);
    throw error;
  }
}

export async function updateTrade(tradeId: string, updates: Partial<Trade>): Promise<Trade> {
  try {
    const setClauses: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    Object.entries(updates).forEach(([key, value]) => {
      if (value !== undefined && key !== 'id') {
        setClauses.push(`${key} = $${paramIndex}`);
        values.push(value);
        paramIndex++;
      }
    });

    if (setClauses.length === 0) {
      throw new Error('No updates provided');
    }

    values.push(tradeId);
    const query = `
      UPDATE trades 
      SET ${setClauses.join(', ')}, updated_at = NOW()
      WHERE id = $${paramIndex}
      RETURNING *
    `;

    const result = await sql.query(query, values);
    return result.rows[0];
  } catch (error) {
    console.error('Error updating trade:', error);
    throw error;
  }
}

export async function closeTrade(
  tradeId: string,
  status: 'tp' | 'sl' | 'breakeven' | 'cancelled',
  exitPrice: number,
  pnl: number
): Promise<Trade> {
  return updateTrade(tradeId, {
    status,
    exit_price: exitPrice,
    exit_time: new Date(),
    pnl,
  } as any);
}

// ============================================
// ACTIVITY LOG FUNCTIONS
// ============================================

export async function addActivityLog(
  userId: string,
  level: ActivityLog['level'],
  message: string,
  metadata?: any,
  botConfigId?: string
): Promise<void> {
  try {
    await sql`
      INSERT INTO activity_logs (user_id, bot_config_id, level, message, metadata)
      VALUES (${userId}, ${botConfigId || null}, ${level}, ${message}, ${metadata ? JSON.stringify(metadata) : null})
    `;
  } catch (error) {
    console.error('Error adding activity log:', error);
    // Don't throw - logging failures shouldn't break the bot
  }
}

export async function getActivityLogs(userId: string, limit = 50): Promise<ActivityLog[]> {
  try {
    const result = await sql<ActivityLog>`
      SELECT * FROM activity_logs 
      WHERE user_id = ${userId}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;
    return result.rows;
  } catch (error) {
    console.error('Error getting activity logs:', error);
    throw error;
  }
}

// ============================================
// DAILY P&L FUNCTIONS
// ============================================

export async function updateDailyPnL(userId: string, pnlChange: number): Promise<void> {
  try {
    await sql`
      UPDATE bot_configs
      SET daily_pnl = daily_pnl + ${pnlChange}
      WHERE user_id = ${userId}
    `;
  } catch (error) {
    console.error('Error updating daily P&L:', error);
    throw error;
  }
}

export async function resetDailyPnL(): Promise<void> {
  try {
    // Reset daily P&L for bots where:
    // 1. daily_start_date is NULL (never set)
    // 2. daily_start_date is before today
    // This ensures all bots get reset properly
    const result = await sql`
      UPDATE bot_configs
      SET daily_pnl = 0, daily_start_date = CURRENT_DATE
      WHERE daily_start_date IS NULL 
         OR daily_start_date < CURRENT_DATE
      RETURNING id
    `;
    if (result.rows && result.rows.length > 0) {
      console.log(`[CRON] Reset daily P&L for ${result.rows.length} bot(s) with stale or NULL daily_start_date`);
    }
  } catch (error) {
    console.error('Error resetting daily P&L:', error);
    throw error;
  }
}

export async function resetDailyPnLForUser(userId: string): Promise<BotConfig> {
  try {
    const result = await sql<BotConfig>`
      UPDATE bot_configs
      SET daily_pnl = 0,
          daily_start_date = CURRENT_DATE,
          updated_at = NOW()
      WHERE user_id = ${userId}
      RETURNING *
    `;
    return result.rows[0];
  } catch (error) {
    console.error('Error resetting daily P&L for user:', error);
    throw error;
  }
}

// ============================================
// HELPER FUNCTIONS
// ============================================

export async function getOrCreateUser(email: string, authUserId?: string): Promise<User> {
  let user = await getUserByEmail(email);
  if (!user) {
    user = await createUser(email, authUserId);
    // Create default bot config
    await createBotConfig(user.id);
  }
  return user;
}

export async function calculateSessionPnL(userId: string): Promise<number> {
  try {
    const result = await sql`
      SELECT COALESCE(SUM(pnl), 0) as total_pnl
      FROM trades
      WHERE user_id = ${userId}
      AND status IN ('tp', 'sl', 'breakeven')
      AND entry_time >= (
        SELECT daily_start_date FROM bot_configs WHERE user_id = ${userId}
      )
    `;
    return Number(result.rows[0]?.total_pnl || 0);
  } catch (error) {
    console.error('Error calculating session P&L:', error);
    return 0;
  }
}

// ============================================
// VOLATILITY DATA FUNCTIONS
// ============================================

export async function saveVolatilityData(
  symbol: string,
  calculatedVolatility: number,
  volatilityModels: VolatilityModelsResult,
  dataPointsUsed: number
): Promise<VolatilityData> {
  try {
    const result = await sql<VolatilityData>`
      INSERT INTO volatility_data (
        symbol, date, calculated_volatility,
        garch11_volatility, egarch11_volatility, gjrgarch11_volatility,
        data_points_used
      ) VALUES (
        ${symbol}, CURRENT_DATE, ${calculatedVolatility},
        ${volatilityModels.garch11.kPct}, ${volatilityModels.egarch11.kPct}, ${volatilityModels.gjrgarch11.kPct},
        ${dataPointsUsed}
      )
      ON CONFLICT (symbol, date)
      DO UPDATE SET
        calculated_volatility = EXCLUDED.calculated_volatility,
        garch11_volatility = EXCLUDED.garch11_volatility,
        egarch11_volatility = EXCLUDED.egarch11_volatility,
        gjrgarch11_volatility = EXCLUDED.gjrgarch11_volatility,
        data_points_used = EXCLUDED.data_points_used,
        calculation_timestamp = NOW()
      RETURNING *
    `;
    return result.rows[0];
  } catch (error) {
    console.error('Error saving volatility data:', error);
    throw error;
  }
}

export async function getVolatilityData(symbol: string, date?: string): Promise<VolatilityData | null> {
  try {
    const result = date
      ? await sql<VolatilityData>`
          SELECT * FROM volatility_data
          WHERE symbol = ${symbol} AND date = ${date}
          LIMIT 1
        `
      : await sql<VolatilityData>`
          SELECT * FROM volatility_data
          WHERE symbol = ${symbol}
          ORDER BY date DESC
          LIMIT 1
        `;
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error getting volatility data:', error);
    throw error;
  }
}

export async function getLatestVolatilityData(): Promise<VolatilityData[]> {
  try {
    const result = await sql<VolatilityData>`
      SELECT DISTINCT ON (symbol) *
      FROM volatility_data
      ORDER BY symbol, date DESC
    `;
    return result.rows;
  } catch (error) {
    console.error('Error getting latest volatility data:', error);
    throw error;
  }
}

// ============================================
// DAILY LEVELS FUNCTIONS
// ============================================

export async function saveDailyLevels(
  symbol: string,
  dailyOpenPrice: number,
  upperRange: number,
  lowerRange: number,
  upLevels: number[],
  dnLevels: number[],
  calculatedVolatility: number,
  subdivisions: number
): Promise<DailyLevels> {
  try {
    // Use UTC date to ensure consistency (YYYY-MM-DD format)
    const nowUTC = new Date();
    const utcDate = new Date(Date.UTC(
      nowUTC.getUTCFullYear(),
      nowUTC.getUTCMonth(),
      nowUTC.getUTCDate(),
      0, 0, 0, 0
    ));
    const dateStr = utcDate.toISOString().split('T')[0]; // YYYY-MM-DD
    
    console.log(`[DB] Saving daily levels for ${symbol} with UTC date: ${dateStr}`);
    
    const result = await sql<DailyLevels>`
      INSERT INTO daily_levels (
        symbol, date, daily_open_price, upper_range, lower_range,
        up_levels, dn_levels, calculated_volatility, subdivisions
      ) VALUES (
        ${symbol}, ${dateStr}::DATE, ${dailyOpenPrice}, ${upperRange}, ${lowerRange},
        ${JSON.stringify(upLevels)}, ${JSON.stringify(dnLevels)}, ${calculatedVolatility}, ${subdivisions}
      )
      ON CONFLICT (symbol, date)
      DO UPDATE SET
        daily_open_price = EXCLUDED.daily_open_price,
        upper_range = EXCLUDED.upper_range,
        lower_range = EXCLUDED.lower_range,
        up_levels = EXCLUDED.up_levels,
        dn_levels = EXCLUDED.dn_levels,
        calculated_volatility = EXCLUDED.calculated_volatility,
        subdivisions = EXCLUDED.subdivisions,
        last_updated = NOW()
      RETURNING *
    `;
    return result.rows[0];
  } catch (error) {
    console.error('Error saving daily levels:', error);
    throw error;
  }
}

export async function getDailyLevels(symbol: string, date?: string): Promise<DailyLevels | null> {
  try {
    const result = date
      ? await sql<DailyLevels>`
          SELECT * FROM daily_levels
          WHERE symbol = ${symbol} AND date = ${date}
          LIMIT 1
        `
      : await sql<DailyLevels>`
          SELECT * FROM daily_levels
          WHERE symbol = ${symbol}
          ORDER BY date DESC
          LIMIT 1
        `;

    if (!result.rows[0]) return null;

    const rawLevels = result.rows[0];
    
    // Convert date to ISO string format (YYYY-MM-DD) for consistent comparison
    // PostgreSQL DATE type can come as Date object or string, normalize it
    let normalizedDate: string;
    // Type assertion: PostgreSQL might return Date object even though interface says string
    const dateValue: any = rawLevels.date;
    // Check if it's a Date object by checking for toISOString method (safer than instanceof)
    if (dateValue && typeof dateValue === 'object' && typeof dateValue.toISOString === 'function') {
      normalizedDate = dateValue.toISOString().split('T')[0];
    } else if (typeof dateValue === 'string') {
      // If it's already a string, try to parse and normalize it
      const dateObj = new Date(dateValue);
      if (!isNaN(dateObj.getTime())) {
        normalizedDate = dateObj.toISOString().split('T')[0];
      } else {
        // If parsing fails, assume it's already in YYYY-MM-DD format
        normalizedDate = dateValue.split('T')[0];
      }
    } else {
      normalizedDate = String(dateValue).split('T')[0];
    }
    
    // Convert NUMERIC types from PostgreSQL (they come as strings) to numbers
    // Also parse JSONB arrays and ensure they're number arrays
    const levels: DailyLevels = {
      ...rawLevels,
      date: normalizedDate, // Normalize date format
      // Convert NUMERIC fields to numbers (PostgreSQL returns them as strings)
      daily_open_price: typeof rawLevels.daily_open_price === 'string' 
        ? parseFloat(rawLevels.daily_open_price) 
        : Number(rawLevels.daily_open_price),
      upper_range: typeof rawLevels.upper_range === 'string'
        ? parseFloat(rawLevels.upper_range)
        : Number(rawLevels.upper_range),
      lower_range: typeof rawLevels.lower_range === 'string'
        ? parseFloat(rawLevels.lower_range)
        : Number(rawLevels.lower_range),
      calculated_volatility: typeof rawLevels.calculated_volatility === 'string'
        ? parseFloat(rawLevels.calculated_volatility)
        : Number(rawLevels.calculated_volatility),
      subdivisions: typeof rawLevels.subdivisions === 'string'
        ? parseInt(rawLevels.subdivisions, 10)
        : Number(rawLevels.subdivisions),
      // Parse JSONB arrays and ensure they're number arrays
      up_levels: (() => {
        let parsed: any = rawLevels.up_levels;
        if (typeof parsed === 'string') {
          try {
            parsed = JSON.parse(parsed);
          } catch (parseError) {
            console.error('Error parsing up_levels JSON:', parseError, 'Value:', parsed);
            return [];
          }
        }
        if (!Array.isArray(parsed)) {
          console.error('up_levels is not an array:', typeof parsed, parsed);
          return [];
        }
        // Ensure all values are numbers
        return parsed.map((l: any) => typeof l === 'string' ? parseFloat(l) : Number(l));
      })(),
      dn_levels: (() => {
        let parsed: any = rawLevels.dn_levels;
        if (typeof parsed === 'string') {
          try {
            parsed = JSON.parse(parsed);
          } catch (parseError) {
            console.error('Error parsing dn_levels JSON:', parseError, 'Value:', parsed);
            return [];
          }
        }
        if (!Array.isArray(parsed)) {
          console.error('dn_levels is not an array:', typeof parsed, parsed);
          return [];
        }
        // Ensure all values are numbers
        return parsed.map((l: any) => typeof l === 'string' ? parseFloat(l) : Number(l));
      })(),
    };

    console.log(`[DB] getDailyLevels for ${symbol} - Converted types:`);
    console.log(`  daily_open_price: ${levels.daily_open_price} (type: ${typeof levels.daily_open_price})`);
    console.log(`  up_levels: ${levels.up_levels.length} levels (type: ${Array.isArray(levels.up_levels) ? 'array' : typeof levels.up_levels})`);
    console.log(`  dn_levels: ${levels.dn_levels.length} levels (type: ${Array.isArray(levels.dn_levels) ? 'array' : typeof levels.dn_levels})`);

    return levels;
  } catch (error) {
    console.error('Error getting daily levels:', error);
    throw error;
  }
}

// ============================================
// DAILY PHASE FUNCTIONS
// ============================================

export async function updatePhaseStatus(
  symbol: string,
  phase: 1 | 2,
  completed: boolean,
  error?: string
): Promise<DailyPhase> {
  try {
    const phaseColumn = phase === 1 ? 'phase1_completed' : 'phase2_completed';
    const timestampColumn = phase === 1 ? 'phase1_timestamp' : 'phase2_timestamp';

    const setClauses = [`${phaseColumn} = ${completed}`];
    if (completed) {
      setClauses.push(`${timestampColumn} = NOW()`);
    }

    if (error) {
      setClauses.push('last_error = $2', 'error_timestamp = NOW()');
    }

    const query = `
      INSERT INTO daily_phases (symbol, date, ${phaseColumn}, ${timestampColumn}${error ? ', last_error, error_timestamp' : ''})
      VALUES ($1, CURRENT_DATE, ${completed ? 'true' : 'false'}, ${completed ? 'NOW()' : 'NULL'}${error ? ', $2, NOW()' : ''})
      ON CONFLICT (symbol, date)
      DO UPDATE SET
        ${setClauses.join(', ')}
      RETURNING *
    `;

    const result = await sql.query(query, error ? [symbol, error] : [symbol]);
    return result.rows[0];
  } catch (err) {
    console.error('Error updating phase status:', err);
    throw err;
  }
}

export async function getPhaseStatus(symbol: string, date?: string): Promise<DailyPhase | null> {
  try {
    const result = date
      ? await sql<DailyPhase>`
          SELECT * FROM daily_phases
          WHERE symbol = ${symbol} AND date = ${date}
          LIMIT 1
        `
      : await sql<DailyPhase>`
          SELECT * FROM daily_phases
          WHERE symbol = ${symbol}
          ORDER BY date DESC
          LIMIT 1
        `;
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error getting phase status:', error);
    throw error;
  }
}

export async function checkPhase1Completed(symbol: string, date?: string): Promise<boolean> {
  const phase = await getPhaseStatus(symbol, date);
  return phase?.phase1_completed || false;
}

export async function checkPhase2Completed(symbol: string, date?: string): Promise<boolean> {
  const phase = await getPhaseStatus(symbol, date);
  return phase?.phase2_completed || false;
}

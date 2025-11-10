import { sql } from '@vercel/postgres';

/**
 * Database utility functions for the trading bot
 */

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
  subdivisions: number;
  no_trade_band_pct: number;
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
  status: 'open' | 'tp' | 'sl' | 'breakeven' | 'cancelled';
  entry_price: number;
  tp_price: number;
  sl_price: number;
  exit_price: number | null;
  current_sl: number;
  position_size: number;
  leverage: number;
  pnl: number;
  reason: string | null;
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
        use_orderbook_confirm, subdivisions, no_trade_band_pct
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
        ${config.subdivisions || 5},
        ${config.no_trade_band_pct || 0.001}
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
    const setClauses: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    // Dynamically build SET clause based on provided updates
    Object.entries(updates).forEach(([key, value]) => {
      if (value !== undefined && key !== 'id' && key !== 'user_id') {
        setClauses.push(`${key} = $${paramIndex}`);
        values.push(value);
        paramIndex++;
      }
    });

    if (setClauses.length === 0) {
      const existing = await getBotConfig(userId);
      if (!existing) throw new Error('Bot config not found');
      return existing;
    }

    values.push(userId); // Add userId for WHERE clause
    const query = `
      UPDATE bot_configs 
      SET ${setClauses.join(', ')}, updated_at = NOW()
      WHERE user_id = $${paramIndex}
      RETURNING *
    `;

    const result = await sql.query(query, values);
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
    const result = await sql<Trade>`
      INSERT INTO trades (
        user_id, bot_config_id, symbol, side, status,
        entry_price, tp_price, sl_price, current_sl,
        position_size, leverage, reason
      ) VALUES (
        ${trade.user_id}, ${trade.bot_config_id}, ${trade.symbol},
        ${trade.side}, ${trade.status}, ${trade.entry_price},
        ${trade.tp_price}, ${trade.sl_price}, ${trade.current_sl},
        ${trade.position_size}, ${trade.leverage}, ${trade.reason || null}
      )
      RETURNING *
    `;
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

export async function getAllTrades(userId: string, limit = 100): Promise<Trade[]> {
  try {
    const result = await sql<Trade>`
      SELECT * FROM trades 
      WHERE user_id = ${userId}
      ORDER BY entry_time DESC
      LIMIT ${limit}
    `;
    return result.rows;
  } catch (error) {
    console.error('Error getting all trades:', error);
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
    await sql`
      UPDATE bot_configs
      SET daily_pnl = 0, daily_start_date = CURRENT_DATE
      WHERE daily_start_date < CURRENT_DATE
    `;
  } catch (error) {
    console.error('Error resetting daily P&L:', error);
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

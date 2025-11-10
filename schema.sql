-- =====================================================
-- GARCHY BOT DATABASE SCHEMA
-- =====================================================
-- This schema supports multiple users running bots
-- in the background with Vercel Cron Jobs
-- =====================================================

-- Users table (simple auth - extend with actual auth later)
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Bot configurations - stores user's bot settings
CREATE TABLE IF NOT EXISTS bot_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  -- Bot settings
  symbol VARCHAR(20) NOT NULL DEFAULT 'BTCUSDT',
  candle_interval VARCHAR(10) NOT NULL DEFAULT '5',
  is_running BOOLEAN NOT NULL DEFAULT false,
  
  -- Risk management
  max_trades INTEGER NOT NULL DEFAULT 3,
  leverage INTEGER NOT NULL DEFAULT 1,
  capital DECIMAL(20, 2) NOT NULL DEFAULT 10000,
  risk_amount DECIMAL(20, 2) NOT NULL DEFAULT 100,
  risk_type VARCHAR(10) NOT NULL DEFAULT 'fixed', -- 'fixed' or 'percent'
  
  -- Daily limits
  daily_target_type VARCHAR(10) NOT NULL DEFAULT 'percent',
  daily_target_amount DECIMAL(10, 2) NOT NULL DEFAULT 5,
  daily_stop_type VARCHAR(10) NOT NULL DEFAULT 'percent',
  daily_stop_amount DECIMAL(10, 2) NOT NULL DEFAULT 3,
  daily_pnl DECIMAL(20, 2) NOT NULL DEFAULT 0,
  daily_start_date DATE NOT NULL DEFAULT CURRENT_DATE,
  
  -- GARCH settings
  garch_mode VARCHAR(10) NOT NULL DEFAULT 'auto', -- 'auto' or 'custom'
  custom_k_pct DECIMAL(10, 6) DEFAULT 0.03,
  
  -- Other settings
  use_orderbook_confirm BOOLEAN NOT NULL DEFAULT true,
  subdivisions INTEGER NOT NULL DEFAULT 5,
  no_trade_band_pct DECIMAL(10, 6) NOT NULL DEFAULT 0.001,
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_polled_at TIMESTAMP WITH TIME ZONE,
  
  -- Ensure one config per user
  UNIQUE(user_id)
);

-- Create index for fast lookups of running bots
CREATE INDEX IF NOT EXISTS idx_bot_configs_running ON bot_configs(is_running, user_id);
CREATE INDEX IF NOT EXISTS idx_bot_configs_last_polled ON bot_configs(last_polled_at);

-- Trades table - stores all trades (open and closed)
CREATE TABLE IF NOT EXISTS trades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bot_config_id UUID NOT NULL REFERENCES bot_configs(id) ON DELETE CASCADE,
  
  -- Trade details
  symbol VARCHAR(20) NOT NULL,
  side VARCHAR(10) NOT NULL, -- 'LONG' or 'SHORT'
  status VARCHAR(20) NOT NULL DEFAULT 'open', -- 'open', 'tp', 'sl', 'breakeven', 'cancelled'
  
  -- Prices
  entry_price DECIMAL(20, 8) NOT NULL,
  tp_price DECIMAL(20, 8) NOT NULL,
  sl_price DECIMAL(20, 8) NOT NULL,
  exit_price DECIMAL(20, 8),
  current_sl DECIMAL(20, 8) NOT NULL, -- Can be updated for breakeven
  
  -- Position sizing
  position_size DECIMAL(20, 8) NOT NULL,
  leverage INTEGER NOT NULL DEFAULT 1,
  
  -- P&L
  pnl DECIMAL(20, 2) DEFAULT 0,
  
  -- Metadata
  reason TEXT,
  entry_time TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  exit_time TIMESTAMP WITH TIME ZONE,
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_trades_user_status ON trades(user_id, status);
CREATE INDEX IF NOT EXISTS idx_trades_bot_config ON trades(bot_config_id, status);
CREATE INDEX IF NOT EXISTS idx_trades_entry_time ON trades(entry_time DESC);

-- Activity logs - stores bot activity for debugging and monitoring
CREATE TABLE IF NOT EXISTS activity_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bot_config_id UUID REFERENCES bot_configs(id) ON DELETE CASCADE,
  
  level VARCHAR(20) NOT NULL, -- 'info', 'success', 'warning', 'error'
  message TEXT NOT NULL,
  metadata JSONB, -- Additional data (e.g., prices, levels)
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index for recent logs
CREATE INDEX IF NOT EXISTS idx_activity_logs_user_created ON activity_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_logs_bot_created ON activity_logs(bot_config_id, created_at DESC);

-- Create a view for easy querying of open trades with current P&L
CREATE OR REPLACE VIEW open_trades_view AS
SELECT 
  t.*,
  bc.symbol as config_symbol,
  bc.capital,
  bc.leverage as config_leverage
FROM trades t
JOIN bot_configs bc ON t.bot_config_id = bc.id
WHERE t.status = 'open';

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers to auto-update updated_at
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_bot_configs_updated_at BEFORE UPDATE ON bot_configs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_trades_updated_at BEFORE UPDATE ON trades
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to reset daily P&L (called by cron or manually)
CREATE OR REPLACE FUNCTION reset_daily_pnl()
RETURNS void AS $$
BEGIN
  UPDATE bot_configs
  SET 
    daily_pnl = 0,
    daily_start_date = CURRENT_DATE
  WHERE daily_start_date < CURRENT_DATE;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- SAMPLE DATA (Optional - for testing)
-- =====================================================
-- Create a test user (you can remove this in production)
INSERT INTO users (email) 
VALUES ('demo@example.com')
ON CONFLICT (email) DO NOTHING;

-- Create a default bot config for the test user
INSERT INTO bot_configs (user_id, symbol, candle_interval, is_running)
SELECT id, 'BTCUSDT', '5', false
FROM users 
WHERE email = 'demo@example.com'
ON CONFLICT (user_id) DO NOTHING;

-- =====================================================
-- CLEANUP FUNCTIONS (Optional)
-- =====================================================

-- Function to clean up old logs (keep last 1000 per user)
CREATE OR REPLACE FUNCTION cleanup_old_logs()
RETURNS void AS $$
BEGIN
  DELETE FROM activity_logs
  WHERE id IN (
    SELECT id FROM (
      SELECT id, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at DESC) as rn
      FROM activity_logs
    ) sub
    WHERE rn > 1000
  );
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- INDEXES FOR PERFORMANCE
-- =====================================================

-- Index for cron job to find active bots quickly
CREATE INDEX IF NOT EXISTS idx_bot_configs_active_poll 
ON bot_configs(is_running, last_polled_at) 
WHERE is_running = true;

-- =====================================================
-- GRANTS (adjust based on your database user)
-- =====================================================
-- These grants might not be necessary on Neon DB
-- as the owner has all permissions by default

-- =====================================================
-- NOTES
-- =====================================================
-- 1. Run this script on your Neon database
-- 2. Set DATABASE_URL in your .env.local file
-- 3. The schema supports multiple users
-- 4. Daily P&L resets automatically based on daily_start_date
-- 5. Activity logs are capped at 1000 per user
-- 6. All timestamps use UTC timezone

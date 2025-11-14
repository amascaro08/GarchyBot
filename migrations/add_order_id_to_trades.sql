-- Migration: Add order_id column to trades table for tracking Bybit orders
-- Run this migration to add order tracking and expiry functionality

-- Add order_id column if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'trades' AND column_name = 'order_id'
  ) THEN
    ALTER TABLE trades ADD COLUMN order_id VARCHAR(100);
    CREATE INDEX IF NOT EXISTS idx_trades_order_id ON trades(order_id);
    COMMENT ON COLUMN trades.order_id IS 'Bybit order ID for tracking and cancellation';
  END IF;
END $$;


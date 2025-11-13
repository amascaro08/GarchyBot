-- Migration: Add use_daily_open_entry column to bot_configs table
-- Run this if you already have the bot_configs table created

ALTER TABLE bot_configs
ADD COLUMN IF NOT EXISTS use_daily_open_entry BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN bot_configs.use_daily_open_entry IS 'Enable/disable entries at daily open level';


-- Add configuration for daily open entry trades
-- Run this migration on your Neon database

-- Add column for enabling/disabling daily open entries
ALTER TABLE bot_configs 
ADD COLUMN IF NOT EXISTS use_daily_open_entry BOOLEAN NOT NULL DEFAULT true;

-- Add comment
COMMENT ON COLUMN bot_configs.use_daily_open_entry IS 'Enable/disable entries at daily open level';

-- Show updated schema
SELECT column_name, data_type, column_default, is_nullable
FROM information_schema.columns
WHERE table_name = 'bot_configs'
ORDER BY ordinal_position;

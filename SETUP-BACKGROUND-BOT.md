# 🤖 Background Bot Setup Guide

This guide will help you set up your trading bot to run in the background on Vercel using Neon Database and cron jobs.

## 📋 Overview

**Before:** Bot runs in the browser, stops when page closes  
**After:** Bot runs on Vercel servers every minute, 24/7

## 🗄️ Step 1: Database Setup

### 1.1 Run the SQL Schema

You need to create the database tables. Connect to your Neon database and run the schema:

**Option A: Using Neon Console**
1. Go to https://console.neon.tech
2. Select your project: `ed80ba47-f242-4387-8ee7-c05f7737bb04`
3. Click on "SQL Editor" in the left sidebar
4. Copy the entire contents of `schema.sql`
5. Paste and click "Run"

**Option B: Using psql command line**
```bash
psql "postgresql://neondb_owner:npg_sdrViK9TXF5p@ep-autumn-forest-ah1r9pnr-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require" -f schema.sql
```

**Option C: Using Node.js script**
```bash
node -e "
const { Client } = require('pg');
const fs = require('fs');
const client = new Client({ connectionString: process.env.POSTGRES_URL });
client.connect().then(() => {
  const sql = fs.readFileSync('schema.sql', 'utf8');
  return client.query(sql);
}).then(() => {
  console.log('Schema created successfully!');
  client.end();
}).catch(console.error);
"
```

### 1.2 Verify Tables Created

Run this query to verify:
```sql
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' 
ORDER BY table_name;
```

You should see:
- `users`
- `bot_configs`
- `trades`
- `activity_logs`

## ⚙️ Step 2: Environment Variables

### 2.1 Local Development

Your `.env.local` file should already have:
```env
# Database
POSTGRES_URL=postgresql://neondb_owner:npg_sdrViK9TXF5p@ep-autumn-forest-ah1r9pnr-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require

# Stack Auth
NEXT_PUBLIC_STACK_PROJECT_ID=ed80ba47-f242-4387-8ee7-c05f7737bb04
NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY=pck_rvcqjddcdy3jjfdw8phhz6k6p9a0q0jnvanvzq09jvjkr
STACK_SECRET_SERVER_KEY=ssk_g6khcygwnt1f7myr9hjqw2ftkbd2sn4w27arb2jrjqn1g

# Cron Secret
CRON_SECRET=change-this-to-a-random-secret

# Demo Mode
DEMO_MODE=true
```

### 2.2 Production (Vercel)

Add these environment variables in Vercel Dashboard:

1. Go to your Vercel project
2. Click Settings → Environment Variables
3. Add each variable:

| Variable | Value | Notes |
|----------|-------|-------|
| `POSTGRES_URL` | Your Neon connection string | From Neon dashboard |
| `NEXT_PUBLIC_STACK_PROJECT_ID` | `ed80ba47-f242-4387-8ee7-c05f7737bb04` | Stack Auth |
| `NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY` | `pck_rvcqjddcdy3jjfdw8phhz6k6p9a0q0jnvanvzq09jvjkr` | Stack Auth |
| `STACK_SECRET_SERVER_KEY` | `ssk_g6khcygwnt1f7myr9hjqw2ftkbd2sn4w27arb2jrjqn1g` | Stack Auth |
| `CRON_SECRET` | Generate random string | See below |
| `DEMO_MODE` | `true` or `false` | Use `true` for now |

**Generate CRON_SECRET:**
```bash
openssl rand -base64 32
```

## 🚀 Step 3: Deploy to Vercel

### 3.1 Deploy

```bash
git add .
git commit -m "Add background bot with database"
git push
```

Vercel will automatically deploy.

### 3.2 Verify Cron Job

1. Go to Vercel Dashboard → Your Project → Cron Jobs
2. You should see: `/api/cron/bot-runner` scheduled every minute
3. Click "Trigger" to test manually

## 🧪 Step 4: Test the System

### 4.1 Test Locally

```bash
# Start dev server
npm run dev

# In another terminal, trigger cron manually
curl -X POST http://localhost:3000/api/cron/bot-runner \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
```

### 4.2 Test API Endpoints

**Get bot status:**
```bash
curl http://localhost:3000/api/bot/status
```

**Start bot:**
```bash
curl -X POST http://localhost:3000/api/bot/start
```

**Stop bot:**
```bash
curl -X POST http://localhost:3000/api/bot/stop
```

**Update config:**
```bash
curl -X POST http://localhost:3000/api/bot/config \
  -H "Content-Type: application/json" \
  -d '{"symbol": "ETHUSDT", "max_trades": 5}'
```

## 📊 Step 5: Monitor Your Bot

### View Logs in Vercel

1. Vercel Dashboard → Your Project → Logs
2. Filter by `/api/cron/bot-runner`
3. You'll see "[CRON] ..." messages every minute

### View Activity in Database

```sql
-- Recent activity logs
SELECT * FROM activity_logs 
ORDER BY created_at DESC 
LIMIT 20;

-- Current bot status
SELECT 
  bc.symbol,
  bc.is_running,
  bc.max_trades,
  bc.daily_pnl,
  bc.last_polled_at,
  COUNT(t.id) as open_trades
FROM bot_configs bc
LEFT JOIN trades t ON t.bot_config_id = bc.id AND t.status = 'open'
GROUP BY bc.id;

-- Recent trades
SELECT * FROM trades 
ORDER BY entry_time DESC 
LIMIT 10;
```

## 🔧 How It Works

### Architecture

```
┌─────────────────────────────────────────────────┐
│          Vercel Cron Job (Every Minute)         │
│         /api/cron/bot-runner                    │
└──────────────────┬──────────────────────────────┘
                   │
                   ▼
         ┌─────────────────────┐
         │  Neon Database       │
         │  - bot_configs       │
         │  - trades            │
         │  - activity_logs     │
         └─────────────────────┘
                   │
                   ▼
         ┌─────────────────────┐
         │  For each running   │
         │  bot:                │
         │  1. Fetch candles    │
         │  2. Check signals    │
         │  3. Manage trades    │
         │  4. Update P&L       │
         └─────────────────────┘
```

### Cron Schedule

- **Frequency:** Every minute (`* * * * *`)
- **Timeout:** 10 seconds (Vercel free tier)
- **Execution:** Serverless function on Vercel Edge Network

### State Management

All bot state is stored in Neon Database:
- ✅ Bot configuration (symbol, leverage, risk settings)
- ✅ Open trades (entry, TP, SL, position size)
- ✅ Daily P&L tracking
- ✅ Activity logs

## 🔐 Security Notes

1. **CRON_SECRET:** Keep this secret! Anyone with this can trigger your bot.
2. **Database credentials:** Never commit to git (use `.env.local`)
3. **Stack Auth:** Handles user authentication securely
4. **DEMO_MODE:** Set to `false` in production to require auth

## 🐛 Troubleshooting

### Cron job not running

1. Check Vercel Dashboard → Cron Jobs
2. Verify `vercel.json` has cron configuration
3. Check function logs for errors

### Database connection errors

1. Verify `POSTGRES_URL` in environment variables
2. Check Neon dashboard for connection limits
3. Ensure IP is not blocked

### Bot not starting

1. Check daily limits (might have hit target/stop)
2. Verify bot config exists in database
3. Check activity logs for errors:
```sql
SELECT * FROM activity_logs WHERE level = 'error' ORDER BY created_at DESC;
```

### No trades executing

1. Check if bot is marked as running:
```sql
SELECT * FROM bot_configs WHERE is_running = true;
```
2. Verify signal logic in cron logs
3. Check if max_trades limit reached

## 📈 Next Steps

### Upgrade to Production Auth

Currently in DEMO_MODE. To use real auth:

1. Set `DEMO_MODE=false`
2. Upgrade React to v19 (for Stack Auth):
```bash
npm install react@19 react-dom@19
```
3. Wrap your app with Stack Auth provider

### Optimize Cron Frequency

Vercel free tier: 1-minute minimum  
Paid tier: Can run more frequently if needed

### Add Notifications

- Email alerts for trades
- Webhook notifications
- Telegram bot integration

### Multi-User Support

Schema supports multiple users out of the box:
- Each user has their own bot_config
- Trades are isolated per user
- Daily P&L tracked per user

## ❓ FAQ

**Q: Will my bot keep running if I close my browser?**  
A: Yes! The bot runs on Vercel's servers via cron jobs.

**Q: How much does this cost?**  
A: Vercel free tier includes cron jobs. Neon has a free tier with generous limits.

**Q: Can multiple users use this?**  
A: Yes! The database schema supports multiple users. Each user gets their own bot configuration.

**Q: What happens if the cron job fails?**  
A: Vercel will retry automatically. Check logs for errors.

**Q: How do I stop the bot?**  
A: Call `/api/bot/stop` or set `is_running = false` in database.

## 📞 Support

For issues or questions:
1. Check Vercel logs
2. Check Neon database logs
3. Review activity_logs table in database
4. Check this documentation

---

**Congratulations! Your bot is now running in the background! 🎉**

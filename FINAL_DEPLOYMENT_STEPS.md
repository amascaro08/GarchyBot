# 🚀 Final Deployment Steps

## ✅ What's Already Done

- ✅ Database schema created (`schema.sql`)
- ✅ Cron job configured (runs every minute)
- ✅ Bot persistence fixed (loads state from database)
- ✅ Build working locally
- ✅ Code pushed to GitHub

---

## 📋 Quick Setup (3 Steps)

### Step 1: Set Environment Variables in Vercel

Go to **Vercel Dashboard** → Your Project → **Settings** → **Environment Variables**

Add these variables:

| Variable | Value | Where to Get It |
|----------|-------|-----------------|
| `POSTGRES_URL` | Copy from `STORAGE_POSTGRES_URL` | Same as STORAGE_POSTGRES_URL |
| `CRON_SECRET` | Generate random string | Run: `openssl rand -base64 32` |

**Important:** Vercel Storage adds `STORAGE_POSTGRES_URL` automatically, but `@vercel/postgres` needs `POSTGRES_URL`. Just copy the same value!

### Step 2: Initialize Database (One Time)

After deployment succeeds, run locally:

```bash
# Make sure POSTGRES_URL is in your .env.local
node run-schema.js
```

This creates all database tables. You only need to run this **once**.

### Step 3: Test Your Bot!

1. Visit your deployed app
2. Click "Start Bot"
3. **Close the browser**
4. Wait 1-2 minutes
5. **Open the app again**
6. ✅ Bot should show as "Running"!
7. ✅ Check activity logs for cron execution

---

## 🔍 Verify It's Working

### Check Vercel Logs
1. Vercel Dashboard → Your Project → **Logs**
2. Filter by: `/api/cron/bot-runner`
3. Should see messages every minute:
   ```
   [CRON] Bot runner started at 2025-11-10...
   [CRON] Found 1 running bot(s)
   [CRON] Processing bot for user...
   ```

### Check Database
```bash
node test-db-connection.js
```

Should show your tables:
- ✓ activity_logs
- ✓ bot_configs
- ✓ trades
- ✓ users

### Check Bot Status
Visit: `https://your-app.vercel.app/api/bot/status`

Should return JSON with:
```json
{
  "success": true,
  "botConfig": { "is_running": true, ... },
  "trades": [...],
  "activityLogs": [...]
}
```

---

## 🎯 How Background Bot Works

```
┌─────────────────────────────────────┐
│   Every Minute (Vercel Cron)       │
│   /api/cron/bot-runner              │
└──────────────┬──────────────────────┘
               │
               ▼
      ┌────────────────┐
      │  Neon Database  │
      │  - bot_configs  │ ← Stores if bot is running
      │  - trades       │ ← All open/closed trades
      │  - activity_logs│ ← Bot activity
      └────────┬───────┘
               │
               ▼
   ┌──────────────────────────┐
   │  For each running bot:   │
   │  1. Fetch market data    │
   │  2. Calculate signals    │
   │  3. Check TP/SL          │
   │  4. Enter new trades     │
   │  5. Update P&L           │
   │  6. Log activity         │
   └──────────────────────────┘
```

### The Magic:
- ✅ Bot runs on **Vercel's servers** (not your browser)
- ✅ Cron triggers every minute automatically
- ✅ Database persists all state
- ✅ UI loads state from database on page load

---

## 🐛 Troubleshooting

### Build Fails
```bash
# Test build locally first
npm run build

# If it works locally but fails on Vercel:
# - Check environment variables in Vercel
# - Verify latest code is pushed: git log --oneline -3
```

### Database Connection Error
```bash
# Test connection
node test-db-connection.js

# If it fails:
# 1. Check POSTGRES_URL in .env.local
# 2. Copy value from STORAGE_POSTGRES_URL in Vercel
# 3. Verify connection string format
```

### Bot Not Running in Background
```sql
-- Check if bot is marked as running
SELECT * FROM bot_configs WHERE is_running = true;

-- Check cron activity
SELECT * FROM activity_logs 
WHERE created_at > NOW() - INTERVAL '10 minutes'
ORDER BY created_at DESC;
```

### No Trades Executing
1. Check Vercel logs for errors
2. Verify cron job is enabled in Vercel Dashboard
3. Check activity_logs table for signal detections
4. Ensure bot is running: `SELECT is_running FROM bot_configs;`

---

## 📊 Monitoring

### Daily Check
```sql
-- Today's activity
SELECT 
  COUNT(*) as total_trades,
  SUM(CASE WHEN status = 'tp' THEN 1 ELSE 0 END) as wins,
  SUM(CASE WHEN status = 'sl' THEN 1 ELSE 0 END) as losses,
  SUM(pnl) as total_pnl
FROM trades
WHERE entry_time::date = CURRENT_DATE;
```

### Bot Health
```sql
-- Last time bot was polled
SELECT 
  symbol,
  is_running,
  last_polled_at,
  NOW() - last_polled_at as time_since_last_poll
FROM bot_configs;
```

If `time_since_last_poll` > 5 minutes and bot is running, check Vercel logs!

---

## 🎉 Success Checklist

- [ ] Environment variables set in Vercel
- [ ] `POSTGRES_URL` added (same value as `STORAGE_POSTGRES_URL`)
- [ ] `CRON_SECRET` added
- [ ] Database schema initialized (`node run-schema.js`)
- [ ] Deployment succeeded
- [ ] Bot shows as running after page refresh
- [ ] Vercel logs show cron execution
- [ ] Database has activity_logs entries

---

**Your bot is now running 24/7 in the background!** 🚀

Close your browser, go to sleep, come back - the bot keeps trading! 💤📈

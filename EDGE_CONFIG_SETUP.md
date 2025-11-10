# Edge Config Authentication & Bot Persistence Setup

This implementation adds authentication and persistence to your trading bot using Vercel Edge Config.

## Features

✅ **Authentication**: Token-based authentication using Edge Config  
✅ **User Persistence**: Store user credentials and preferences  
✅ **Bot State Persistence**: Bot state persists across sessions  
✅ **Background Execution**: Bot runs automatically via Vercel Cron (every 2 minutes)  
✅ **Multi-User Support**: Each user has their own token and bot state  

## Setup Instructions

### 1. Configure Edge Config Environment Variables

Add these environment variables to your Vercel project:

```
EDGE_CONFIG_TOKEN=<your-edge-config-token>
EDGE_CONFIG_URL=<your-edge-config-connection-string>
```

**To get these values:**
1. Go to your Vercel project dashboard
2. Navigate to Storage → Edge Config
3. Find your Edge Config store (label: `garchy-bot-token`)
4. Copy the **Connection String** → this is your `EDGE_CONFIG_URL`
5. Create a Vercel API token with Edge Config access → this is your `EDGE_CONFIG_TOKEN`

### 2. API Endpoints

#### Authentication

**POST `/api/auth/login`**
- Creates a new token or validates existing token
- Stores user credentials (Bybit API keys)

```json
{
  "token": "optional-existing-token",
  "bybitApiKey": "your-api-key",
  "bybitApiSecret": "your-api-secret",
  "testnet": true
}
```

**GET `/api/auth/verify?token=xxx`**
- Verifies token and returns user info

#### Bot State Management

**GET `/api/bot/state?token=xxx`**
- Retrieves current bot state

**POST `/api/bot/state`**
- Updates bot state

```json
{
  "token": "your-token",
  "state": {
    "botRunning": true,
    "symbol": "BTCUSDT",
    "candleInterval": "5",
    "maxTrades": 3,
    "leverage": 1,
    "capital": 10000,
    "riskAmount": 100,
    "riskType": "fixed",
    "dailyTargetType": "percent",
    "dailyTargetAmount": 5,
    "dailyStopType": "percent",
    "dailyStopAmount": 3,
    "garchMode": "auto",
    "customKPct": 0.03,
    "useOrderBookConfirm": true
  }
}
```

#### Bot Execution

**GET `/api/bot/run?token=xxx`**
- Runs bot logic server-side (can be called manually or by cron)

**GET `/api/bot/cron`**
- Cron endpoint (runs every 2 minutes)
- Automatically executes bots for all active users

### 3. Cron Configuration

The bot is configured to run every 2 minutes via Vercel Cron (see `vercel.json`).

To change the schedule, edit `vercel.json`:
```json
{
  "crons": [
    {
      "path": "/api/bot/cron",
      "schedule": "*/2 * * * *"  // Every 2 minutes
    }
  ]
}
```

### 4. Usage Flow

1. **Initial Setup**:
   ```bash
   POST /api/auth/login
   {
     "bybitApiKey": "your-key",
     "bybitApiSecret": "your-secret",
     "testnet": true
   }
   ```
   Response includes a `token` - save this!

2. **Start Bot**:
   ```bash
   POST /api/bot/state
   {
     "token": "your-token",
     "state": {
       "botRunning": true,
       "symbol": "BTCUSDT",
       ...
     }
   }
   ```

3. **Bot Runs Automatically**:
   - Vercel Cron calls `/api/bot/cron` every 2 minutes
   - Cron endpoint finds all active bots and runs them
   - Bot state is persisted in Edge Config

4. **Check Status**:
   ```bash
   GET /api/bot/state?token=your-token
   ```

### 5. Order Placement

Orders now support token-based authentication:

```bash
POST /api/order
{
  "token": "your-token",  // Optional - uses Edge Config credentials
  "symbol": "BTCUSDT",
  "side": "Buy",
  "qty": 0.001,
  "testnet": true
}
```

If `token` is provided, it uses credentials from Edge Config. Otherwise, falls back to environment variables.

## Security Notes

- Tokens are stored in Edge Config (encrypted at rest)
- API keys are stored securely in Edge Config
- Cron endpoint can be protected with `CRON_SECRET` environment variable
- Each user's data is isolated by token

## Troubleshooting

1. **Edge Config not working**: Verify `EDGE_CONFIG_TOKEN` and `EDGE_CONFIG_URL` are set correctly
2. **Cron not running**: Check Vercel Cron logs in dashboard
3. **Bot not persisting**: Ensure bot state is saved via `/api/bot/state` before closing browser

## Next Steps

- Integrate authentication UI into your frontend
- Add token management UI
- Implement token refresh mechanism
- Add bot state sync to frontend

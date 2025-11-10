# 🔧 Vercel Storage (Neon) Setup

## The Issue

When you connect Neon through Vercel Storage, it adds environment variables with the `STORAGE_` prefix:
- `STORAGE_URL`
- `STORAGE_PRISMA_URL`
- etc.

But our code uses `@vercel/postgres` which looks for `POSTGRES_URL`.

## Solution: Add POSTGRES_URL Variable

In your **Vercel Dashboard**:

1. Go to your project → **Settings** → **Environment Variables**

2. Add a new variable:
   - **Key**: `POSTGRES_URL`
   - **Value**: Copy the value from `STORAGE_URL` (the same connection string)
   - **Environment**: All (Production, Preview, Development)

3. Or if you see these variables, map them:
   ```
   STORAGE_URL → Copy to POSTGRES_URL
   ```

## Quick Test

After adding `POSTGRES_URL`:

```bash
# Test connection locally
node test-db-connection.js

# Initialize database
node run-schema.js
```

## Alternative: Update .env.local

If Vercel added `STORAGE_URL` to your local environment, add this to `.env.local`:

```bash
# Copy from STORAGE_URL
POSTGRES_URL="postgresql://neondb_owner:npg_sdrViK9TXF5p@ep-autumn-forest-ah1r9pnr-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require"
```

## Verify in Vercel

1. Vercel Dashboard → Your Project → Settings → Environment Variables
2. You should see both:
   - `STORAGE_URL` (added by Neon integration)
   - `POSTGRES_URL` (add this manually, same value as STORAGE_URL)

## Why This Happens

- **Neon via Vercel Storage**: Uses `STORAGE_*` prefix
- **@vercel/postgres package**: Looks for `POSTGRES_*` prefix
- **Solution**: Set both (they point to the same database)

---

**Once POSTGRES_URL is set, the bot will connect to the database!** ✅

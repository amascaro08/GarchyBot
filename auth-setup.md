# Authentication Setup Guide

## Neon Database with Auth

Since you've enabled Neon Auth, you have several options for integrating authentication with the bot:

### Option 1: Use Neon Auth Directly (Recommended)

Neon provides built-in authentication that creates an `auth.users` table. To integrate:

1. **Update the schema to reference Neon's auth**:
   
   Instead of creating our own users table, we can reference Neon's:

```sql
-- Create bot_configs table that references auth.users directly
CREATE TABLE IF NOT EXISTS bot_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL, -- References auth.users.id (TEXT in Neon Auth)
  
  -- ... rest of the schema
);
```

2. **In your API routes**, get the authenticated user from Neon's session

### Option 2: Use Clerk (Popular with Next.js)

If you want to use Clerk for a better UX:

```bash
npm install @clerk/nextjs
```

Then wrap your app with `ClerkProvider` and use `auth()` in API routes.

### Option 3: Use NextAuth.js

```bash
npm install next-auth @auth/pg-adapter
```

Provides flexibility with multiple auth providers.

---

## Current Schema Compatibility

The provided schema uses a `users` table with `auth_user_id` field that can link to any auth provider:

- **Neon Auth**: `auth_user_id` → `auth.users.id`
- **Clerk**: `auth_user_id` → `clerk_user_id`
- **NextAuth**: `auth_user_id` → `accounts.userId`

---

## Quick Start (For Development)

For now, the schema includes a demo user. You can:

1. **Run the schema as-is** - it creates a test user
2. **Add authentication later** - just update the `auth_user_id` field when ready

---

## Which auth do you want to use?

Let me know and I'll configure it properly:
- [ ] Neon Auth (built-in)
- [ ] Clerk (easiest Next.js integration)
- [ ] NextAuth (most flexible)
- [ ] None for now (use demo user)

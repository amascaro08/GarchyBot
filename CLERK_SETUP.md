# 🔐 Clerk Setup Guide

## Step 1: Create Clerk Account

1. Go to https://dashboard.clerk.com
2. Sign up for free (no credit card required)
3. Create a new application
4. Choose authentication methods (email, Google, GitHub, etc.)

## Step 2: Get Your API Keys

1. In Clerk Dashboard, go to **API Keys**
2. Copy your keys:
   - **Publishable Key** (starts with `pk_test_` or `pk_live_`)
   - **Secret Key** (starts with `sk_test_` or `sk_live_`)

## Step 3: Add Keys to Environment Variables

### Local Development (`.env.local`):
```bash
# Replace these with your actual Clerk keys
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_your_key_here
CLERK_SECRET_KEY=sk_test_your_key_here
```

### Vercel Production:
1. Go to Vercel Dashboard → Your Project → Settings → Environment Variables
2. Add:
   - `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` = your publishable key
   - `CLERK_SECRET_KEY` = your secret key

## Step 4: Test Locally

```bash
# Start the dev server
npm run dev

# Visit http://localhost:3000
# You should be redirected to sign-in page
```

## Step 5: Deploy

```bash
git add .
git commit -m "Add Clerk authentication"
git push
```

## 🎯 What You Get with Clerk

- ✅ Beautiful sign-in/sign-up pages (no coding needed!)
- ✅ Email verification
- ✅ Password reset
- ✅ Social logins (Google, GitHub, etc.)
- ✅ User management dashboard
- ✅ Multi-factor authentication (optional)
- ✅ Session management
- ✅ User profile pages

## 🔒 Security Features

- ✅ Each user gets their own bot configuration
- ✅ Users can only see their own trades
- ✅ Protected API routes
- ✅ Automatic session management

## 💡 Free Tier Includes

- Up to 10,000 monthly active users
- All authentication features
- Email support

## 🚀 After Setup

Once Clerk keys are added:
1. Visit your app
2. You'll see a sign-in page
3. Create an account
4. Start your bot!
5. **Close the browser** - bot keeps running! ✅
6. Come back later - bot still running! ✅

---

**Note:** The bot will work in demo mode without Clerk, but you won't have:
- User accounts
- Login/logout
- Multiple user support

import { StackServerApp } from '@stackframe/stack';

/**
 * Stack Auth configuration and utilities
 */

export const stackServerApp = new StackServerApp({
  tokenStore: 'nextjs-cookie',
  urls: {
    signIn: '/sign-in',
    signUp: '/sign-up',
    afterSignIn: '/',
    afterSignUp: '/',
    afterSignOut: '/sign-in',
  },
});

/**
 * Get authenticated user from Stack Auth
 * Returns null if not authenticated
 */
export async function getAuthUser() {
  try {
    const user = await stackServerApp.getUser();
    return user;
  } catch (error) {
    console.error('Error getting auth user:', error);
    return null;
  }
}

/**
 * Get user ID (works in both demo mode and Stack Auth mode)
 */
export async function getUserId(): Promise<string | null> {
  // Check if demo mode is enabled
  if (process.env.DEMO_MODE === 'true') {
    return 'demo-user-id';
  }

  const user = await getAuthUser();
  return user?.id || null;
}

/**
 * Get user email (works in both demo mode and Stack Auth mode)
 */
export async function getUserEmail(): Promise<string | null> {
  // Check if demo mode is enabled
  if (process.env.DEMO_MODE === 'true') {
    return process.env.DEMO_USER_EMAIL || 'demo@example.com';
  }

  const user = await getAuthUser();
  return user?.primaryEmail || null;
}

/**
 * Require authentication - throws error if not authenticated
 */
export async function requireAuth() {
  const user = await getAuthUser();
  if (!user && process.env.DEMO_MODE !== 'true') {
    throw new Error('Unauthorized');
  }
  return user;
}

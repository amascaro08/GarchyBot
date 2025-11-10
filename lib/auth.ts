import { auth, currentUser } from '@clerk/nextjs/server';

/**
 * Auth utilities for the trading bot using Clerk
 */

/**
 * Get authenticated user ID from Clerk
 */
export async function getUserId(): Promise<string | null> {
  const { userId } = await auth();
  return userId;
}

/**
 * Get authenticated user email from Clerk
 */
export async function getUserEmail(): Promise<string | null> {
  const user = await currentUser();
  return user?.emailAddresses?.[0]?.emailAddress || null;
}

/**
 * Require authentication - throws if not authenticated
 */
export async function requireAuth() {
  const { userId } = await auth();
  if (!userId) {
    throw new Error('Unauthorized - Please sign in');
  }
  
  const user = await currentUser();
  return {
    id: userId,
    email: user?.emailAddresses?.[0]?.emailAddress || null,
  };
}

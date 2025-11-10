import { StackHandler } from '@stackframe/stack';
import { stackServerApp } from '@/lib/auth';

/**
 * Stack Auth API route handler
 * This handles all Stack Auth endpoints (sign-in, sign-up, etc.)
 */
export const GET = StackHandler(stackServerApp);
export const POST = StackHandler(stackServerApp);

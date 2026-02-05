import { query } from './_generated/server';

/**
 * Simple health check query to verify Convex connectivity.
 */
export const ping = query({
  args: {},
  handler: () => {
    return { status: 'ok', timestamp: Date.now() };
  },
});

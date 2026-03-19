/**
 * Common utilities for GitHub routes
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { createLogger } from '@automaker/utils';

const logger = createLogger('GitHub');

export const execAsync = promisify(exec);

// Extended PATH to include common tool installation locations
export const extendedPath = [
  process.env.PATH,
  '/opt/homebrew/bin',
  '/usr/local/bin',
  '/home/linuxbrew/.linuxbrew/bin',
  `${process.env.HOME}/.local/bin`,
]
  .filter(Boolean)
  .join(':');

export const execEnv = {
  ...process.env,
  PATH: extendedPath,
};

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function logError(error: unknown, context: string): void {
  logger.error(`${context}:`, error);
}

/**
 * Build exec env with optional GH_TOKEN injection for per-project account selection.
 */
export function getExecEnvWithGhToken(token?: string): Record<string, string | undefined> {
  if (!token) return execEnv;
  return { ...execEnv, GH_TOKEN: token };
}

/**
 * Build exec env with GH_TOKEN and git author identity for per-project account selection.
 * Sets GIT_AUTHOR_NAME, GIT_AUTHOR_EMAIL, GIT_COMMITTER_NAME, GIT_COMMITTER_EMAIL
 * so commits are attributed to the correct GitHub user.
 */
export function getExecEnvWithGitIdentity(
  token?: string,
  username?: string
): Record<string, string | undefined> {
  const env = getExecEnvWithGhToken(token);
  if (!username) return env;
  return {
    ...env,
    GIT_AUTHOR_NAME: username,
    GIT_AUTHOR_EMAIL: `${username}@users.noreply.github.com`,
    GIT_COMMITTER_NAME: username,
    GIT_COMMITTER_EMAIL: `${username}@users.noreply.github.com`,
  };
}

/**
 * GitHubAccountManager - Manages GitHub accounts for per-project gh CLI operations
 *
 * Stores GitHub tokens (PAT or from `gh auth login`) in global settings.
 * Provides per-project account selection via GH_TOKEN env var injection.
 */

import type { GitHubAccount } from '@automaker/types';
import { createLogger } from '@automaker/utils';
import type { SettingsService } from './settings-service.js';
import { execAsync, execEnv } from '../routes/github/routes/common.js';

const logger = createLogger('GitHubAccountManager');

/**
 * Mask a token for safe display (show first 7 and last 4 characters).
 */
function maskToken(value: string | undefined): string {
  if (!value) return '****';
  if (value.length <= 12) return '****';
  return `${value.substring(0, 7)}...${value.substring(value.length - 4)}`;
}

export class GitHubAccountManager {
  private settingsService: SettingsService;

  constructor(settingsService: SettingsService) {
    this.settingsService = settingsService;
  }

  /**
   * Get all accounts with tokens masked for API responses.
   */
  async getAccounts(): Promise<Array<GitHubAccount & { maskedToken: string }>> {
    const settings = await this.settingsService.getGlobalSettings();
    const accounts = settings.githubAccounts ?? [];
    return accounts.map((account) => ({
      ...account,
      token: '', // Never send raw token to client
      maskedToken: maskToken(account.token),
    }));
  }

  /**
   * Get all accounts with raw tokens (internal use only).
   */
  private async getRawAccounts(): Promise<GitHubAccount[]> {
    const settings = await this.settingsService.getGlobalSettings();
    return settings.githubAccounts ?? [];
  }

  /**
   * Add a new GitHub account after validating the token.
   */
  async addAccount(
    id: string,
    name: string,
    token: string,
    username: string
  ): Promise<GitHubAccount> {
    const settings = await this.settingsService.getGlobalSettings();
    const accounts = settings.githubAccounts ?? [];

    const newAccount: GitHubAccount = {
      id,
      name,
      username,
      token,
      enabled: true,
      createdAt: new Date().toISOString(),
    };

    accounts.push(newAccount);
    await this.settingsService.updateGlobalSettings({ githubAccounts: accounts });

    logger.info(`GitHub account added: "${name}" (${username})`);
    return newAccount;
  }

  /**
   * Update an existing account's name or enabled status.
   */
  async updateAccount(
    id: string,
    updates: { name?: string; enabled?: boolean }
  ): Promise<GitHubAccount | null> {
    const settings = await this.settingsService.getGlobalSettings();
    const accounts = settings.githubAccounts ?? [];
    const account = accounts.find((a) => a.id === id);

    if (!account) return null;

    if (updates.name !== undefined) account.name = updates.name;
    if (updates.enabled !== undefined) account.enabled = updates.enabled;

    await this.settingsService.updateGlobalSettings({ githubAccounts: accounts });
    logger.info(`GitHub account updated: "${account.name}"`);
    return account;
  }

  /**
   * Delete an account by ID.
   */
  async deleteAccount(id: string): Promise<boolean> {
    const settings = await this.settingsService.getGlobalSettings();
    const accounts = settings.githubAccounts ?? [];
    const index = accounts.findIndex((a) => a.id === id);

    if (index === -1) return false;

    const removed = accounts.splice(index, 1)[0];
    await this.settingsService.updateGlobalSettings({ githubAccounts: accounts });
    logger.info(`GitHub account deleted: "${removed.name}"`);
    return true;
  }

  /**
   * Get the raw token for a project's configured GitHub account.
   * Returns undefined if no account is configured or the account is not found/disabled.
   */
  async getTokenForProject(projectPath: string): Promise<string | undefined> {
    const account = await this.getAccountForProject(projectPath);
    return account?.token;
  }

  /**
   * Get the full account for a project's configured GitHub account.
   * Returns undefined if no account is configured or the account is not found/disabled.
   */
  async getAccountForProject(projectPath: string): Promise<GitHubAccount | undefined> {
    const projectSettings = await this.settingsService.getProjectSettings(projectPath);
    const accountId = projectSettings?.githubAccountId;
    if (!accountId) return undefined;

    const accounts = await this.getRawAccounts();
    return accounts.find((a) => a.id === accountId && a.enabled);
  }

  /**
   * Validate a GitHub token by calling `gh api user`.
   * Returns the username if valid, or an error message.
   */
  async validateToken(
    token: string
  ): Promise<{ valid: boolean; username?: string; error?: string }> {
    try {
      const { stdout } = await execAsync('gh api user --jq .login', {
        env: { ...execEnv, GH_TOKEN: token },
      });
      const username = stdout.trim();
      if (!username) {
        return { valid: false, error: 'Could not determine GitHub username' };
      }
      return { valid: true, username };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('401') || message.includes('Bad credentials')) {
        return { valid: false, error: 'Invalid token or insufficient permissions' };
      }
      return { valid: false, error: `Token validation failed: ${message}` };
    }
  }

  /**
   * Capture token from the local gh CLI auth state.
   * Runs `gh auth token` and `gh api user --jq .login`.
   */
  async captureToken(): Promise<{ token?: string; username?: string; error?: string }> {
    try {
      const { stdout: token } = await execAsync('gh auth token', { env: execEnv });
      const trimmedToken = token.trim();
      if (!trimmedToken) {
        return { error: 'No token found. Complete `gh auth login` first.' };
      }

      const { stdout: username } = await execAsync('gh api user --jq .login', {
        env: { ...execEnv, GH_TOKEN: trimmedToken },
      });

      return { token: trimmedToken, username: username.trim() };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { error: `Failed to capture token: ${message}` };
    }
  }

  /**
   * Auto-import the GH_TOKEN environment variable as a GitHub account
   * if one is set and no accounts exist yet. Called on server startup.
   */
  async autoImportEnvToken(): Promise<void> {
    const envToken = process.env.GH_TOKEN;
    if (!envToken) return;

    const settings = await this.settingsService.getGlobalSettings();
    const existing = settings.githubAccounts ?? [];

    // Check if this token is already imported
    if (existing.some((a) => a.token === envToken)) return;

    // Validate and get username
    const validation = await this.validateToken(envToken);
    if (!validation.valid || !validation.username) {
      logger.warn('GH_TOKEN env var present but invalid, skipping auto-import');
      return;
    }

    const { randomUUID } = await import('crypto');
    await this.addAccount(
      randomUUID(),
      `${validation.username} (auto-imported)`,
      envToken,
      validation.username
    );
    logger.info(`Auto-imported GH_TOKEN env var as GitHub account: ${validation.username}`);
  }
}

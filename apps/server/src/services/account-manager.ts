/**
 * AccountManager - Multi-account API key management with automatic failover
 *
 * Manages multiple Anthropic API accounts, tracks rate limits, and provides
 * automatic failover when accounts hit rate limits. Supports round-robin
 * distribution across concurrent features.
 *
 * For OAuth accounts, creates per-account HOME directories containing
 * .claude/.credentials.json so the SDK subprocess authenticates via its
 * standard credential resolution flow (instead of raw ANTHROPIC_AUTH_TOKEN).
 */

import type {
  AnthropicAccount,
  AccountFailoverSettings,
  RateLimitType,
  RateLimitEvent,
  ClaudeOAuthCredentials,
} from '@automaker/types';
import { createLogger } from '@automaker/utils';
import type { EventEmitter } from '../lib/events.js';
import type { SettingsService } from './settings-service.js';
import fs from 'fs/promises';
import path from 'path';

const logger = createLogger('AccountManager');

const MAX_RATE_LIMIT_EVENTS = 10;

interface ActiveAuthResult {
  apiKey?: string;
  accountHomeDir?: string;
  accountId: string | null;
}

export class AccountManager {
  private events: EventEmitter;
  private settingsService: SettingsService;
  private dataDir: string;

  /** In-memory map: featureId -> accountId */
  private featureAccountMap = new Map<string, string>();

  /** Round-robin index for concurrent distribution */
  private roundRobinIndex = 0;

  constructor(events: EventEmitter, settingsService: SettingsService, dataDir: string) {
    this.events = events;
    this.settingsService = settingsService;
    this.dataDir = dataDir;
  }

  /**
   * Returns the best available auth credentials + account ID.
   * Returns either apiKey or accountHomeDir depending on the account's authType.
   * Falls back to credentials.apiKeys.anthropic if no accounts are configured.
   */
  async getActiveAuth(): Promise<ActiveAuthResult | null> {
    const account = await this.getBestAvailableAccount();
    if (account) {
      if (account.authType === 'oauth') {
        const homeDir = await this.ensureAccountHomeDir(account);
        return {
          accountHomeDir: homeDir,
          accountId: account.id,
        };
      }
      return {
        apiKey: account.apiKey,
        accountId: account.id,
      };
    }

    // No accounts configured or all disabled — fall back to primary credentials
    const credentials = await this.settingsService.getCredentials();
    if (credentials?.apiKeys?.anthropic) {
      return { apiKey: credentials.apiKeys.anthropic, accountId: null };
    }

    return null;
  }

  /**
   * Get the HOME directory path for an OAuth account.
   * Returns undefined if the account doesn't have oauthCredentials.
   */
  async getAccountHomeDir(account: AnthropicAccount): Promise<string | undefined> {
    if (account.authType !== 'oauth') return undefined;
    return this.ensureAccountHomeDir(account);
  }

  /**
   * Creates/updates a per-account HOME directory with .claude/.credentials.json.
   * Returns the HOME path, or undefined if credentials are missing.
   */
  async ensureAccountHomeDir(account: AnthropicAccount): Promise<string | undefined> {
    if (!account.oauthCredentials) {
      if (account.authToken) {
        logger.warn(
          `Account "${account.name}" has legacy authToken but no oauthCredentials. ` +
            `Re-paste credentials from ~/.claude/.credentials.json to enable per-account HOME.`
        );
      }
      return undefined;
    }

    const homeDir = path.join(this.dataDir, 'account-homes', account.id);
    const claudeDir = path.join(homeDir, '.claude');

    await fs.mkdir(claudeDir, { recursive: true });

    // Write .credentials.json in the format the Claude CLI expects
    const credentialsFile = path.join(claudeDir, '.credentials.json');
    const credentialsData = {
      claudeAiOauth: account.oauthCredentials,
    };
    await fs.writeFile(credentialsFile, JSON.stringify(credentialsData, null, 2));

    // Write settings.json to prevent onboarding wizard
    const settingsFile = path.join(claudeDir, 'settings.json');
    try {
      await fs.access(settingsFile);
    } catch {
      // Only write if it doesn't exist
      await fs.writeFile(settingsFile, JSON.stringify({}, null, 2));
    }

    logger.debug(`[ensureAccountHomeDir] HOME dir ready for account "${account.name}": ${homeDir}`);
    return homeDir;
  }

  /**
   * Read back refreshed tokens from a per-account HOME directory after execution.
   * The Claude CLI may have refreshed the OAuth tokens during execution.
   */
  async syncCredentialsFromHomeDir(accountId: string): Promise<void> {
    const settings = await this.settingsService.getGlobalSettings();
    const accounts = settings.anthropicAccounts ?? [];
    const account = accounts.find((a) => a.id === accountId);

    if (!account || account.authType !== 'oauth') return;

    const credentialsFile = path.join(
      this.dataDir,
      'account-homes',
      accountId,
      '.claude',
      '.credentials.json'
    );

    try {
      const data = await fs.readFile(credentialsFile, 'utf-8');
      const parsed = JSON.parse(data);
      const oauth = parsed?.claudeAiOauth;

      if (oauth?.accessToken && oauth?.refreshToken && oauth?.expiresAt) {
        const updated: ClaudeOAuthCredentials = {
          accessToken: oauth.accessToken,
          refreshToken: oauth.refreshToken,
          expiresAt: oauth.expiresAt,
          scopes: oauth.scopes,
          subscriptionType: oauth.subscriptionType,
          rateLimitTier: oauth.rateLimitTier,
        };

        // Only update if tokens actually changed
        if (
          account.oauthCredentials?.accessToken !== updated.accessToken ||
          account.oauthCredentials?.refreshToken !== updated.refreshToken
        ) {
          account.oauthCredentials = updated;
          await this.settingsService.updateGlobalSettings({ anthropicAccounts: accounts });
          logger.info(`Synced refreshed credentials for account "${account.name}"`);
        }
      }
    } catch {
      // File may not exist or be unreadable — not critical
      logger.debug(`Could not sync credentials for account ${accountId}`);
    }
  }

  /**
   * Remove the per-account HOME directory for a deleted account.
   */
  async removeAccountHomeDir(accountId: string): Promise<void> {
    const homeDir = path.join(this.dataDir, 'account-homes', accountId);
    try {
      await fs.rm(homeDir, { recursive: true, force: true });
      logger.info(`Removed HOME dir for account ${accountId}`);
    } catch {
      // Ignore — dir may not exist
    }
  }

  /**
   * Filters enabled + not-rate-limited accounts, sorts by priority.
   * If all are rate-limited, returns the one with soonest resetAt.
   */
  async getBestAvailableAccount(): Promise<AnthropicAccount | null> {
    const settings = await this.settingsService.getGlobalSettings();
    const accounts = settings.anthropicAccounts ?? [];
    const failoverSettings = settings.accountFailoverSettings ?? {
      enabled: true,
      distributeConcurrent: true,
      resetBufferSeconds: 30,
    };

    const enabledAccounts = accounts.filter((a) => a.enabled);
    if (enabledAccounts.length === 0) return null;

    if (!failoverSettings.enabled) {
      // Failover disabled — just return highest priority enabled account
      return enabledAccounts.sort((a, b) => a.priority - b.priority)[0] ?? null;
    }

    // Split into available and rate-limited
    const available: AnthropicAccount[] = [];
    const rateLimited: AnthropicAccount[] = [];

    for (const account of enabledAccounts) {
      if (this.isAccountRateLimited(account, failoverSettings.resetBufferSeconds)) {
        rateLimited.push(account);
      } else {
        available.push(account);
      }
    }

    if (available.length > 0) {
      // Return highest priority available account
      return available.sort((a, b) => a.priority - b.priority)[0];
    }

    // All rate-limited — return the one with the soonest resetAt
    if (rateLimited.length > 0) {
      return rateLimited.sort((a, b) => {
        const resetA = a.rateLimitEvents[0]?.resetAt ?? '';
        const resetB = b.rateLimitEvents[0]?.resetAt ?? '';
        return resetA.localeCompare(resetB);
      })[0];
    }

    return null;
  }

  /**
   * Records a rate limit event against an account, persists to settings.
   */
  async recordRateLimitEvent(
    accountId: string,
    type: RateLimitType,
    resetAt: string
  ): Promise<void> {
    const settings = await this.settingsService.getGlobalSettings();
    const accounts = settings.anthropicAccounts ?? [];
    const account = accounts.find((a) => a.id === accountId);

    if (!account) {
      logger.warn(`Cannot record rate limit: account ${accountId} not found`);
      return;
    }

    const event: RateLimitEvent = {
      type,
      hitAt: new Date().toISOString(),
      resetAt,
      resetTimeString: this.formatResetTime(resetAt),
    };

    // Prepend new event, keep max 10
    account.rateLimitEvents = [event, ...account.rateLimitEvents].slice(0, MAX_RATE_LIMIT_EVENTS);

    await this.settingsService.updateGlobalSettings({ anthropicAccounts: accounts });

    logger.info(
      `Rate limit recorded for account "${account.name}" (${type}), resets at ${resetAt}`
    );

    this.events.emit('account:rate-limited', {
      accountId,
      accountName: account.name,
      type,
      resetAt,
      resetTimeString: event.resetTimeString,
    });
  }

  /**
   * Checks if an account is currently rate-limited.
   */
  isAccountRateLimited(account: AnthropicAccount, resetBufferSeconds = 30): boolean {
    const latestEvent = account.rateLimitEvents[0];
    if (!latestEvent) return false;

    const resetTime = new Date(latestEvent.resetAt).getTime();
    const now = Date.now();
    const bufferMs = resetBufferSeconds * 1000;

    return now < resetTime + bufferMs;
  }

  /**
   * Round-robin assignment of available accounts across features for concurrent execution.
   */
  async distributeAccounts(featureIds: string[]): Promise<Map<string, string>> {
    const settings = await this.settingsService.getGlobalSettings();
    const accounts = settings.anthropicAccounts ?? [];
    const failoverSettings = settings.accountFailoverSettings ?? {
      enabled: true,
      distributeConcurrent: true,
      resetBufferSeconds: 30,
    };

    const assignments = new Map<string, string>();

    const availableAccounts = accounts
      .filter(
        (a) => a.enabled && !this.isAccountRateLimited(a, failoverSettings.resetBufferSeconds)
      )
      .sort((a, b) => a.priority - b.priority);

    if (availableAccounts.length === 0) return assignments;

    for (const featureId of featureIds) {
      // Skip if already assigned
      if (this.featureAccountMap.has(featureId)) continue;

      const account = availableAccounts[this.roundRobinIndex % availableAccounts.length];
      assignments.set(featureId, account.id);
      this.featureAccountMap.set(featureId, account.id);
      this.roundRobinIndex++;
    }

    return assignments;
  }

  /**
   * Track which feature uses which account (in-memory map).
   */
  assignAccountToFeature(featureId: string, accountId: string): void {
    this.featureAccountMap.set(featureId, accountId);
  }

  /**
   * Lookup which account is assigned to a feature.
   */
  getAccountForFeature(featureId: string): string | undefined {
    return this.featureAccountMap.get(featureId);
  }

  /**
   * Cleanup after feature execution.
   */
  releaseFeatureAccount(featureId: string): void {
    this.featureAccountMap.delete(featureId);
  }

  /**
   * Update lastUsedAt for an account after successful use.
   */
  async recordSuccess(accountId: string): Promise<void> {
    const settings = await this.settingsService.getGlobalSettings();
    const accounts = settings.anthropicAccounts ?? [];
    const account = accounts.find((a) => a.id === accountId);

    if (!account) return;

    account.lastUsedAt = new Date().toISOString();
    await this.settingsService.updateGlobalSettings({ anthropicAccounts: accounts });
  }

  /**
   * Returns all accounts with computed isRateLimited status for UI.
   */
  async getAccountStatuses(): Promise<
    Array<
      AnthropicAccount & {
        isRateLimited: boolean;
        resetTimeString?: string;
      }
    >
  > {
    const settings = await this.settingsService.getGlobalSettings();
    const accounts = settings.anthropicAccounts ?? [];
    const failoverSettings = settings.accountFailoverSettings ?? {
      enabled: true,
      distributeConcurrent: true,
      resetBufferSeconds: 30,
    };

    return accounts.map((account) => {
      const isRateLimited = this.isAccountRateLimited(account, failoverSettings.resetBufferSeconds);
      const latestEvent = account.rateLimitEvents[0];

      return {
        ...account,
        isRateLimited,
        resetTimeString: isRateLimited ? this.formatResetTime(latestEvent?.resetAt) : undefined,
      };
    });
  }

  /**
   * Format a reset time as a human-readable relative string.
   */
  private formatResetTime(resetAt?: string): string | undefined {
    if (!resetAt) return undefined;

    const resetTime = new Date(resetAt).getTime();
    const now = Date.now();
    const diffMs = resetTime - now;

    if (diffMs <= 0) return 'now';

    const diffSeconds = Math.ceil(diffMs / 1000);
    if (diffSeconds < 60) return `in ${diffSeconds}s`;

    const diffMinutes = Math.ceil(diffSeconds / 60);
    if (diffMinutes < 60) return `in ${diffMinutes}m`;

    const diffHours = Math.ceil(diffMinutes / 60);
    return `in ${diffHours}h`;
  }
}

import { spawn } from 'child_process';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { ClaudeUsage } from '../routes/claude/types.js';
import { createLogger } from '@automaker/utils';

/**
 * Claude Usage Service
 *
 * Fetches usage data by making a lightweight API call to the Anthropic Messages API
 * using the OAuth token from Claude CLI's credentials file. The rate limit headers
 * in the response contain subscription usage information.
 *
 * Falls back to checking Claude CLI availability for basic health checks.
 */
const logger = createLogger('ClaudeUsage');

interface OAuthCredentials {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  subscriptionType?: string;
  rateLimitTier?: string;
}

interface CredentialsFile {
  claudeAiOauth?: OAuthCredentials;
}

export class ClaudeUsageService {
  private claudeBinary = 'claude';
  private isWindows = os.platform() === 'win32';

  /**
   * Check if Claude CLI is available on the system
   */
  async isAvailable(): Promise<boolean> {
    // First check if we have credentials
    const creds = this.readCredentials();
    if (creds) return true;

    // Fall back to checking CLI binary
    return new Promise((resolve) => {
      const checkCmd = this.isWindows ? 'where' : 'which';
      const proc = spawn(checkCmd, [this.claudeBinary]);
      proc.on('close', (code) => {
        resolve(code === 0);
      });
      proc.on('error', () => {
        resolve(false);
      });
    });
  }

  /**
   * Fetch usage data by making a lightweight API call and reading rate limit headers
   */
  async fetchUsageData(): Promise<ClaudeUsage> {
    const creds = this.readCredentials();
    if (!creds) {
      throw new Error(
        "Authentication required - no Claude CLI credentials found. Please run 'claude login'"
      );
    }

    // Check if token is expired
    if (Date.now() > creds.expiresAt) {
      throw new Error(
        "token_expired: Claude CLI OAuth token has expired. Please run 'claude login' to re-authenticate."
      );
    }

    return this.fetchUsageViaApi(creds.accessToken);
  }

  /**
   * Read OAuth credentials from the Claude CLI credentials file
   */
  private readCredentials(): OAuthCredentials | null {
    const credentialsPath = path.join(os.homedir(), '.claude', '.credentials.json');

    try {
      if (!fs.existsSync(credentialsPath)) {
        logger.debug('No credentials file found at', credentialsPath);
        return null;
      }

      const data = fs.readFileSync(credentialsPath, 'utf-8');
      const parsed: CredentialsFile = JSON.parse(data);

      if (!parsed.claudeAiOauth?.accessToken) {
        logger.debug('No OAuth credentials in credentials file');
        return null;
      }

      return parsed.claudeAiOauth;
    } catch (error) {
      logger.warn('Failed to read credentials file:', error);
      return null;
    }
  }

  /**
   * Make a minimal API call and extract usage data from rate limit headers.
   *
   * Uses claude-haiku-4-5 with max_tokens=1 to minimize cost (~$0.00001).
   * The anthropic-ratelimit-unified-* headers in the response contain
   * subscription usage information for Claude Max/Team/Pro plans.
   */
  private async fetchUsageViaApi(accessToken: string): Promise<ClaudeUsage> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': accessToken,
          'anthropic-version': '2023-06-01',
          'anthropic-beta': 'oauth-2025-04-20',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5',
          max_tokens: 1,
          messages: [{ role: 'user', content: '.' }],
        }),
        signal: controller.signal,
      });

      if (response.status === 401) {
        throw new Error(
          "token_expired: Claude CLI OAuth token is invalid or expired. Please run 'claude login' to re-authenticate."
        );
      }

      if (!response.ok && response.status !== 200) {
        const body = await response.text().catch(() => '');
        throw new Error(`API request failed with status ${response.status}: ${body}`);
      }

      // Consume the response body to avoid resource leaks
      await response.text().catch(() => '');

      return this.parseRateLimitHeaders(response.headers);
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Parse the anthropic-ratelimit-unified-* headers into ClaudeUsage format.
   *
   * Headers we look for:
   * - anthropic-ratelimit-unified-5h-utilization: 0.05 (session, 0-1 scale)
   * - anthropic-ratelimit-unified-5h-reset: 1774357200 (unix timestamp)
   * - anthropic-ratelimit-unified-5h-status: allowed|warning|rejected
   * - anthropic-ratelimit-unified-7d-utilization: 0.02 (weekly, 0-1 scale)
   * - anthropic-ratelimit-unified-7d-reset: 1774882800 (unix timestamp)
   * - anthropic-ratelimit-unified-7d-status: allowed|warning|rejected
   * - anthropic-ratelimit-unified-overage-status: allowed|rejected
   * - anthropic-ratelimit-unified-overage-disabled-reason: (reason)
   * - anthropic-ratelimit-unified-fallback-percentage: 0.5 (sonnet fallback %)
   */
  private parseRateLimitHeaders(headers: Headers): ClaudeUsage {
    const get = (name: string) => headers.get(name) || '';

    // Session (5-hour window)
    const sessionUtilization = parseFloat(get('anthropic-ratelimit-unified-5h-utilization')) || 0;
    const sessionResetUnix = parseInt(get('anthropic-ratelimit-unified-5h-reset'), 10) || 0;
    const sessionPercentage = Math.round(sessionUtilization * 100);
    const sessionResetTime = sessionResetUnix
      ? new Date(sessionResetUnix * 1000).toISOString()
      : this.getDefaultResetTime('session');
    const sessionResetText = sessionResetUnix ? this.formatResetText(sessionResetUnix) : '';

    // Weekly (7-day window)
    const weeklyUtilization = parseFloat(get('anthropic-ratelimit-unified-7d-utilization')) || 0;
    const weeklyResetUnix = parseInt(get('anthropic-ratelimit-unified-7d-reset'), 10) || 0;
    const weeklyPercentage = Math.round(weeklyUtilization * 100);
    const weeklyResetTime = weeklyResetUnix
      ? new Date(weeklyResetUnix * 1000).toISOString()
      : this.getDefaultResetTime('weekly');
    const weeklyResetText = weeklyResetUnix ? this.formatResetText(weeklyResetUnix) : '';

    // The unified API headers don't provide per-model breakdowns.
    // Use the same weekly utilization for the sonnet card since it's all unified now.
    const sonnetWeeklyPercentage = weeklyPercentage;

    // Overage (extra usage billing)
    const overageStatus = get('anthropic-ratelimit-unified-overage-status');
    const overageResetUnix = parseInt(get('anthropic-ratelimit-unified-overage-reset'), 10) || 0;
    const hasOverage = overageStatus === 'allowed' || overageStatus === 'allowed_warning';

    return {
      sessionTokensUsed: 0,
      sessionLimit: 0,
      sessionPercentage,
      sessionResetTime,
      sessionResetText,

      weeklyTokensUsed: 0,
      weeklyLimit: 0,
      weeklyPercentage,
      weeklyResetTime,
      weeklyResetText,

      sonnetWeeklyTokensUsed: 0,
      sonnetWeeklyPercentage,
      sonnetResetText: weeklyResetText,

      costUsed: null,
      costLimit: hasOverage && overageResetUnix ? 0 : null,
      costCurrency: null,

      lastUpdated: new Date().toISOString(),
      userTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
  }

  /**
   * Format a unix timestamp into a human-readable reset text
   */
  private formatResetText(unixTimestamp: number): string {
    const resetDate = new Date(unixTimestamp * 1000);
    const now = new Date();
    const diff = resetDate.getTime() - now.getTime();

    if (diff <= 0) {
      return 'Resets soon';
    }

    // Less than 1 hour: show minutes
    if (diff < 3600000) {
      const mins = Math.ceil(diff / 60000);
      return `Resets in ${mins}m`;
    }

    // Less than 24 hours: show hours and minutes
    if (diff < 86400000) {
      const hours = Math.floor(diff / 3600000);
      const mins = Math.ceil((diff % 3600000) / 60000);
      return mins > 0 ? `Resets in ${hours}h ${mins}m` : `Resets in ${hours}h`;
    }

    // More than 24 hours: show date
    const month = resetDate.toLocaleString('en-US', { month: 'short' });
    const day = resetDate.getDate();
    const timeStr = resetDate
      .toLocaleString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      })
      .toLowerCase();
    return `Resets ${month} ${day}, ${timeStr}`;
  }

  /**
   * Get default reset time based on usage type
   */
  private getDefaultResetTime(type: string): string {
    const now = new Date();

    if (type === 'session') {
      return new Date(now.getTime() + 5 * 60 * 60 * 1000).toISOString();
    } else {
      const result = new Date(now);
      const currentDay = now.getDay();
      let daysUntilMonday = (1 + 7 - currentDay) % 7;
      if (daysUntilMonday === 0) daysUntilMonday = 7;
      result.setDate(result.getDate() + daysUntilMonday);
      result.setHours(12, 59, 0, 0);
      return result.toISOString();
    }
  }
}

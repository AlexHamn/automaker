import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ClaudeUsageService } from '@/services/claude-usage-service.js';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';

vi.mock('child_process');
vi.mock('fs');
vi.mock('os');

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('claude-usage-service.ts', () => {
  let service: ClaudeUsageService;
  let mockSpawnProcess: any;

  const validCredentials = {
    claudeAiOauth: {
      accessToken: 'sk-ant-oat01-test-token',
      refreshToken: 'sk-ant-ort01-test-refresh',
      expiresAt: Date.now() + 3600000, // 1 hour from now
      subscriptionType: 'max',
      rateLimitTier: 'default_claude_max_5x',
    },
  };

  const expiredCredentials = {
    claudeAiOauth: {
      ...validCredentials.claudeAiOauth,
      expiresAt: Date.now() - 3600000, // 1 hour ago
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ClaudeUsageService();

    // Default: credentials file exists with valid token
    vi.mocked(os.homedir).mockReturnValue('/home/testuser');
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(validCredentials));

    // Mock spawn for isAvailable fallback
    mockSpawnProcess = {
      on: vi.fn(),
      kill: vi.fn(),
    };
    vi.mocked(spawn).mockReturnValue(mockSpawnProcess as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('isAvailable', () => {
    it('should return true when credentials exist', async () => {
      const result = await service.isAvailable();
      expect(result).toBe(true);
    });

    it('should fall back to CLI check when no credentials', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      vi.mocked(os.platform).mockReturnValue('linux');
      mockSpawnProcess.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'close') callback(0);
        return mockSpawnProcess;
      });

      const result = await service.isAvailable();
      expect(result).toBe(true);
      expect(spawn).toHaveBeenCalledWith('which', ['claude']);
    });

    it('should return false when no credentials and CLI not found', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      vi.mocked(os.platform).mockReturnValue('linux');
      mockSpawnProcess.on.mockImplementation((event: string, callback: Function) => {
        if (event === 'close') callback(1);
        return mockSpawnProcess;
      });

      const result = await service.isAvailable();
      expect(result).toBe(false);
    });
  });

  describe('fetchUsageData', () => {
    it('should throw when no credentials file exists', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      await expect(service.fetchUsageData()).rejects.toThrow('no Claude CLI credentials found');
    });

    it('should throw when token is expired', async () => {
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(expiredCredentials));

      await expect(service.fetchUsageData()).rejects.toThrow('token_expired');
    });

    it('should make API call and parse rate limit headers', async () => {
      const mockHeaders = new Headers({
        'anthropic-ratelimit-unified-5h-utilization': '0.25',
        'anthropic-ratelimit-unified-5h-reset': String(Math.floor(Date.now() / 1000) + 3600),
        'anthropic-ratelimit-unified-5h-status': 'allowed',
        'anthropic-ratelimit-unified-7d-utilization': '0.10',
        'anthropic-ratelimit-unified-7d-reset': String(Math.floor(Date.now() / 1000) + 86400),
        'anthropic-ratelimit-unified-7d-status': 'allowed',
        'anthropic-ratelimit-unified-fallback-percentage': '0.5',
        'anthropic-ratelimit-unified-overage-status': 'rejected',
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: mockHeaders,
        text: () => Promise.resolve('{}'),
      });

      const result = await service.fetchUsageData();

      expect(result.sessionPercentage).toBe(25);
      expect(result.weeklyPercentage).toBe(10);
      expect(result.sonnetWeeklyPercentage).toBe(10); // same as weekly (unified)
      expect(result.lastUpdated).toBeDefined();
      expect(result.sessionResetText).toMatch(/Resets in/);
      expect(result.weeklyResetText).toMatch(/Resets/);

      // Verify API call
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.anthropic.com/v1/messages',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'x-api-key': 'sk-ant-oat01-test-token',
            'anthropic-beta': 'oauth-2025-04-20',
          }),
        })
      );
    });

    it('should throw on 401 response (expired token)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        headers: new Headers(),
        text: () => Promise.resolve('{"error": "invalid x-api-key"}'),
      });

      await expect(service.fetchUsageData()).rejects.toThrow('token_expired');
    });

    it('should handle API errors gracefully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        headers: new Headers(),
        text: () => Promise.resolve('Internal Server Error'),
      });

      await expect(service.fetchUsageData()).rejects.toThrow('API request failed with status 500');
    });

    it('should handle network errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      await expect(service.fetchUsageData()).rejects.toThrow('Network error');
    });

    it('should handle missing rate limit headers', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({}),
        text: () => Promise.resolve('{}'),
      });

      const result = await service.fetchUsageData();

      expect(result.sessionPercentage).toBe(0);
      expect(result.weeklyPercentage).toBe(0);
      expect(result.sonnetWeeklyPercentage).toBe(0);
    });
  });

  describe('formatResetText', () => {
    it('should show minutes for less than 1 hour', () => {
      const resetUnix = Math.floor(Date.now() / 1000) + 1800; // 30 minutes
      // @ts-expect-error - accessing private method for testing
      const result = service.formatResetText(resetUnix);
      expect(result).toMatch(/Resets in \d+m/);
    });

    it('should show hours and minutes for less than 24 hours', () => {
      const resetUnix = Math.floor(Date.now() / 1000) + 7200; // 2 hours
      // @ts-expect-error - accessing private method for testing
      const result = service.formatResetText(resetUnix);
      expect(result).toMatch(/Resets in \d+h/);
    });

    it('should show date for more than 24 hours', () => {
      const resetUnix = Math.floor(Date.now() / 1000) + 172800; // 2 days
      // @ts-expect-error - accessing private method for testing
      const result = service.formatResetText(resetUnix);
      expect(result).toMatch(/Resets \w+ \d+/);
    });

    it('should handle past timestamps', () => {
      const resetUnix = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago
      // @ts-expect-error - accessing private method for testing
      const result = service.formatResetText(resetUnix);
      expect(result).toBe('Resets soon');
    });
  });

  describe('getDefaultResetTime', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2025-01-15T10:00:00Z')); // Wednesday
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should return session default (5 hours from now)', () => {
      // @ts-expect-error - accessing private method for testing
      const result = service.getDefaultResetTime('session');

      const expected = new Date('2025-01-15T15:00:00Z');
      expect(new Date(result)).toEqual(expected);
    });

    it('should return weekly default (next Monday at noon)', () => {
      // @ts-expect-error - accessing private method for testing
      const result = service.getDefaultResetTime('weekly');

      const resultDate = new Date(result);
      expect(resultDate.getDay()).toBe(1); // Monday
      expect(resultDate.getHours()).toBe(12);
      expect(resultDate.getMinutes()).toBe(59);
    });
  });
});

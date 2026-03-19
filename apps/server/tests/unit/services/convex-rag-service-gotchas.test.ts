import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the secureFs module
vi.mock('@automaker/platform', () => ({
  secureFs: {
    access: vi.fn(),
    readdir: vi.fn(),
    readFile: vi.fn(),
  },
}));

// Mock client methods
const mockAction = vi.fn();

vi.mock('convex/browser', () => {
  return {
    ConvexHttpClient: class MockConvexHttpClient {
      query = vi.fn();
      action = (...args: unknown[]) => mockAction(...args);
      setAdminAuth = vi.fn();
    },
  };
});

// Mock convex/server
vi.mock('convex/server', () => ({
  makeFunctionReference: vi.fn((name: string) => name),
}));

describe('ConvexRAGService gotcha detection', () => {
  beforeEach(() => {
    mockAction.mockReset();
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.AUTOMAKER_RAG_ENABLED;
    delete process.env.CONVEX_URL;
    delete process.env.CONVEX_DEPLOY_KEY;
  });

  async function getService(opts: { enabled: boolean; url?: string; deployKey?: string }) {
    if (opts.enabled) process.env.AUTOMAKER_RAG_ENABLED = 'true';
    if (opts.url) process.env.CONVEX_URL = opts.url;
    if (opts.deployKey) process.env.CONVEX_DEPLOY_KEY = opts.deployKey;

    const { getConvexRAGService } = await import('@/services/convex-rag-service.js');
    return getConvexRAGService();
  }

  describe('searchGotchas', () => {
    it('should return empty result when service is not available', async () => {
      const service = await getService({ enabled: false });

      const result = await service.searchGotchas('/test/project', 'add database migration');

      expect(result.context).toBe('');
      expect(result.sources).toEqual([]);
      expect(result.chunksRetrieved).toBe(0);
    });

    it('should call searchFeatureContext with memory contentType', async () => {
      mockAction.mockResolvedValue({
        results: [
          {
            content: [{ text: 'Always run migrations in a transaction' }],
            score: 0.5,
            entryId: 'e1',
            order: 0,
            startOrder: 0,
          },
        ],
        text: 'Always run migrations in a transaction',
        entries: [{ key: 'memory:gotchas.md', title: 'gotchas' }],
        usage: { embeddingTokens: 10 },
      });

      const service = await getService({
        enabled: true,
        url: 'https://test.convex.cloud',
        deployKey: 'test-key',
      });

      const result = await service.searchGotchas('/test/project', 'add database migration');

      expect(result.context).toBe('Always run migrations in a transaction');
      expect(result.sources).toEqual(['memory:gotchas.md']);
      expect(result.chunksRetrieved).toBe(1);

      // Verify contentType filter was 'memory'
      expect(mockAction).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          contentType: 'memory',
        })
      );
    });

    it('should use lower vectorScoreThreshold for broader matching', async () => {
      mockAction.mockResolvedValue({
        results: [],
        text: '',
        entries: [],
        usage: { embeddingTokens: 5 },
      });

      const service = await getService({
        enabled: true,
        url: 'https://test.convex.cloud',
        deployKey: 'test-key',
      });

      await service.searchGotchas('/test/project', 'test task');

      expect(mockAction).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          vectorScoreThreshold: 0.3,
        })
      );
    });

    it('should default to limit of 5', async () => {
      mockAction.mockResolvedValue({
        results: [],
        text: '',
        entries: [],
        usage: { embeddingTokens: 5 },
      });

      const service = await getService({
        enabled: true,
        url: 'https://test.convex.cloud',
        deployKey: 'test-key',
      });

      await service.searchGotchas('/test/project', 'test task');

      expect(mockAction).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          limit: 5,
        })
      );
    });

    it('should handle errors gracefully', async () => {
      mockAction.mockRejectedValue(new Error('Search timeout'));

      const service = await getService({
        enabled: true,
        url: 'https://test.convex.cloud',
        deployKey: 'test-key',
      });

      const result = await service.searchGotchas('/test/project', 'test task');

      expect(result.context).toBe('');
      expect(result.chunksRetrieved).toBe(0);
    });
  });
});

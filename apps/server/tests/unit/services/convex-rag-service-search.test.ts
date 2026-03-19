import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the secureFs module
vi.mock('@automaker/platform', () => ({
  secureFs: {
    access: vi.fn(),
    readdir: vi.fn(),
    readFile: vi.fn(),
  },
}));

// Mock client — using a class so mockImplementation survives clearAllMocks
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

describe('ConvexRAGService search', () => {
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

  describe('searchFeatureContext', () => {
    it('should return empty result when service is not available', async () => {
      const service = await getService({ enabled: false });

      const result = await service.searchFeatureContext('/test/project', 'test query');

      expect(result.context).toBe('');
      expect(result.sources).toEqual([]);
      expect(result.chunksRetrieved).toBe(0);
    });

    it('should call Convex search action with correct parameters', async () => {
      mockAction.mockResolvedValue({
        results: [
          { content: [{ text: 'chunk1' }], score: 0.8, entryId: 'e1', order: 0, startOrder: 0 },
        ],
        text: 'chunk1',
        entries: [{ key: 'context:README.md', title: 'README' }],
        usage: { embeddingTokens: 10 },
      });

      const service = await getService({
        enabled: true,
        url: 'https://test.convex.cloud',
        deployKey: 'test-key',
      });

      const result = await service.searchFeatureContext('/test/project', 'add authentication');

      expect(result.context).toBe('chunk1');
      expect(result.sources).toEqual(['context:README.md']);
      expect(result.chunksRetrieved).toBe(1);
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('should pass optional contentType filter', async () => {
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

      await service.searchFeatureContext('/test/project', 'query', {
        contentType: 'memory',
        limit: 5,
      });

      expect(mockAction).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          contentType: 'memory',
          limit: 5,
        })
      );
    });

    it('should handle Convex action errors gracefully', async () => {
      mockAction.mockRejectedValue(new Error('Convex connection timeout'));

      const service = await getService({
        enabled: true,
        url: 'https://test.convex.cloud',
        deployKey: 'test-key',
      });

      const result = await service.searchFeatureContext('/test/project', 'test query');

      expect(result.context).toBe('');
      expect(result.sources).toEqual([]);
      expect(result.chunksRetrieved).toBe(0);
    });
  });

  describe('searchForAgent', () => {
    it('should return null when service is not available', async () => {
      const service = await getService({ enabled: false });

      const result = await service.searchForAgent('/test/project', 'implement login');

      expect(result).toBeNull();
    });

    it('should return formatted markdown when results found', async () => {
      mockAction.mockResolvedValue({
        results: [
          {
            content: [{ text: 'Auth uses JWT tokens' }],
            score: 0.9,
            entryId: 'e1',
            order: 0,
            startOrder: 0,
          },
        ],
        text: 'Auth uses JWT tokens',
        entries: [{ key: 'context:AUTH.md', title: 'AUTH' }],
        usage: { embeddingTokens: 15 },
      });

      const service = await getService({
        enabled: true,
        url: 'https://test.convex.cloud',
        deployKey: 'test-key',
      });

      const result = await service.searchForAgent('/test/project', 'implement login');

      expect(result).not.toBeNull();
      expect(result).toContain('## Relevant Knowledge Base Context');
      expect(result).toContain('Auth uses JWT tokens');
      expect(result).toContain('context:AUTH.md');
    });

    it('should return null when search returns no results', async () => {
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

      const result = await service.searchForAgent('/test/project', 'something unrelated');

      expect(result).toBeNull();
    });

    it('should handle errors gracefully and return null', async () => {
      mockAction.mockRejectedValue(new Error('Network error'));

      const service = await getService({
        enabled: true,
        url: 'https://test.convex.cloud',
        deployKey: 'test-key',
      });

      const result = await service.searchForAgent('/test/project', 'test query');

      expect(result).toBeNull();
    });
  });
});

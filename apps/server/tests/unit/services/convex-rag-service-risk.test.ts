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

vi.mock('convex/server', () => ({
  makeFunctionReference: vi.fn((name: string) => name),
}));

describe('ConvexRAGService risk assessment', () => {
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

  describe('assessFeatureRisk', () => {
    it('should return low risk when service is not available', async () => {
      const service = await getService({ enabled: false });

      const result = await service.assessFeatureRisk(
        '/test/project',
        'Add auth',
        'implement authentication'
      );

      expect(result.riskScore).toBe(0);
      expect(result.riskLevel).toBe('low');
      expect(result.factors).toHaveLength(0);
    });

    it('should flag no prior work as medium risk', async () => {
      // Similar search returns no results
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

      const result = await service.assessFeatureRisk(
        '/test/project',
        'New feature',
        'something completely new'
      );

      expect(result.riskScore).toBeGreaterThan(0);
      expect(result.factors.some((f) => f.type === 'no_prior_work')).toBe(true);
      expect(result.recommendations.length).toBeGreaterThan(0);
    });

    it('should detect failure patterns in similar features', async () => {
      // First call (similar implementations) returns results with "Failed" in context
      // Second call (gotchas) returns no results
      let callCount = 0;
      mockAction.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return {
            results: [
              {
                content: [{ text: 'Status: Failed' }],
                score: 0.5,
                entryId: 'e1',
                order: 0,
                startOrder: 0,
              },
            ],
            text: '# Feature: Login\nCategory: auth\nStatus: Failed\n\nFailed to implement',
            entries: [{ key: 'feature:feat-1' }],
            usage: { embeddingTokens: 10 },
          };
        }
        return {
          results: [],
          text: '',
          entries: [],
          usage: { embeddingTokens: 5 },
        };
      });

      const service = await getService({
        enabled: true,
        url: 'https://test.convex.cloud',
        deployKey: 'test-key',
      });

      const result = await service.assessFeatureRisk(
        '/test/project',
        'Add login',
        'user authentication'
      );

      expect(result.factors.some((f) => f.type === 'similar_failures')).toBe(true);
      expect(result.similarFeatureCount).toBe(1);
    });

    it('should flag gotcha matches', async () => {
      let callCount = 0;
      mockAction.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // Similar implementations - successful
          return {
            results: [
              {
                content: [{ text: 'Successful' }],
                score: 0.8,
                entryId: 'e1',
                order: 0,
                startOrder: 0,
              },
            ],
            text: '# Feature: Auth\nStatus: Successful\n\nWorked great',
            entries: [{ key: 'feature:feat-1' }],
            usage: { embeddingTokens: 10 },
          };
        }
        // Gotchas found
        return {
          results: [
            {
              content: [{ text: 'Watch out' }],
              score: 0.5,
              entryId: 'e2',
              order: 0,
              startOrder: 0,
            },
            { content: [{ text: 'Careful' }], score: 0.4, entryId: 'e3', order: 0, startOrder: 0 },
          ],
          text: 'Watch out for edge cases\n\nCareful with error handling',
          entries: [{ key: 'memory:gotchas.md' }, { key: 'memory:patterns.md' }],
          usage: { embeddingTokens: 8 },
        };
      });

      const service = await getService({
        enabled: true,
        url: 'https://test.convex.cloud',
        deployKey: 'test-key',
      });

      const result = await service.assessFeatureRisk(
        '/test/project',
        'Add auth',
        'user authentication'
      );

      expect(result.factors.some((f) => f.type === 'gotcha_matches')).toBe(true);
      expect(result.recommendations.some((r) => r.includes('gotcha'))).toBe(true);
    });

    it('should return valid risk levels', async () => {
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

      const result = await service.assessFeatureRisk(
        '/test/project',
        'Test',
        'test feature description here'
      );

      expect(['low', 'medium', 'high']).toContain(result.riskLevel);
      expect(result.riskScore).toBeGreaterThanOrEqual(0);
      expect(result.riskScore).toBeLessThanOrEqual(1);
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('should handle search errors gracefully', async () => {
      mockAction.mockRejectedValue(new Error('Network error'));

      const service = await getService({
        enabled: true,
        url: 'https://test.convex.cloud',
        deployKey: 'test-key',
      });

      // Should not throw
      const result = await service.assessFeatureRisk('/test/project', 'Test', 'test feature');

      expect(result.riskLevel).toBeDefined();
      expect(result.riskScore).toBeGreaterThanOrEqual(0);
    });
  });
});

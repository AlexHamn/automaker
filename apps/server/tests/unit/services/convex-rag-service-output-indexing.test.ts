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
const mockQuery = vi.fn();

vi.mock('convex/browser', () => {
  return {
    ConvexHttpClient: class MockConvexHttpClient {
      query = (...args: unknown[]) => mockQuery(...args);
      action = (...args: unknown[]) => mockAction(...args);
      setAdminAuth = vi.fn();
    },
  };
});

// Mock convex/server
vi.mock('convex/server', () => ({
  makeFunctionReference: vi.fn((name: string) => name),
}));

describe('ConvexRAGService feature output indexing', () => {
  beforeEach(() => {
    mockAction.mockReset();
    mockQuery.mockReset();
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

  describe('indexFeatureOutput', () => {
    it('should return failed result when service is not available', async () => {
      const service = await getService({ enabled: false });

      const result = await service.indexFeatureOutput(
        '/test/project',
        'feat-1',
        'Add login',
        'auth',
        'output content',
        true
      );

      expect(result.status).toBe('failed');
      expect(result.error).toContain('not available');
    });

    it('should index successful feature output with importance 0.8', async () => {
      // Return null for needsReindexing check (never indexed)
      mockQuery.mockResolvedValue(null);
      mockAction.mockResolvedValue({ success: true, key: 'feature:feat-1' });

      const service = await getService({
        enabled: true,
        url: 'https://test.convex.cloud',
        deployKey: 'test-key',
      });

      const result = await service.indexFeatureOutput(
        '/test/project',
        'feat-1',
        'Add login',
        'auth',
        '## Implementation\nAdded JWT auth',
        true
      );

      expect(result.status).toBe('indexed');
      expect(result.filePath).toBe('features/feat-1/agent-output.md');

      // Verify the action was called with wasSuccessful=true
      expect(mockAction).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          featureId: 'feat-1',
          featureTitle: 'Add login',
          category: 'auth',
          wasSuccessful: true,
        })
      );
    });

    it('should index failed feature output', async () => {
      mockQuery.mockResolvedValue(null);
      mockAction.mockResolvedValue({ success: true, key: 'feature:feat-2' });

      const service = await getService({
        enabled: true,
        url: 'https://test.convex.cloud',
        deployKey: 'test-key',
      });

      const result = await service.indexFeatureOutput(
        '/test/project',
        'feat-2',
        'Fix bug',
        'bugfix',
        'Failed: could not reproduce',
        false
      );

      expect(result.status).toBe('indexed');
      expect(mockAction).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          wasSuccessful: false,
        })
      );
    });

    it('should skip re-indexing when checksum matches', async () => {
      // Return existing record with matching checksum
      const { computeChecksum } = await import('@/lib/file-utils.js');
      const content = 'unchanged output';
      const checksum = computeChecksum(content);

      mockQuery.mockResolvedValue({ checksum });

      const service = await getService({
        enabled: true,
        url: 'https://test.convex.cloud',
        deployKey: 'test-key',
      });

      const result = await service.indexFeatureOutput(
        '/test/project',
        'feat-3',
        'Test feature',
        'general',
        content,
        true
      );

      expect(result.status).toBe('skipped');
      // action should NOT have been called
      expect(mockAction).not.toHaveBeenCalled();
    });

    it('should handle Convex action errors gracefully', async () => {
      mockQuery.mockResolvedValue(null);
      mockAction.mockRejectedValue(new Error('Convex timeout'));

      const service = await getService({
        enabled: true,
        url: 'https://test.convex.cloud',
        deployKey: 'test-key',
      });

      const result = await service.indexFeatureOutput(
        '/test/project',
        'feat-4',
        'Broken feature',
        'general',
        'some output',
        true
      );

      expect(result.status).toBe('failed');
      expect(result.error).toContain('Convex timeout');
    });

    it('should include contentHash in the action call', async () => {
      mockQuery.mockResolvedValue(null);
      mockAction.mockResolvedValue({ success: true, key: 'feature:feat-5' });

      const service = await getService({
        enabled: true,
        url: 'https://test.convex.cloud',
        deployKey: 'test-key',
      });

      await service.indexFeatureOutput(
        '/test/project',
        'feat-5',
        'Test',
        'general',
        'output text',
        true
      );

      expect(mockAction).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          contentHash: expect.any(String),
        })
      );
    });
  });
});

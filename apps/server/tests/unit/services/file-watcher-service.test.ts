import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock fs module
const mockWatch = vi.fn();
const mockAccessSync = vi.fn();
vi.mock('fs', () => ({
  default: {
    watch: mockWatch,
    accessSync: mockAccessSync,
  },
  watch: mockWatch,
  accessSync: mockAccessSync,
}));

// Mock platform
vi.mock('@automaker/platform', () => ({
  secureFs: {
    access: vi.fn(),
    readFile: vi.fn(),
    readdir: vi.fn(),
  },
}));

// Mock convex
vi.mock('convex/browser', () => ({
  ConvexHttpClient: class {
    query = vi.fn();
    action = vi.fn();
    mutation = vi.fn();
    setAdminAuth = vi.fn();
  },
}));

vi.mock('convex/server', () => ({
  makeFunctionReference: vi.fn((name: string) => name),
}));

describe('FileWatcherService', () => {
  let mockWatcher: { on: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.resetModules();
    mockWatcher = {
      on: vi.fn().mockReturnThis(),
      close: vi.fn(),
    };
    mockWatch.mockReturnValue(mockWatcher);
    mockAccessSync.mockImplementation(() => {}); // Directories exist
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should create a singleton instance', async () => {
    const { getFileWatcherService } = await import('@/services/file-watcher-service.js');

    // Create mock RAG service
    const mockRagService = {
      isAvailable: () => true,
      indexContextFile: vi.fn(),
      indexMemoryFile: vi.fn(),
      removeFromIndex: vi.fn(),
    } as any;

    const service1 = getFileWatcherService(mockRagService);
    const service2 = getFileWatcherService();

    expect(service1).toBe(service2);
    expect(service1).not.toBeNull();
  });

  it('should not create duplicate watchers for the same project', async () => {
    const { getFileWatcherService } = await import('@/services/file-watcher-service.js');

    const mockRagService = {
      isAvailable: () => true,
      indexContextFile: vi.fn(),
      indexMemoryFile: vi.fn(),
      removeFromIndex: vi.fn(),
    } as any;

    const service = getFileWatcherService(mockRagService)!;

    service.watchProject('/test/project');
    const callCount1 = mockWatch.mock.calls.length;

    service.watchProject('/test/project');
    const callCount2 = mockWatch.mock.calls.length;

    // Should not create new watchers on second call
    expect(callCount2).toBe(callCount1);
  });

  it('should report watching status correctly', async () => {
    const { getFileWatcherService } = await import('@/services/file-watcher-service.js');

    const mockRagService = {
      isAvailable: () => true,
      indexContextFile: vi.fn(),
      indexMemoryFile: vi.fn(),
      removeFromIndex: vi.fn(),
    } as any;

    const service = getFileWatcherService(mockRagService)!;

    expect(service.isWatching('/test/project')).toBe(false);
    expect(service.getWatchedProjectCount()).toBe(0);

    service.watchProject('/test/project');

    expect(service.isWatching('/test/project')).toBe(true);
    expect(service.getWatchedProjectCount()).toBe(1);
  });

  it('should close watchers on unwatchProject', async () => {
    const { getFileWatcherService } = await import('@/services/file-watcher-service.js');

    const mockRagService = {
      isAvailable: () => true,
      indexContextFile: vi.fn(),
      indexMemoryFile: vi.fn(),
      removeFromIndex: vi.fn(),
    } as any;

    const service = getFileWatcherService(mockRagService)!;
    service.watchProject('/test/project');

    expect(service.isWatching('/test/project')).toBe(true);

    service.unwatchProject('/test/project');

    expect(service.isWatching('/test/project')).toBe(false);
    expect(mockWatcher.close).toHaveBeenCalled();
  });

  it('should handle missing directories gracefully', async () => {
    mockAccessSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });

    vi.resetModules();

    const { getFileWatcherService } = await import('@/services/file-watcher-service.js');

    const mockRagService = {
      isAvailable: () => true,
      indexContextFile: vi.fn(),
      indexMemoryFile: vi.fn(),
      removeFromIndex: vi.fn(),
    } as any;

    const service = getFileWatcherService(mockRagService)!;

    // Should not throw
    service.watchProject('/nonexistent/project');

    // Should not create watchers for missing directories
    expect(mockWatch).not.toHaveBeenCalled();
  });
});

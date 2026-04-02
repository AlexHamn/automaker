/**
 * File Watcher Service
 *
 * Watches .automaker/context/ and .automaker/memory/ directories for changes
 * and triggers incremental RAG re-indexing with debouncing.
 */

import fs from 'fs';
import path from 'path';
import { createLogger } from '@automaker/utils';
import { secureFs } from '@automaker/platform';
import type { getConvexRAGService } from './convex-rag-service.js';

type ConvexRAGService = ReturnType<typeof getConvexRAGService>;

const logger = createLogger('FileWatcher');

const DEBOUNCE_MS = 1000;
const VALID_EXTENSIONS = new Set(['.md', '.txt', '.json']);

/**
 * Service that watches project directories for file changes and triggers
 * incremental RAG re-indexing.
 */
class FileWatcherService {
  private watchers = new Map<string, fs.FSWatcher[]>();
  private pendingChanges = new Map<string, NodeJS.Timeout>();
  private ragService: ConvexRAGService;

  constructor(ragService: ConvexRAGService) {
    this.ragService = ragService;
  }

  /**
   * Start watching a project's .automaker/ directories for changes.
   * Safe to call multiple times — will not create duplicate watchers.
   */
  watchProject(projectPath: string): void {
    if (this.watchers.has(projectPath)) {
      return; // Already watching
    }

    const projectWatchers: fs.FSWatcher[] = [];

    const dirsToWatch = [
      { dir: path.join(projectPath, '.automaker', 'context'), type: 'context' as const },
      { dir: path.join(projectPath, '.automaker', 'memory'), type: 'memory' as const },
    ];

    for (const { dir, type } of dirsToWatch) {
      try {
        fs.accessSync(dir);
        const watcher = fs.watch(dir, (eventType, filename) => {
          if (!filename) return;
          if (!VALID_EXTENSIONS.has(path.extname(filename).toLowerCase())) return;
          if (filename === '_index.md') return; // Skip memory index file
          if (filename === 'context-metadata.json') return; // Skip metadata file

          const filePath = path.join(dir, filename);
          this.handleFileChange(projectPath, filePath, type, eventType);
        });

        watcher.on('error', (error) => {
          logger.warn(`File watcher error for ${dir}:`, error);
        });

        projectWatchers.push(watcher);
        logger.debug(`Watching ${type} directory: ${dir}`);
      } catch {
        // Directory doesn't exist — skip silently
      }
    }

    if (projectWatchers.length > 0) {
      this.watchers.set(projectPath, projectWatchers);
      logger.info(`Started watching project for RAG changes`, {
        projectPath,
        directories: projectWatchers.length,
      });
    }
  }

  /**
   * Stop watching a project's directories.
   */
  unwatchProject(projectPath: string): void {
    const projectWatchers = this.watchers.get(projectPath);
    if (!projectWatchers) return;

    for (const watcher of projectWatchers) {
      watcher.close();
    }
    this.watchers.delete(projectPath);

    // Clear any pending changes for this project
    for (const [key, timeout] of this.pendingChanges) {
      if (key.startsWith(projectPath)) {
        clearTimeout(timeout);
        this.pendingChanges.delete(key);
      }
    }

    logger.info('Stopped watching project', { projectPath });
  }

  /**
   * Stop all watchers and clean up.
   */
  unwatchAll(): void {
    for (const [projectPath] of this.watchers) {
      this.unwatchProject(projectPath);
    }
  }

  /**
   * Handle a file change event with debouncing.
   */
  private handleFileChange(
    projectPath: string,
    filePath: string,
    type: 'context' | 'memory',
    eventType: string
  ): void {
    const changeKey = filePath;

    // Clear any pending debounce for this file
    const existing = this.pendingChanges.get(changeKey);
    if (existing) {
      clearTimeout(existing);
    }

    // Debounce the change
    const timeout = setTimeout(async () => {
      this.pendingChanges.delete(changeKey);
      await this.processFileChange(projectPath, filePath, type, eventType);
    }, DEBOUNCE_MS);

    this.pendingChanges.set(changeKey, timeout);
  }

  /**
   * Process a debounced file change — re-index or remove from index.
   */
  private async processFileChange(
    projectPath: string,
    filePath: string,
    type: 'context' | 'memory',
    eventType: string
  ): Promise<void> {
    if (!this.ragService.isAvailable()) return;

    const relativePath = path.relative(projectPath, filePath);

    // Check if file still exists (might have been deleted)
    try {
      await secureFs.access(filePath);
    } catch {
      // File was deleted — remove from index
      logger.info('File deleted, removing from index', { filePath: relativePath });
      try {
        await this.ragService.removeFromIndex(projectPath, relativePath);
      } catch (error) {
        logger.warn('Failed to remove deleted file from index', {
          filePath: relativePath,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
      return;
    }

    // File exists — re-index it
    logger.info('File changed, re-indexing', { filePath: relativePath, type });
    try {
      if (type === 'context') {
        await this.ragService.indexContextFile(projectPath, filePath);
      } else {
        await this.ragService.indexMemoryFile(projectPath, filePath);
      }
    } catch (error) {
      logger.warn('Failed to re-index changed file', {
        filePath: relativePath,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Get the number of projects currently being watched.
   */
  getWatchedProjectCount(): number {
    return this.watchers.size;
  }

  /**
   * Check if a project is currently being watched.
   */
  isWatching(projectPath: string): boolean {
    return this.watchers.has(projectPath);
  }
}

// Singleton
let instance: FileWatcherService | null = null;

/**
 * Get or create the singleton FileWatcherService.
 * Requires the RAG service to be passed on first call.
 */
export function getFileWatcherService(ragService?: ConvexRAGService): FileWatcherService | null {
  if (!instance && ragService) {
    instance = new FileWatcherService(ragService);
  }
  return instance;
}

/**
 * File utilities for RAG indexing
 *
 * Provides checksum computation and project ID generation
 * for content change detection and project identification.
 */

import { createHash } from 'crypto';

/**
 * Compute SHA-256 checksum of content
 *
 * Used for detecting file changes between indexing runs.
 *
 * @param content - The content to hash
 * @returns Hex-encoded SHA-256 digest
 */
export function computeChecksum(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * Generate a stable project ID from a project path
 *
 * Uses first 12 characters of SHA-256 hash for brevity
 * while maintaining collision resistance.
 *
 * @param projectPath - Absolute path to the project
 * @returns 12-character hex string
 */
export function getProjectId(projectPath: string): string {
  return createHash('sha256').update(projectPath, 'utf8').digest('hex').slice(0, 12);
}

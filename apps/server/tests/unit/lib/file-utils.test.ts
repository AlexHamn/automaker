import { describe, it, expect } from 'vitest';
import { computeChecksum, getProjectId } from '@/lib/file-utils.js';

describe('file-utils.ts', () => {
  describe('computeChecksum', () => {
    it('should compute consistent SHA-256 checksums', () => {
      const content = 'Hello, World!';
      const checksum1 = computeChecksum(content);
      const checksum2 = computeChecksum(content);

      expect(checksum1).toBe(checksum2);
      expect(checksum1).toHaveLength(64); // SHA-256 produces 64 hex chars
    });

    it('should produce different checksums for different content', () => {
      const checksum1 = computeChecksum('content A');
      const checksum2 = computeChecksum('content B');

      expect(checksum1).not.toBe(checksum2);
    });

    it('should handle empty strings', () => {
      const checksum = computeChecksum('');

      expect(checksum).toHaveLength(64);
      // Known SHA-256 of empty string
      expect(checksum).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    });

    it('should handle unicode content', () => {
      const content = 'Hello, World!';
      const checksum = computeChecksum(content);

      expect(checksum).toHaveLength(64);
      expect(() => computeChecksum(content)).not.toThrow();
    });

    it('should handle multiline content', () => {
      const content = `Line 1
Line 2
Line 3`;
      const checksum = computeChecksum(content);

      expect(checksum).toHaveLength(64);
    });
  });

  describe('getProjectId', () => {
    it('should generate stable 12-character IDs', () => {
      const projectPath = '/home/user/projects/my-project';
      const id1 = getProjectId(projectPath);
      const id2 = getProjectId(projectPath);

      expect(id1).toBe(id2);
      expect(id1).toHaveLength(12);
    });

    it('should produce different IDs for different paths', () => {
      const id1 = getProjectId('/path/to/project-a');
      const id2 = getProjectId('/path/to/project-b');

      expect(id1).not.toBe(id2);
    });

    it('should handle paths with special characters', () => {
      const id = getProjectId('/path/with spaces/and-special_chars');

      expect(id).toHaveLength(12);
      // Should be hex characters only
      expect(id).toMatch(/^[0-9a-f]+$/);
    });

    it('should distinguish between similar paths', () => {
      const id1 = getProjectId('/home/user/project');
      const id2 = getProjectId('/home/user/projects');
      const id3 = getProjectId('/home/user/project/');

      expect(id1).not.toBe(id2);
      // Trailing slash makes a different path
      expect(id1).not.toBe(id3);
    });

    it('should handle Windows-style paths', () => {
      const id = getProjectId('C:\\Users\\user\\project');

      expect(id).toHaveLength(12);
      expect(id).toMatch(/^[0-9a-f]+$/);
    });
  });
});

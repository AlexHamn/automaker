/**
 * Code Pattern Extractor
 *
 * Extracts meaningful patterns from TypeScript/JavaScript source files
 * using regex-based parsing. Returns enriched content suitable for
 * semantic search indexing via the RAG pipeline.
 */

import path from 'path';

const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  '.automaker',
  '.git',
  'coverage',
  '.next',
  '.cache',
  '.vite',
  '__pycache__',
  '.turbo',
  '.parcel-cache',
]);

const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);

const MAX_FILE_SIZE = 50 * 1024; // 50KB

export type PatternType =
  | 'component'
  | 'service'
  | 'route'
  | 'hook'
  | 'model'
  | 'utility'
  | 'test'
  | 'config'
  | 'other';

export interface ExtractionResult {
  patternType: PatternType;
  enrichedContent: string;
  exportedNames: string[];
}

/**
 * Check if a directory should be skipped during scanning
 */
export function shouldSkipDir(dirName: string): boolean {
  return SKIP_DIRS.has(dirName) || dirName.startsWith('.');
}

/**
 * Check if a file should be indexed based on extension and size
 */
export function shouldIndexFile(filePath: string, fileSize: number): boolean {
  const ext = path.extname(filePath).toLowerCase();
  if (!CODE_EXTENSIONS.has(ext)) return false;
  if (fileSize > MAX_FILE_SIZE) return false;
  // Skip declaration files and generated files
  if (filePath.endsWith('.d.ts')) return false;
  if (filePath.includes('.gen.')) return false;
  return true;
}

/**
 * Determine the pattern type based on file path
 */
export function classifyFile(relativePath: string): PatternType {
  const lower = relativePath.toLowerCase();
  const basename = path.basename(lower);

  if (lower.includes('/routes/') || lower.includes('/route/')) return 'route';
  if (lower.includes('/components/') || lower.includes('/component/')) return 'component';
  if (lower.includes('/services/') || lower.includes('/service/')) return 'service';
  if (lower.includes('/hooks/') || basename.startsWith('use-') || basename.startsWith('use_'))
    return 'hook';
  if (lower.includes('/types/') || lower.includes('/models/') || lower.endsWith('.d.ts'))
    return 'model';
  if (lower.includes('/lib/') || lower.includes('/utils/') || lower.includes('/helpers/'))
    return 'utility';
  if (lower.includes('.test.') || lower.includes('.spec.') || lower.includes('__tests__'))
    return 'test';
  if (basename.includes('config') || basename.includes('.config.')) return 'config';
  return 'other';
}

/**
 * Extract meaningful patterns from a source file's content
 */
export function extractPatterns(relativePath: string, content: string): ExtractionResult {
  const patternType = classifyFile(relativePath);
  const exportedNames: string[] = [];
  const parts: string[] = [];

  // File header
  parts.push(`# ${relativePath}`);
  parts.push(`Type: ${patternType}`);
  parts.push('');

  // Extract imports (top 15 for context)
  const imports = content.match(/^import\s+.*$/gm);
  if (imports && imports.length > 0) {
    parts.push('## Imports');
    parts.push(...imports.slice(0, 15));
    parts.push('');
  }

  // Extract exported functions
  const funcMatches = content.matchAll(
    /(?:\/\*\*[\s\S]*?\*\/\s*)?export\s+(?:async\s+)?function\s+(\w+)\s*\([^)]*\)(?:\s*:\s*[^{]+)?/g
  );
  for (const match of funcMatches) {
    exportedNames.push(match[1]);
    parts.push(match[0].trim());
  }

  // Extract exported classes
  const classMatches = content.matchAll(
    /(?:\/\*\*[\s\S]*?\*\/\s*)?export\s+(?:default\s+)?(?:abstract\s+)?class\s+(\w+)(?:\s+extends\s+\w+)?(?:\s+implements\s+[\w,\s]+)?/g
  );
  for (const match of classMatches) {
    exportedNames.push(match[1]);
    parts.push(match[0].trim());
  }

  // Extract exported const/let (including arrow functions and components)
  const constMatches = content.matchAll(
    /(?:\/\*\*[\s\S]*?\*\/\s*)?export\s+(?:default\s+)?const\s+(\w+)(?:\s*:\s*[^=]+)?\s*=/g
  );
  for (const match of constMatches) {
    exportedNames.push(match[1]);
    parts.push(match[0].trim());
  }

  // Extract exported interfaces and types
  const typeMatches = content.matchAll(
    /(?:\/\*\*[\s\S]*?\*\/\s*)?export\s+(?:type|interface)\s+(\w+)(?:<[^>]+>)?(?:\s*=\s*[^;{]+|\s*\{[^}]*\})?/g
  );
  for (const match of typeMatches) {
    exportedNames.push(match[1]);
    parts.push(match[0].trim().substring(0, 200)); // Truncate long type defs
  }

  // Extract TODO/FIXME comments
  const todoMatches = content.matchAll(/\/\/\s*(TODO|FIXME|HACK|XXX|NOTE):\s*.+$/gm);
  const todos: string[] = [];
  for (const match of todoMatches) {
    todos.push(match[0].trim());
  }
  if (todos.length > 0) {
    parts.push('');
    parts.push('## TODOs');
    parts.push(...todos.slice(0, 10));
  }

  return {
    patternType,
    enrichedContent: parts.join('\n'),
    exportedNames,
  };
}

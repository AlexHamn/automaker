#!/usr/bin/env tsx
/**
 * RAG Index CLI Script
 *
 * Indexes context and memory files for a project into the Convex RAG system.
 *
 * Usage:
 *   npm run rag:index -- /path/to/project
 *   npx tsx scripts/rag-index.ts /path/to/project
 */

import { config } from 'dotenv';
import path from 'path';

// Load environment variables from root .env
config({ path: path.resolve(process.cwd(), '.env') });

// Dynamic import to ensure env vars are loaded first
async function main() {
  const projectPath = process.argv[2];

  if (!projectPath) {
    console.error('Usage: npm run rag:index -- /path/to/project');
    console.error('       npx tsx scripts/rag-index.ts /path/to/project');
    process.exit(1);
  }

  // Resolve to absolute path
  const absolutePath = path.resolve(projectPath);
  console.log(`\nIndexing project: ${absolutePath}\n`);

  // Import the service after env vars are loaded
  const { getConvexRAGService } = await import('../apps/server/src/services/convex-rag-service.js');

  const ragService = getConvexRAGService();

  if (!ragService.isEnabled()) {
    console.error('RAG service is not enabled.');
    console.error('Set AUTOMAKER_RAG_ENABLED=true in your environment.');
    process.exit(1);
  }

  if (!ragService.isConfigured()) {
    console.error('RAG service is not configured.');
    console.error('Set CONVEX_URL in your environment.');
    process.exit(1);
  }

  if (!ragService.isAvailable()) {
    console.error('RAG service is not available.');
    console.error('Check CONVEX_URL and CONVEX_DEPLOY_KEY are set correctly.');
    process.exit(1);
  }

  console.log('RAG service available. Starting indexing...\n');

  const startTime = Date.now();

  try {
    const result = await ragService.indexProject(absolutePath);

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log('Indexing complete!\n');
    console.log(`Project ID: ${result.projectId}`);
    console.log(`Duration: ${duration}s\n`);

    console.log('Summary:');
    console.log(`  Total files: ${result.summary.total}`);
    console.log(`  Indexed: ${result.summary.indexed}`);
    console.log(`  Skipped (unchanged): ${result.summary.skipped}`);
    console.log(`  Failed: ${result.summary.failed}`);

    if (result.contextFiles.length > 0) {
      console.log('\nContext files:');
      for (const file of result.contextFiles) {
        const status = file.status === 'indexed' ? '+' : file.status === 'skipped' ? '=' : 'x';
        console.log(`  [${status}] ${file.filePath}${file.error ? ` (${file.error})` : ''}`);
      }
    }

    if (result.memoryFiles.length > 0) {
      console.log('\nMemory files:');
      for (const file of result.memoryFiles) {
        const status = file.status === 'indexed' ? '+' : file.status === 'skipped' ? '=' : 'x';
        console.log(`  [${status}] ${file.filePath}${file.error ? ` (${file.error})` : ''}`);
      }
    }

    console.log('\nLegend: [+] indexed, [=] skipped, [x] failed');

    if (result.summary.failed > 0) {
      process.exit(1);
    }
  } catch (error) {
    console.error('Indexing failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();

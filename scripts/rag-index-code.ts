#!/usr/bin/env tsx
/**
 * RAG Code Index CLI Script
 *
 * Indexes codebase source files (TS/JS) into the Convex RAG system.
 *
 * Usage:
 *   npm run rag:index-code -- /path/to/project
 *   npx tsx scripts/rag-index-code.ts /path/to/project
 */

import { config } from 'dotenv';
import path from 'path';

// Load environment variables from root .env
config({ path: path.resolve(process.cwd(), '.env') });

async function main() {
  const projectPath = process.argv[2];

  if (!projectPath) {
    console.error('Usage: npm run rag:index-code -- /path/to/project');
    console.error('       npx tsx scripts/rag-index-code.ts /path/to/project');
    process.exit(1);
  }

  const absolutePath = path.resolve(projectPath);
  console.log(`\nIndexing codebase: ${absolutePath}\n`);

  const { getConvexRAGService } = await import('../apps/server/src/services/convex-rag-service.js');

  const ragService = getConvexRAGService();

  if (!ragService.isAvailable()) {
    console.error('RAG service is not available.');
    console.error('Ensure AUTOMAKER_RAG_ENABLED=true, CONVEX_URL, and CONVEX_DEPLOY_KEY are set.');
    process.exit(1);
  }

  console.log('RAG service available. Scanning source files...\n');

  const startTime = Date.now();

  try {
    const result = await ragService.indexCodebase(absolutePath);

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log('Code indexing complete!\n');
    console.log(`Project ID: ${result.projectId}`);
    console.log(`Duration: ${duration}s\n`);

    console.log('Summary:');
    console.log(`  Total files: ${result.summary.total}`);
    console.log(`  Indexed: ${result.summary.indexed}`);
    console.log(`  Skipped (unchanged): ${result.summary.skipped}`);
    console.log(`  Failed: ${result.summary.failed}`);

    if (result.summary.failed > 0) {
      console.log('\nFailed files:');
      for (const file of result.memoryFiles) {
        if (file.status === 'failed') {
          console.log(`  [x] ${file.filePath} (${file.error})`);
        }
      }
      process.exit(1);
    }
  } catch (error) {
    console.error('Code indexing failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();

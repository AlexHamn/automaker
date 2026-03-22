#!/usr/bin/env tsx
/**
 * RAG Backfill CLI Script
 *
 * Indexes agent outputs from existing completed features into the Convex RAG system.
 *
 * Usage:
 *   npm run rag:backfill -- /path/to/project
 *   npx tsx scripts/rag-backfill.ts /path/to/project
 */

import { config } from 'dotenv';
import path from 'path';
import fs from 'fs/promises';

// Load environment variables from root .env
config({ path: path.resolve(process.cwd(), '.env') });

async function main() {
  const projectPath = process.argv[2];

  if (!projectPath) {
    console.error('Usage: npm run rag:backfill -- /path/to/project');
    console.error('       npx tsx scripts/rag-backfill.ts /path/to/project');
    process.exit(1);
  }

  const absolutePath = path.resolve(projectPath);
  console.log(`\nBackfilling feature outputs: ${absolutePath}\n`);

  const { getConvexRAGService } = await import('../apps/server/src/services/convex-rag-service.js');

  const ragService = getConvexRAGService();

  if (!ragService.isAvailable()) {
    console.error('RAG service is not available.');
    console.error('Ensure AUTOMAKER_RAG_ENABLED=true, CONVEX_URL, and CONVEX_DEPLOY_KEY are set.');
    process.exit(1);
  }

  console.log('RAG service available. Scanning features...\n');

  const featuresDir = path.join(absolutePath, '.automaker', 'features');
  let featureDirs: string[];

  try {
    featureDirs = await fs.readdir(featuresDir);
  } catch {
    console.error(`No features directory found at ${featuresDir}`);
    process.exit(1);
  }

  let indexed = 0;
  let skipped = 0;
  let failed = 0;
  let noOutput = 0;

  for (const featureId of featureDirs) {
    const featureDir = path.join(featuresDir, featureId);

    // Check if it's a directory
    try {
      const stat = await fs.stat(featureDir);
      if (!stat.isDirectory()) continue;
    } catch {
      continue;
    }

    // Read feature.json for metadata
    const featureJsonPath = path.join(featureDir, 'feature.json');
    let featureTitle = featureId;
    let category = 'general';
    let wasSuccessful = true;

    try {
      const featureJson = JSON.parse(await fs.readFile(featureJsonPath, 'utf-8'));
      featureTitle = featureJson.title || featureId;
      category = featureJson.category || 'general';
      const status = featureJson.status || '';
      wasSuccessful = !['failed', 'backlog'].includes(status);
    } catch {
      // No feature.json, use defaults
    }

    // Read agent-output.md
    const outputPath = path.join(featureDir, 'agent-output.md');
    let agentOutput: string;

    try {
      agentOutput = await fs.readFile(outputPath, 'utf-8');
    } catch {
      noOutput++;
      continue;
    }

    if (!agentOutput.trim()) {
      noOutput++;
      continue;
    }

    // Index the output
    try {
      const result = await ragService.indexFeatureOutput(
        absolutePath,
        featureId,
        featureTitle,
        category,
        agentOutput,
        wasSuccessful
      );

      if (result.status === 'indexed') {
        console.log(`  [+] ${featureId} - ${featureTitle}`);
        indexed++;
      } else if (result.status === 'skipped') {
        console.log(`  [=] ${featureId} - ${featureTitle}`);
        skipped++;
      } else {
        console.log(`  [x] ${featureId} - ${featureTitle} (${result.error})`);
        failed++;
      }
    } catch (error) {
      console.log(
        `  [x] ${featureId} - ${featureTitle} (${error instanceof Error ? error.message : 'Unknown error'})`
      );
      failed++;
    }
  }

  console.log('\nBackfill complete!\n');
  console.log('Summary:');
  console.log(`  Indexed: ${indexed}`);
  console.log(`  Skipped (unchanged): ${skipped}`);
  console.log(`  No output: ${noOutput}`);
  console.log(`  Failed: ${failed}`);
  console.log('\nLegend: [+] indexed, [=] skipped, [x] failed');

  if (failed > 0) {
    process.exit(1);
  }
}

main();

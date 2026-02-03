# RAG Implementation Epics

This document breaks down the Convex RAG implementation into actionable epics with clear scope, tasks, acceptance criteria, and dependencies.

---

## Epic Overview

| Epic | Title | Priority | Dependency |
|------|-------|----------|------------|
| **E1** | Convex Infrastructure Setup | P0 | None |
| **E2** | Context & Memory File Indexing | P0 | E1 |
| **E3** | Semantic Search Integration | P0 | E2 |
| **E4** | Feature Output Indexing | P1 | E3 |
| **E5** | Similar Implementation Search | P1 | E4 |
| **E6** | Gotcha Detection System | P1 | E4 |
| **E7** | Knowledge Base UI | P2 | E4 |
| **E8** | Codebase Pattern Indexing | P2 | E3 |
| **E9** | Incremental Re-indexing | P2 | E4 |
| **E10** | Cross-Feature Learning | P3 | E6, E9 |

---

## Phase 1: Foundation

### Epic E1: Convex Infrastructure Setup

**Goal**: Set up Convex backend with RAG component and establish connection from Automaker server.

#### Tasks

- [ ] **E1.1** Create Convex project and configure deployment
  - Sign up at convex.dev
  - Create new project for Automaker
  - Configure deployment environment (dev/prod)

- [ ] **E1.2** Install dependencies
  ```bash
  npm install @convex-dev/rag convex @ai-sdk/openai
  ```

- [ ] **E1.3** Create `convex/convex.config.ts`
  ```typescript
  import { defineApp } from "convex/server";
  import rag from "@convex-dev/rag/convex.config.js";

  const app = defineApp();
  app.use(rag);
  export default app;
  ```

- [ ] **E1.4** Create `convex/schema.ts` with tables
  - `indexedContent` - Track indexed files and metadata
  - `indexingJobs` - Background job management

- [ ] **E1.5** Create `convex/rag.ts` with RAG instance
  - Configure OpenAI embedding model (`text-embedding-3-small`)
  - Define Automaker filter types
  - Set embedding dimension (1536)

- [ ] **E1.6** Add environment variables
  - `CONVEX_URL` - Convex deployment URL
  - `CONVEX_DEPLOY_KEY` - For CI/CD deployments
  - `OPENAI_API_KEY` - For embedding generation

- [ ] **E1.7** Create `ConvexRAGService` class in server
  - Initialize `ConvexHttpClient`
  - Add connection health check method
  - Export singleton instance

- [ ] **E1.8** Add Convex to workspace build configuration
  - Update `package.json` scripts
  - Add `convex dev` to development workflow
  - Configure TypeScript paths

#### Acceptance Criteria

- [ ] `npx convex dev` runs successfully
- [ ] Server can connect to Convex deployment
- [ ] Health check endpoint returns Convex status
- [ ] Environment variables documented in `.env.example`

#### Files to Create/Modify

| File | Action |
|------|--------|
| `convex/convex.config.ts` | Create |
| `convex/schema.ts` | Create |
| `convex/rag.ts` | Create |
| `apps/server/src/services/convex-rag-service.ts` | Create |
| `apps/server/src/index.ts` | Modify (add health check) |
| `package.json` | Modify (add scripts) |
| `.env.example` | Modify (add vars) |

---

### Epic E2: Context & Memory File Indexing

**Goal**: Index `.automaker/context/` and `.automaker/memory/` files into Convex RAG.

#### Tasks

- [ ] **E2.1** Create `convex/indexing/contextFiles.ts`
  - `indexContextFile` action
  - Accept projectId, filePath, content, title, description
  - Use namespace pattern: `project:{projectId}`
  - Use key pattern: `context:{filePath}`

- [ ] **E2.2** Create `convex/indexing/memoryFiles.ts`
  - `indexMemoryFile` action
  - Parse YAML frontmatter for tags, importance, summary
  - Enrich content with tags for better embedding
  - Set importance weighting (0-1)

- [ ] **E2.3** Create file loading utilities
  - `loadContextFilesFromDisk(contextDir)` - Read all .md/.txt files
  - `loadMemoryFilesFromDisk(memoryDir)` - Read with frontmatter parsing
  - `computeFileChecksum(content)` - For change detection

- [ ] **E2.4** Implement checksum-based change detection
  - Store checksums in `indexedContent` table
  - Skip re-indexing unchanged files
  - Track `lastIndexed` timestamp

- [ ] **E2.5** Add `indexContextFiles` method to `ConvexRAGService`
  - Load files from disk
  - Check for changes via checksum
  - Call Convex actions for changed files
  - Update `indexedContent` metadata

- [ ] **E2.6** Add `indexMemoryFiles` method to `ConvexRAGService`
  - Parse frontmatter metadata
  - Map importance scores
  - Handle missing/malformed frontmatter gracefully

- [ ] **E2.7** Create CLI command: `npm run rag:index`
  - Accept `--project` flag for project path
  - Index both context and memory files
  - Display progress and results

- [ ] **E2.8** Add indexing on project open
  - Hook into project loading in server
  - Trigger background indexing for opened project
  - Show indexing status in UI

#### Acceptance Criteria

- [ ] All `.automaker/context/*.md` files indexed with correct namespace
- [ ] All `.automaker/memory/*.md` files indexed with importance scores
- [ ] Re-running index skips unchanged files
- [ ] CLI command shows progress and success count
- [ ] Logs show embedding token usage

#### Files to Create/Modify

| File | Action |
|------|--------|
| `convex/indexing/contextFiles.ts` | Create |
| `convex/indexing/memoryFiles.ts` | Create |
| `convex/indexing/utils.ts` | Create |
| `apps/server/src/services/convex-rag-service.ts` | Modify |
| `apps/server/src/lib/file-utils.ts` | Modify (add checksum) |
| `scripts/rag-index.ts` | Create |
| `package.json` | Modify (add script) |

---

### Epic E3: Semantic Search Integration

**Goal**: Replace/enhance context loading with semantic search from Convex RAG.

#### Tasks

- [ ] **E3.1** Create `convex/search/featureContext.ts`
  - `searchForFeatureContext` action
  - Accept projectId, featureTitle, featureDescription, category
  - Use `vectorScoreThreshold: 0.5`
  - Include chunk context: `{ before: 1, after: 1 }`

- [ ] **E3.2** Create `convex/search/index.ts`
  - Export all search actions
  - Add type definitions for search responses

- [ ] **E3.3** Add `getFeatureContext` method to `ConvexRAGService`
  - Call `searchForFeatureContext` action
  - Return formatted context string and sources
  - Handle errors gracefully

- [ ] **E3.4** Create `loadContextFilesWithRAG` function
  - Location: `libs/utils/src/context-loader.ts`
  - Accept optional RAG configuration
  - Fall back to full file load when RAG unavailable
  - Include source attribution in returned context

- [ ] **E3.5** Integrate RAG context into agent prompt building
  - Modify prompt construction in `AgentService`
  - Use feature title/description as query
  - Pass category when available

- [ ] **E3.6** Add feature flag for RAG
  - `AUTOMAKER_RAG_ENABLED=true/false`
  - Allow per-project RAG enable/disable
  - Graceful fallback when disabled

- [ ] **E3.7** Add logging and metrics
  - Log search latency
  - Log number of chunks retrieved
  - Log embedding token usage
  - Track fallback occurrences

#### Acceptance Criteria

- [ ] Feature execution uses semantic search for context (when enabled)
- [ ] Context relevance improves for specific feature types
- [ ] Fallback works when Convex unavailable
- [ ] Logs show search performance metrics
- [ ] Feature flag controls RAG usage

#### Files to Create/Modify

| File | Action |
|------|--------|
| `convex/search/featureContext.ts` | Create |
| `convex/search/index.ts` | Create |
| `apps/server/src/services/convex-rag-service.ts` | Modify |
| `libs/utils/src/context-loader.ts` | Modify |
| `apps/server/src/services/agent-service.ts` | Modify |
| `apps/server/src/lib/config.ts` | Modify (add flag) |

---

## Phase 2: Feature Intelligence

### Epic E4: Feature Output Indexing

**Goal**: Automatically index agent outputs from completed features.

#### Tasks

- [ ] **E4.1** Create `convex/indexing/featureOutputs.ts`
  - `indexAgentOutput` action
  - Accept featureId, title, category, output, success status
  - Set importance: 0.8 for successful, 0.4 for failed
  - Enrich with feature metadata header

- [ ] **E4.2** Add `indexFeatureOutput` method to `ConvexRAGService`
  - Call indexing action with feature data
  - Handle large outputs (chunk if needed)
  - Log indexing result

- [ ] **E4.3** Create feature completion hook
  - Location: `apps/server/src/services/agent-service.ts`
  - Trigger after feature status changes to `done` or `failed`
  - Read `agent-output.md` content
  - Call `indexFeatureOutput`

- [ ] **E4.4** Add filter for feature category
  - Index category as filter field
  - Enable category-scoped searches

- [ ] **E4.5** Create backfill script for existing features
  - Scan `.automaker/features/*/`
  - Read `feature.json` for metadata
  - Read `agent-output.md` for content
  - Index with appropriate importance

- [ ] **E4.6** Add CLI command: `npm run rag:backfill`
  - Accept `--project` flag
  - Show progress for each feature
  - Skip already-indexed features

#### Acceptance Criteria

- [ ] Completing a feature triggers automatic indexing
- [ ] Failed features indexed with lower importance
- [ ] Backfill script processes all existing features
- [ ] Category filter enables scoped searches
- [ ] Indexing doesn't block feature completion

#### Files to Create/Modify

| File | Action |
|------|--------|
| `convex/indexing/featureOutputs.ts` | Create |
| `apps/server/src/services/convex-rag-service.ts` | Modify |
| `apps/server/src/services/agent-service.ts` | Modify |
| `scripts/rag-backfill.ts` | Create |
| `package.json` | Modify (add script) |

---

### Epic E5: Similar Implementation Search

**Goal**: Enable searching for similar past implementations during feature planning.

#### Tasks

- [ ] **E5.1** Create `convex/search/similarImplementations.ts`
  - `searchSimilarImplementations` action
  - Filter by `contentType: "agent-output"`
  - Higher score threshold (0.6) for quality
  - Include chunk context: `{ before: 2, after: 2 }`

- [ ] **E5.2** Add `findSimilarImplementations` to `ConvexRAGService`
  - Accept description and optional category
  - Return formatted implementation examples
  - Include feature titles for attribution

- [ ] **E5.3** Create API endpoint for similar search
  - `POST /api/rag/similar`
  - Accept: `{ projectId, description, category }`
  - Return: `{ implementations, matchCount }`

- [ ] **E5.4** Add similar implementations to feature planning
  - Query when user creates/edits feature description
  - Display in feature detail sidebar
  - Debounce queries (500ms)

- [ ] **E5.5** Create UI component: `SimilarImplementations`
  - Show loading state during search
  - Display match snippets with scores
  - Link to source features
  - Collapsible for space efficiency

- [ ] **E5.6** Add to enhancement prompt
  - Include similar implementations in Claude context
  - Limit to top 3 most relevant
  - Add instruction to reference patterns

#### Acceptance Criteria

- [ ] API returns relevant past implementations
- [ ] UI shows similar features during planning
- [ ] Category filtering improves relevance
- [ ] Agent receives relevant examples in prompt
- [ ] Performance: <2s search latency

#### Files to Create/Modify

| File | Action |
|------|--------|
| `convex/search/similarImplementations.ts` | Create |
| `apps/server/src/services/convex-rag-service.ts` | Modify |
| `apps/server/src/routes/rag.ts` | Create |
| `apps/ui/src/components/features/SimilarImplementations.tsx` | Create |
| `apps/ui/src/hooks/useSimilarImplementations.ts` | Create |
| `libs/prompts/src/enhancement.ts` | Modify |

---

### Epic E6: Gotcha Detection System

**Goal**: Surface potential issues and past failures before feature execution.

#### Tasks

- [ ] **E6.1** Create `convex/search/gotchas.ts`
  - `searchMemoryForGotchas` action
  - Query pattern: "potential issues problems gotchas: {description}"
  - Filter by memory content type
  - Lower threshold (0.4) for broader matches

- [ ] **E6.2** Create `convex/search/pastFailures.ts`
  - `searchPastFailures` action
  - Filter by failed features (importance < 0.5)
  - Extract failure patterns

- [ ] **E6.3** Add `searchGotchas` method to `ConvexRAGService`
  - Combine memory gotchas and past failures
  - Deduplicate similar warnings
  - Rank by relevance

- [ ] **E6.4** Create API endpoint for gotcha search
  - `POST /api/rag/gotchas`
  - Accept: `{ projectId, taskDescription }`
  - Return: `{ warnings, sources }`

- [ ] **E6.5** Add pre-execution warning display
  - Query gotchas when feature starts execution
  - Display warnings in execution modal
  - Allow user to proceed or cancel

- [ ] **E6.6** Create UI component: `GotchaWarnings`
  - Yellow warning banner style
  - Expandable details for each warning
  - Source attribution links
  - "I understand" acknowledgment

- [ ] **E6.7** Include gotchas in agent prompt
  - Add "Known Issues" section to prompt
  - Instruct agent to avoid documented pitfalls
  - Reference specific gotcha sources

#### Acceptance Criteria

- [ ] Relevant warnings surface before execution
- [ ] Past failures inform current feature
- [ ] User can review warnings before proceeding
- [ ] Agent prompt includes relevant gotchas
- [ ] Gotcha matches logged for analysis

#### Files to Create/Modify

| File | Action |
|------|--------|
| `convex/search/gotchas.ts` | Create |
| `convex/search/pastFailures.ts` | Create |
| `apps/server/src/services/convex-rag-service.ts` | Modify |
| `apps/server/src/routes/rag.ts` | Modify |
| `apps/ui/src/components/features/GotchaWarnings.tsx` | Create |
| `apps/ui/src/components/features/ExecutionModal.tsx` | Modify |
| `libs/prompts/src/agent-system.ts` | Modify |

---

## Phase 3: User Experience

### Epic E7: Knowledge Base UI

**Goal**: Provide a UI for browsing, searching, and managing indexed content.

#### Tasks

- [ ] **E7.1** Create Convex queries for stats
  - `convex/queries/stats.ts`
  - `getIndexStats` - Count by content type
  - `getRecentlyIndexed` - Latest indexed items
  - `getIndexingJobs` - Job status

- [ ] **E7.2** Create API endpoints for knowledge base
  - `GET /api/rag/stats` - Index statistics
  - `GET /api/rag/content` - List indexed content
  - `POST /api/rag/search` - Manual search
  - `DELETE /api/rag/content/:id` - Remove content

- [ ] **E7.3** Create Knowledge Base page route
  - Location: `apps/ui/src/routes/knowledge-base.tsx`
  - Add to navigation (settings area)
  - Project-scoped view

- [ ] **E7.4** Create stats dashboard component
  - Total items by content type (pie chart)
  - Indexing activity timeline
  - Storage usage estimate
  - Last sync timestamp

- [ ] **E7.5** Create content browser component
  - Filterable by content type
  - Searchable by text
  - Paginated list view
  - Preview on hover/click

- [ ] **E7.6** Create manual search interface
  - Query input with suggestions
  - Filter toggles (content types)
  - Results with relevance scores
  - Source links

- [ ] **E7.7** Add re-index and clear actions
  - "Re-index All" button with confirmation
  - "Clear Index" for fresh start
  - Progress indicator during operations

- [ ] **E7.8** Real-time updates with Convex subscriptions
  - Use `useQuery` for reactive stats
  - Show live indexing progress
  - Update content list on changes

#### Acceptance Criteria

- [ ] Users can view all indexed content
- [ ] Search interface returns relevant results
- [ ] Stats show index health at a glance
- [ ] Re-index action works without data loss
- [ ] Real-time updates during indexing

#### Files to Create/Modify

| File | Action |
|------|--------|
| `convex/queries/stats.ts` | Create |
| `apps/server/src/routes/rag.ts` | Modify |
| `apps/ui/src/routes/knowledge-base.tsx` | Create |
| `apps/ui/src/components/knowledge-base/StatsCard.tsx` | Create |
| `apps/ui/src/components/knowledge-base/ContentBrowser.tsx` | Create |
| `apps/ui/src/components/knowledge-base/SearchInterface.tsx` | Create |
| `apps/ui/src/hooks/useKnowledgeBase.ts` | Create |

---

### Epic E8: Codebase Pattern Indexing

**Goal**: Index codebase structure and patterns for architecture-aware context.

#### Tasks

- [ ] **E8.1** Create code pattern extractor
  - Parse TypeScript/JavaScript files
  - Extract function signatures and docstrings
  - Identify component patterns (React, routes, services)
  - Extract TODO/FIXME comments

- [ ] **E8.2** Create `convex/indexing/codePatterns.ts`
  - `indexCodePattern` action
  - Accept file path, pattern type, content
  - Filter by pattern type (component, route, service, etc.)

- [ ] **E8.3** Implement selective code indexing
  - Respect `.gitignore` patterns
  - Skip node_modules, dist, build directories
  - Focus on src/ directories
  - Limit file size (skip large generated files)

- [ ] **E8.4** Add `indexCodebase` method to `ConvexRAGService`
  - Scan project directory
  - Extract patterns from each file
  - Batch index operations
  - Track progress

- [ ] **E8.5** Create CLI command: `npm run rag:index-code`
  - Accept `--project` and `--patterns` flags
  - Show extraction progress
  - Report indexed patterns

- [ ] **E8.6** Create code pattern search
  - `convex/search/codePatterns.ts`
  - `searchCodePatterns` action
  - Filter by pattern type
  - Return file locations

- [ ] **E8.7** Integrate code patterns into agent context
  - Query relevant patterns for feature
  - Include in "Codebase Context" section
  - Limit to most relevant patterns

#### Acceptance Criteria

- [ ] Key code patterns extracted and indexed
- [ ] Pattern search returns relevant code locations
- [ ] Agent receives architectural context
- [ ] Large/binary files skipped appropriately
- [ ] Indexing respects .gitignore

#### Files to Create/Modify

| File | Action |
|------|--------|
| `convex/indexing/codePatterns.ts` | Create |
| `convex/search/codePatterns.ts` | Create |
| `apps/server/src/services/code-pattern-extractor.ts` | Create |
| `apps/server/src/services/convex-rag-service.ts` | Modify |
| `scripts/rag-index-code.ts` | Create |
| `libs/prompts/src/agent-system.ts` | Modify |

---

### Epic E9: Incremental Re-indexing

**Goal**: Automatically re-index changed files without manual intervention.

#### Tasks

- [ ] **E9.1** Implement file watcher service
  - Watch `.automaker/context/` and `.automaker/memory/`
  - Debounce rapid changes (1s)
  - Queue changed files for indexing

- [ ] **E9.2** Create incremental index mutation
  - `convex/mutations/incrementalIndex.ts`
  - Accept file path and new checksum
  - Compare with stored checksum
  - Trigger re-index if changed

- [ ] **E9.3** Add background job queue
  - `convex/indexingJobs` table for job tracking
  - Process jobs in order
  - Retry failed jobs (max 3 attempts)
  - Report job status

- [ ] **E9.4** Implement stale content detection
  - Compare last-indexed timestamp with file mtime
  - Flag stale content in UI
  - Suggest re-index for stale items

- [ ] **E9.5** Add delete handling
  - Detect deleted files
  - Remove from index when file deleted
  - Handle renamed files (delete + add)

- [ ] **E9.6** Create Convex scheduled function
  - Run daily to check for stale content
  - Re-index files older than threshold
  - Send notification if errors

- [ ] **E9.7** Add indexing status to server health check
  - Include last successful index time
  - Show pending job count
  - Alert on prolonged failures

#### Acceptance Criteria

- [ ] File changes trigger automatic re-indexing
- [ ] Deleted files removed from index
- [ ] Stale content detected and flagged
- [ ] Job queue handles failures gracefully
- [ ] Health check reports indexing status

#### Files to Create/Modify

| File | Action |
|------|--------|
| `convex/mutations/incrementalIndex.ts` | Create |
| `convex/scheduled/staleContentCheck.ts` | Create |
| `apps/server/src/services/file-watcher-service.ts` | Create |
| `apps/server/src/services/convex-rag-service.ts` | Modify |
| `apps/server/src/routes/health.ts` | Modify |

---

## Phase 4: Intelligence

### Epic E10: Cross-Feature Learning

**Goal**: Extract and surface learnings from feature history for predictive insights.

#### Tasks

- [ ] **E10.1** Create learning extraction pipeline
  - Analyze completed feature conversations
  - Extract decision patterns using Claude
  - Identify success/failure factors
  - Store as structured learnings

- [ ] **E10.2** Create `convex/indexing/learnings.ts`
  - `indexLearning` action
  - Accept: topic, insight, source feature, outcome
  - Higher importance for validated learnings

- [ ] **E10.3** Build feature outcome analyzer
  - Track features from creation to completion
  - Measure: time to complete, iterations, success rate
  - Correlate with feature attributes

- [ ] **E10.4** Create risk scoring model
  - Analyze similar past features
  - Calculate risk based on: category, complexity, past failures
  - Return risk score (0-1) with factors

- [ ] **E10.5** Add `assessFeatureRisk` to `ConvexRAGService`
  - Query similar features and outcomes
  - Calculate composite risk score
  - Return risk factors and mitigations

- [ ] **E10.6** Create API endpoint for risk assessment
  - `POST /api/rag/risk`
  - Accept: `{ projectId, featureTitle, featureDescription }`
  - Return: `{ riskScore, factors, recommendations }`

- [ ] **E10.7** Display risk assessment in UI
  - Show risk indicator on feature cards
  - Detail view with factor breakdown
  - Recommended actions for high-risk features

- [ ] **E10.8** Generate learning reports
  - Weekly digest of new learnings
  - Top patterns by category
  - Improvement trends over time

#### Acceptance Criteria

- [ ] Learnings extracted from completed features
- [ ] Risk scores calculated for new features
- [ ] UI shows risk indicators and factors
- [ ] Recommendations surface for high-risk features
- [ ] Learning reports generated automatically

#### Files to Create/Modify

| File | Action |
|------|--------|
| `convex/indexing/learnings.ts` | Create |
| `convex/search/riskAssessment.ts` | Create |
| `apps/server/src/services/learning-extractor.ts` | Create |
| `apps/server/src/services/risk-analyzer.ts` | Create |
| `apps/server/src/services/convex-rag-service.ts` | Modify |
| `apps/server/src/routes/rag.ts` | Modify |
| `apps/ui/src/components/features/RiskIndicator.tsx` | Create |
| `apps/ui/src/components/reports/LearningReport.tsx` | Create |

---

## Dependencies Graph

```
E1 (Infrastructure)
 │
 └──► E2 (Context/Memory Indexing)
       │
       └──► E3 (Semantic Search)
             │
             ├──► E4 (Feature Output Indexing)
             │     │
             │     ├──► E5 (Similar Implementation Search)
             │     │
             │     ├──► E6 (Gotcha Detection)
             │     │     │
             │     │     └──► E10 (Cross-Feature Learning)
             │     │
             │     ├──► E7 (Knowledge Base UI)
             │     │
             │     └──► E9 (Incremental Re-indexing)
             │           │
             │           └──► E10 (Cross-Feature Learning)
             │
             └──► E8 (Codebase Pattern Indexing)
```

---

## Milestone Summary

### Milestone 1: RAG Foundation (Epics E1-E3)

**Deliverables**:
- Convex backend operational
- Context and memory files indexed
- Semantic search integrated into agent prompts

**Success Criteria**:
- Agent receives semantically relevant context
- Fallback works when RAG unavailable
- <500ms search latency

### Milestone 2: Feature Intelligence (Epics E4-E6)

**Deliverables**:
- Automatic feature output indexing
- Similar implementation discovery
- Pre-execution gotcha warnings

**Success Criteria**:
- All new features auto-indexed
- Similar features surfaced in planning
- Gotchas displayed before execution

### Milestone 3: User Experience (Epics E7-E9)

**Deliverables**:
- Knowledge base management UI
- Codebase pattern indexing
- Automatic incremental re-indexing

**Success Criteria**:
- Users can browse/search all indexed content
- Code patterns inform agent context
- No manual re-indexing required

### Milestone 4: Predictive Intelligence (Epic E10)

**Deliverables**:
- Automated learning extraction
- Feature risk assessment
- Learning reports

**Success Criteria**:
- Risk scores correlate with outcomes
- Learnings improve agent performance
- Reports provide actionable insights

---

## Technical Notes

### Convex Limits to Consider

| Limit | Value | Mitigation |
|-------|-------|------------|
| Vector dimensions | 2-4096 | Use 1536 (OpenAI default) |
| Results per search | Max 256 | Paginate if needed |
| Filter fields | Max 16 | Consolidate filters |
| Function timeout | 60s | Batch large operations |

### Performance Targets

| Operation | Target Latency |
|-----------|---------------|
| Single file index | <2s |
| Context search | <500ms |
| Similar implementation search | <1s |
| Full project re-index | <5min (100 files) |

### Error Handling Strategy

1. **Convex unavailable**: Fall back to full file loading
2. **OpenAI rate limit**: Queue and retry with backoff
3. **Index corruption**: Provide "clear and re-index" action
4. **Large content**: Chunk files >10KB before indexing

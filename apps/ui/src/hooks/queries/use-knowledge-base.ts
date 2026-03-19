/**
 * Knowledge Base Query Hooks
 *
 * React Query hooks for the Knowledge Base page — fetching RAG status,
 * searching indexed content, and triggering re-indexing.
 */

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getElectronAPI } from '@/lib/electron';
import { queryKeys } from '@/lib/query-keys';

export interface KBFile {
  filePath: string;
  contentType: string;
  lastIndexed: string;
}

export interface KBStatus {
  enabled: boolean;
  configured: boolean;
  url?: string;
  projectId: string;
  indexed: boolean;
  fileCount?: number;
  files: KBFile[];
  error?: string;
}

export interface KBSearchResult {
  context: string;
  sources: string[];
  chunksRetrieved: number;
  latencyMs: number;
}

export interface KBIndexResult {
  projectId: string;
  summary: {
    total: number;
    indexed: number;
    skipped: number;
    failed: number;
    duration: number;
  };
}

/**
 * Fetch knowledge base status for a project
 */
export function useKnowledgeBaseStatus(projectPath: string | undefined) {
  return useQuery({
    queryKey: queryKeys.rag.status(projectPath ?? ''),
    queryFn: async (): Promise<KBStatus | null> => {
      if (!projectPath) return null;
      const api = getElectronAPI();
      const result = await api.rag?.getStatus(projectPath);
      if (!result?.success || !result.status) return null;
      return result.status as KBStatus;
    },
    enabled: !!projectPath,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}

/**
 * Search the knowledge base with debounced query
 */
export function useKnowledgeBaseSearch(
  projectPath: string | undefined,
  query: string,
  contentType?: string,
  options: { debounceMs?: number; minLength?: number } = {}
) {
  const { debounceMs = 500, minLength = 3 } = options;

  const [debouncedQuery, setDebouncedQuery] = useState(query);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), debounceMs);
    return () => clearTimeout(timer);
  }, [query, debounceMs]);

  const hasValidQuery = debouncedQuery.length >= minLength;

  return useQuery({
    queryKey: queryKeys.rag.search(projectPath ?? '', debouncedQuery, contentType),
    queryFn: async (): Promise<KBSearchResult | null> => {
      if (!projectPath || !hasValidQuery) return null;
      const api = getElectronAPI();
      const result = await api.rag?.search(projectPath, debouncedQuery, contentType);
      if (!result?.success || !result.result) return null;
      return result.result as KBSearchResult;
    },
    enabled: !!projectPath && hasValidQuery,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}

/**
 * Mutation to trigger project re-indexing
 */
export function useIndexProject(projectPath: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (): Promise<KBIndexResult | null> => {
      if (!projectPath) return null;
      const api = getElectronAPI();
      const result = await api.rag?.indexProject(projectPath);
      if (!result?.success || !result.result) return null;
      return result.result as KBIndexResult;
    },
    onSuccess: () => {
      if (projectPath) {
        queryClient.invalidateQueries({ queryKey: queryKeys.rag.status(projectPath) });
      }
    },
  });
}

/**
 * Mutation to trigger codebase indexing
 */
export function useIndexCode(projectPath: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (): Promise<KBIndexResult | null> => {
      if (!projectPath) return null;
      const api = getElectronAPI();
      const result = await api.rag?.indexCode(projectPath);
      if (!result?.success || !result.result) return null;
      return result.result as KBIndexResult;
    },
    onSuccess: () => {
      if (projectPath) {
        queryClient.invalidateQueries({ queryKey: queryKeys.rag.status(projectPath) });
      }
    },
  });
}

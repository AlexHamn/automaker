/**
 * Similar Implementations Query Hook
 *
 * Fetches similar past implementations from the RAG knowledge base
 * based on a feature description. Uses debouncing to avoid excessive
 * API calls while the user types.
 */

import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getElectronAPI } from '@/lib/electron';
import { queryKeys } from '@/lib/query-keys';

export interface SimilarImplementationsResult {
  context: string;
  sources: string[];
  chunksRetrieved: number;
  latencyMs: number;
}

interface UseSimilarImplementationsOptions {
  enabled?: boolean;
  debounceMs?: number;
  minLength?: number;
}

/**
 * Hook to fetch similar past implementations based on a feature description.
 * Debounces the description input to avoid excessive API calls.
 */
export function useSimilarImplementations(
  projectPath: string | undefined,
  description: string | undefined,
  category?: string,
  options: UseSimilarImplementationsOptions = {}
) {
  const { enabled = true, debounceMs = 500, minLength = 20 } = options;

  const [debouncedDescription, setDebouncedDescription] = useState(description ?? '');

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedDescription(description ?? '');
    }, debounceMs);
    return () => clearTimeout(timer);
  }, [description, debounceMs]);

  const hasValidDescription = debouncedDescription.length >= minLength;

  return useQuery({
    queryKey: queryKeys.rag.similar(projectPath ?? '', debouncedDescription, category),
    queryFn: async (): Promise<SimilarImplementationsResult | null> => {
      if (!projectPath || !hasValidDescription) return null;

      const api = getElectronAPI();
      const result = await api.rag?.searchSimilar(projectPath, debouncedDescription, category);

      if (!result?.success || !result.result) {
        return null;
      }

      return result.result;
    },
    enabled: !!projectPath && hasValidDescription && enabled,
    staleTime: 60_000, // 1 minute
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

/**
 * Gotcha Warnings Query Hook
 *
 * Fetches potential gotchas and warnings from the RAG knowledge base
 * based on a task description. Uses debouncing to avoid excessive API calls.
 */

import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getElectronAPI } from '@/lib/electron';
import { queryKeys } from '@/lib/query-keys';

export interface GotchaWarningsResult {
  context: string;
  sources: string[];
  chunksRetrieved: number;
  latencyMs: number;
}

interface UseGotchaWarningsOptions {
  enabled?: boolean;
  debounceMs?: number;
  minLength?: number;
}

/**
 * Hook to fetch gotcha warnings based on a task description.
 * Debounces the description input to avoid excessive API calls.
 */
export function useGotchaWarnings(
  projectPath: string | undefined,
  description: string | undefined,
  options: UseGotchaWarningsOptions = {}
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
    queryKey: queryKeys.rag.gotchas(projectPath ?? '', debouncedDescription),
    queryFn: async (): Promise<GotchaWarningsResult | null> => {
      if (!projectPath || !hasValidDescription) return null;

      const api = getElectronAPI();
      const result = await api.rag?.searchGotchas(projectPath, debouncedDescription);

      if (!result?.success || !result.result) {
        return null;
      }

      return result.result;
    },
    enabled: !!projectPath && hasValidDescription && enabled,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

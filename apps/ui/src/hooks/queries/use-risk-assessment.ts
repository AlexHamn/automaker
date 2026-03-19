/**
 * Risk Assessment Query Hook
 *
 * Fetches risk assessment for a feature based on past outcomes
 * from the RAG knowledge base. Uses debouncing.
 */

import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getElectronAPI } from '@/lib/electron';
import { queryKeys } from '@/lib/query-keys';

export interface RiskAssessmentResult {
  riskScore: number;
  riskLevel: 'low' | 'medium' | 'high';
  factors: Array<{ type: string; description: string; weight: number }>;
  recommendations: string[];
  similarFeatureCount: number;
  latencyMs: number;
}

interface UseRiskAssessmentOptions {
  enabled?: boolean;
  debounceMs?: number;
  minLength?: number;
}

export function useRiskAssessment(
  projectPath: string | undefined,
  title: string | undefined,
  description: string | undefined,
  category?: string,
  options: UseRiskAssessmentOptions = {}
) {
  const { enabled = true, debounceMs = 500, minLength = 20 } = options;

  const [debouncedTitle, setDebouncedTitle] = useState(title ?? '');
  const [debouncedDescription, setDebouncedDescription] = useState(description ?? '');

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedTitle(title ?? '');
      setDebouncedDescription(description ?? '');
    }, debounceMs);
    return () => clearTimeout(timer);
  }, [title, description, debounceMs]);

  const hasValidInput = debouncedDescription.length >= minLength;

  return useQuery({
    queryKey: queryKeys.rag.risk(projectPath ?? '', debouncedTitle, debouncedDescription, category),
    queryFn: async (): Promise<RiskAssessmentResult | null> => {
      if (!projectPath || !hasValidInput) return null;

      const api = getElectronAPI();
      const result = await api.rag?.assessRisk(
        projectPath,
        debouncedTitle,
        debouncedDescription,
        category
      );

      if (!result?.success || !result.result) return null;
      return result.result;
    },
    enabled: !!projectPath && hasValidInput && enabled,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

/**
 * Board Features Hook
 *
 * React Query-based hook for managing features on the board view.
 * Handles feature loading, categories, and auto-mode event notifications.
 */

import { useState, useCallback, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '@/store/app-store';
import { getElectronAPI } from '@/lib/electron';
import { toast } from 'sonner';
import { createLogger } from '@automaker/utils/logger';
import { useFeatures } from '@/hooks/queries';
import { queryKeys } from '@/lib/query-keys';

const logger = createLogger('BoardFeatures');

interface UseBoardFeaturesProps {
  currentProject: { path: string; id: string } | null;
}

export function useBoardFeatures({ currentProject }: UseBoardFeaturesProps) {
  const queryClient = useQueryClient();
  const [persistedCategories, setPersistedCategories] = useState<string[]>([]);

  // Use React Query for features
  const {
    data: features = [],
    isLoading,
    refetch: loadFeatures,
  } = useFeatures(currentProject?.path);

  // Load persisted categories from file
  const loadCategories = useCallback(async () => {
    if (!currentProject) return;

    try {
      const api = getElectronAPI();
      const result = await api.readFile(`${currentProject.path}/.automaker/categories.json`);

      if (result.success && result.content) {
        const parsed = JSON.parse(result.content);
        if (Array.isArray(parsed)) {
          setPersistedCategories(parsed);
        }
      } else {
        setPersistedCategories([]);
      }
    } catch {
      setPersistedCategories([]);
    }
  }, [currentProject]);

  // Save a new category to the persisted categories file
  const saveCategory = useCallback(
    async (category: string) => {
      if (!currentProject || !category.trim()) return;

      try {
        const api = getElectronAPI();
        let categories: string[] = [...persistedCategories];

        if (!categories.includes(category)) {
          categories.push(category);
          categories.sort();

          await api.writeFile(
            `${currentProject.path}/.automaker/categories.json`,
            JSON.stringify(categories, null, 2)
          );

          setPersistedCategories(categories);
        }
      } catch (error) {
        logger.error('Failed to save category:', error);
      }
    },
    [currentProject, persistedCategories]
  );

  // Subscribe to auto mode events for notifications (ding sound, toasts)
  // Note: Query invalidation is handled by useAutoModeQueryInvalidation in the root
  useEffect(() => {
    const api = getElectronAPI();
    if (!api?.autoMode || !currentProject) return;

    const { removeRunningTask } = useAppStore.getState();
    const projectId = currentProject.id;

    const unsubscribe = api.autoMode.onEvent((event) => {
      const eventProjectId = ('projectId' in event && event.projectId) || projectId;

      if (event.type === 'auto_mode_feature_complete') {
        // Play ding sound when feature is done (unless muted)
        const { muteDoneSound } = useAppStore.getState();
        if (!muteDoneSound) {
          const audio = new Audio('/sounds/ding.mp3');
          audio.play().catch((err) => logger.warn('Could not play ding sound:', err));
        }
      } else if (event.type === 'auto_mode_error') {
        // Remove from running tasks
        if (event.featureId) {
          removeRunningTask(eventProjectId, event.featureId);
        }

        // Show error toast
        const isAuthError =
          event.errorType === 'authentication' ||
          (event.error &&
            (event.error.includes('Authentication failed') ||
              event.error.includes('Invalid API key')));

        if (isAuthError) {
          toast.error('Authentication Failed', {
            description:
              "Your API key is invalid or expired. Please check Settings or run 'claude login' in terminal.",
            duration: 10000,
          });
        } else {
          toast.error('Agent encountered an error', {
            description: event.error || 'Check the logs for details',
          });
        }
      }
    });

    return unsubscribe;
  }, [currentProject]);

  // Check for interrupted features on mount
  useEffect(() => {
    if (!currentProject) return;

    const checkInterrupted = async () => {
      const api = getElectronAPI();
      if (api.autoMode?.resumeInterrupted) {
        try {
          await api.autoMode.resumeInterrupted(currentProject.path);
          logger.info('Checked for interrupted features');
        } catch (error) {
          logger.warn('Failed to check for interrupted features:', error);
        }
      }
    };

    checkInterrupted();
  }, [currentProject]);

  // Load persisted categories on mount/project change
  useEffect(() => {
    loadCategories();
  }, [loadCategories]);

  // Clear categories when project changes
  useEffect(() => {
    setPersistedCategories([]);
  }, [currentProject?.path]);

  return {
    features,
    isLoading,
    persistedCategories,
    loadFeatures: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.features.all(currentProject?.path ?? ''),
      });
    },
    loadCategories,
    saveCategory,
  };
}

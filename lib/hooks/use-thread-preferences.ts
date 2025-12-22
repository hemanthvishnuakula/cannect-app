/**
 * useThreadPreferences - Bluesky-style Thread View/Sort Preferences
 * 
 * Based on: bluesky-social/social-app/src/state/queries/usePostThread/useThreadPreferences.ts
 * 
 * Manages:
 * - sort: 'hotness' | 'oldest' | 'newest' (reply ordering)
 * - view: 'tree' | 'linear' (nested vs flat view)
 * 
 * Persists preferences via MMKV/AsyncStorage for consistency across sessions.
 */

import { useState, useCallback, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ============================================
// Types
// ============================================

export type ThreadSort = 'hotness' | 'oldest' | 'newest';
export type ThreadView = 'tree' | 'linear';

export interface ThreadPreferences {
  sort: ThreadSort;
  view: ThreadView;
}

interface UseThreadPreferencesReturn {
  /** Whether preferences have been loaded from storage */
  isLoaded: boolean;
  /** Current sort order for replies */
  sort: ThreadSort;
  /** Set sort order (persists to storage) */
  setSort: (sort: ThreadSort) => void;
  /** Current view mode (tree or linear) */
  view: ThreadView;
  /** Set view mode (persists to storage) */
  setView: (view: ThreadView) => void;
}

// ============================================
// Constants
// ============================================

const STORAGE_KEY = 'thread_preferences';

const DEFAULT_PREFERENCES: ThreadPreferences = {
  sort: 'hotness',
  view: 'linear', // Linear is Bluesky's default
};

// ============================================
// Hook
// ============================================

/**
 * Bluesky-style thread preferences with persistence
 */
export function useThreadPreferences(): UseThreadPreferencesReturn {
  const [isLoaded, setIsLoaded] = useState(false);
  const [sort, setSortState] = useState<ThreadSort>(DEFAULT_PREFERENCES.sort);
  const [view, setViewState] = useState<ThreadView>(DEFAULT_PREFERENCES.view);

  // Load preferences from storage on mount
  useEffect(() => {
    const loadPreferences = async () => {
      try {
        const stored = await AsyncStorage.getItem(STORAGE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored) as Partial<ThreadPreferences>;
          if (parsed.sort) setSortState(parsed.sort);
          if (parsed.view) setViewState(parsed.view);
        }
      } catch (error) {
        console.warn('[ThreadPreferences] Failed to load:', error);
      } finally {
        setIsLoaded(true);
      }
    };
    
    loadPreferences();
  }, []);

  // Persist preferences to storage
  const persistPreferences = useCallback(async (prefs: ThreadPreferences) => {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    } catch (error) {
      console.warn('[ThreadPreferences] Failed to persist:', error);
    }
  }, []);

  const setSort = useCallback((newSort: ThreadSort) => {
    setSortState(newSort);
    persistPreferences({ sort: newSort, view });
  }, [view, persistPreferences]);

  const setView = useCallback((newView: ThreadView) => {
    setViewState(newView);
    persistPreferences({ sort, view: newView });
  }, [sort, persistPreferences]);

  return {
    isLoaded,
    sort,
    setSort,
    view,
    setView,
  };
}

/**
 * Create a query key for thread data that includes preferences
 * Bluesky pattern: separate queryKey per sort/view combination
 */
export function createThreadQueryKey(
  postId: string,
  sort: ThreadSort,
  view: ThreadView
): readonly ['thread', string, ThreadSort, ThreadView] {
  return ['thread', postId, sort, view] as const;
}

/**
 * Create a query key for "other" thread items (deferred replies)
 * Used for pagination/load more
 */
export function createThreadOtherQueryKey(
  postId: string
): readonly ['thread-other', string] {
  return ['thread-other', postId] as const;
}

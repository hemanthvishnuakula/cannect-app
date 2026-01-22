/**
 * View Tracking Hook
 *
 * Tracks post views for analytics and trending features.
 * Uses intersection observer to detect when posts enter viewport.
 */

import { useCallback, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useCurrentDid } from './use-atp-auth';

const FEED_API_URL = 'https://feed.cannect.space';
const VIEW_BATCH_SIZE = 10;
const VIEW_BATCH_DELAY = 5000; // 5 seconds

// Global queue for batching views
let viewQueue: Array<{ postUri: string; source: string }> = [];
let flushTimeout: ReturnType<typeof setTimeout> | null = null;
let currentViewerDid: string | null = null;

/**
 * Flush queued views to the API
 */
async function flushViews() {
  if (viewQueue.length === 0) return;

  const views = [...viewQueue];
  viewQueue = [];

  try {
    await fetch(`${FEED_API_URL}/api/views`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        views,
        viewerDid: currentViewerDid,
      }),
    });
  } catch (err) {
    // Silently fail - view tracking is non-critical
    console.debug('[Views] Failed to record views:', err);
  }
}

/**
 * Queue a view to be sent
 */
function queueView(postUri: string, source: string = 'feed') {
  viewQueue.push({ postUri, source });

  // Flush if we hit batch size
  if (viewQueue.length >= VIEW_BATCH_SIZE) {
    if (flushTimeout) clearTimeout(flushTimeout);
    flushViews();
    return;
  }

  // Otherwise schedule a flush
  if (!flushTimeout) {
    flushTimeout = setTimeout(() => {
      flushTimeout = null;
      flushViews();
    }, VIEW_BATCH_DELAY);
  }
}

/**
 * Hook to track views for a single post
 * Attach the returned ref to the post container element
 */
export function useTrackPostView(postUri: string | undefined, source: string = 'feed') {
  const currentDid = useCurrentDid();
  const hasTracked = useRef(false);
  const elementRef = useRef<HTMLDivElement>(null);

  // Update global viewer DID
  useEffect(() => {
    if (currentDid) {
      currentViewerDid = currentDid;
    }
  }, [currentDid]);

  useEffect(() => {
    if (!postUri || hasTracked.current) return;

    const element = elementRef.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && !hasTracked.current) {
            hasTracked.current = true;
            queueView(postUri, source);
            observer.disconnect();
          }
        }
      },
      {
        threshold: 0.5, // 50% visible
        rootMargin: '0px',
      }
    );

    observer.observe(element);

    return () => observer.disconnect();
  }, [postUri, source]);

  return elementRef;
}

/**
 * Hook to track views for multiple posts (e.g., feed)
 * Returns a function to manually track a view
 */
export function useViewTracking() {
  const currentDid = useCurrentDid();

  // Update global viewer DID
  useEffect(() => {
    if (currentDid) {
      currentViewerDid = currentDid;
    }
  }, [currentDid]);

  const trackView = useCallback((postUri: string, source: string = 'feed') => {
    if (postUri) {
      queueView(postUri, source);
    }
  }, []);

  const trackViews = useCallback((postUris: string[], source: string = 'feed') => {
    for (const uri of postUris) {
      if (uri) {
        queueView(uri, source);
      }
    }
  }, []);

  return { trackView, trackViews };
}

/**
 * Flush any pending views when component unmounts or page unloads
 */
export function useFlushViewsOnUnmount() {
  useEffect(() => {
    const handleUnload = () => flushViews();
    window.addEventListener('beforeunload', handleUnload);

    return () => {
      window.removeEventListener('beforeunload', handleUnload);
      flushViews();
    };
  }, []);
}

// =============================================================================
// View Count Fetching
// =============================================================================

interface PostViewStats {
  postUri: string;
  totalViews: number;
  uniqueViewers: number;
  firstView: string | null;
  lastView: string | null;
}

/**
 * Hook to fetch view count for a single post
 * @param postUri - The post URI to get views for
 * @param enabled - Whether to fetch (default true)
 */
export function usePostViewCount(postUri: string | undefined, enabled: boolean = true) {
  return useQuery<PostViewStats>({
    queryKey: ['post-views', postUri],
    queryFn: async () => {
      if (!postUri) throw new Error('No post URI');
      const response = await fetch(
        `${FEED_API_URL}/api/views/post?uri=${encodeURIComponent(postUri)}`
      );
      if (!response.ok) throw new Error('Failed to fetch view count');
      return response.json();
    },
    enabled: enabled && !!postUri,
    staleTime: 60 * 1000, // 1 minute - views change frequently
    gcTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Hook to fetch trending posts
 * @param hours - Time window in hours (default 24)
 * @param limit - Max posts to return (default 20)
 */
export function useTrendingPosts(hours: number = 24, limit: number = 20) {
  return useQuery<{ period: string; posts: Array<{ postUri: string; views: number }> }>({
    queryKey: ['trending-posts', hours, limit],
    queryFn: async () => {
      const response = await fetch(
        `${FEED_API_URL}/api/trending?hours=${hours}&limit=${limit}`
      );
      if (!response.ok) throw new Error('Failed to fetch trending posts');
      return response.json();
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
  });
}

/**
 * Format view count for display (e.g., 1.2K, 5.3M)
 */
export function formatViewCount(count: number): string {
  if (count < 1000) return count.toString();
  if (count < 1000000) return `${(count / 1000).toFixed(1).replace(/\.0$/, '')}K`;
  return `${(count / 1000000).toFixed(1).replace(/\.0$/, '')}M`;
}

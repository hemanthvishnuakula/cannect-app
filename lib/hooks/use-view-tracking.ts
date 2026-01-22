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

/**
 * Simple hash function for consistent variance per post
 */
function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash);
}

/**
 * Calculate estimated view count based on engagement metrics
 * 
 * Since most posts come from Bluesky and don't have our view tracking,
 * we estimate views based on typical engagement ratios:
 * - ~2-5% of viewers like a post → 1 like ≈ 25-40 views
 * - ~0.5-1% of viewers comment → 1 comment ≈ 75-150 views
 * - ~0.2-0.5% of viewers repost → 1 repost ≈ 150-300 views
 * 
 * We add some variance to make it look natural, not formulaic.
 * The variance is deterministic based on postUri so it's consistent.
 */
export function calculateEstimatedViews(
  trackedViews: number,
  likeCount: number,
  replyCount: number,
  repostCount: number,
  postUri?: string
): number {
  // Base multipliers (conservative estimates)
  const LIKE_MULTIPLIER = 30; // 1 like ≈ 30 views
  const COMMENT_MULTIPLIER = 100; // 1 comment ≈ 100 views  
  const REPOST_MULTIPLIER = 200; // 1 repost ≈ 200 views
  
  // Calculate engagement-based views
  const likeViews = likeCount * LIKE_MULTIPLIER;
  const commentViews = replyCount * COMMENT_MULTIPLIER;
  const repostViews = repostCount * REPOST_MULTIPLIER;
  
  // Total estimated from engagement
  const engagementViews = likeViews + commentViews + repostViews;
  
  // Use the higher of tracked views or engagement-based estimate
  // This ensures posts with actual tracking aren't underestimated
  const baseViews = Math.max(trackedViews, engagementViews);
  
  // Add a small variance (±10%) to make it look natural
  // Use post URI hash for consistent variance per post
  const hash = postUri ? hashCode(postUri) : 0;
  const variance = 0.9 + ((hash % 20) / 100); // 0.90 to 1.10
  
  // Minimum 1 view if there's any engagement
  const totalEngagement = likeCount + replyCount + repostCount;
  if (totalEngagement === 0 && trackedViews === 0) {
    return 0;
  }
  
  return Math.max(1, Math.round(baseViews * variance));
}

/**
 * Hook to get estimated view count for a post
 * Combines tracked views with engagement-based estimation
 */
export function useEstimatedViewCount(
  postUri: string | undefined,
  likeCount: number = 0,
  replyCount: number = 0,
  repostCount: number = 0
): number {
  const { data: viewStats } = usePostViewCount(postUri, false); // Don't auto-fetch for every post
  const trackedViews = viewStats?.totalViews || 0;
  
  return calculateEstimatedViews(trackedViews, likeCount, replyCount, repostCount, postUri);
}

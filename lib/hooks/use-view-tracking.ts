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
 * Works with React Native Web by finding the underlying DOM node
 */
export function useTrackPostView(postUri: string | undefined, source: string = 'feed') {
  const currentDid = useCurrentDid();
  const hasTracked = useRef(false);
  const elementRef = useRef<any>(null);

  // Update global viewer DID
  useEffect(() => {
    if (currentDid) {
      currentViewerDid = currentDid;
    }
  }, [currentDid]);

  useEffect(() => {
    if (!postUri || hasTracked.current) return;

    // Skip on native (no IntersectionObserver)
    if (typeof window === 'undefined' || typeof IntersectionObserver === 'undefined') {
      // On native, just track immediately when mounted (simpler approach)
      hasTracked.current = true;
      queueView(postUri, source);
      return;
    }

    const refValue = elementRef.current;
    if (!refValue) return;

    // React Native Web: the ref might be a View with a DOM node inside
    // Try to get the underlying DOM element
    let element: Element | null = null;

    if (refValue instanceof Element) {
      // Direct DOM element
      element = refValue;
    } else if (refValue._nativeTag || refValue.canonical) {
      // React Native Web internal - try to find DOM node
      // @ts-ignore - accessing internal property
      element = refValue._nativeTag || refValue;
    } else if (typeof refValue.measure === 'function') {
      // React Native view - try findDOMNode equivalent for web
      try {
        // @ts-ignore - findNodeHandle for web
        const { findDOMNode } = require('react-dom');
        element = findDOMNode(refValue);
      } catch {
        // Fallback: just track immediately
        hasTracked.current = true;
        queueView(postUri, source);
        return;
      }
    }

    if (!element || !(element instanceof Element)) {
      // Can't observe, just track immediately
      console.debug('[ViewTracking] Could not find DOM element, tracking immediately');
      hasTracked.current = true;
      queueView(postUri, source);
      return;
    }

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
      const response = await fetch(`${FEED_API_URL}/api/trending?hours=${hours}&limit=${limit}`);
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
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash);
}

/**
 * Calculate estimated view count based on engagement metrics
 *
 * Strategy: More natural, gradual view counts
 * - Lower engagement multipliers (realistic ~20-30% engagement rate for likes)
 * - Logarithmic scaling to prevent unrealistic jumps
 *
 * Stronger multipliers for 40M user network:
 * - 1 like ≈ 50 views (2% engagement rate)
 * - 1 reply ≈ 250 views (0.4% engagement rate)
 * - 1 repost ≈ 400 views (0.25% engagement rate)
 *
 * Note: This is for placeholder/fallback only. Server handles gradual release.
 */
export function calculateEstimatedViews(
  trackedViews: number,
  likeCount: number,
  replyCount: number,
  repostCount: number,
  postUri?: string
): number {
  // Stronger multipliers for 40M user network
  const LIKE_MULTIPLIER = 50;
  const REPLY_MULTIPLIER = 250;
  const REPOST_MULTIPLIER = 400;

  // Calculate raw engagement views
  const likeViews = likeCount * LIKE_MULTIPLIER;
  const replyViews = replyCount * REPLY_MULTIPLIER;
  const repostViews = repostCount * REPOST_MULTIPLIER;

  const rawViews = likeViews + replyViews + repostViews;

  // Apply logarithmic scaling for very high engagement
  let scaledViews: number;
  if (rawViews <= 500) {
    scaledViews = rawViews;
  } else if (rawViews <= 2000) {
    scaledViews = 500 + Math.round((rawViews - 500) * 0.8);
  } else {
    scaledViews = 1700 + Math.round((rawViews - 2000) * 0.6);
  }

  // Combine with tracked viewport views
  const baseViews = scaledViews + trackedViews;

  // Add a small variance (±15%) to make it look natural
  const hash = postUri ? hashCode(postUri) : 0;
  const variance = 0.85 + (hash % 31) / 100; // 0.85 to 1.15

  // Minimum 1 view if there's any engagement
  const totalEngagement = likeCount + replyCount + repostCount;
  if (totalEngagement === 0 && trackedViews === 0) {
    return 0;
  }

  return Math.max(1, Math.round(baseViews * variance));
}

/**
 * Hook to get estimated view count for a post from the server
 * Fetches from API to ensure consistent views across all users
 */
export function useEstimatedViewCount(
  postUri: string | undefined,
  likeCount: number = 0,
  replyCount: number = 0,
  repostCount: number = 0
): number {
  const { data } = useQuery<{ postUri: string; estimatedViews: number }>({
    queryKey: ['estimated-views', postUri],
    queryFn: async () => {
      if (!postUri) throw new Error('No post URI');
      const params = new URLSearchParams({
        uri: postUri,
        likes: likeCount.toString(),
        replies: replyCount.toString(),
        reposts: repostCount.toString(),
      });
      const response = await fetch(`${FEED_API_URL}/api/estimated-views?${params}`);
      if (!response.ok) {
        // Fallback to local calculation if API fails
        return {
          postUri,
          estimatedViews: calculateEstimatedViews(0, likeCount, replyCount, repostCount, postUri),
        };
      }
      return response.json();
    },
    enabled: !!postUri && (likeCount > 0 || replyCount > 0 || repostCount > 0),
    staleTime: 5 * 60 * 1000, // 5 minutes - views are stable
    gcTime: 30 * 60 * 1000, // 30 minutes
    // Return local calculation while loading
    placeholderData: postUri
      ? {
          postUri,
          estimatedViews: calculateEstimatedViews(0, likeCount, replyCount, repostCount, postUri),
        }
      : undefined,
  });

  return (
    data?.estimatedViews || calculateEstimatedViews(0, likeCount, replyCount, repostCount, postUri)
  );
}

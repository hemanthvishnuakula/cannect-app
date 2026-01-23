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
const VIEW_BATCH_DELAY = 3000; // 3 seconds - faster flush

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
        threshold: 0.25, // 25% visible - captures scroll-by views
        rootMargin: '50px', // Start tracking slightly before visible
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
 * Calculate views from engagement (client-side fallback)
 * 
 * Multipliers based on typical engagement rates:
 * - 1 like ≈ 50 views (2% engagement)
 * - 1 reply ≈ 250 views (0.4% engagement)
 * - 1 repost ≈ 400 views (0.25% engagement)
 */
export function calculateViews(
  likeCount: number,
  replyCount: number,
  repostCount: number,
  postUri?: string
): number {
  const LIKE_MULTIPLIER = 50;
  const REPLY_MULTIPLIER = 250;
  const REPOST_MULTIPLIER = 400;

  const likeViews = likeCount * LIKE_MULTIPLIER;
  const replyViews = replyCount * REPLY_MULTIPLIER;
  const repostViews = repostCount * REPOST_MULTIPLIER;

  const rawViews = likeViews + replyViews + repostViews;

  // Apply logarithmic scaling for very high engagement
  let views: number;
  if (rawViews <= 500) {
    views = rawViews;
  } else if (rawViews <= 2000) {
    views = 500 + Math.round((rawViews - 500) * 0.8);
  } else {
    views = 1700 + Math.round((rawViews - 2000) * 0.6);
  }

  // Add a small variance (±15%) to make it look natural
  const hash = postUri ? hashCode(postUri) : 0;
  const variance = 0.85 + (hash % 31) / 100; // 0.85 to 1.15

  return Math.round(views * variance);
}

// Keep old function name for backwards compatibility
export const calculateEstimatedViews = (
  _trackedViews: number,
  likeCount: number,
  replyCount: number,
  repostCount: number,
  postUri?: string
) => calculateViews(likeCount, replyCount, repostCount, postUri);

/**
 * Hook to get view count for a post
 */
export function useViewCount(
  postUri: string | undefined,
  likeCount: number = 0,
  replyCount: number = 0,
  repostCount: number = 0
): number {
  const { data } = useQuery<{ postUri: string; views: number; estimatedViews?: number }>({
    queryKey: ['views', postUri],
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
        return {
          postUri,
          views: calculateViews(likeCount, replyCount, repostCount, postUri),
        };
      }
      const json = await response.json();
      return {
        postUri,
        views: json.views ?? json.estimatedViews ?? 0,
      };
    },
    enabled: !!postUri,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    placeholderData: postUri
      ? {
          postUri,
          views: calculateViews(likeCount, replyCount, repostCount, postUri),
        }
      : undefined,
  });

  return data?.views ?? calculateViews(likeCount, replyCount, repostCount, postUri);
}

// Keep old hook name for backwards compatibility
export const useEstimatedViewCount = useViewCount;

/**
 * Hook to get total reach for a profile (sum of all post views)
 * @param did - The user's DID
 * @param posts - Array of posts with engagement data to calculate reach
 */
export function useProfileReach(
  did: string | undefined,
  posts?: Array<{ uri: string; likeCount?: number; replyCount?: number; repostCount?: number }>
): number {
  const { data } = useQuery<{ totalViews: number }>({
    queryKey: ['profile-reach', did],
    queryFn: async () => {
      if (!did) throw new Error('No DID');
      
      // Get tracked views from server
      const response = await fetch(`${FEED_API_URL}/api/views/author?did=${encodeURIComponent(did)}`);
      if (!response.ok) {
        return { totalViews: 0 };
      }
      const data = await response.json();
      return { totalViews: data.totalViews || 0 };
    },
    enabled: !!did,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 30 * 60 * 1000, // 30 minutes
  });

  // Calculate engagement-based reach from posts if provided
  let engagementReach = 0;
  if (posts && posts.length > 0) {
    for (const post of posts) {
      engagementReach += calculateViews(
        post.likeCount || 0,
        post.replyCount || 0,
        post.repostCount || 0,
        post.uri
      );
    }
  }

  // Total reach = tracked views + engagement-based views
  return (data?.totalViews || 0) + engagementReach;
}

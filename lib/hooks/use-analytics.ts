/**
 * Analytics Hook - PostHog Event Tracking
 * 
 * Centralized analytics for tracking user behavior.
 * Uses PostHog for product analytics.
 * 
 * Note: This hook is SSR-safe - it gracefully handles server-side rendering
 * where PostHog is not available.
 */

import { useCallback } from 'react';

// SSR-safe import - usePostHog only available on client
let usePostHog: () => { capture: (event: string, properties?: Record<string, any>) => void } | null = () => null;
if (typeof window !== 'undefined') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    usePostHog = require('posthog-react-native').usePostHog;
  } catch {
    // PostHog not available
  }
}

/**
 * Analytics events we track
 */
export type AnalyticsEvent = 
  // Auth events
  | 'user_signed_up'
  | 'user_logged_in'
  | 'user_logged_out'
  // Post events
  | 'post_created'
  | 'post_liked'
  | 'post_unliked'
  | 'post_reposted'
  | 'post_unreposted'
  | 'post_deleted'
  | 'post_viewed'
  // Feed events
  | 'feed_viewed'
  | 'feed_refreshed'
  | 'feed_scrolled_to_end'
  // Profile events
  | 'profile_viewed'
  | 'profile_edited'
  | 'user_followed'
  | 'user_unfollowed'
  // Engagement
  | 'reply_created'
  | 'media_uploaded'
  // PWA events
  | 'pwa_installed'
  | 'push_enabled'
  | 'push_disabled';

/**
 * Hook for tracking analytics events
 */
export function useAnalytics() {
  const posthog = usePostHog();

  const track = useCallback((event: AnalyticsEvent, properties?: Record<string, any>) => {
    // Skip if PostHog not available (SSR or not initialized)
    if (!posthog) return;
    posthog.capture(event, properties);
  }, [posthog]);

  // Convenience methods for common events
  const trackPostCreated = useCallback((hasMedia: boolean, mediaCount: number) => {
    track('post_created', { has_media: hasMedia, media_count: mediaCount });
  }, [track]);

  const trackPostLiked = useCallback((postUri: string) => {
    track('post_liked', { post_uri: postUri });
  }, [track]);

  const trackPostReposted = useCallback((postUri: string) => {
    track('post_reposted', { post_uri: postUri });
  }, [track]);

  const trackFeedViewed = useCallback((feedType: 'global' | 'local' | 'following') => {
    track('feed_viewed', { feed_type: feedType });
  }, [track]);

  const trackProfileViewed = useCallback((profileDid: string, isOwnProfile: boolean) => {
    track('profile_viewed', { profile_did: profileDid, is_own_profile: isOwnProfile });
  }, [track]);

  return {
    track,
    trackPostCreated,
    trackPostLiked,
    trackPostReposted,
    trackFeedViewed,
    trackProfileViewed,
  };
}

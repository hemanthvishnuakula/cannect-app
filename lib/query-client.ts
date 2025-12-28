import { QueryClient } from "@tanstack/react-query";
import { isAuthError, handleAuthError } from "./atproto/agent";
import { logger } from "./utils";

// Track if we're already handling an auth error to prevent multiple triggers
let isHandlingAuthError = false;

// Track consecutive 400 errors - multiple 400s in a row likely means auth failure
let consecutive400Count = 0;
let last400Time = 0;
const CONSECUTIVE_400_THRESHOLD = 3;
const CONSECUTIVE_400_WINDOW_MS = 2000; // Reset count if more than 2s between errors

/**
 * Custom retry function with rate limit awareness
 * - 429 (rate limit): Retry up to 5 times with backoff
 * - 4xx client errors: Don't retry (except 429)
 * - 5xx server errors: Retry up to 2 times
 * - Network errors: Retry up to 2 times
 */
function shouldRetry(failureCount: number, error: any): boolean {
  const status = error?.status || error?.response?.status;
  const errorMsg = error?.message || error?.data?.message || String(error).substring(0, 100);
  const now = Date.now();
  
  // Log every error through retry logic
  console.log('[QueryClient] shouldRetry called:', { 
    failureCount, 
    status, 
    errorMsg,
    isHandlingAuthError,
    consecutive400Count 
  });
  logger.debug('query', 'retry_check', `Checking retry: status=${status}`, {
    failureCount,
    status,
    errorMsg: errorMsg.substring(0, 50),
    isHandlingAuthError,
    consecutive400Count
  });
  
  // Track consecutive 400 errors
  if (status === 400) {
    if (now - last400Time < CONSECUTIVE_400_WINDOW_MS) {
      consecutive400Count++;
    } else {
      consecutive400Count = 1;
    }
    last400Time = now;
    
    console.log('[QueryClient] 400 error tracked:', { consecutive400Count, threshold: CONSECUTIVE_400_THRESHOLD });
    
    // Multiple 400s in quick succession = likely auth failure
    if (consecutive400Count >= CONSECUTIVE_400_THRESHOLD && !isHandlingAuthError) {
      console.warn(`[QueryClient] 🔴 ${consecutive400Count} consecutive 400 errors - triggering auth failure`);
      logger.error('query', 'consecutive_400_auth', `${consecutive400Count} consecutive 400s`, { errorMsg });
      isHandlingAuthError = true;
      consecutive400Count = 0;
      handleAuthError().finally(() => {
        setTimeout(() => { isHandlingAuthError = false; }, 5000);
      });
      return false;
    }
  } else {
    // Reset on non-400 status
    consecutive400Count = 0;
  }
  
  // Check if this is a specific auth error - trigger session expiry
  const authError = isAuthError(error);
  console.log('[QueryClient] isAuthError result:', authError);
  
  if (authError && !isHandlingAuthError) {
    isHandlingAuthError = true;
    console.warn('[QueryClient] 🔴 Auth error detected, triggering session expiry');
    logger.error('query', 'auth_error_detected', 'Query triggered auth error', { status, errorMsg });
    handleAuthError().finally(() => {
      // Reset after a delay to allow re-detection if needed
      setTimeout(() => { isHandlingAuthError = false; }, 5000);
    });
    return false;
  }
  
  // Rate limited - retry more aggressively with backoff
  if (status === 429) {
    console.log('[QueryClient] Rate limited, will retry');
    return failureCount < 5;
  }
  
  // Other client errors (400, 401, 403, 404) - don't retry
  if (status >= 400 && status < 500) {
    console.log('[QueryClient] Client error, not retrying');
    return false;
  }
  
  // Server errors or network errors - retry up to 2 times
  console.log('[QueryClient] Will retry server/network error');
  return failureCount < 2;
}

/**
 * Exponential backoff with jitter
 * Base delay doubles each attempt: 1s, 2s, 4s, 8s, 16s (max 30s)
 * Jitter adds randomness to prevent thundering herd
 */
function getRetryDelay(attemptIndex: number, error: any): number {
  const status = error?.status || error?.response?.status;
  
  // For rate limits, check Retry-After header first
  if (status === 429) {
    const retryAfter = error?.headers?.get?.('retry-after') || 
                       error?.response?.headers?.['retry-after'];
    if (retryAfter) {
      const seconds = parseInt(retryAfter, 10);
      if (!isNaN(seconds)) {
        return seconds * 1000;
      }
    }
  }
  
  // Exponential backoff: 1s, 2s, 4s, 8s, 16s
  const baseDelay = Math.min(1000 * Math.pow(2, attemptIndex), 30000);
  // Add jitter (±25%)
  const jitter = baseDelay * 0.25 * (Math.random() - 0.5);
  return baseDelay + jitter;
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      gcTime: 1000 * 60 * 30, // 30 minutes (formerly cacheTime)
      retry: shouldRetry,
      retryDelay: getRetryDelay,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: shouldRetry,
      retryDelay: getRetryDelay,
    },
  },
});

// Query keys factory for type-safe query keys
export const queryKeys = {
  // Auth
  auth: {
    session: ["auth", "session"] as const,
    user: ["auth", "user"] as const,
  },
  
  // Profiles
  profiles: {
    all: ["profiles"] as const,
    detail: (id: string) => ["profiles", id] as const,
    byUsername: (username: string) => ["profiles", "username", username] as const,
  },
  
  // Posts / Feed
  posts: {
    all: ["posts"] as const,
    feed: (userId?: string) => ["posts", "feed", userId] as const,
    detail: (id: string) => ["posts", id] as const,
    byUser: (userId: string) => ["posts", "user", userId] as const,
    replies: (postId: string) => ["posts", "replies", postId] as const,
  },
  
  // Notifications
  notifications: {
    all: ["notifications"] as const,
    unreadCount: ["notifications", "unread"] as const,
  },
  
  // Search
  search: {
    users: (query: string) => ["search", "users", query] as const,
    posts: (query: string) => ["search", "posts", query] as const,
  },
  
  // Following / Followers
  follows: {
    followers: (userId: string) => ["follows", "followers", userId] as const,
    following: (userId: string) => ["follows", "following", userId] as const,
    isFollowing: (userId: string, targetId: string) =>
      ["follows", "isFollowing", userId, targetId] as const,
  },
};

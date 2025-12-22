/**
 * Thread Types - Bluesky Flat Style
 * 
 * Based on Bluesky's thread model:
 * - Full ancestor chain (root → parent → focused)
 * - FLAT replies list with "Replying to @user" labels
 * - No inline nesting - tap a reply to see its thread
 */

import type { PostWithAuthor } from './database';

/**
 * A reply in the flat thread list
 * Includes parent info for "Replying to @user" display
 */
export interface ThreadReply {
  /** The reply post */
  post: PostWithAuthor;
  /** Username being replied to (for "Replying to @user" label) */
  replyingTo?: string;
}

/**
 * Complete thread view structure - Bluesky Flat Style
 */
export interface ThreadView {
  /** The post being focused on */
  focusedPost: PostWithAuthor;
  
  /** 
   * Ancestor chain from root to parent
   * Order: [root, ..., grandparent, parent]
   * Empty if focused post is a root post
   */
  ancestors: PostWithAuthor[];
  
  /** 
   * FLAT list of all replies in the thread
   * Sorted by created_at, includes "Replying to" info
   */
  replies: ThreadReply[];
  
  /** Total number of replies in thread */
  totalReplies: number;
  
  /** Whether there are more replies to load */
  hasMoreReplies: boolean;
}

/**
 * Flattened item for FlashList rendering
 * UI flags match Bluesky's pattern for thread line visibility
 */
export type ThreadListItem = 
  | { type: 'ancestor'; post: PostWithAuthor; showParentLine: boolean; showChildLine: boolean }
  | { type: 'focused'; post: PostWithAuthor; showParentLine: boolean; showChildLine: boolean }
  | { type: 'reply'; reply: ThreadReply; showParentLine: boolean; showChildLine: boolean }
  | { type: 'reply-divider'; count: number }
  | { type: 'load-more'; count: number };

/**
 * Thread configuration constants
 */
export const THREAD_CONFIG = {
  /** Number of ancestors to show before "show more" */
  ANCESTOR_PREVIEW_COUNT: 5,
  /** Number of replies per page */
  REPLIES_PER_PAGE: 20,
} as const;

/**
 * Thread design tokens - Matches Bluesky's official layout
 * Reference: bluesky-social/social-app/src/screens/PostThread/const.ts
 */
export const THREAD_DESIGN = {
  /** Avatar size (Bluesky uses 42px in linear view) */
  AVATAR_SIZE: 42,
  /** Thread connector line width */
  LINE_WIDTH: 2,
  /** Outer space/padding */
  OUTER_SPACE: 16,
  /** Gap between avatar and content */
  AVATAR_GAP: 12,
  
  // Legacy compatibility - kept for backward compat with old components
  /** @deprecated Use OUTER_SPACE instead */
  HORIZONTAL_PADDING: 16,
  /** @deprecated Use AVATAR_SIZE + AVATAR_GAP instead */
  LEFT_COLUMN_WIDTH: 48,
  /** @deprecated Use AVATAR_SIZE for all post types */
  AVATAR_SIZES: {
    ancestor: 42,
    focused: 48,
    reply: 42,
  },
} as const;

/**
 * Flatten a ThreadView into a list of renderable items - Bluesky Style
 * Sets showParentLine/showChildLine flags for continuous thread connectors
 */
export function flattenThreadToList(thread: ThreadView): ThreadListItem[] {
  const items: ThreadListItem[] = [];
  const hasAncestors = thread.ancestors.length > 0;
  const hasReplies = thread.replies.length > 0;
  
  // 1. Add ancestors with thread lines
  thread.ancestors.forEach((post, index) => {
    const isLast = index === thread.ancestors.length - 1;
    items.push({
      type: 'ancestor',
      post,
      showParentLine: index > 0, // Line going up (not for first ancestor)
      showChildLine: true, // Always show line going down to next
    });
  });
  
  // 2. Add focused post
  items.push({
    type: 'focused',
    post: thread.focusedPost,
    showParentLine: hasAncestors, // Line going up to parent
    showChildLine: hasReplies, // Line going down to replies
  });
  
  // 3. Add reply divider if there are replies
  if (thread.replies.length > 0) {
    items.push({
      type: 'reply-divider',
      count: thread.totalReplies,
    });
  }
  
  // 4. Add all replies flat
  thread.replies.forEach((reply, index) => {
    const isLast = index === thread.replies.length - 1;
    items.push({
      type: 'reply',
      reply,
      showParentLine: true, // Always show line going up in reply section
      showChildLine: !isLast, // Show line down unless last reply
    });
  });
  
  // 5. Add load more if there are more replies
  if (thread.hasMoreReplies) {
    items.push({
      type: 'load-more',
      count: thread.totalReplies - thread.replies.length,
    });
  }
  
  return items;
}

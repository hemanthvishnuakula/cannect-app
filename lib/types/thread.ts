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
 */
export type ThreadListItem = 
  | { type: 'ancestor'; post: PostWithAuthor; isLast: boolean }
  | { type: 'focused'; post: PostWithAuthor }
  | { type: 'reply'; reply: ThreadReply }
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
 * Thread design tokens
 */
export const THREAD_DESIGN = {
  /** Avatar sizes by context */
  AVATAR_SIZES: {
    ancestor: 32,
    focused: 48,
    reply: 40,
  },
  /** Thread connector line width */
  LINE_WIDTH: 2,
} as const;

/**
 * Flatten a ThreadView into a list of renderable items - Bluesky Flat Style
 */
export function flattenThreadToList(thread: ThreadView): ThreadListItem[] {
  const items: ThreadListItem[] = [];
  
  // 1. Add ancestors
  thread.ancestors.forEach((post, index) => {
    items.push({
      type: 'ancestor',
      post,
      isLast: index === thread.ancestors.length - 1,
    });
  });
  
  // 2. Add focused post
  items.push({
    type: 'focused',
    post: thread.focusedPost,
  });
  
  // 3. Add reply divider if there are replies
  if (thread.replies.length > 0) {
    items.push({
      type: 'reply-divider',
      count: thread.totalReplies,
    });
  }
  
  // 4. Add all replies flat (no nesting)
  thread.replies.forEach(reply => {
    items.push({
      type: 'reply',
      reply,
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

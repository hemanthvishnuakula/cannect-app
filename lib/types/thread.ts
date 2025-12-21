/**
 * Thread Types for Post Ribbon Architecture
 * 
 * Based on Bluesky's thread model:
 * - Full ancestor chain (root → parent → focused)
 * - Inline nested replies (1-2 levels deep)
 * - Continuous thread lines
 */

import type { PostWithAuthor } from './database';

/**
 * A node in the thread tree
 */
export interface ThreadNode {
  /** The post at this node */
  post: PostWithAuthor;
  /** Direct reply children */
  children: ThreadNode[];
  /** Depth in the tree (0 = direct reply to focused) */
  depth: number;
  /** Whether there are more replies to load */
  hasMoreReplies: boolean;
  /** Total reply count for "show more" UI */
  replyCount: number;
}

/**
 * Complete thread view structure
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
   * Direct descendants with optional inline nesting
   * Each node can have children for inline display
   */
  descendants: ThreadNode[];
  
  /** Total number of replies to the focused post */
  totalReplies: number;
  
  /** Whether there are more ancestors than shown (very deep threads) */
  hasMoreAncestors: boolean;
}

/**
 * Flattened item for FlashList rendering
 */
export type ThreadListItem = 
  | { type: 'ancestor'; post: PostWithAuthor; isLast: boolean }
  | { type: 'focused'; post: PostWithAuthor }
  | { type: 'reply'; node: ThreadNode; depth: number }
  | { type: 'show-more'; parentId: string; count: number; depth: number }
  | { type: 'reply-divider'; count: number };

/**
 * Thread configuration constants
 */
export const THREAD_CONFIG = {
  /** Maximum levels of nested replies to show inline */
  MAX_INLINE_DEPTH: 2,
  /** Number of ancestors to show before "show more" */
  ANCESTOR_PREVIEW_COUNT: 5,
  /** Initial number of replies to load */
  INITIAL_REPLIES_COUNT: 10,
  /** Number of nested replies to show inline per level */
  INLINE_REPLIES_PER_LEVEL: 2,
} as const;

/**
 * Thread ribbon design tokens
 */
export const THREAD_RIBBON = {
  /** Avatar sizes by context */
  AVATAR_SIZES: {
    ancestor: 32,
    focused: 48,
    reply: 36,
    nested: 28,
  },
  /** Thread connector line width */
  LINE_WIDTH: 2,
  /** Indentation per nesting level */
  INDENT_PER_LEVEL: 44,
} as const;

/**
 * Flatten a ThreadView into a list of renderable items
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
  if (thread.descendants.length > 0) {
    items.push({
      type: 'reply-divider',
      count: thread.totalReplies,
    });
  }
  
  // 4. Add top-level descendants only
  // NOTE: Nested children are rendered INLINE by ThreadReply component,
  // so we don't add them to the flat list (that would cause duplicates)
  thread.descendants.forEach(node => {
    items.push({
      type: 'reply',
      node,
      depth: 0, // Always depth 0 in flat list; ThreadReply handles nesting
    });
  });
  
  return items;
}

/**
 * AT Protocol Chat/DM Hooks
 *
 * Uses Bluesky's chat.bsky.convo API via PDS proxy.
 * Messages are routed through cannect.space PDS to api.bsky.chat.
 */

import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from '@tanstack/react-query';
import * as atproto from '@/lib/atproto/agent';
import { useAuthStore } from '@/lib/stores/auth-store-atp';

// ============================================================
// TYPES
// ============================================================

export interface ChatMember {
  did: string;
  handle: string;
  displayName?: string;
  avatar?: string;
}

export interface ChatMessage {
  id: string;
  rev: string;
  text: string;
  facets?: any[]; // Rich text facets (mentions, links, hashtags)
  sender: { did: string };
  sentAt: string;
}

export interface Conversation {
  id: string;
  rev: string;
  members: ChatMember[];
  lastMessage?: ChatMessage;
  unreadCount: number;
  muted: boolean;
}

// ============================================================
// HOOKS
// ============================================================

/**
 * Get all conversations (DM list)
 */
export function useConversations() {
  const { isAuthenticated } = useAuthStore();

  return useInfiniteQuery({
    queryKey: ['conversations'],
    queryFn: async ({ pageParam }) => {
      const result = await atproto.listConversations(pageParam);
      return result;
    },
    getNextPageParam: (lastPage: any) => lastPage.cursor,
    initialPageParam: undefined as string | undefined,
    enabled: isAuthenticated,
    staleTime: 1000 * 10, // 10 seconds
    refetchInterval: 1000 * 30, // Poll every 30 seconds
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });
}

/**
 * Get a single conversation by ID
 */
export function useConversation(convoId: string | undefined) {
  const { isAuthenticated } = useAuthStore();

  return useQuery({
    queryKey: ['conversation', convoId],
    queryFn: async () => {
      if (!convoId) throw new Error('No conversation ID');
      const result = await atproto.getConversation(convoId);
      return result.convo as Conversation;
    },
    enabled: isAuthenticated && !!convoId,
    staleTime: 1000 * 10,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });
}

/**
 * Get messages for a specific conversation
 */
export function useMessages(convoId: string | undefined) {
  const { isAuthenticated } = useAuthStore();

  return useInfiniteQuery({
    queryKey: ['messages', convoId],
    queryFn: async ({ pageParam }) => {
      if (!convoId) throw new Error('No conversation ID');
      const result = await atproto.getMessages(convoId, pageParam);
      return result;
    },
    getNextPageParam: (lastPage: any) => lastPage.cursor,
    initialPageParam: undefined as string | undefined,
    enabled: isAuthenticated && !!convoId,
    staleTime: 1000 * 5, // 5 seconds
    refetchInterval: 1000 * 5, // Poll every 5 seconds when in chat
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });
}

/**
 * Get or create conversation with a user
 */
export function useStartConversation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (memberDid: string) => {
      const session = atproto.getSession();
      if (!session) throw new Error('Not authenticated');

      const result = await atproto.getConvoForMembers([session.did, memberDid]);

      if (!result?.convo?.id) {
        throw new Error('Failed to create conversation');
      }

      return result.convo as Conversation;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
    onError: (error) => {
      // Mutation will automatically reset isPending to false
      // This is here for explicitness and logging
      console.log('[useStartConversation] Mutation error handled, isPending reset');
    },
    retry: false, // Don't retry - user action, not network error
  });
}

/**
 * Send a message with optimistic updates
 * Message appears instantly, then confirms with server
 */
export function useSendMessage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ convoId, text }: { convoId: string; text: string }) => {
      const result = await atproto.sendMessage(convoId, text);
      return result as ChatMessage;
    },
    onMutate: async ({ convoId, text }) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['messages', convoId] });

      // Snapshot the previous value
      const previousMessages = queryClient.getQueryData(['messages', convoId]);

      // Get current user's DID for the optimistic message
      const session = atproto.getSession();

      // Create optimistic message
      const optimisticMessage: ChatMessage = {
        id: `optimistic-${Date.now()}`,
        rev: '',
        text,
        sender: { did: session?.did || '' },
        sentAt: new Date().toISOString(),
      };

      // Optimistically update the cache
      queryClient.setQueryData(['messages', convoId], (old: any) => {
        if (!old?.pages) return old;

        // Add to first page (messages are reversed for display, so first page = newest)
        const newPages = [...old.pages];
        if (newPages[0]) {
          newPages[0] = {
            ...newPages[0],
            messages: [optimisticMessage, ...(newPages[0].messages || [])],
          };
        }
        return { ...old, pages: newPages };
      });

      return { previousMessages };
    },
    onError: (err, variables, context) => {
      // Rollback to previous state on error
      if (context?.previousMessages) {
        queryClient.setQueryData(['messages', variables.convoId], context.previousMessages);
      }
      console.error('[useSendMessage] Failed:', err);
    },
    onSettled: (_, __, variables) => {
      // Refetch to ensure we have the real message from server
      queryClient.invalidateQueries({ queryKey: ['messages', variables.convoId] });
      // Also refresh conversation list (for last message preview)
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
  });
}

/**
 * Mark conversation as read
 */
export function useMarkConvoRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (convoId: string) => {
      await atproto.updateConvoRead(convoId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
  });
}

/**
 * Leave/delete a conversation
 */
export function useLeaveConversation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (convoId: string) => {
      await atproto.leaveConversation(convoId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
  });
}

/**
 * Delete a message (for self only)
 */
export function useDeleteMessage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ convoId, messageId }: { convoId: string; messageId: string }) => {
      await atproto.deleteMessageForSelf(convoId, messageId);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['messages', variables.convoId] });
    },
  });
}

/**
 * Get total unread message count
 */
export function useUnreadMessageCount() {
  const { data } = useConversations();

  const unreadCount =
    data?.pages
      ?.flatMap((page: any) => page.convos || [])
      .reduce((sum: number, convo: any) => sum + (convo.unreadCount || 0), 0) || 0;

  return { data: unreadCount };
}

/**
 * Check if current user can message another user
 * Returns { canChat: boolean } - use to show/hide message button
 */
export function useCanMessage(memberDid: string | undefined) {
  const { isAuthenticated } = useAuthStore();

  return useQuery({
    queryKey: ['canMessage', memberDid],
    queryFn: async (): Promise<{ canChat: boolean }> => {
      if (!memberDid) return { canChat: false };
      try {
        const result = await atproto.getConvoAvailability(memberDid);
        console.log('[useCanMessage] Result for', memberDid.slice(-8), ':', result?.canChat);
        // Ensure we always return a simple boolean
        return { canChat: result?.canChat === true };
      } catch (error: any) {
        console.warn(
          '[useCanMessage] Error for',
          memberDid.slice(-8),
          ':',
          error?.message || error
        );
        // On error, return canChat: true to show button (let the actual message attempt handle errors)
        return { canChat: true };
      }
    },
    enabled: isAuthenticated && !!memberDid,
    staleTime: 1000 * 60 * 5, // Cache for 5 minutes
    retry: false, // Don't retry - if it fails, just show button
  });
}

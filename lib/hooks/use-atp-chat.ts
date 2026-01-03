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
    staleTime: 1000 * 30, // 30 seconds
    refetchInterval: 1000 * 60, // Refetch every minute
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
    staleTime: 1000 * 30,
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
    staleTime: 1000 * 10, // 10 seconds
    refetchInterval: 1000 * 15, // Poll every 15 seconds when viewing
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
      return result.convo as Conversation;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
  });
}

/**
 * Send a message
 */
export function useSendMessage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ convoId, text }: { convoId: string; text: string }) => {
      const result = await atproto.sendMessage(convoId, text);
      return result as ChatMessage;
    },
    onSuccess: (_, variables) => {
      // Refetch messages for this conversation
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
 * Get total unread message count
 */
export function useUnreadMessageCount() {
  const { data } = useConversations();

  const unreadCount =
    data?.pages?.flatMap((page: any) => page.convos || []).reduce((sum: number, convo: any) => sum + (convo.unreadCount || 0), 0) || 0;

  return unreadCount;
}

/**
 * Hooks Index - Pure AT Protocol
 *
 * All hooks now use AT Protocol directly - no Supabase.
 */

// Auth
export {
  useAuth,
  useLogin,
  useLogin as useSignIn,
  useLogout,
  useCreateAccount,
  useCurrentDid,
  useIsAuthenticated,
} from './use-atp-auth';

// Feed & Posts
export {
  useTimeline,
  useTimeline as useFeed,
  useCannectFeed,
  useAuthorFeed,
  useActorLikes,
  usePostThread,
  useCreatePost,
  useDeletePost,
  useLikePost,
  useUnlikePost,
  useRepost,
  useDeleteRepost,
  useToggleLike,
  useToggleRepost,
  useSearchPosts,
  useSuggestedPosts,
  type FeedViewPost,
  type PostView,
  type ThreadViewPost,
} from './use-atp-feed';

// Profile
export {
  useProfile,
  useMyProfile,
  useMyProfile as useCurrentProfile,
  useUpdateProfile,
  useFollowers,
  useFollowing,
  useFollow,
  useUnfollow,
  useToggleFollow,
  useSearchUsers,
  useSuggestedUsers,
  type ProfileView,
  type ProfileViewDetailed,
} from './use-atp-profile';

// Notifications
export {
  useNotifications,
  useUnreadNotificationCount,
  useMarkNotificationsRead,
  type Notification,
} from './use-atp-notifications';

// Utility hooks (no Supabase dependency)
export { useDebounce } from './use-debounce';
export { useNetworkStatus } from './use-network-status';

// Optimistic Updates utilities
export {
  createOptimisticContext,
  postUpdaters,
  cancelFeedQueries,
  snapshotFeedState,
  restoreFeedState,
  updatePostInFeeds,
  removePostFromFeeds,
  invalidateFeeds,
  FEED_KEYS,
} from './optimistic-updates';

// PWA Diamond Standard APIs
export { usePWA } from './use-pwa';
export { useWebPush } from './use-web-push';

// Chat / Direct Messages
export {
  useConversations,
  useConversation,
  useMessages,
  useStartConversation,
  useSendMessage,
  useMarkConvoRead,
  useUnreadMessageCount,
  type ChatMember,
  type ChatMessage,
  type Conversation,
} from './use-atp-chat';

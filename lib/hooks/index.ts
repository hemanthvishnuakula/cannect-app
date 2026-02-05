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
  checkEmailExistsOnLegacyPds,
  checkUsernameExistsOnLegacyPds,
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
  useBoostedPosts,
  useTrendingTopics,
  useSearchTypeahead,
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
  usePinnedPost,
  useIsPinnedPost,
  usePinPost,
  useUnpinPost,
  useIsPostBoosted,
  useBoostPost,
  useUnboostPost,
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

// View Tracking
export {
  useTrackPostView,
  useViewTracking,
  useFlushViewsOnUnmount,
  usePostViewCount,
  useTrendingPosts,
  useEstimatedViewCount,
  useProfileReach,
  formatViewCount,
  calculateEstimatedViews,
} from './use-view-tracking';

// Chat / Direct Messages
export {
  useConversations,
  useConversation,
  useMessages,
  useStartConversation,
  useSendMessage,
  useMarkConvoRead,
  useLeaveConversation,
  useDeleteMessage,
  useUnreadMessageCount,
  useCanMessage,
  type ChatMember,
  type ChatMessage,
  type Conversation,
} from './use-atp-chat';

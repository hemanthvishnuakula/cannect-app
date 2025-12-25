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
  useTimeline as useFollowingFeed,
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

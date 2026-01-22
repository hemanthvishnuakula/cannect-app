/**
 * ProfileView - Unified profile layout component
 *
 * Used by both:
 * - app/(tabs)/profile.tsx (own profile)
 * - app/user/[handle].tsx (other users)
 *
 * Conditional elements:
 * - Own profile: Edit Profile + Logout buttons, Likes tab always visible
 * - Other users: Follow/Unfollow button, Likes tab hidden (API limitation)
 */

import { View, Text, Pressable, ActivityIndicator, RefreshControl } from 'react-native';
import { Image } from 'expo-image';
import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { LogOut, Edit3, MessageCircle } from 'lucide-react-native';
import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useAuthorFeed, useActorLikes, useStartConversation } from '@/lib/hooks';
import { PostCard } from '@/components/Post';
import { FollowButton, useToast } from '@/components/ui';
import { getOptimizedAvatarUrl } from '@/lib/utils/avatar';
import { triggerImpact } from '@/lib/utils/haptics';
import type { AppBskyActorDefs } from '@atproto/api';

type ProfileViewDetailed = AppBskyActorDefs.ProfileViewDetailed;
type ProfileTab = 'posts' | 'reposts' | 'replies' | 'likes';

function formatNumber(num: number | undefined): string {
  if (!num) return '0';
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toString();
}

interface ProfileViewProps {
  /** The profile data to display */
  profileData: ProfileViewDetailed;
  /** Whether this is the current user's own profile */
  isOwnProfile: boolean;
  /** Current user's DID (for checking post ownership) */
  currentUserDid?: string;
  /** Whether the profile data is being refreshed */
  isRefreshing?: boolean;
  /** Called when user pulls to refresh */
  onRefresh?: () => void;
  /** Called when Edit Profile is pressed (own profile only) */
  onEditProfile?: () => void;
  /** Called when Logout is pressed (own profile only) */
  onLogout?: () => void;
  /** Increment to trigger scroll to top */
  scrollToTopTrigger?: number;
}

export function ProfileView({
  profileData,
  isOwnProfile,
  currentUserDid: _currentUserDid,
  isRefreshing = false,
  onRefresh,
  onEditProfile,
  onLogout,
  scrollToTopTrigger,
}: ProfileViewProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<ProfileTab>('posts');
  const listRef = useRef<FlashList<any>>(null);

  // Scroll to top when trigger changes
  useEffect(() => {
    if (scrollToTopTrigger && scrollToTopTrigger > 0) {
      listRef.current?.scrollToOffset({ offset: 0, animated: true });
    }
  }, [scrollToTopTrigger]);

  // Different feeds based on active tab
  const postsQuery = useAuthorFeed(profileData.did, 'posts_no_replies');
  const repliesQuery = useAuthorFeed(profileData.did, 'posts_with_replies');
  // Likes only available for own profile (Bluesky API limitation)
  const likesQuery = useActorLikes(isOwnProfile ? profileData.did : undefined);

  // Get posts data based on active tab
  const posts = useMemo(() => {
    if (activeTab === 'posts') {
      return postsQuery.data?.pages?.flatMap((page) => page.feed) || [];
    } else if (activeTab === 'reposts') {
      const allPosts = postsQuery.data?.pages?.flatMap((page) => page.feed) || [];
      return allPosts.filter((item) => item.reason?.$type === 'app.bsky.feed.defs#reasonRepost');
    } else if (activeTab === 'replies') {
      const allPosts = repliesQuery.data?.pages?.flatMap((page) => page.feed) || [];
      return allPosts.filter((item) => {
        const record = item.post.record as any;
        return record?.reply;
      });
    } else if (activeTab === 'likes') {
      return likesQuery.data?.pages?.flatMap((page) => page.feed) || [];
    }
    return [];
  }, [activeTab, postsQuery.data, repliesQuery.data, likesQuery.data]);

  const currentQuery =
    activeTab === 'likes' ? likesQuery : activeTab === 'replies' ? repliesQuery : postsQuery;

  const handleRefresh = useCallback(() => {
    triggerImpact('light');
    onRefresh?.();
    currentQuery.refetch();
  }, [onRefresh, currentQuery]);

  // Tabs: Likes only visible for own profile
  const tabs: { key: ProfileTab; label: string }[] = [
    { key: 'posts', label: 'Posts' },
    { key: 'reposts', label: 'Reposts' },
    { key: 'replies', label: 'Replies' },
    ...(isOwnProfile ? [{ key: 'likes' as ProfileTab, label: 'Likes' }] : []),
  ];

  return (
    <>
      <FlashList
        ref={listRef}
        data={posts}
        keyExtractor={(item, index) => `${item.post.uri}-${index}`}
        estimatedItemSize={350}
        overrideItemLayout={(layout) => {
          layout.size = 280;
        }}
        ListHeaderComponent={
          <View>
            {/* Banner */}
            {profileData.banner ? (
              <Image
                source={{ uri: profileData.banner }}
                className="w-full h-32"
                contentFit="cover"
                cachePolicy="memory-disk"
                recyclingKey={profileData.banner}
                transition={200}
              />
            ) : (
              <View className="w-full h-32 bg-primary/20" />
            )}

            {/* Profile Info */}
            <View className="px-4 -mt-12">
              {/* Avatar */}
              {profileData.avatar ? (
                <Image
                  source={{ uri: getOptimizedAvatarUrl(profileData.avatar, 96) }}
                  className="w-24 h-24 rounded-full border-4 border-background"
                  contentFit="cover"
                  cachePolicy="memory-disk"
                  recyclingKey={profileData.avatar}
                  transition={200}
                />
              ) : (
                <View className="w-24 h-24 rounded-full border-4 border-background bg-surface-elevated items-center justify-center">
                  <Text className="text-text-muted text-3xl">
                    {(profileData.handle || '?')[0].toUpperCase()}
                  </Text>
                </View>
              )}

              {/* Actions - conditional based on own profile */}
              <View className="absolute right-4 top-14 flex-row gap-2">
                {isOwnProfile ? (
                  <>
                    <Pressable
                      onPress={onEditProfile}
                      className="bg-surface-elevated border border-border px-4 py-2 rounded-full flex-row items-center active:opacity-70"
                    >
                      <Edit3 size={16} color="#FAFAFA" />
                      <Text className="text-text-primary font-semibold ml-2">Edit Profile</Text>
                    </Pressable>
                    <Pressable
                      onPress={onLogout}
                      className="bg-surface-elevated border border-border p-2 rounded-full items-center justify-center active:opacity-70"
                    >
                      <LogOut size={18} color="#EF4444" />
                    </Pressable>
                  </>
                ) : (
                  <View className="flex-row gap-2">
                    <MessageButton did={profileData.did} />
                    <FollowButton profile={profileData} size="large" />
                  </View>
                )}
              </View>

              {/* Name & Handle */}
              <Text className="text-xl font-bold text-text-primary mt-3">
                {profileData.displayName || profileData.handle}
              </Text>
              <Text className="text-text-muted">@{profileData.handle}</Text>

              {/* Bio */}
              {profileData.description && (
                <Text className="text-text-primary mt-2">{profileData.description}</Text>
              )}

              {/* Stats */}
              <View className="flex-row gap-4 mt-3">
                <Pressable
                  className="flex-row items-center active:opacity-70"
                  onPress={() => router.push(`/user/${profileData.handle}/followers` as any)}
                >
                  <Text className="font-bold text-text-primary">
                    {formatNumber(profileData.followersCount)}
                  </Text>
                  <Text className="text-text-muted ml-1">followers</Text>
                </Pressable>
                <Pressable
                  className="flex-row items-center active:opacity-70"
                  onPress={() => router.push(`/user/${profileData.handle}/following` as any)}
                >
                  <Text className="font-bold text-text-primary">
                    {formatNumber(profileData.followsCount)}
                  </Text>
                  <Text className="text-text-muted ml-1">following</Text>
                </Pressable>
                <View className="flex-row items-center">
                  <Text className="font-bold text-text-primary">
                    {formatNumber(profileData.postsCount)}
                  </Text>
                  <Text className="text-text-muted ml-1">posts</Text>
                </View>
              </View>
            </View>

            {/* Tabs */}
            <View className="flex-row border-b border-border mt-4">
              {tabs.map((tab) => (
                <Pressable
                  key={tab.key}
                  onPress={() => setActiveTab(tab.key)}
                  className={`flex-1 py-3 items-center ${activeTab === tab.key ? 'border-b-2 border-primary' : ''}`}
                >
                  <Text
                    className={
                      activeTab === tab.key ? 'text-primary font-semibold' : 'text-text-muted'
                    }
                  >
                    {tab.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        }
        renderItem={({ item }) => <PostCard item={item} hideFollowButton />}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing || currentQuery.isRefetching}
            onRefresh={handleRefresh}
            tintColor="#10B981"
          />
        }
        onEndReached={() => {
          if (currentQuery.hasNextPage && !currentQuery.isFetchingNextPage) {
            currentQuery.fetchNextPage();
          }
        }}
        onEndReachedThreshold={0.5}
        contentContainerStyle={{ paddingBottom: 20 }}
        ListEmptyComponent={
          currentQuery.isLoading ? (
            <View className="py-10 items-center">
              <ActivityIndicator color="#10B981" />
            </View>
          ) : (
            <View className="py-20 items-center">
              <Text className="text-text-muted">
                {activeTab === 'posts' && 'No posts yet'}
                {activeTab === 'reposts' && 'No reposts yet'}
                {activeTab === 'replies' && 'No replies yet'}
                {activeTab === 'likes' && 'No likes yet'}
              </Text>
            </View>
          )
        }
        ListFooterComponent={
          currentQuery.isFetchingNextPage ? (
            <View className="py-4 items-center">
              <ActivityIndicator size="small" color="#10B981" />
            </View>
          ) : null
        }
      />
    </>
  );
}

// ============================================================
// MESSAGE BUTTON
// ============================================================

/**
 * MessageButton - Opens a DM conversation with the user
 *
 * Note: We intentionally don't pre-check if the user allows DMs.
 * The getConvoAvailability API caused React rendering issues.
 * Instead, we show the button and display a helpful error if DMs are restricted.
 */
function MessageButton({ did }: { did: string }) {
  const router = useRouter();
  const { showError } = useToast();
  const { mutate: startConversation, isPending, reset } = useStartConversation();

  const handlePress = useCallback(() => {
    triggerImpact('light');

    startConversation(did, {
      onSuccess: (convo) => {
        router.push(`/messages/${convo.id}` as any);
      },
      onError: (error: any) => {
        console.error('[Chat] Failed to start conversation:', error);
        // Explicitly reset mutation state
        reset();
        const msg = error?.message || '';
        if (msg.includes('someone they follow')) {
          showError('This user only accepts messages from people they follow.');
        } else {
          showError('Could not start conversation. Please try again.');
        }
      },
    });
  }, [did, startConversation, router, showError, reset]);

  return (
    <Pressable
      onPress={handlePress}
      disabled={isPending}
      className="bg-surface-elevated border border-border p-2.5 rounded-full items-center justify-center active:opacity-70"
    >
      {isPending ? (
        <ActivityIndicator size="small" color="#10B981" />
      ) : (
        <MessageCircle size={20} color="#FAFAFA" />
      )}
    </Pressable>
  );
}

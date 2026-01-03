/**
 * Following List Screen - Pure AT Protocol
 *
 * Route: /user/[handle]/following
 */

import { View, Text, Pressable, RefreshControl, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FlashList } from '@shopify/flash-list';
import { useLocalSearchParams, Stack, useRouter } from 'expo-router';
import { useMemo, useCallback } from 'react';
import { useProfile, useFollowing } from '@/lib/hooks';
import { useAuthStore } from '@/lib/stores';
import { UserRow } from '@/components/Profile';
import { UserListSkeleton } from '@/components/skeletons';
import { BackButton } from '@/components/ui';
import type { AppBskyActorDefs } from '@atproto/api';

type ProfileView = AppBskyActorDefs.ProfileView;

function formatNumber(num: number | undefined): string {
  if (!num) return '0';
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toString();
}

export default function FollowingScreen() {
  const { handle } = useLocalSearchParams<{ handle: string }>();
  const router = useRouter();
  const { did: currentUserDid } = useAuthStore();

  const profileQuery = useProfile(handle || '');
  const followingQuery = useFollowing(profileQuery.data?.did);

  const following = useMemo(() => {
    return followingQuery.data?.pages?.flatMap((page) => page.follows) || [];
  }, [followingQuery.data]);

  const handleUserPress = (user: ProfileView) => {
    router.push(`/user/${user.handle}`);
  };

  const handleRefresh = useCallback(() => {
    followingQuery.refetch();
  }, [followingQuery]);

  const followingCount = profileQuery.data?.followsCount || 0;

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTitle: 'Following',
          headerStyle: { backgroundColor: '#0A0A0A' },
          headerTintColor: '#FAFAFA',
          headerLeft: () => <BackButton fallbackRoute={`/user/${handle}`} />,
        }}
      />

      {/* Header with count */}
      <View className="px-4 py-3 border-b border-border">
        <Text className="text-text-primary font-semibold text-lg">
          {formatNumber(followingCount)} Following
        </Text>
        <Text className="text-text-muted">@{handle}</Text>
      </View>

      {(profileQuery.isLoading || followingQuery.isLoading) && following.length === 0 ? (
        <UserListSkeleton count={10} />
      ) : (
        <FlashList
          data={following}
          keyExtractor={(item, index) => `${item.did}-${index}`}
          estimatedItemSize={80}
          overrideItemLayout={(layout) => {
            layout.size = 80;
          }}
          renderItem={({ item }) => (
            <UserRow
              user={item}
              onPress={() => handleUserPress(item)}
              showFollowButton={item.did !== currentUserDid}
              showBio
            />
          )}
          refreshControl={
            <RefreshControl
              refreshing={followingQuery.isRefetching}
              onRefresh={handleRefresh}
              tintColor="#10B981"
            />
          }
          onEndReached={() => {
            if (followingQuery.hasNextPage && !followingQuery.isFetchingNextPage) {
              followingQuery.fetchNextPage();
            }
          }}
          onEndReachedThreshold={0.5}
          contentContainerStyle={{ paddingBottom: 20 }}
          ListEmptyComponent={
            <View className="py-20 items-center">
              <Text className="text-text-muted">Not following anyone</Text>
            </View>
          }
          ListFooterComponent={
            followingQuery.isFetchingNextPage ? (
              <View className="py-4 items-center">
                <ActivityIndicator size="small" color="#10B981" />
              </View>
            ) : null
          }
        />
      )}
    </SafeAreaView>
  );
}

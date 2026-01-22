/**
 * Notifications Screen - Pure AT Protocol
 */

import { View, Text, FlatList, Pressable, RefreshControl, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  Bell,
  Heart,
  Repeat2,
  UserPlus,
  MessageCircle,
  AtSign,
  RefreshCw,
} from 'lucide-react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { getOptimizedAvatarWithFallback } from '@/lib/utils/avatar';
import { useCallback, useRef, useEffect } from 'react';
import { useNotifications, useMarkNotificationsRead } from '@/lib/hooks';
import { triggerImpact } from '@/lib/utils/haptics';
import { scrollToTop } from '@/lib/utils/scroll-to-top';
import type { AppBskyNotificationListNotifications } from '@atproto/api';

type Notification = AppBskyNotificationListNotifications.Notification;

function formatTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 1) return 'now';
  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays < 7) return `${diffDays}d`;
  return date.toLocaleDateString();
}

function NotificationIcon({ reason }: { reason: string }) {
  switch (reason) {
    case 'like':
      return <Heart size={16} color="#EF4444" fill="#EF4444" />;
    case 'repost':
      return <Repeat2 size={16} color="#10B981" />;
    case 'follow':
      return <UserPlus size={16} color="#3B82F6" />;
    case 'reply':
      return <MessageCircle size={16} color="#8B5CF6" />;
    case 'mention':
      return <AtSign size={16} color="#F59E0B" />;
    case 'quote':
      return <MessageCircle size={16} color="#EC4899" />;
    default:
      return <Bell size={16} color="#6B7280" />;
  }
}

function getNotificationText(reason: string): string {
  switch (reason) {
    case 'like':
      return 'liked your post';
    case 'repost':
      return 'reposted your post';
    case 'follow':
      return 'followed you';
    case 'reply':
      return 'replied to your post';
    case 'mention':
      return 'mentioned you';
    case 'quote':
      return 'quoted your post';
    default:
      return 'interacted with you';
  }
}

function NotificationItem({ notification }: { notification: Notification }) {
  const router = useRouter();
  const author = notification.author;
  const isUnread = !notification.isRead;

  const handlePress = () => {
    if (notification.reason === 'follow') {
      router.push(`/user/${author.handle}`);
    } else if (notification.reasonSubject) {
      // Navigate to the post
      const uriParts = notification.reasonSubject.split('/');
      const rkey = uriParts[uriParts.length - 1];
      const authorDid = uriParts[2];
      router.push(`/post/${authorDid}/${rkey}`);
    }
  };

  return (
    <Pressable
      onPress={handlePress}
      className={`flex-row px-4 py-3 border-b border-border ${isUnread ? 'bg-primary/5' : ''}`}
    >
      {/* Icon */}
      <View className="w-8 items-center pt-1">
        <NotificationIcon reason={notification.reason} />
      </View>

      {/* Content */}
      <View className="flex-1 ml-2">
        <View className="flex-row items-center">
          <Image
            source={{
              uri: getOptimizedAvatarWithFallback(
                author.avatar,
                author.displayName || author.handle,
                32
              ),
            }}
            className="w-8 h-8 rounded-full"
          />
          <View className="ml-2 flex-1">
            <Text className="text-text-primary">
              <Text className="font-semibold">{author.displayName || author.handle}</Text>{' '}
              {getNotificationText(notification.reason)}
            </Text>
            <Text className="text-text-muted text-sm">{formatTime(notification.indexedAt)}</Text>
          </View>
        </View>
      </View>
    </Pressable>
  );
}

export default function NotificationsScreen() {
  const notificationsQuery = useNotifications();
  const markAsRead = useMarkNotificationsRead();
  const listRef = useRef<FlatList>(null);

  const notifications = notificationsQuery.data?.pages?.flatMap((page) => page.notifications) || [];

  // Scroll to top when tab is pressed while already on this screen
  useEffect(() => {
    return scrollToTop.subscribe('notifications', () => {
      listRef.current?.scrollToOffset({ offset: 0, animated: true });
    });
  }, []);

  // Mark all as read when screen is focused (after 2 second delay)
  useFocusEffect(
    useCallback(() => {
      const timer = setTimeout(() => {
        if (notifications.length > 0) {
          markAsRead.mutate();
        }
      }, 2000);

      return () => clearTimeout(timer);
    }, [notifications.length])
  );

  const handleRefresh = () => {
    triggerImpact('light');
    notificationsQuery.refetch();
  };

  if (notificationsQuery.isError) {
    return (
      <SafeAreaView className="flex-1 bg-background" edges={['top']}>
        <View className="px-5 py-4 border-b border-border">
          <Text className="text-3xl font-bold text-text-primary">Notifications</Text>
        </View>
        <View className="flex-1 items-center justify-center px-6">
          <RefreshCw size={48} color="#6B7280" />
          <Text className="text-text-primary text-lg font-semibold mt-4">Failed to load</Text>
          <Pressable onPress={handleRefresh} className="bg-primary px-6 py-3 rounded-full mt-4">
            <Text className="text-white font-semibold">Retry</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      <View className="px-5 py-4 border-b border-border">
        <Text className="text-3xl font-bold text-text-primary">Notifications</Text>
      </View>
      <FlatList
        ref={listRef}
        data={notifications}
        keyExtractor={(item, index) => `${item.uri}-${index}`}
        renderItem={({ item }) => <NotificationItem notification={item} />}
        refreshControl={
          <RefreshControl
            refreshing={notificationsQuery.isRefetching}
            onRefresh={handleRefresh}
            tintColor="#10B981"
          />
        }
        onEndReached={() => {
          if (notificationsQuery.hasNextPage && !notificationsQuery.isFetchingNextPage) {
            notificationsQuery.fetchNextPage();
          }
        }}
        onEndReachedThreshold={0.5}
        contentContainerStyle={{ paddingBottom: 20 }}
        ListEmptyComponent={
          notificationsQuery.isLoading ? (
            <View className="flex-1 items-center justify-center pt-24">
              <ActivityIndicator size="large" color="#10B981" />
            </View>
          ) : (
            <View className="flex-1 items-center justify-center pt-24 px-10">
              <View className="bg-gray-100 dark:bg-zinc-900 p-6 rounded-full mb-6">
                <Bell size={40} color="#10B981" />
              </View>
              <Text className="text-text-primary text-xl font-bold text-center mb-2">
                No notifications yet
              </Text>
              <Text className="text-text-muted text-center text-base">
                When someone interacts with your posts, you'll see it here.
              </Text>
            </View>
          )
        }
        ListFooterComponent={
          notificationsQuery.isFetchingNextPage ? (
            <View className="py-4 items-center">
              <ActivityIndicator size="small" color="#10B981" />
            </View>
          ) : null
        }
      />
    </SafeAreaView>
  );
}

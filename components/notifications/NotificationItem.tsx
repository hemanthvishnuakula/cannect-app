import React, { memo } from 'react';
import { View, Text, Pressable } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Heart, Repeat2, MessageCircle, Quote, UserPlus } from 'lucide-react-native';
import { formatDistanceToNow } from '@/lib/utils/date';

// Bluesky butterfly logo component
const BlueskyLogo = ({ size = 12 }: { size?: number }) => (
  <View style={{ width: size, height: size, justifyContent: 'center', alignItems: 'center' }}>
    <Text style={{ fontSize: size - 2, color: '#0085FF' }}>🦋</Text>
  </View>
);

interface NotificationItemProps {
  notification: {
    id: string;
    reason: string;
    is_external?: boolean;
    is_read?: boolean;
    created_at: string;
    post_id?: string;
    // Post details (for navigation)
    post?: {
      id: string;
      at_uri?: string;
    };
    // Internal actor
    actor?: {
      id: string;
      username: string;
      display_name?: string;
      avatar_url?: string;
    };
    // External actor (Bluesky)
    actor_did?: string;
    actor_handle?: string;
    actor_display_name?: string;
    actor_avatar?: string;
  };
}

export const NotificationItem = memo(function NotificationItem({
  notification,
}: NotificationItemProps) {
  const router = useRouter();
  const isExternal = notification.is_external;
  const isUnread = !notification.is_read;

  // Get actor info - prefer display name, but use handle if they're the same
  const rawDisplayName = isExternal
    ? notification.actor_display_name
    : notification.actor?.display_name;

  const actorHandle = isExternal ? notification.actor_handle : notification.actor?.username;

  // Only show display name if it's different from the handle
  const displayNameIsDifferent =
    rawDisplayName && rawDisplayName !== actorHandle && rawDisplayName !== `@${actorHandle}`;

  const actorName = displayNameIsDifferent
    ? rawDisplayName
    : (isExternal ? actorHandle?.split('.')[0] : actorHandle) || 'User';

  const actorAvatar = isExternal ? notification.actor_avatar : notification.actor?.avatar_url;

  const fallbackAvatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(actorName || 'U')}&background=3B82F6&color=fff`;

  // Get icon and text based on reason
  const getNotificationDetails = () => {
    switch (notification.reason) {
      case 'like':
        return {
          icon: <Heart size={16} color="#EF4444" fill="#EF4444" />,
          text: 'liked your post',
          color: '#EF4444',
        };
      case 'repost':
        return {
          icon: <Repeat2 size={16} color="#10B981" />,
          text: 'reposted your post',
          color: '#10B981',
        };
      case 'reply':
        return {
          icon: <MessageCircle size={16} color="#3B82F6" />,
          text: 'replied to your post',
          color: '#3B82F6',
        };
      case 'quote':
        return {
          icon: <Quote size={16} color="#8B5CF6" />,
          text: 'quoted your post',
          color: '#8B5CF6',
        };
      case 'follow':
        return {
          icon: <UserPlus size={16} color="#10B981" />,
          text: 'followed you',
          color: '#10B981',
        };
      case 'mention':
        return {
          icon: <MessageCircle size={16} color="#F59E0B" />,
          text: 'mentioned you',
          color: '#F59E0B',
        };
      default:
        return {
          icon: <Heart size={16} color="#6B7280" />,
          text: 'interacted with you',
          color: '#6B7280',
        };
    }
  };

  const { icon, text } = getNotificationDetails();

  const handlePress = () => {
    // If we have an AT URI, extract did/rkey and navigate to thread view
    if (notification.post?.at_uri) {
      // AT URI format: at://did/app.bsky.feed.post/rkey
      const parts = notification.post.at_uri.split('/');
      const rkey = parts[parts.length - 1];
      const did = parts[2]; // did is the 3rd segment
      if (did && rkey) {
        router.push(`/post/${did}/${rkey}`);
        return;
      }
    }

    // Fallback: navigate to user profile
    const identifier =
      notification.actor_handle || notification.actor?.username || notification.actor?.id;
    if (identifier) router.push(`/user/${identifier}` as any);
  };

  const handleAvatarPress = () => {
    // Use best available identifier
    const identifier =
      notification.actor_handle || notification.actor?.username || notification.actor?.id;
    if (identifier) router.push(`/user/${identifier}` as any);
  };

  return (
    <Pressable
      onPress={handlePress}
      className={`flex-row items-start p-4 border-b border-border active:bg-surface-elevated ${
        isUnread ? 'bg-primary/5' : ''
      }`}
    >
      {/* Icon */}
      <View className="w-8 items-end mr-3 mt-1">{icon}</View>

      {/* Avatar with Bluesky indicator */}
      <Pressable onPress={handleAvatarPress} className="mr-3 relative">
        <Image
          source={{ uri: actorAvatar || fallbackAvatar }}
          style={{ width: 44, height: 44, borderRadius: 22 }}
          contentFit="cover"
          cachePolicy="memory-disk"
          recyclingKey={actorAvatar || notification.actor?.id}
          transition={50}
          priority="high"
        />
        {isExternal && (
          <View className="absolute -bottom-0.5 -right-0.5 bg-white dark:bg-gray-900 rounded-full p-0.5">
            <BlueskyLogo size={14} />
          </View>
        )}
      </Pressable>

      {/* Content */}
      <View className="flex-1">
        {/* Main notification line */}
        <Text className="text-text-primary leading-5">
          <Text className="font-bold">{actorName}</Text>
          {displayNameIsDifferent && actorHandle && (
            <Text className="text-text-muted"> @{actorHandle}</Text>
          )}
          <Text className="text-text-muted"> {text}</Text>
        </Text>

        {/* Timestamp and source */}
        <View className="flex-row items-center mt-1 gap-2">
          <Text className="text-text-muted text-xs">
            {formatDistanceToNow(new Date(notification.created_at))}
          </Text>
          {isExternal && <Text className="text-blue-500 text-xs">via Bluesky</Text>}
        </View>
      </View>

      {/* Unread indicator */}
      {isUnread && <View className="w-2 h-2 rounded-full bg-primary mt-2" />}
    </Pressable>
  );
});

export default NotificationItem;

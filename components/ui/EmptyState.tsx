/**
 * EmptyState - Branded empty state with icon and action
 *
 * Use when a list/feed has no items to display.
 * Shows a helpful message and optional call-to-action.
 */

import { View, Text, Pressable } from 'react-native';
import { Inbox, Users, Search, FileText, MessageCircle, Heart } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';

type EmptyStateVariant = 'feed' | 'following' | 'search' | 'posts' | 'messages' | 'notifications';

interface EmptyStateProps {
  /** Predefined variant with icon and message */
  variant?: EmptyStateVariant;
  /** Custom icon (overrides variant) */
  icon?: LucideIcon;
  /** Custom title */
  title?: string;
  /** Custom message */
  message?: string;
  /** Action button label */
  actionLabel?: string;
  /** Action callback */
  onAction?: () => void;
}

const variants: Record<EmptyStateVariant, { icon: LucideIcon; title: string; message: string }> = {
  feed: {
    icon: Inbox,
    title: 'No posts yet',
    message: 'The cannabis feed is building up.\nCheck back soon!',
  },
  following: {
    icon: Users,
    title: 'Your timeline is empty',
    message: 'Follow some people to see their posts here.',
  },
  search: {
    icon: Search,
    title: 'No results found',
    message: 'Try a different search term.',
  },
  posts: {
    icon: FileText,
    title: 'No posts yet',
    message: "This user hasn't posted anything yet.",
  },
  messages: {
    icon: MessageCircle,
    title: 'No messages',
    message: 'Start a conversation with someone!',
  },
  notifications: {
    icon: Heart,
    title: 'No notifications',
    message: "You're all caught up!",
  },
};

export function EmptyState({
  variant = 'feed',
  icon,
  title,
  message,
  actionLabel,
  onAction,
}: EmptyStateProps) {
  const config = variants[variant];
  const Icon = icon || config.icon;
  const displayTitle = title || config.title;
  const displayMessage = message || config.message;

  return (
    <View className="flex-1 items-center justify-center py-20 px-6">
      {/* Icon */}
      <View className="w-20 h-20 rounded-full bg-surface-elevated items-center justify-center mb-5">
        <Icon size={36} color="#6B7280" />
      </View>

      {/* Title */}
      <Text className="text-text-primary text-lg font-semibold text-center mb-2">
        {displayTitle}
      </Text>

      {/* Message */}
      <Text className="text-text-muted text-center max-w-xs leading-5">{displayMessage}</Text>

      {/* Optional Action Button */}
      {actionLabel && onAction && (
        <Pressable onPress={onAction} className="mt-6 bg-primary px-6 py-3 rounded-full">
          <Text className="text-white font-semibold">{actionLabel}</Text>
        </Pressable>
      )}
    </View>
  );
}

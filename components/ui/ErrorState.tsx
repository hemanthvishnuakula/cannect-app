/**
 * ErrorState - Inline error display with retry button
 *
 * Use this instead of returning null when API calls fail.
 * Shows a branded error message with optional retry action.
 */

import { View, Text, Pressable } from 'react-native';
import { AlertCircle, RefreshCw, WifiOff } from 'lucide-react-native';

interface ErrorStateProps {
  /** Error title (default: "Something went wrong") */
  title?: string;
  /** Error description */
  message?: string;
  /** Retry callback - if provided, shows retry button */
  onRetry?: () => void;
  /** Show as network error variant */
  isNetworkError?: boolean;
  /** Compact mode for inline use */
  compact?: boolean;
}

export function ErrorState({
  title = 'Something went wrong',
  message = "We couldn't load this content. Please try again.",
  onRetry,
  isNetworkError = false,
  compact = false,
}: ErrorStateProps) {
  const Icon = isNetworkError ? WifiOff : AlertCircle;
  const iconSize = compact ? 24 : 32;

  if (compact) {
    return (
      <View className="flex-row items-center justify-center py-4 px-4 bg-red-900/20 border border-red-800/50 rounded-xl mx-4 my-2">
        <Icon size={iconSize} color="#EF4444" />
        <Text className="text-red-400 text-sm ml-2 flex-1">{message}</Text>
        {onRetry && (
          <Pressable
            onPress={onRetry}
            className="ml-3 bg-red-900/50 px-3 py-1.5 rounded-full flex-row items-center"
          >
            <RefreshCw size={14} color="#EF4444" />
            <Text className="text-red-400 text-sm font-medium ml-1">Retry</Text>
          </Pressable>
        )}
      </View>
    );
  }

  return (
    <View className="flex-1 items-center justify-center py-16 px-6">
      {/* Icon */}
      <View className="w-16 h-16 rounded-full bg-red-900/30 items-center justify-center mb-4">
        <Icon size={iconSize} color="#EF4444" />
      </View>

      {/* Title */}
      <Text className="text-text-primary text-lg font-semibold text-center mb-2">{title}</Text>

      {/* Message */}
      <Text className="text-text-muted text-center mb-6 max-w-xs">{message}</Text>

      {/* Retry Button */}
      {onRetry && (
        <Pressable
          onPress={onRetry}
          className="flex-row items-center bg-red-900/30 border border-red-800/50 px-6 py-3 rounded-full"
        >
          <RefreshCw size={18} color="#EF4444" />
          <Text className="text-red-400 font-semibold ml-2">Try Again</Text>
        </Pressable>
      )}
    </View>
  );
}

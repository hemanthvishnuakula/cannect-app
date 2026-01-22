/**
 * MentionSuggestions - Dropdown for @mention autocomplete
 *
 * Shows a list of user suggestions when typing @username in compose.
 * Uses AT Protocol's searchActorsTypeahead for real-time suggestions.
 */

import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { memo, useEffect, useState, useCallback } from 'react';
import { getOptimizedAvatarUrl } from '@/lib/utils/avatar';
import * as atproto from '@/lib/atproto/agent';
import type { AppBskyActorDefs } from '@atproto/api';

type ProfileViewBasic = AppBskyActorDefs.ProfileViewBasic;

interface MentionSuggestionsProps {
  /** The search query (text after @) */
  query: string;
  /** Called when a user is selected */
  onSelect: (handle: string) => void;
  /** Whether the component is visible */
  visible: boolean;
}

export const MentionSuggestions = memo(function MentionSuggestions({
  query,
  onSelect,
  visible,
}: MentionSuggestionsProps) {
  const [suggestions, setSuggestions] = useState<ProfileViewBasic[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch suggestions when query changes
  useEffect(() => {
    if (!visible || !query || query.length < 1) {
      setSuggestions([]);
      return;
    }

    // Debounce the search
    const timer = setTimeout(async () => {
      setIsLoading(true);
      setError(null);

      try {
        const result = await atproto.searchActorsTypeahead(query, 6);
        setSuggestions(result.data.actors || []);
      } catch (err) {
        console.error('[MentionSuggestions] Search failed:', err);
        setError('Failed to search users');
        setSuggestions([]);
      } finally {
        setIsLoading(false);
      }
    }, 200); // 200ms debounce

    return () => clearTimeout(timer);
  }, [query, visible]);

  const handleSelect = useCallback(
    (handle: string) => {
      onSelect(handle);
    },
    [onSelect]
  );

  if (!visible) return null;

  // Show nothing if no query yet
  if (!query) return null;

  return (
    <View className="bg-surface-elevated border border-border rounded-xl shadow-lg overflow-hidden max-h-64">
      {/* Loading state */}
      {isLoading && suggestions.length === 0 && (
        <View className="p-4 items-center">
          <ActivityIndicator size="small" color="#10B981" />
        </View>
      )}

      {/* Error state */}
      {error && (
        <View className="p-4">
          <Text className="text-text-muted text-sm text-center">{error}</Text>
        </View>
      )}

      {/* No results */}
      {!isLoading && !error && suggestions.length === 0 && query.length >= 1 && (
        <View className="p-4">
          <Text className="text-text-muted text-sm text-center">No users found</Text>
        </View>
      )}

      {/* Suggestions list */}
      {suggestions.map((user) => (
        <Pressable
          key={user.did}
          onPress={() => handleSelect(user.handle)}
          className="flex-row items-center px-4 py-3 border-b border-border active:bg-surface-pressed"
          style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
        >
          {/* Avatar */}
          {user.avatar ? (
            <Image
              source={{ uri: getOptimizedAvatarUrl(user.avatar, 36) }}
              className="w-9 h-9 rounded-full bg-surface-elevated"
              contentFit="cover"
              transition={50}
              cachePolicy="memory-disk"
            />
          ) : (
            <View className="w-9 h-9 rounded-full bg-surface-elevated items-center justify-center">
              <Text className="text-text-muted text-sm">{user.handle[0].toUpperCase()}</Text>
            </View>
          )}

          {/* User info */}
          <View className="flex-1 ml-3">
            <Text className="text-text-primary font-medium" numberOfLines={1}>
              {user.displayName || user.handle}
            </Text>
            <Text className="text-text-muted text-sm" numberOfLines={1}>
              @{user.handle}
            </Text>
          </View>

          {/* Network badge */}
          {(user.handle.endsWith('.cannect.space') ||
            user.handle.endsWith('.pds.cannect.space')) && (
            <View className="px-2 py-0.5 rounded-full bg-primary/20">
              <Text className="text-primary text-xs font-medium">cannect</Text>
            </View>
          )}
        </Pressable>
      ))}
    </View>
  );
});

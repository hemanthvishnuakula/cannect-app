/**
 * ChatEmbeddedPost - Renders an embedded post within a chat message
 *
 * Displays a compact preview of a shared post with:
 * - Author avatar and name
 * - Post text preview
 * - Tap to navigate to full post
 */

import { useState, useEffect } from 'react';
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { getOptimizedAvatarWithFallback, getFallbackAvatarUrl } from '@/lib/utils/avatar';
import * as atproto from '@/lib/atproto/agent';
import { triggerImpact } from '@/lib/utils/haptics';

interface ChatEmbeddedPostProps {
  embed: {
    $type?: string;
    record?: {
      uri?: string;
      cid?: string;
      author?: {
        did?: string;
        handle?: string;
        displayName?: string;
        avatar?: string;
      };
      value?: {
        text?: string;
        createdAt?: string;
      };
    };
  };
  isOwn: boolean;
}

export function ChatEmbeddedPost({ embed, isOwn }: ChatEmbeddedPostProps) {
  const router = useRouter();
  const [postData, setPostData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [avatarError, setAvatarError] = useState(false);

  // The embed might have full record data or just uri/cid
  // If we only have uri/cid, we'd need to fetch the post
  const record = embed?.record;

  // Extract post info - check if it's already resolved (has author) or needs fetching
  const hasResolvedData = record?.author?.handle || record?.value?.text;

  useEffect(() => {
    // If we have full data, use it
    if (hasResolvedData) {
      setPostData({
        author: record?.author,
        text: record?.value?.text || '',
        uri: record?.uri,
      });
      return;
    }

    // If we only have uri/cid, fetch the post
    if (record?.uri && !postData && !isLoading) {
      setIsLoading(true);
      atproto
        .getPostThread(record.uri)
        .then((result: any) => {
          const post = result?.thread?.post;
          if (post) {
            setPostData({
              author: post.author,
              text: (post.record as any)?.text || '',
              uri: post.uri,
            });
          }
        })
        .catch(console.error)
        .finally(() => setIsLoading(false));
    }
  }, [record?.uri, record?.author, record?.value?.text, hasResolvedData, postData, isLoading]);

  const handlePress = () => {
    if (!postData?.uri) return;

    triggerImpact('light');
    const parts = postData.uri.split('/');
    const did = parts[2];
    const rkey = parts[4];
    router.push(`/post/${did}/${rkey}` as any);
  };

  if (isLoading) {
    return (
      <View
        style={{
          backgroundColor: isOwn ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.05)',
          borderRadius: 12,
          padding: 12,
          marginTop: 6,
          alignItems: 'center',
        }}
      >
        <ActivityIndicator size="small" color={isOwn ? '#fff' : '#10B981'} />
      </View>
    );
  }

  if (!postData) {
    return null;
  }

  const { author, text } = postData;
  const authorName = author?.displayName || author?.handle || 'Unknown';
  const authorHandle = author?.handle || '';

  const avatarUrl = avatarError
    ? getFallbackAvatarUrl(authorName)
    : getOptimizedAvatarWithFallback(author?.avatar, authorName, 32);

  return (
    <Pressable
      onPress={handlePress}
      style={{
        backgroundColor: isOwn ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.05)',
        borderRadius: 12,
        padding: 10,
        marginTop: 6,
        borderWidth: 1,
        borderColor: isOwn ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.08)',
      }}
    >
      {/* Author row */}
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
        <Image
          source={{ uri: avatarUrl }}
          style={{ width: 24, height: 24, borderRadius: 12 }}
          contentFit="cover"
          onError={() => setAvatarError(true)}
        />
        <View style={{ marginLeft: 8, flex: 1 }}>
          <Text
            style={{
              color: isOwn ? 'rgba(255,255,255,0.95)' : '#E5E7EB',
              fontSize: 13,
              fontWeight: '600',
            }}
            numberOfLines={1}
          >
            {authorName}
          </Text>
          <Text
            style={{
              color: isOwn ? 'rgba(255,255,255,0.6)' : '#9CA3AF',
              fontSize: 11,
            }}
            numberOfLines={1}
          >
            @{authorHandle}
          </Text>
        </View>
      </View>

      {/* Post text preview */}
      <Text
        style={{
          color: isOwn ? 'rgba(255,255,255,0.9)' : '#D1D5DB',
          fontSize: 13,
          lineHeight: 18,
        }}
        numberOfLines={3}
      >
        {text}
      </Text>

      {/* Tap to view indicator */}
      <Text
        style={{
          color: isOwn ? 'rgba(255,255,255,0.5)' : '#6B7280',
          fontSize: 11,
          marginTop: 6,
        }}
      >
        Tap to view post →
      </Text>
    </Pressable>
  );
}

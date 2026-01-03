/**
 * MessageRichText - Renders chat message text with facets
 *
 * Similar to RichText but with chat-specific styling:
 * - Different link colors for own vs other messages
 * - Underline for links to make them visible
 */

import { Text, Linking } from 'react-native';
import { useRouter } from 'expo-router';
import { memo, useMemo } from 'react';

interface MessageRichTextProps {
  /** The message text */
  text: string;
  /** The facets array from the message */
  facets?: any[];
  /** Whether this is the current user's message */
  isOwn: boolean;
}

interface TextSegment {
  text: string;
  type: 'text' | 'mention' | 'link' | 'hashtag';
  value?: string;
}

/**
 * Parse text and facets into segments for rendering
 */
function parseTextWithFacets(text: string, facets?: any[]): TextSegment[] {
  if (!facets || facets.length === 0) {
    return [{ text, type: 'text' }];
  }

  // Sort facets by byte start position
  const sortedFacets = [...facets].sort(
    (a, b) => (a.index?.byteStart ?? 0) - (b.index?.byteStart ?? 0)
  );

  const segments: TextSegment[] = [];

  // Convert text to bytes for proper indexing (Bluesky uses byte offsets)
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const textBytes = encoder.encode(text);

  let currentBytePos = 0;

  for (const facet of sortedFacets) {
    const byteStart = facet.index?.byteStart ?? 0;
    const byteEnd = facet.index?.byteEnd ?? 0;

    // Add plain text before this facet
    if (byteStart > currentBytePos) {
      const plainBytes = textBytes.slice(currentBytePos, byteStart);
      segments.push({
        text: decoder.decode(plainBytes),
        type: 'text',
      });
    }

    // Get the faceted text
    const facetBytes = textBytes.slice(byteStart, byteEnd);
    const facetText = decoder.decode(facetBytes);

    // Determine facet type from features
    const feature = facet.features?.[0];
    if (feature) {
      const featureType = feature.$type;

      if (featureType === 'app.bsky.richtext.facet#mention') {
        segments.push({
          text: facetText,
          type: 'mention',
          value: feature.did,
        });
      } else if (featureType === 'app.bsky.richtext.facet#link') {
        segments.push({
          text: facetText,
          type: 'link',
          value: feature.uri,
        });
      } else if (featureType === 'app.bsky.richtext.facet#tag') {
        segments.push({
          text: facetText,
          type: 'hashtag',
          value: feature.tag,
        });
      } else {
        segments.push({
          text: facetText,
          type: 'text',
        });
      }
    }

    currentBytePos = byteEnd;
  }

  // Add remaining text after last facet
  if (currentBytePos < textBytes.length) {
    const remainingBytes = textBytes.slice(currentBytePos);
    segments.push({
      text: decoder.decode(remainingBytes),
      type: 'text',
    });
  }

  return segments;
}

export const MessageRichText = memo(function MessageRichText({
  text,
  facets,
  isOwn,
}: MessageRichTextProps) {
  const router = useRouter();

  const segments = useMemo(() => parseTextWithFacets(text, facets), [text, facets]);

  const handleMentionPress = (did: string) => {
    router.push(`/user/${did}` as any);
  };

  const handleLinkPress = (url: string) => {
    Linking.openURL(url);
  };

  const handleHashtagPress = (tag: string) => {
    router.push(`/search?q=${encodeURIComponent('#' + tag)}` as any);
  };

  // Colors based on message ownership
  const textColor = isOwn ? '#FFFFFF' : '#F3F4F6';
  const linkColor = isOwn ? '#BFDBFE' : '#60A5FA'; // Light blue for contrast

  return (
    <Text
      style={{
        color: textColor,
        fontSize: 15,
        lineHeight: 20,
        marginRight: 8,
        flexShrink: 1,
      }}
    >
      {segments.map((segment, index) => {
        switch (segment.type) {
          case 'mention':
            return (
              <Text
                key={index}
                style={{ color: linkColor, textDecorationLine: 'underline' }}
                onPress={() => segment.value && handleMentionPress(segment.value)}
              >
                {segment.text}
              </Text>
            );

          case 'link':
            return (
              <Text
                key={index}
                style={{ color: linkColor, textDecorationLine: 'underline' }}
                onPress={() => segment.value && handleLinkPress(segment.value)}
              >
                {segment.text}
              </Text>
            );

          case 'hashtag':
            return (
              <Text
                key={index}
                style={{ color: linkColor }}
                onPress={() => segment.value && handleHashtagPress(segment.value)}
              >
                {segment.text}
              </Text>
            );

          default:
            return <Text key={index}>{segment.text}</Text>;
        }
      })}
    </Text>
  );
});

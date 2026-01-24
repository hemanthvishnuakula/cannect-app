/**
 * RichText - Renders post text with facets (mentions, links, hashtags)
 *
 * Bluesky posts include a "facets" array that marks ranges of text as:
 * - Mentions (@user) → navigate to profile
 * - Links (URLs) → open in browser
 * - Hashtags (#tag) → search for tag
 *
 * This component parses those facets and renders interactive text.
 */

import { Text, Linking } from 'react-native';
import { useRouter } from 'expo-router';
import { memo, useMemo } from 'react';
import type { AppBskyRichtextFacet } from '@atproto/api';

interface RichTextProps {
  /** The post text */
  text: string;
  /** The facets array from the record */
  facets?: AppBskyRichtextFacet.Main[];
  /** Base text style class */
  className?: string;
  /** Number of lines before truncating (optional) */
  numberOfLines?: number;
}

interface TextSegment {
  text: string;
  type: 'text' | 'mention' | 'link' | 'hashtag';
  value?: string; // DID for mention, URL for link, tag for hashtag
}

/**
 * Parse text and facets into segments for rendering
 */
function parseTextWithFacets(text: string, facets?: AppBskyRichtextFacet.Main[]): TextSegment[] {
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
          value: (feature as any).did,
        });
      } else if (featureType === 'app.bsky.richtext.facet#link') {
        segments.push({
          text: facetText,
          type: 'link',
          value: (feature as any).uri,
        });
      } else if (featureType === 'app.bsky.richtext.facet#tag') {
        segments.push({
          text: facetText,
          type: 'hashtag',
          value: (feature as any).tag,
        });
      } else {
        // Unknown facet type, render as plain text
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

export const RichText = memo(function RichText({
  text,
  facets,
  className = '',
  numberOfLines,
}: RichTextProps) {
  const router = useRouter();

  const segments = useMemo(() => parseTextWithFacets(text, facets), [text, facets]);

  const handleMentionPress = (did: string) => {
    // Navigate to user profile by DID
    // We'll need to resolve DID to handle, or use DID directly
    router.push(`/user/${did}` as any);
  };

  const handleLinkPress = (url: string) => {
    Linking.openURL(url);
  };

  const handleHashtagPress = (tag: string) => {
    // Navigate to search with hashtag
    router.push(`/search?q=${encodeURIComponent('#' + tag)}` as any);
  };

  return (
    <Text
      className={`text-zinc-300 text-[15px] leading-relaxed ${className}`}
      numberOfLines={numberOfLines}
    >
      {segments.map((segment, index) => {
        switch (segment.type) {
          case 'mention':
            return (
              <Text
                key={index}
                className="text-primary"
                onPress={() => segment.value && handleMentionPress(segment.value)}
              >
                {segment.text}
              </Text>
            );

          case 'link':
            return (
              <Text
                key={index}
                className="text-primary"
                onPress={() => segment.value && handleLinkPress(segment.value)}
              >
                {segment.text}
              </Text>
            );

          case 'hashtag':
            return (
              <Text
                key={index}
                className="text-primary"
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

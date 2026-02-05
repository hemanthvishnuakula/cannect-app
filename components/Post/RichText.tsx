/**
 * RichText - Renders post text with facets (mentions, links, hashtags) and markdown (bold, italic)
 *
 * Bluesky posts include a "facets" array that marks ranges of text as:
 * - Mentions (@user) → navigate to profile
 * - Links (URLs) → open in browser
 * - Hashtags (#tag) → search for tag
 *
 * Additionally, we parse markdown-style formatting:
 * - **bold** → bold text
 * - *italic* → italic text
 * - ***bold italic*** → both
 *
 * This component parses those facets and renders interactive text.
 */

import { Text, Linking, type TextStyle } from 'react-native';
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
  /** URLs to hide from text (e.g., when a link preview card is shown) */
  hideUrls?: string[];
}

interface TextSegment {
  text: string;
  type: 'text' | 'mention' | 'link' | 'hashtag';
  value?: string; // DID for mention, URL for link, tag for hashtag
  isBold?: boolean;
  isItalic?: boolean;
}

/**
 * Parse markdown formatting (bold and italic) from text
 * Returns an array of segments with formatting info
 */
function parseMarkdown(text: string): { text: string; isBold: boolean; isItalic: boolean }[] {
  const segments: { text: string; isBold: boolean; isItalic: boolean }[] = [];

  // Regex to match **bold**, *italic*, or ***bold italic***
  const pattern = /(\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|\*([^*]+?)\*)/g;

  let lastIndex = 0;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    // Add text before the match
    if (match.index > lastIndex) {
      segments.push({
        text: text.slice(lastIndex, match.index),
        isBold: false,
        isItalic: false,
      });
    }

    // Determine the type of formatting
    if (match[2]) {
      // ***bold italic***
      segments.push({
        text: match[2],
        isBold: true,
        isItalic: true,
      });
    } else if (match[3]) {
      // **bold**
      segments.push({
        text: match[3],
        isBold: true,
        isItalic: false,
      });
    } else if (match[4]) {
      // *italic*
      segments.push({
        text: match[4],
        isBold: false,
        isItalic: true,
      });
    }

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    segments.push({
      text: text.slice(lastIndex),
      isBold: false,
      isItalic: false,
    });
  }

  return segments.length > 0 ? segments : [{ text, isBold: false, isItalic: false }];
}

/**
 * Parse text and facets into segments for rendering
 */
function parseTextWithFacets(text: string, facets?: AppBskyRichtextFacet.Main[]): TextSegment[] {
  if (!facets || facets.length === 0) {
    // No facets, just parse markdown
    return parseMarkdown(text).map((seg) => ({ ...seg, type: 'text' as const }));
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

    // Add plain text before this facet (with markdown parsing)
    if (byteStart > currentBytePos) {
      const plainBytes = textBytes.slice(currentBytePos, byteStart);
      const plainText = decoder.decode(plainBytes);
      const markdownSegments = parseMarkdown(plainText);
      segments.push(...markdownSegments.map((seg) => ({ ...seg, type: 'text' as const })));
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
        // Unknown facet type, render as plain text with markdown
        const markdownSegments = parseMarkdown(facetText);
        segments.push(...markdownSegments.map((seg) => ({ ...seg, type: 'text' as const })));
      }
    }

    currentBytePos = byteEnd;
  }

  // Add remaining text after last facet (with markdown parsing)
  if (currentBytePos < textBytes.length) {
    const remainingBytes = textBytes.slice(currentBytePos);
    const remainingText = decoder.decode(remainingBytes);
    const markdownSegments = parseMarkdown(remainingText);
    segments.push(...markdownSegments.map((seg) => ({ ...seg, type: 'text' as const })));
  }

  return segments;
}

export const RichText = memo(function RichText({
  text,
  facets,
  className = '',
  numberOfLines,
  hideUrls = [],
}: RichTextProps) {
  const router = useRouter();

  const segments = useMemo(() => parseTextWithFacets(text, facets), [text, facets]);

  // Filter out URLs that should be hidden (when embed card is shown)
  const filteredSegments = useMemo(() => {
    if (hideUrls.length === 0) return segments;
    
    return segments.filter((segment) => {
      if (segment.type === 'link' && segment.value) {
        // Check if this URL should be hidden
        return !hideUrls.some((url) => segment.value === url || segment.text === url);
      }
      return true;
    });
  }, [segments, hideUrls]);

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

  // Build text style based on formatting
  const getTextStyle = (segment: TextSegment): TextStyle => {
    const style: TextStyle = {};
    if (segment.isBold) {
      style.fontWeight = '700'; // Use numeric for better cross-platform support
    }
    if (segment.isItalic) {
      style.fontStyle = 'italic';
    }
    return style;
  };

  return (
    <Text
      className={`text-zinc-300 text-[15px] leading-relaxed ${className}`}
      numberOfLines={numberOfLines}
    >
      {filteredSegments.map((segment, index) => {
        const textStyle = getTextStyle(segment);

        switch (segment.type) {
          case 'mention':
            return (
              <Text
                key={index}
                className="text-primary"
                style={textStyle}
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
                style={textStyle}
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
                style={textStyle}
                onPress={() => segment.value && handleHashtagPress(segment.value)}
              >
                {segment.text}
              </Text>
            );

          default:
            return (
              <Text key={index} style={textStyle}>
                {segment.text}
              </Text>
            );
        }
      })}
    </Text>
  );
});

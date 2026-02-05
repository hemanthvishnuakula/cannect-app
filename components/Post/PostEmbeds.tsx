/**
 * PostEmbeds - Renders all types of post embeds
 *
 * Handles:
 * - Images (single or grid)
 * - Videos
 * - Link previews (external)
 * - Quote posts
 * - Record with media (quote + images/video)
 * - YouTube link fallback (when no embed but text contains YouTube URL)
 */

import React from 'react';
import { View, Text, Pressable, Linking } from 'react-native';
import { Image } from 'expo-image';
import { ExternalLink, Play } from 'lucide-react-native';
import { VideoPlayer } from '@/components/ui/VideoPlayer';
import { getOptimizedAvatarUrl } from '@/lib/utils/avatar';
import type {
  AppBskyEmbedImages,
  AppBskyEmbedExternal,
  AppBskyEmbedRecord,
  AppBskyEmbedVideo,
  AppBskyEmbedRecordWithMedia,
} from '@atproto/api';

// Stop event propagation helper (works on web and native)
// Note: Only stopPropagation is needed - preventDefault breaks click detection on web
const stopEvent = (e: any) => {
  e?.stopPropagation?.();
};

/**
 * Extract YouTube video ID from various YouTube URL formats
 * Supports: youtube.com/watch?v=, youtu.be/, youtube.com/embed/, m.youtube.com, etc.
 */
function extractYouTubeVideoId(text: string): { videoId: string; url: string } | null {
  if (!text) return null;

  // Regex patterns for YouTube URLs
  const patterns = [
    // youtube.com/watch?v=VIDEO_ID
    /(?:https?:\/\/)?(?:www\.|m\.)?youtube\.com\/watch\?[^\s]*v=([a-zA-Z0-9_-]{11})/,
    // youtu.be/VIDEO_ID
    /(?:https?:\/\/)?youtu\.be\/([a-zA-Z0-9_-]{11})/,
    // youtube.com/embed/VIDEO_ID
    /(?:https?:\/\/)?(?:www\.)?youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
    // youtube.com/v/VIDEO_ID
    /(?:https?:\/\/)?(?:www\.)?youtube\.com\/v\/([a-zA-Z0-9_-]{11})/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      // Extract the full URL for linking
      const urlMatch = text.match(/https?:\/\/(?:www\.|m\.)?(?:youtube\.com|youtu\.be)[^\s]*/);
      return {
        videoId: match[1],
        url: urlMatch ? urlMatch[0] : `https://youtube.com/watch?v=${match[1]}`,
      };
    }
  }

  return null;
}

interface PostEmbedsProps {
  embed: any; // The post.embed object
  onImagePress?: (images: string[], index: number) => void;
  /** Full width mode for card layout */
  fullWidth?: boolean;
  /** Post text - used to detect YouTube URLs when no embed exists */
  text?: string;
}

export function PostEmbeds({ embed, onImagePress, fullWidth = false, text }: PostEmbedsProps) {
  // If no embed, check for YouTube URL in text
  if (!embed) {
    const youtube = extractYouTubeVideoId(text || '');
    if (youtube) {
      return (
        <View className={fullWidth ? 'px-4' : 'mt-3'}>
          <YouTubePreview videoId={youtube.videoId} url={youtube.url} />
        </View>
      );
    }
    return null;
  }

  const embedType = embed.$type;

  // Wrapper for full-width mode
  const wrapperClass = fullWidth ? '' : 'mt-3';

  // Images
  if (embedType === 'app.bsky.embed.images#view') {
    const images = (embed as AppBskyEmbedImages.View).images;
    return (
      <View className={wrapperClass}>
        <ImageGrid images={images} onImagePress={onImagePress} fullWidth={fullWidth} />
      </View>
    );
  }

  // Link Preview
  if (embedType === 'app.bsky.embed.external#view') {
    const external = (embed as AppBskyEmbedExternal.View).external;
    return (
      <View className={fullWidth ? 'px-4' : 'mt-3'}>
        <LinkPreview external={external} />
      </View>
    );
  }

  // Quote Post
  if (embedType === 'app.bsky.embed.record#view') {
    const record = (embed as AppBskyEmbedRecord.View).record;
    if (record.$type === 'app.bsky.embed.record#viewRecord') {
      return (
        <View className={fullWidth ? 'px-4' : 'mt-3'}>
          <QuotePost record={record as any} />
        </View>
      );
    }
    return null;
  }

  // Video
  if (embedType === 'app.bsky.embed.video#view') {
    const video = embed as AppBskyEmbedVideo.View;
    return (
      <View className={wrapperClass}>
        <VideoEmbed video={video} fullWidth={fullWidth} />
      </View>
    );
  }

  // Record with Media (Quote + Images/Video)
  if (embedType === 'app.bsky.embed.recordWithMedia#view') {
    const rwm = embed as AppBskyEmbedRecordWithMedia.View;
    return (
      <View className={wrapperClass}>
        <RecordWithMedia data={rwm} onImagePress={onImagePress} fullWidth={fullWidth} />
      </View>
    );
  }

  return null;
}

// ============================================
// Sub-components
// ============================================

function ImageGrid({
  images,
  onImagePress,
  fullWidth = false,
}: {
  images: AppBskyEmbedImages.ViewImage[];
  onImagePress?: (images: string[], index: number) => void;
  fullWidth?: boolean;
}) {
  const imageUrls = images.map((img) => img.fullsize || img.thumb);

  // Border radius: none for full-width mode
  const borderClass = fullWidth ? '' : 'rounded-lg';

  if (images.length === 1) {
    const img = images[0];
    // Calculate aspect ratio from image data, default to 4:3 if not available
    const aspectRatio = img.aspectRatio ? img.aspectRatio.width / img.aspectRatio.height : 4 / 3;
    // Cap height: min 150px, max 400px based on aspect ratio
    const maxHeight = 400;
    const minHeight = 150;
    // For a full-width image, height = width / aspectRatio
    // We'll use paddingBottom trick for responsive aspect ratio
    const heightPercent = Math.min(Math.max((1 / aspectRatio) * 100, (minHeight / 400) * 100), 100);

    return (
      <Pressable
        onPressIn={stopEvent}
        onPress={(e) => {
          stopEvent(e);
          onImagePress?.(imageUrls, 0);
        }}
        className={`overflow-hidden ${borderClass}`}
      >
        <View style={{ width: '100%', maxHeight, minHeight }}>
          <Image
            source={{ uri: img.thumb }}
            style={{ width: '100%', aspectRatio, maxHeight, minHeight }}
            className={`bg-neutral-900 ${borderClass}`}
            contentFit="cover"
            transition={50}
            cachePolicy="memory-disk"
            recyclingKey={img.thumb}
          />
        </View>
      </Pressable>
    );
  }

  return (
    <View
      className={`flex-row flex-wrap gap-1 overflow-hidden ${fullWidth ? 'px-4' : borderClass}`}
    >
      {images.slice(0, 4).map((img, idx) => (
        <Pressable
          key={idx}
          onPressIn={stopEvent}
          onPress={(e) => {
            stopEvent(e);
            onImagePress?.(imageUrls, idx);
          }}
          className="w-[48%]"
        >
          <Image
            source={{ uri: img.thumb }}
            className="w-full h-32 rounded-lg bg-neutral-900"
            contentFit="cover"
            transition={50}
            cachePolicy="memory-disk"
            recyclingKey={img.thumb}
          />
        </Pressable>
      ))}
    </View>
  );
}

function LinkPreview({ external }: { external: AppBskyEmbedExternal.ViewExternal }) {
  const handlePress = () => {
    Linking.openURL(external.uri);
  };

  let hostname = '';
  try {
    hostname = new URL(external.uri).hostname.replace('www.', '');
  } catch {
    hostname = external.uri;
  }

  return (
    <Pressable
      onPressIn={stopEvent}
      onPress={(e) => {
        stopEvent(e);
        handlePress();
      }}
      className="mt-2 border border-neutral-800/60 rounded-2xl overflow-hidden bg-neutral-900/30"
    >
      {external.thumb && (
        <Image
          source={{ uri: external.thumb }}
          className="w-full h-36 bg-neutral-900"
          contentFit="cover"
          transition={50}
          cachePolicy="memory-disk"
          recyclingKey={external.thumb}
        />
      )}
      <View className="px-4 py-3">
        <Text className="text-text-muted text-xs mb-1">{hostname}</Text>
        <Text className="text-text-primary font-medium text-[15px] leading-snug" numberOfLines={2}>
          {external.title || hostname}
        </Text>
      </View>
    </Pressable>
  );
}

function QuotePost({ record }: { record: any }) {
  const author = record.author;
  const text = record.value?.text;

  return (
    <View className="mt-2 border border-neutral-800/60 rounded-lg p-3">
      <View className="flex-row items-center mb-1">
        {author?.avatar && (
          <Image
            source={{ uri: getOptimizedAvatarUrl(author.avatar, 20) }}
            className="w-5 h-5 rounded-full mr-2 bg-neutral-900 flex-shrink-0"
            contentFit="cover"
            transition={50}
            cachePolicy="memory-disk"
            recyclingKey={author.avatar}
          />
        )}
        <Text className="text-text-primary font-medium text-sm flex-shrink" numberOfLines={1}>
          {author?.displayName || author?.handle}
        </Text>
        <Text className="text-text-muted text-sm ml-1 flex-shrink-0">
          @{author?.handle?.slice(0, 15)}
          {author?.handle?.length > 15 ? '…' : ''}
        </Text>
      </View>
      <Text className="text-text-primary text-sm" numberOfLines={3}>
        {text}
      </Text>
    </View>
  );
}

function VideoEmbed({
  video,
  fullWidth = false,
}: {
  video: AppBskyEmbedVideo.View;
  fullWidth?: boolean;
}) {
  const aspectRatio =
    video.aspectRatio?.width && video.aspectRatio?.height
      ? video.aspectRatio.width / video.aspectRatio.height
      : 16 / 9;

  const borderClass = fullWidth ? '' : 'rounded-xl';

  return (
    <View className={`overflow-hidden ${borderClass}`}>
      <VideoPlayer
        url={video.playlist}
        thumbnailUrl={video.thumbnail}
        aspectRatio={aspectRatio}
        muted={true}
        loop={true}
      />
    </View>
  );
}

function RecordWithMedia({
  data,
  onImagePress,
  fullWidth = false,
}: {
  data: AppBskyEmbedRecordWithMedia.View;
  onImagePress?: (images: string[], index: number) => void;
  fullWidth?: boolean;
}) {
  const media = data.media;
  const record = data.record?.record;

  return (
    <>
      {/* Media part (images or video) */}
      {media.$type === 'app.bsky.embed.images#view' && (
        <ImageGrid
          images={(media as any).images}
          onImagePress={onImagePress}
          fullWidth={fullWidth}
        />
      )}
      {media.$type === 'app.bsky.embed.video#view' && (
        <VideoEmbed video={media as any} fullWidth={fullWidth} />
      )}

      {/* Quote part */}
      {record && record.$type === 'app.bsky.embed.record#viewRecord' && (
        <View className={fullWidth ? 'px-4 mt-2' : 'mt-2'}>
          <QuotePost record={record as any} />
        </View>
      )}
    </>
  );
}

/**
 * YouTube Preview - Renders a YouTube video preview card
 * Fetches real title via our oEmbed proxy API
 */
function YouTubePreview({ videoId, url }: { videoId: string; url: string }) {
  const [metadata, setMetadata] = React.useState<{
    title: string;
    author_name: string;
  } | null>(null);

  // Fetch metadata on mount
  React.useEffect(() => {
    const fetchMetadata = async () => {
      try {
        const response = await fetch(
          `https://feed.cannect.space/api/oembed?url=${encodeURIComponent(url)}`
        );
        if (response.ok) {
          const data = await response.json();
          setMetadata(data);
        }
      } catch (err) {
        // Silently fail - we'll show fallback
      }
    };
    fetchMetadata();
  }, [url]);

  const handlePress = () => {
    Linking.openURL(url);
  };

  // YouTube provides predictable thumbnail URLs
  const thumbnailUrl = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;

  return (
    <Pressable
      onPressIn={stopEvent}
      onPress={(e) => {
        stopEvent(e);
        handlePress();
      }}
      className="mt-2 border border-border rounded-xl overflow-hidden"
    >
      <View className="relative">
        <Image
          source={{ uri: thumbnailUrl }}
          className="w-full h-44 bg-surface-elevated"
          contentFit="cover"
          transition={50}
          cachePolicy="memory-disk"
          recyclingKey={thumbnailUrl}
        />
        {/* Play button overlay */}
        <View className="absolute inset-0 items-center justify-center">
          <View className="bg-red-600 rounded-full p-3">
            <Play size={24} color="#FFFFFF" fill="#FFFFFF" />
          </View>
        </View>
      </View>
      <View className="p-3">
        <Text className="text-text-primary font-medium" numberOfLines={2}>
          {metadata?.title || 'YouTube Video'}
        </Text>
        {metadata?.author_name && (
          <Text className="text-text-muted text-sm mt-0.5" numberOfLines={1}>
            {metadata.author_name}
          </Text>
        )}
        <View className="flex-row items-center mt-1">
          <ExternalLink size={12} color="#6B7280" />
          <Text className="text-text-muted text-xs ml-1">youtube.com</Text>
        </View>
      </View>
    </Pressable>
  );
}

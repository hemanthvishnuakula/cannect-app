/**
 * PostEmbeds - Renders all types of post embeds
 *
 * Handles:
 * - Images (single or grid)
 * - Videos
 * - Link previews (external)
 * - Quote posts
 * - Record with media (quote + images/video)
 */

import { View, Text, Pressable, Linking } from 'react-native';
import { Image } from 'expo-image';
import { ExternalLink } from 'lucide-react-native';
import { VideoPlayer } from '@/components/ui/VideoPlayer';
import type {
  AppBskyEmbedImages,
  AppBskyEmbedExternal,
  AppBskyEmbedRecord,
  AppBskyEmbedVideo,
  AppBskyEmbedRecordWithMedia,
} from '@atproto/api';

// Stop event propagation helper (works on web and native)
const stopEvent = (e: any) => {
  e?.stopPropagation?.();
  e?.preventDefault?.();
};

interface PostEmbedsProps {
  embed: any; // The post.embed object
  onImagePress?: (images: string[], index: number) => void;
}

export function PostEmbeds({ embed, onImagePress }: PostEmbedsProps) {
  if (!embed) return null;

  const embedType = embed.$type;

  // Images
  if (embedType === 'app.bsky.embed.images#view') {
    const images = (embed as AppBskyEmbedImages.View).images;
    return <ImageGrid images={images} onImagePress={onImagePress} />;
  }

  // Link Preview
  if (embedType === 'app.bsky.embed.external#view') {
    const external = (embed as AppBskyEmbedExternal.View).external;
    return <LinkPreview external={external} />;
  }

  // Quote Post
  if (embedType === 'app.bsky.embed.record#view') {
    const record = (embed as AppBskyEmbedRecord.View).record;
    if (record.$type === 'app.bsky.embed.record#viewRecord') {
      return <QuotePost record={record as any} />;
    }
    return null;
  }

  // Video
  if (embedType === 'app.bsky.embed.video#view') {
    const video = embed as AppBskyEmbedVideo.View;
    return <VideoEmbed video={video} />;
  }

  // Record with Media (Quote + Images/Video)
  if (embedType === 'app.bsky.embed.recordWithMedia#view') {
    const rwm = embed as AppBskyEmbedRecordWithMedia.View;
    return <RecordWithMedia data={rwm} onImagePress={onImagePress} />;
  }

  return null;
}

// ============================================
// Sub-components
// ============================================

function ImageGrid({
  images,
  onImagePress,
}: {
  images: AppBskyEmbedImages.ViewImage[];
  onImagePress?: (images: string[], index: number) => void;
}) {
  const imageUrls = images.map((img) => img.fullsize || img.thumb);

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
        className="mt-2 rounded-xl overflow-hidden"
      >
        <View style={{ width: '100%', maxHeight, minHeight }}>
          <Image
            source={{ uri: img.thumb }}
            style={{ width: '100%', aspectRatio, maxHeight, minHeight }}
            className="rounded-xl bg-surface-elevated"
            contentFit="cover"
            transition={200}
            cachePolicy="memory-disk"
            recyclingKey={img.thumb}
          />
        </View>
      </Pressable>
    );
  }

  return (
    <View className="mt-2 flex-row flex-wrap gap-1 rounded-xl overflow-hidden">
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
            className="w-full h-32 rounded-lg bg-surface-elevated"
            contentFit="cover"
            transition={200}
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
    hostname = new URL(external.uri).hostname;
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
      className="mt-2 border border-border rounded-xl overflow-hidden"
    >
      {external.thumb && (
        <Image
          source={{ uri: external.thumb }}
          className="w-full h-32 bg-surface-elevated"
          contentFit="cover"
          transition={200}
          cachePolicy="memory-disk"
          recyclingKey={external.thumb}
        />
      )}
      <View className="p-3">
        <Text className="text-text-primary font-medium" numberOfLines={2}>
          {external.title || hostname}
        </Text>
        {external.description && (
          <Text className="text-text-muted text-sm mt-1" numberOfLines={2}>
            {external.description}
          </Text>
        )}
        <View className="flex-row items-center mt-2">
          <ExternalLink size={12} color="#6B7280" />
          <Text className="text-text-muted text-xs ml-1">{hostname}</Text>
        </View>
      </View>
    </Pressable>
  );
}

function QuotePost({ record }: { record: any }) {
  const author = record.author;
  const text = record.value?.text;

  return (
    <View className="mt-2 border border-border rounded-xl p-3">
      <View className="flex-row items-center mb-1">
        {author?.avatar && (
          <Image
            source={{ uri: author.avatar }}
            className="w-5 h-5 rounded-full mr-2 bg-surface-elevated flex-shrink-0"
            contentFit="cover"
            transition={150}
            cachePolicy="memory-disk"
            recyclingKey={author.avatar}
          />
        )}
        <Text className="text-text-primary font-medium text-sm flex-shrink" numberOfLines={1}>
          {author?.displayName || author?.handle}
        </Text>
        <Text className="text-text-muted text-sm ml-1 flex-shrink-0">@{author?.handle?.slice(0, 15)}{author?.handle?.length > 15 ? '…' : ''}</Text>
      </View>
      <Text className="text-text-primary text-sm" numberOfLines={3}>
        {text}
      </Text>
    </View>
  );
}

function VideoEmbed({ video }: { video: AppBskyEmbedVideo.View }) {
  const aspectRatio =
    video.aspectRatio?.width && video.aspectRatio?.height
      ? video.aspectRatio.width / video.aspectRatio.height
      : 16 / 9;

  return (
    <View className="mt-2 rounded-xl overflow-hidden">
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
}: {
  data: AppBskyEmbedRecordWithMedia.View;
  onImagePress?: (images: string[], index: number) => void;
}) {
  const media = data.media;
  const record = data.record?.record;

  return (
    <>
      {/* Media part (images or video) */}
      {media.$type === 'app.bsky.embed.images#view' && (
        <ImageGrid images={(media as any).images} onImagePress={onImagePress} />
      )}
      {media.$type === 'app.bsky.embed.video#view' && <VideoEmbed video={media as any} />}

      {/* Quote part */}
      {record && record.$type === 'app.bsky.embed.record#viewRecord' && (
        <QuotePost record={record as any} />
      )}
    </>
  );
}

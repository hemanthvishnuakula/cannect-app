import { View, Pressable } from 'react-native';
import { Image } from 'expo-image';
import { Layers, Play } from 'lucide-react-native';
import { useRouter } from 'expo-router';

// Standard blurhash placeholder for loading states
const BLURHASH_NEUTRAL = 'L6PZfSi_.AyE_3t7t7R**0o#DgR4';

interface MediaGridItemProps {
  item: {
    id: string;
    did?: string;
    rkey?: string;
    media_urls?: string[];
    video_url?: string;
  };
}

/**
 * Gold Standard Media Grid Item
 *
 * A square thumbnail that:
 * - Shows the first image/video from a post
 * - Displays overlay icons for galleries (multiple images) or videos
 * - Navigates to the Thread View on tap (Infinite Pivot)
 */
export function MediaGridItem({ item }: MediaGridItemProps) {
  const router = useRouter();
  const mediaCount = item.media_urls?.length || 0;
  const hasVideo = item.video_url != null;
  const firstMedia = item.media_urls?.[0];

  if (!firstMedia) return null;

  return (
    <Pressable
      onPress={() => {
        if (item.did && item.rkey) {
          router.push(`/post/${item.did}/${item.rkey}`);
        }
      }}
      className="p-[1px] active:opacity-80"
      style={{ width: '33.33%', aspectRatio: 1 }}
    >
      <Image
        source={{ uri: firstMedia }}
        className="w-full h-full bg-surface"
        contentFit="cover"
        placeholder={BLURHASH_NEUTRAL}
        transition={50}
      />

      {/* Indicator Overlays */}
      {(mediaCount > 1 || hasVideo) && (
        <View className="absolute top-2 right-2">
          {mediaCount > 1 && (
            <View className="bg-black/50 rounded p-1">
              <Layers size={14} color="white" />
            </View>
          )}
          {hasVideo && (
            <View className="bg-black/50 rounded p-1">
              <Play size={14} color="white" fill="white" />
            </View>
          )}
        </View>
      )}
    </Pressable>
  );
}

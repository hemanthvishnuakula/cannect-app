import React, { useState } from 'react';
import { View, Text } from 'react-native';
import { Image } from 'expo-image';
import { ImageOff } from 'lucide-react-native';
import { getPlaceholder } from '@/lib/utils/assets';

const MAX_HEIGHT = 500; // Prevent ultra-tall images from taking over the screen

interface PostMediaProps {
  uri: string;
  isFederated?: boolean;
}

export function PostMedia({ uri, isFederated = false }: PostMediaProps) {
  // Start with a safe 4:3 placeholder ratio (common photo aspect)
  const [aspectRatio, setAspectRatio] = useState(4 / 3);
  const [hasError, setHasError] = useState(false);

  return (
    <View 
      className="overflow-hidden rounded-2xl bg-surface/50 border border-border/50"
      style={{ 
        width: '100%', 
        aspectRatio: aspectRatio,
        maxHeight: MAX_HEIGHT 
      }}
    >
      {hasError ? (
        // ✅ Error fallback: Show placeholder when image fails to load
        <View className="flex-1 items-center justify-center bg-surface">
          <ImageOff size={32} color="#6B7280" />
          <Text className="text-text-muted text-xs mt-2">Image unavailable</Text>
        </View>
      ) : (
        <Image
          source={uri}
          style={{ width: '100%', height: '100%' }}
          contentFit="cover"
          placeholder={getPlaceholder(isFederated)}
          transition={300}
          cachePolicy="memory-disk"
          onLoad={(e) => {
            const { width, height } = e.source;
            if (width && height) {
              // ✅ Diamond Standard: Calculate exact aspect ratio
              setAspectRatio(width / height);
            }
          }}
          onError={() => setHasError(true)}
        />
      )}
    </View>
  );
}

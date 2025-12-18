import React, { useState } from 'react';
import { View, ScrollView, Pressable, NativeSyntheticEvent, NativeScrollEvent, useWindowDimensions, Platform } from 'react-native';
import * as Haptics from 'expo-haptics';
import { PostMedia } from './PostMedia';
import { MediaViewer } from '../ui/MediaViewer';

interface PostCarouselProps {
  mediaUrls: string[];
  isFederated?: boolean;
}

export function PostCarousel({ mediaUrls, isFederated = false }: PostCarouselProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(0);
  const { width: windowWidth } = useWindowDimensions();
  
  // Padding adjustment to match feed's horizontal margins (px-4 = 16px each side)
  const carouselWidth = windowWidth - 32; 

  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const scrollOffset = event.nativeEvent.contentOffset.x;
    const index = Math.round(scrollOffset / carouselWidth);
    if (index !== activeIndex) setActiveIndex(index);
  };

  const openViewer = (index: number) => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    setViewerIndex(index);
    setViewerOpen(true);
  };

  if (!mediaUrls || mediaUrls.length === 0) return null;

  // Single image: render directly without carousel overhead
  if (mediaUrls.length === 1) {
    return (
      <View className="mt-3">
        <Pressable onPress={() => openViewer(0)}>
          <PostMedia uri={mediaUrls[0]} isFederated={isFederated} />
        </Pressable>
        <MediaViewer
          isVisible={viewerOpen}
          images={mediaUrls}
          initialIndex={0}
          onClose={() => setViewerOpen(false)}
        />
      </View>
    );
  }

  // Multiple images: horizontal paging carousel
  return (
    <View className="mt-3">
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        decelerationRate="fast"
        snapToInterval={carouselWidth}
        disableIntervalMomentum
      >
        {mediaUrls.map((url, index) => (
          <Pressable 
            key={`${url}-${index}`} 
            style={{ width: carouselWidth }}
            onPress={() => openViewer(index)}
          >
            <PostMedia uri={url} isFederated={isFederated} />
          </Pressable>
        ))}
      </ScrollView>

      {/* Pagination Dots */}
      <View className="flex-row justify-center gap-1.5 mt-2">
        {mediaUrls.map((_, index) => (
          <View
            key={index}
            className={`h-1.5 rounded-full ${
              index === activeIndex ? "w-4 bg-primary" : "w-1.5 bg-border"
            }`}
          />
        ))}
      </View>

      {/* Fullscreen Media Viewer */}
      <MediaViewer
        isVisible={viewerOpen}
        images={mediaUrls}
        initialIndex={viewerIndex}
        onClose={() => setViewerOpen(false)}
      />
    </View>
  );
}

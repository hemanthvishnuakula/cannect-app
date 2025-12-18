import React, { useState, useRef, useCallback } from 'react';
import {
  Modal,
  View,
  Pressable,
  ScrollView,
  Dimensions,
  Text,
  NativeSyntheticEvent,
  NativeScrollEvent,
  StyleSheet,
} from 'react-native';
import { Image } from 'expo-image';
import { X, ChevronLeft, ChevronRight, Download } from 'lucide-react-native';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

interface MediaViewerProps {
  isVisible: boolean;
  images: string[];
  initialIndex: number;
  onClose: () => void;
}

/**
 * Web-compatible MediaViewer
 * Uses ScrollView instead of PagerView for Vercel compatibility
 */
export function MediaViewer({
  isVisible,
  images,
  initialIndex,
  onClose,
}: MediaViewerProps) {
  const [currentPage, setCurrentPage] = useState(initialIndex);
  const scrollRef = useRef<ScrollView>(null);

  // Reset state when modal opens
  React.useEffect(() => {
    if (isVisible) {
      setCurrentPage(initialIndex);
      setTimeout(() => {
        scrollRef.current?.scrollTo({ x: initialIndex * SCREEN_WIDTH, animated: false });
      }, 100);
    }
  }, [isVisible, initialIndex]);

  // ✅ Fix: Add keyboard navigation for web accessibility
  React.useEffect(() => {
    if (!isVisible) return;
    
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowLeft') {
        goToPrevious();
      } else if (e.key === 'ArrowRight') {
        goToNext();
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isVisible, onClose]);

  const handleScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const page = Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH);
    if (page !== currentPage && page >= 0 && page < images.length) {
      setCurrentPage(page);
    }
  }, [currentPage, images.length]);

  const handleDownload = useCallback(() => {
    // ✅ Fix: Proper download using blob for cross-origin images
    const imageUrl = images[currentPage];
    fetch(imageUrl)
      .then(res => res.blob())
      .then(blob => {
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `image_${Date.now()}.jpg`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href);
      })
      .catch(() => {
        // Fallback to opening in new tab
        window.open(imageUrl, '_blank');
      });
  }, [images, currentPage]);

  const goToPrevious = useCallback(() => {
    if (currentPage > 0) {
      const newPage = currentPage - 1;
      setCurrentPage(newPage);
      scrollRef.current?.scrollTo({ x: newPage * SCREEN_WIDTH, animated: true });
    }
  }, [currentPage]);

  const goToNext = useCallback(() => {
    if (currentPage < images.length - 1) {
      const newPage = currentPage + 1;
      setCurrentPage(newPage);
      scrollRef.current?.scrollTo({ x: newPage * SCREEN_WIDTH, animated: true });
    }
  }, [currentPage, images.length]);

  if (!images || images.length === 0) return null;

  return (
    <Modal
      visible={isVisible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.container}>
        {/* Header Controls */}
        <View style={styles.header}>
          {/* Page Counter */}
          {images.length > 1 && (
            <View style={styles.pageCounter}>
              <Text style={styles.pageCounterText}>
                {currentPage + 1} / {images.length}
              </Text>
            </View>
          )}

          <View style={styles.headerButtons}>
            {/* Download Button */}
            <Pressable
              onPress={handleDownload}
              style={styles.headerButton}
              accessibilityLabel="Download image"
            >
              <Download color="white" size={20} />
            </Pressable>

            {/* Close Button */}
            <Pressable
              onPress={onClose}
              style={styles.headerButton}
              accessibilityLabel="Close viewer"
            >
              <X color="white" size={24} />
            </Pressable>
          </View>
        </View>

        {/* Scrollable Images */}
        <ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onScroll={handleScroll}
          scrollEventThrottle={16}
          style={styles.scrollView}
        >
          {images.map((url, index) => (
            <View key={`${url}-${index}`} style={styles.page}>
              <Image
                source={url}
                style={styles.image}
                contentFit="contain"
                transition={300}
              />
            </View>
          ))}
        </ScrollView>

        {/* Navigation Arrows */}
        {images.length > 1 && (
          <>
            {currentPage > 0 && (
              <Pressable style={styles.navLeft} onPress={goToPrevious}>
                <ChevronLeft color="white" size={32} />
              </Pressable>
            )}
            {currentPage < images.length - 1 && (
              <Pressable style={styles.navRight} onPress={goToNext}>
                <ChevronRight color="white" size={32} />
              </Pressable>
            )}
          </>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.95)',
  },
  header: {
    position: 'absolute',
    top: 20,
    left: 20,
    right: 20,
    zIndex: 100,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  pageCounter: {
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  pageCounterText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '500',
  },
  headerButtons: {
    flexDirection: 'row',
    gap: 10,
  },
  headerButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  scrollView: {
    flex: 1,
  },
  page: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
    justifyContent: 'center',
    alignItems: 'center',
  },
  image: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT * 0.8,
  },
  navLeft: {
    position: 'absolute',
    left: 10,
    top: '50%',
    marginTop: -24,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 50,
  },
  navRight: {
    position: 'absolute',
    right: 10,
    top: '50%',
    marginTop: -24,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 50,
  },
});

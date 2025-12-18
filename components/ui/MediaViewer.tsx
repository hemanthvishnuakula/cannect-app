import React, { useState, useCallback, useRef } from 'react';
import {
  Modal,
  View,
  Pressable,
  StyleSheet,
  Dimensions,
  Alert,
  ActivityIndicator,
  Text,
  Platform,
  ScrollView,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native';
import { Image } from 'expo-image';
import { BlurView } from 'expo-blur';
import { X, Download, Check, ChevronLeft, ChevronRight } from 'lucide-react-native';

// Conditionally import native-only modules
const isNative = Platform.OS !== 'web';

// Dynamic imports for native-only modules
let PagerView: any = null;
let GestureHandlerRootView: any = View;
let MediaLibrary: any = null;
let FileSystem: any = null;
let Haptics: any = null;
let ZoomableImage: any = null;

if (isNative) {
  try {
    PagerView = require('react-native-pager-view').default;
    GestureHandlerRootView = require('react-native-gesture-handler').GestureHandlerRootView;
    MediaLibrary = require('expo-media-library');
    FileSystem = require('expo-file-system');
    Haptics = require('expo-haptics');
    ZoomableImage = require('./ZoomableImage').ZoomableImage;
  } catch (e) {
    console.warn('Native modules not available:', e);
  }
}

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

interface MediaViewerProps {
  isVisible: boolean;
  images: string[];
  initialIndex: number;
  onClose: () => void;
}

export function MediaViewer({
  isVisible,
  images,
  initialIndex,
  onClose,
}: MediaViewerProps) {
  const [currentPage, setCurrentPage] = useState(initialIndex);
  const [isSaving, setIsSaving] = useState(false);
  const [hasSaved, setHasSaved] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  // Reset state when modal opens with new images
  React.useEffect(() => {
    if (isVisible) {
      setCurrentPage(initialIndex);
      setHasSaved(false);
      // Scroll to initial position on web
      if (Platform.OS === 'web' && scrollRef.current) {
        setTimeout(() => {
          scrollRef.current?.scrollTo({ x: initialIndex * SCREEN_WIDTH, animated: false });
        }, 100);
      }
    }
  }, [isVisible, initialIndex]);

  const handleSave = useCallback(async () => {
    if (Platform.OS === 'web') {
      // Web: Open image in new tab for manual download
      window.open(images[currentPage], '_blank');
      return;
    }

    if (!MediaLibrary || !FileSystem || !Haptics) return;

    try {
      setIsSaving(true);
      const { status } = await MediaLibrary.requestPermissionsAsync();

      if (status !== 'granted') {
        Alert.alert(
          'Permission Required',
          'Please allow access to your photos to save images.'
        );
        return;
      }

      const imageUrl = images[currentPage];
      const filename = imageUrl.split('/').pop() || `image_${Date.now()}.jpg`;
      const fileUri = FileSystem.documentDirectory + filename;

      // Download the file to local storage
      const downloadRes = await FileSystem.downloadAsync(imageUrl, fileUri);

      // Save to the media library
      await MediaLibrary.saveToLibraryAsync(downloadRes.uri);

      // Success feedback
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setHasSaved(true);
      setTimeout(() => setHasSaved(false), 2500);
    } catch (error) {
      console.error('Error saving image:', error);
      Alert.alert('Error', 'Failed to save image. Please try again.');
      Haptics?.notificationAsync?.(Haptics.NotificationFeedbackType.Error);
    } finally {
      setIsSaving(false);
    }
  }, [images, currentPage]);

  const handlePageSelected = useCallback(
    (e: { nativeEvent: { position: number } }) => {
      setCurrentPage(e.nativeEvent.position);
      setHasSaved(false);
    },
    []
  );

  const handleWebScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const page = Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH);
    if (page !== currentPage) {
      setCurrentPage(page);
      setHasSaved(false);
    }
  }, [currentPage]);

  const handleSwipeDown = useCallback(() => {
    if (Haptics) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    onClose();
  }, [onClose]);

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

  const RootWrapper = isNative && GestureHandlerRootView ? GestureHandlerRootView : View;

  // Web-specific image component (no gestures)
  const WebImage = ({ uri }: { uri: string }) => (
    <View style={styles.page}>
      <Image
        source={uri}
        style={styles.webImage}
        contentFit="contain"
        transition={300}
      />
    </View>
  );

  return (
    <Modal
      visible={isVisible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <RootWrapper style={styles.gestureRoot}>
        <View style={styles.container}>
          {/* Blur Background - use dark overlay on web */}
          {isNative ? (
            <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} />
          ) : (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.95)' }]} />
          )}

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
              {/* Save Button */}
              <Pressable
                onPress={handleSave}
                disabled={isSaving || hasSaved}
                style={styles.headerButton}
                accessibilityLabel="Save image to gallery"
              >
                {isSaving ? (
                  <ActivityIndicator size="small" color="white" />
                ) : hasSaved ? (
                  <Check color="#10B981" size={20} />
                ) : (
                  <Download color="white" size={20} />
                )}
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

          {/* Paging Content - Platform specific */}
          {isNative && PagerView && ZoomableImage ? (
            <PagerView
              style={styles.pager}
              initialPage={initialIndex}
              onPageSelected={handlePageSelected}
              layoutDirection="ltr"
              overdrag
            >
              {images.map((url, index) => (
                <View key={`${url}-${index}`} style={styles.page}>
                  <ZoomableImage uri={url} onSwipeDown={handleSwipeDown} />
                </View>
              ))}
            </PagerView>
          ) : (
            // Web fallback: ScrollView with pagination
            <ScrollView
              ref={scrollRef}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onScroll={handleWebScroll}
              scrollEventThrottle={16}
              style={styles.pager}
            >
              {images.map((url, index) => (
                <WebImage key={`${url}-${index}`} uri={url} />
              ))}
            </ScrollView>
          )}

          {/* Web navigation arrows */}
          {Platform.OS === 'web' && images.length > 1 && (
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

          {/* Swipe Hint - native only */}
          {isNative && (
            <View style={styles.hintContainer}>
              <Text style={styles.hintText}>
                Pinch to zoom • Double-tap to toggle • Swipe down to close
              </Text>
            </View>
          )}
        </View>
      </RootWrapper>
    </Modal>
  );
}

const styles = StyleSheet.create({
  gestureRoot: {
    flex: 1,
  },
  container: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.95)',
  },
  header: {
    position: 'absolute',
    top: 50,
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
  pager: {
    flex: 1,
  },
  page: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    width: SCREEN_WIDTH,
  },
  webImage: {
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
  hintContainer: {
    position: 'absolute',
    bottom: 40,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  hintText: {
    color: 'rgba(255, 255, 255, 0.4)',
    fontSize: 12,
  },
});

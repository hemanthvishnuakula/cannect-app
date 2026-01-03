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
} from 'react-native';
import { BlurView } from 'expo-blur';
import PagerView from 'react-native-pager-view';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as MediaLibrary from 'expo-media-library';
import * as FileSystem from 'expo-file-system';
import * as Haptics from 'expo-haptics';
import { X, Download, Check } from 'lucide-react-native';
import { triggerImpact } from '@/lib/utils/haptics';

import { ZoomableImage } from './ZoomableImage';

const { width: _SCREEN_WIDTH } = Dimensions.get('window');

interface MediaViewerProps {
  isVisible: boolean;
  images: string[];
  initialIndex: number;
  onClose: () => void;
}

/**
 * Native MediaViewer with full gesture support
 * Uses PagerView, Reanimated gestures, and Haptics
 * This file is only loaded on iOS/Android (not web)
 */
export function MediaViewer({ isVisible, images, initialIndex, onClose }: MediaViewerProps) {
  const [currentPage, setCurrentPage] = useState(initialIndex);
  const [isSaving, setIsSaving] = useState(false);
  const [hasSaved, setHasSaved] = useState(false);
  const pagerRef = useRef<PagerView>(null);

  // ✅ Fix: Reset state AND scroll PagerView when modal opens
  React.useEffect(() => {
    if (isVisible) {
      setCurrentPage(initialIndex);
      setHasSaved(false);
      // Programmatically set page for re-opens
      setTimeout(() => {
        pagerRef.current?.setPage(initialIndex);
      }, 50);
    }
  }, [isVisible, initialIndex]);

  const handleSave = useCallback(async () => {
    try {
      setIsSaving(true);
      const { status } = await MediaLibrary.requestPermissionsAsync();

      if (status !== 'granted') {
        Alert.alert('Permission Required', 'Please allow access to your photos to save images.');
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
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setIsSaving(false);
    }
  }, [images, currentPage]);

  const handlePageSelected = useCallback((e: { nativeEvent: { position: number } }) => {
    setCurrentPage(e.nativeEvent.position);
    setHasSaved(false);
  }, []);

  const handleSwipeDown = useCallback(() => {
    triggerImpact('light');
    onClose();
  }, [onClose]);

  if (!images || images.length === 0) return null;

  return (
    <Modal
      visible={isVisible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <GestureHandlerRootView style={styles.gestureRoot}>
        <View style={styles.container}>
          {/* Blur Background */}
          <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} />

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

          {/* Native PagerView with Zoomable Images */}
          <PagerView
            ref={pagerRef}
            style={styles.pager}
            initialPage={initialIndex}
            onPageSelected={handlePageSelected}
            layoutDirection="ltr"
            overdrag
            offscreenPageLimit={1}
          >
            {images.map((url, index) => (
              <View key={`${url}-${index}`} style={styles.page}>
                <ZoomableImage uri={url} onSwipeDown={handleSwipeDown} />
              </View>
            ))}
          </PagerView>

          {/* Swipe Hint */}
          <View style={styles.hintContainer}>
            <Text style={styles.hintText}>
              Pinch to zoom • Double-tap to toggle • Swipe down to close
            </Text>
          </View>
        </View>
      </GestureHandlerRootView>
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

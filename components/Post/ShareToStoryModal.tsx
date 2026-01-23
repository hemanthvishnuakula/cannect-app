/**
 * ShareToStoryModal - Modal for sharing posts to Instagram Stories
 *
 * Features:
 * - Preview of the shareable card
 * - Capture card as image using react-native-view-shot
 * - Share to Instagram Stories via expo-sharing
 * - Fallback: download/share image for manual upload
 */

import { useRef, useState, useCallback } from 'react';
import { View, Text, Pressable, Modal, Platform, Alert, ActivityIndicator } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system';
import { X, Instagram, Download } from 'lucide-react-native';
import { ShareToStoryCard } from './ShareToStoryCard';
import { triggerImpact, triggerNotification } from '@/lib/utils/haptics';
import type { AppBskyFeedDefs } from '@atproto/api';

type PostView = AppBskyFeedDefs.PostView;

interface ShareToStoryModalProps {
  visible: boolean;
  onClose: () => void;
  post: PostView;
}

export function ShareToStoryModal({ visible, onClose, post }: ShareToStoryModalProps) {
  const cardRef = useRef<View>(null);
  const [isCapturing, setIsCapturing] = useState(false);

  const captureAndShare = useCallback(async () => {
    if (!cardRef.current) return;

    setIsCapturing(true);
    triggerImpact('medium');

    try {
      // Capture the card as an image
      const uri = await captureRef(cardRef, {
        format: 'png',
        quality: 1,
        result: 'tmpfile',
      });

      // Check if sharing is available
      const isAvailable = await Sharing.isAvailableAsync();
      
      if (isAvailable) {
        await Sharing.shareAsync(uri, {
          mimeType: 'image/png',
          dialogTitle: 'Share to Instagram Stories',
          UTI: 'public.png', // iOS specific
        });
        triggerNotification('success');
      } else {
        // Fallback for web or unsupported platforms
        if (Platform.OS === 'web') {
          // On web, trigger download
          const link = document.createElement('a');
          link.href = uri;
          link.download = `cannect-post-${Date.now()}.png`;
          link.click();
        } else {
          Alert.alert('Sharing not available', 'Please take a screenshot to share manually.');
        }
      }
    } catch (error) {
      console.error('[ShareToStory] Capture failed:', error);
      triggerNotification('error');
      if (Platform.OS === 'web') {
        window.alert('Failed to create shareable image. Please try again.');
      } else {
        Alert.alert('Error', 'Failed to create shareable image. Please try again.');
      }
    } finally {
      setIsCapturing(false);
      onClose();
    }
  }, [onClose]);

  // For web, we need a different approach using canvas
  const handleWebCapture = useCallback(async () => {
    if (Platform.OS !== 'web') {
      captureAndShare();
      return;
    }

    setIsCapturing(true);
    triggerImpact('medium');

    try {
      // On web, use html2canvas or dom-to-image
      // For now, we'll use react-native-view-shot which has web support
      const uri = await captureRef(cardRef, {
        format: 'png',
        quality: 1,
      });

      // Create download link
      const link = document.createElement('a');
      link.href = uri;
      link.download = `cannect-post-${Date.now()}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      triggerNotification('success');
    } catch (error) {
      console.error('[ShareToStory] Web capture failed:', error);
      triggerNotification('error');
      window.alert('Failed to create image. Please try taking a screenshot.');
    } finally {
      setIsCapturing(false);
      onClose();
    }
  }, [onClose]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View className="flex-1 bg-black/80 justify-center items-center">
        {/* Close button */}
        <Pressable
          onPress={onClose}
          className="absolute top-12 right-4 p-2 z-10"
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <X size={28} color="#FAFAFA" />
        </Pressable>

        {/* Preview Card */}
        <View className="items-center">
          <Text className="text-text-primary text-lg font-semibold mb-4">
            Share to Instagram Stories
          </Text>
          
          {/* The actual card that will be captured */}
          <View className="rounded-2xl overflow-hidden shadow-2xl" style={{ elevation: 10 }}>
            <ShareToStoryCard ref={cardRef} post={post} />
          </View>

          {/* Share Button */}
          <Pressable
            onPress={Platform.OS === 'web' ? handleWebCapture : captureAndShare}
            disabled={isCapturing}
            className={`mt-6 flex-row items-center px-8 py-4 rounded-full ${
              isCapturing ? 'bg-zinc-700' : 'bg-gradient-to-r from-pink-500 to-purple-500'
            }`}
            style={{
              backgroundColor: isCapturing ? '#3f3f46' : '#E1306C', // Instagram pink
            }}
          >
            {isCapturing ? (
              <ActivityIndicator size="small" color="#FAFAFA" />
            ) : (
              <>
                <Instagram size={22} color="#FAFAFA" />
                <Text className="text-white text-base font-semibold ml-2">
                  Share to Stories
                </Text>
              </>
            )}
          </Pressable>

          {/* Download option for web */}
          {Platform.OS === 'web' && (
            <Pressable
              onPress={handleWebCapture}
              disabled={isCapturing}
              className="mt-3 flex-row items-center px-6 py-3 rounded-full bg-zinc-800"
            >
              <Download size={18} color="#A1A1AA" />
              <Text className="text-text-muted text-sm ml-2">Download Image</Text>
            </Pressable>
          )}

          <Text className="text-text-muted text-xs mt-4 text-center px-8">
            The image will be saved and ready to share{'\n'}to Instagram Stories or other apps
          </Text>
        </View>
      </View>
    </Modal>
  );
}

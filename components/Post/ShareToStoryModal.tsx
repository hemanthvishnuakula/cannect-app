/**
 * ShareToStoryModal - Modal for sharing posts to Instagram Stories
 *
 * Simple flow:
 * 1. Show preview of shareable card
 * 2. One button: "Save & Share"
 * 3. Captures image and opens share sheet (mobile) or downloads (web)
 */

import { useRef, useState, useCallback } from 'react';
import { View, Text, Pressable, Modal, Platform, Alert, ActivityIndicator } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import { X, Download, Share2 } from 'lucide-react-native';
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

  const handleSaveAndShare = useCallback(async () => {
    if (!cardRef.current) return;

    setIsCapturing(true);
    triggerImpact('medium');

    // Longer delay to ensure fonts and images are fully rendered
    await new Promise((resolve) => setTimeout(resolve, 300));

    try {
      if (Platform.OS === 'web') {
        // Web: Download the image
        const uri = await captureRef(cardRef, {
          format: 'png',
          quality: 1,
          snapshotContentContainer: true,
        });

        const link = document.createElement('a');
        link.href = uri;
        link.download = `cannect-post-${Date.now()}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        triggerNotification('success');
      } else {
        // Mobile: Capture and share
        const uri = await captureRef(cardRef, {
          format: 'png',
          quality: 1,
          result: 'tmpfile',
          snapshotContentContainer: true,
        });

        const isAvailable = await Sharing.isAvailableAsync();

        if (isAvailable) {
          await Sharing.shareAsync(uri, {
            mimeType: 'image/png',
            dialogTitle: 'Share to Instagram Stories',
            UTI: 'public.png',
          });
          triggerNotification('success');
        } else {
          Alert.alert('Sharing not available', 'Please take a screenshot to share manually.');
        }
      }
    } catch (error) {
      console.error('[ShareToStory] Capture failed:', error);
      triggerNotification('error');
      if (Platform.OS === 'web') {
        window.alert('Failed to create image. Please try taking a screenshot.');
      } else {
        Alert.alert('Error', 'Failed to create image. Please try again.');
      }
    } finally {
      setIsCapturing(false);
      onClose();
    }
  }, [onClose]);

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View className="flex-1 bg-black/90 justify-center items-center px-4">
        {/* Close button */}
        <Pressable
          onPress={onClose}
          className="absolute top-12 right-4 w-10 h-10 items-center justify-center rounded-full bg-zinc-800"
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <X size={24} color="#FAFAFA" />
        </Pressable>

        {/* Title */}
        <Text className="text-text-primary text-lg font-semibold mb-4">Share to Stories</Text>

        {/* Preview Card */}
        <View
          className="rounded-2xl overflow-hidden"
          style={{
            shadowColor: '#10B981',
            shadowOffset: { width: 0, height: 0 },
            shadowOpacity: 0.3,
            shadowRadius: 20,
            elevation: 10,
          }}
        >
          <ShareToStoryCard ref={cardRef} post={post} />
        </View>

        {/* Single Action Button */}
        <Pressable
          onPress={handleSaveAndShare}
          disabled={isCapturing}
          className="mt-6 flex-row items-center justify-center px-8 py-4 rounded-full"
          style={{
            backgroundColor: isCapturing ? '#3f3f46' : '#10B981',
            minWidth: 200,
          }}
        >
          {isCapturing ? (
            <ActivityIndicator size="small" color="#FAFAFA" />
          ) : (
            <>
              {Platform.OS === 'web' ? (
                <Download size={20} color="#FAFAFA" />
              ) : (
                <Share2 size={20} color="#FAFAFA" />
              )}
              <Text className="text-white text-base font-semibold ml-2">
                {Platform.OS === 'web' ? 'Download Image' : 'Save & Share'}
              </Text>
            </>
          )}
        </Pressable>

        {/* Helper text */}
        <Text className="text-text-muted text-xs mt-4 text-center">
          {Platform.OS === 'web'
            ? 'Image will download, then upload to Instagram Stories'
            : 'Opens share menu to post to Instagram Stories'}
        </Text>
      </View>
    </Modal>
  );
}

import { Modal, View, Text, Pressable, Platform, Alert } from "react-native";
import { Trash2, Flag, Share2, Link } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import * as Clipboard from "expo-clipboard";
import { canShare, share } from "@/lib/utils/pwa-apis";
import * as atproto from "@/lib/atproto/agent";
import type { ReportReason } from "@/lib/atproto/agent";

interface PostOptionsMenuProps {
  isVisible: boolean;
  onClose: () => void;
  onDelete?: () => void;
  isOwnPost: boolean;
  postUrl?: string;
  postText?: string;
  authorHandle?: string;
  isReply?: boolean;
  postUri?: string;
  postCid?: string;
}

export function PostOptionsMenu({ 
  isVisible, 
  onClose, 
  onDelete,
  isOwnPost,
  postUrl,
  postText,
  authorHandle,
  isReply = false,
  postUri,
  postCid,
}: PostOptionsMenuProps) {
  
  // 💎 DIAMOND: Check if native share is available
  const canUseNativeShare = Platform.OS === 'web' && canShare();
  
  const handleDelete = () => {
    if (Platform.OS !== "web") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    }
    onDelete?.();
    onClose();
  };

  const handleCopyLink = async () => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    if (postUrl) {
      await Clipboard.setStringAsync(postUrl);
    }
    onClose();
  };

  // 💎 DIAMOND: Native Web Share API
  const handleNativeShare = async () => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    
    await share({
      title: authorHandle ? `Post by @${authorHandle}` : 'Post on Cannect',
      text: postText?.substring(0, 280) || '',
      url: postUrl || '',
    });
    
    onClose();
  };

  const showReportOptions = () => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    onClose();

    // Show report reason picker
    const reportReasons: { label: string; value: ReportReason }[] = [
      { label: 'Sexual Content', value: 'sexual' },
      { label: 'Spam', value: 'spam' },
      { label: 'Harassment/Rude', value: 'rude' },
      { label: 'Misleading', value: 'misleading' },
      { label: 'Violation of Terms', value: 'violation' },
      { label: 'Other', value: 'other' },
    ];

    if (Platform.OS === 'web') {
      // Web: use simple confirm dialog
      const reason = window.prompt(
        'Report this post?\n\nReasons:\n1. Sexual Content\n2. Spam\n3. Harassment\n4. Misleading\n5. Violation\n6. Other\n\nEnter number (1-6):'
      );
      
      if (reason) {
        const reasonMap: Record<string, ReportReason> = {
          '1': 'sexual',
          '2': 'spam', 
          '3': 'rude',
          '4': 'misleading',
          '5': 'violation',
          '6': 'other',
        };
        const selectedReason = reasonMap[reason];
        if (selectedReason && postUri && postCid) {
          submitReport(selectedReason);
        }
      }
    } else {
      // Native: use Alert with buttons
      Alert.alert(
        'Report Post',
        'Why are you reporting this content?',
        [
          ...reportReasons.map(r => ({
            text: r.label,
            onPress: () => submitReport(r.value),
          })),
          { text: 'Cancel', style: 'cancel' as const },
        ]
      );
    }
  };

  const submitReport = async (reason: ReportReason) => {
    if (!postUri || !postCid) {
      Alert.alert('Error', 'Unable to report this post');
      return;
    }

    try {
      await atproto.reportPost(postUri, postCid, reason);
      
      if (Platform.OS === 'web') {
        window.alert('Report submitted. Thank you for helping keep Cannect safe.');
      } else {
        Alert.alert('Report Submitted', 'Thank you for helping keep Cannect safe.');
      }
    } catch (error) {
      console.error('Failed to submit report:', error);
      if (Platform.OS === 'web') {
        window.alert('Failed to submit report. Please try again.');
      } else {
        Alert.alert('Error', 'Failed to submit report. Please try again.');
      }
    }
  };

  return (
    <Modal 
      visible={isVisible} 
      animationType="slide" 
      transparent
      statusBarTranslucent
      onRequestClose={onClose}
    >
      {/* Backdrop */}
      <Pressable 
        className="flex-1 bg-black/50" 
        onPress={onClose}
      />
      
      {/* Bottom Sheet */}
      <View className="bg-surface-elevated rounded-t-3xl pb-8 pt-2">
        {/* Handle Bar */}
        <View className="items-center py-3">
          <View className="w-10 h-1 bg-zinc-600 rounded-full" />
        </View>

        {/* Menu Options */}
        <View className="px-4 pb-4">
          {/* 💎 DIAMOND: Native Share Option - Only on Web with Share API */}
          {canUseNativeShare && postUrl && (
            <Pressable
              onPress={handleNativeShare}
              className="flex-row items-center gap-4 py-4 px-4 rounded-xl active:bg-zinc-800/50"
            >
              <View className="w-11 h-11 rounded-full bg-emerald-500/20 items-center justify-center">
                <Share2 size={22} color="#10B981" />
              </View>
              <View className="flex-1">
                <Text className="text-text-primary text-lg font-semibold">
                  Share
                </Text>
                <Text className="text-text-muted text-sm">
                  Share via apps on your device
                </Text>
              </View>
            </Pressable>
          )}

          {/* Copy Link Option */}
          {postUrl && (
            <Pressable
              onPress={handleCopyLink}
              className="flex-row items-center gap-4 py-4 px-4 rounded-xl active:bg-zinc-800/50"
            >
              <View className="w-11 h-11 rounded-full bg-zinc-800 items-center justify-center">
                <Link size={22} color="#FAFAFA" />
              </View>
              <View className="flex-1">
                <Text className="text-text-primary text-lg font-semibold">
                  Copy Link
                </Text>
                <Text className="text-text-muted text-sm">
                  Copy {isReply ? "reply" : "post"} link to clipboard
                </Text>
              </View>
            </Pressable>
          )}

          {/* Delete Option - Only for own posts */}
          {isOwnPost && onDelete && (
            <Pressable
              onPress={handleDelete}
              className="flex-row items-center gap-4 py-4 px-4 rounded-xl active:bg-zinc-800/50"
            >
              <View className="w-11 h-11 rounded-full bg-red-500/20 items-center justify-center">
                <Trash2 size={22} color="#EF4444" />
              </View>
              <View className="flex-1">
                <Text className="text-red-500 text-lg font-semibold">
                  {isReply ? "Delete Reply" : "Delete Post"}
                </Text>
                <Text className="text-text-muted text-sm">
                  Permanently remove this {isReply ? "reply" : "post"}
                </Text>
              </View>
            </Pressable>
          )}

          {/* Report Option - Only for other's posts */}
          {!isOwnPost && (
            <Pressable
              onPress={showReportOptions}
              className="flex-row items-center gap-4 py-4 px-4 rounded-xl active:bg-zinc-800/50"
            >
              <View className="w-11 h-11 rounded-full bg-zinc-800 items-center justify-center">
                <Flag size={22} color="#FAFAFA" />
              </View>
              <View className="flex-1">
                <Text className="text-text-primary text-lg font-semibold">
                  {isReply ? "Report Reply" : "Report Post"}
                </Text>
                <Text className="text-text-muted text-sm">
                  Report inappropriate content
                </Text>
              </View>
            </Pressable>
          )}
        </View>

        {/* Cancel Button */}
        <View className="px-4">
          <Pressable
            onPress={onClose}
            className="py-4 rounded-xl bg-zinc-800 items-center active:bg-zinc-700"
          >
            <Text className="text-text-primary font-semibold text-base">Cancel</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

import React, { useState } from "react";
import { View, Text, TextInput, Pressable, Platform, ActivityIndicator } from "react-native";
import { Image } from "expo-image";
import { Send, X, LogIn } from "lucide-react-native";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { useAuthStore } from "@/lib/stores";
import { BLURHASH_PLACEHOLDERS } from "@/lib/utils/assets";

interface ReplyBarProps {
  onSend: (text: string) => void;
  isPending?: boolean;
  placeholder?: string;
  /** When replying to a specific comment (nested thread) */
  replyTargetUsername?: string | null;
  onCancelTarget?: () => void;
  /** Initial text value (e.g., @mention) */
  initialText?: string;
}

/**
 * Diamond Standard Reply Bar
 * 
 * Features:
 * - Haptic feedback on send
 * - User avatar display
 * - Reply target indicator for nested replies
 * - Smooth keyboard integration
 */
export function ReplyBar({
  onSend,
  isPending = false,
  placeholder = "Post your reply...",
  replyTargetUsername,
  onCancelTarget,
  initialText = "",
}: ReplyBarProps) {
  const [text, setText] = useState(initialText);
  const { user, profile, isAuthenticated } = useAuthStore();
  const router = useRouter();

  // Update text when initialText changes (e.g., switching reply targets)
  React.useEffect(() => {
    setText(initialText);
  }, [initialText]);

  const handleSend = () => {
    if (!text.trim() || isPending) return;

    // ✅ Diamond Standard: Haptic success feedback
    if (Platform.OS !== "web") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }

    onSend(text.trim());
    setText("");
  };

  // Handle login navigation
  const handleLogin = () => {
    router.push("/login" as any);
  };

  const avatarUrl = profile?.avatar_url || 
    `https://ui-avatars.com/api/?name=${user?.email?.[0] || "U"}&background=10B981&color=fff`;

  const hasContent = text.trim().length > 0;

  // Show login prompt if not authenticated
  if (!isAuthenticated || !user) {
    return (
      <View className="border-t border-border bg-background px-4 py-4">
        <Pressable 
          onPress={handleLogin}
          className="flex-row items-center justify-center gap-2 bg-primary rounded-full py-3"
          style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}
        >
          <LogIn size={18} color="white" />
          <Text className="text-white font-semibold">Log in to reply</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View className="border-t border-border bg-background">
      {/* Reply target indicator - shows when replying to a specific comment */}
      {replyTargetUsername && (
        <View className="flex-row items-center justify-between px-4 py-2 bg-surface/50">
          <Text className="text-xs text-text-muted">
            Replying to <Text className="text-primary font-medium">@{replyTargetUsername}</Text>
          </Text>
          <Pressable 
            onPress={onCancelTarget}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <X size={16} color="#6B7280" />
          </Pressable>
        </View>
      )}

      <View className="px-4 py-3 flex-row items-center gap-3">
        {/* User avatar */}
        <Image
          source={{ uri: avatarUrl }}
          style={{ width: 32, height: 32, borderRadius: 16 }}
          contentFit="cover"
          placeholder={BLURHASH_PLACEHOLDERS.NEUTRAL}
          transition={200}
        />

        {/* Input field */}
        <View className="flex-1 bg-surface rounded-2xl px-4 py-2.5 border border-border/30">
          <TextInput
            className="text-text-primary text-[15px] max-h-32"
            placeholder={placeholder}
            placeholderTextColor="#6B7280"
            value={text}
            onChangeText={setText}
            multiline
            maxLength={280}
            editable={!isPending}
          />
        </View>

        {/* Send button */}
        <Pressable
          onPress={handleSend}
          disabled={!hasContent || isPending}
          className={`w-10 h-10 rounded-full items-center justify-center ${
            hasContent && !isPending ? "bg-primary" : "bg-muted"
          }`}
          style={({ pressed }) => ({
            opacity: pressed ? 0.8 : 1,
            transform: [{ scale: pressed ? 0.95 : 1 }],
          })}
        >
          {isPending ? (
            <ActivityIndicator size="small" color="white" />
          ) : (
            <Send size={18} color={hasContent ? "white" : "#6B7280"} />
          )}
        </Pressable>
      </View>
    </View>
  );
}

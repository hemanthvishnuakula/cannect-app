import { useEffect, useRef } from "react";
import { View, Animated, type ViewProps } from "react-native";
import { cn } from "@/lib/utils";

/**
 * Gold Standard Skeleton Component
 * 
 * A shimmering placeholder component for loading states.
 * Provides visual feedback that content is loading.
 */

interface SkeletonProps extends ViewProps {
  /** Width of the skeleton (number or string like '100%') */
  width?: number | string;
  /** Height of the skeleton */
  height?: number | string;
  /** Border radius */
  radius?: number | "full" | "sm" | "md" | "lg" | "xl";
}

export function Skeleton({ 
  width = "100%", 
  height = 20, 
  radius = "md",
  className,
  style,
  ...props 
}: SkeletonProps) {
  const shimmerAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmerAnim, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(shimmerAnim, {
          toValue: 0,
          duration: 1000,
          useNativeDriver: true,
        }),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, [shimmerAnim]);

  const opacity = shimmerAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.3, 0.7],
  });

  const getBorderRadius = () => {
    if (typeof radius === "number") return radius;
    switch (radius) {
      case "full": return 9999;
      case "sm": return 4;
      case "md": return 8;
      case "lg": return 12;
      case "xl": return 16;
      default: return 8;
    }
  };

  return (
    <Animated.View
      className={cn("bg-muted", className)}
      style={[
        {
          width,
          height,
          borderRadius: getBorderRadius(),
          opacity,
        },
        style,
      ]}
      {...props}
    />
  );
}

/**
 * Skeleton Group - Common loading patterns
 */
export function SkeletonText({ lines = 3 }: { lines?: number }) {
  return (
    <View className="gap-2">
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton 
          key={i} 
          height={14} 
          width={i === lines - 1 ? "60%" : "100%"} 
        />
      ))}
    </View>
  );
}

export function SkeletonAvatar({ size = 48 }: { size?: number }) {
  return <Skeleton width={size} height={size} radius="full" />;
}

export function SkeletonCard() {
  return (
    <View className="p-4 gap-3 border-b border-border">
      <View className="flex-row gap-3 items-center">
        <SkeletonAvatar />
        <View className="flex-1 gap-2">
          <Skeleton height={14} width="40%" />
          <Skeleton height={12} width="25%" />
        </View>
      </View>
      <SkeletonText lines={2} />
    </View>
  );
}

/**
 * Profile Skeleton - Loading state for profile pages
 */
export function SkeletonProfile() {
  return (
    <View className="bg-background">
      {/* Cover Image */}
      <Skeleton height={128} radius={0} />
      
      <View className="px-4">
        {/* Avatar overlapping cover */}
        <View className="-mt-10 mb-3">
          <SkeletonAvatar size={80} />
        </View>
        
        {/* Name and username */}
        <View className="gap-2 mb-4">
          <Skeleton height={24} width="50%" />
          <Skeleton height={16} width="30%" />
        </View>
        
        {/* Bio */}
        <View className="mb-4">
          <SkeletonText lines={2} />
        </View>
        
        {/* Stats */}
        <View className="flex-row gap-4 mb-4">
          <Skeleton height={16} width={80} />
          <Skeleton height={16} width={80} />
        </View>
        
        {/* Tabs */}
        <View className="flex-row border-b border-border py-3">
          <Skeleton height={16} width="33%" />
          <Skeleton height={16} width="33%" />
          <Skeleton height={16} width="33%" />
        </View>
      </View>
    </View>
  );
}

import { View, Text } from 'react-native';
import { Image } from 'expo-image';

interface AvatarProps {
  url?: string | null;
  name: string;
  size?: number;
}

export function Avatar({ url, name, size = 40 }: AvatarProps) {
  const initials = name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  if (url) {
    return (
      <Image
        source={{ uri: url }}
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
        }}
        contentFit="cover"
        transition={50}
        priority="high"
        cachePolicy="memory-disk"
        recyclingKey={url}
      />
    );
  }

  // Generate a consistent color based on the name
  const colors = [
    '#10B981', // Primary green
    '#059669', // Dark green
    '#34D399', // Light green
    '#3B82F6', // Blue
    '#8B5CF6', // Purple
    '#EC4899', // Pink
    '#F59E0B', // Amber
  ];
  const colorIndex = name.charCodeAt(0) % colors.length;
  const backgroundColor = colors[colorIndex];

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor,
      }}
      className="items-center justify-center"
    >
      <Text style={{ fontSize: size * 0.4 }} className="text-white font-semibold">
        {initials}
      </Text>
    </View>
  );
}

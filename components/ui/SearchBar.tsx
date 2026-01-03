/**
 * SearchBar - Reusable search input with icon and clear button
 */

import { View, TextInput, Pressable } from 'react-native';
import { Search, X } from 'lucide-react-native';

export interface SearchBarProps {
  value: string;
  onChangeText: (text: string) => void;
  onClear?: () => void;
  placeholder?: string;
  autoFocus?: boolean;
}

export function SearchBar({
  value,
  onChangeText,
  onClear,
  placeholder = 'Search...',
  autoFocus = false,
}: SearchBarProps) {
  const handleClear = () => {
    onChangeText('');
    onClear?.();
  };

  return (
    <View className="px-4 py-2 border-b border-border">
      <View className="flex-row items-center bg-surface rounded-full px-4 py-2">
        <Search size={18} color="#6B7280" />
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor="#6B7280"
          className="flex-1 ml-2 text-text-primary"
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus={autoFocus}
        />
        {value.length > 0 && (
          <Pressable onPress={handleClear} className="p-1">
            <X size={18} color="#6B7280" />
          </Pressable>
        )}
      </View>
    </View>
  );
}

import { createContext, useContext } from 'react';
import { View, Text, Pressable, type ViewProps, type PressableProps } from 'react-native';
import { cn } from '@/lib/utils';
import { triggerImpact } from '@/lib/utils/haptics';

/**
 * Platinum Standard Tabs Component
 *
 * A accessible, haptic-enabled tab navigation component following
 * the React Native Reusables pattern.
 *
 * expo-haptics is Web-safe - it simply does nothing on Web without crashing.
 */

// Context for sharing state between Tabs primitives
interface TabsContextValue {
  value: string;
  onValueChange: (value: string) => void;
}

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabsContext() {
  const context = useContext(TabsContext);
  if (!context) {
    throw new Error('Tabs components must be used within a Tabs provider');
  }
  return context;
}

// Root Component
interface TabsProps extends ViewProps {
  value: string;
  onValueChange: (value: string) => void;
  children: React.ReactNode;
}

export function Tabs({ value, onValueChange, children, className, ...props }: TabsProps) {
  return (
    <TabsContext.Provider value={{ value, onValueChange }}>
      <View className={cn('w-full', className)} {...props}>
        {children}
      </View>
    </TabsContext.Provider>
  );
}

// Tab List Container
interface TabsListProps extends ViewProps {
  children: React.ReactNode;
}

export function TabsList({ children, className, ...props }: TabsListProps) {
  return (
    <View
      className={cn('flex-row border-b border-border bg-background', className)}
      role="tablist"
      {...props}
    >
      {children}
    </View>
  );
}

// Individual Tab Trigger
interface TabsTriggerProps extends Omit<PressableProps, 'onPress'> {
  value: string;
  children: React.ReactNode;
}

export function TabsTrigger({ value, children, className, disabled, ...props }: TabsTriggerProps) {
  const { value: activeValue, onValueChange } = useTabsContext();
  const isActive = activeValue === value;

  const handlePress = () => {
    if (disabled) return;

    // Haptic feedback on tab change
    triggerImpact('light');

    onValueChange(value);
  };

  return (
    <Pressable
      role="tab"
      accessibilityState={{ selected: isActive }}
      onPress={handlePress}
      disabled={disabled}
      className={cn(
        'flex-1 items-center justify-center py-3 border-b-2',
        isActive ? 'border-primary' : 'border-transparent',
        disabled && 'opacity-50',
        className
      )}
      {...props}
    >
      {typeof children === 'string' ? (
        <Text
          className={cn(
            'text-sm font-semibold',
            isActive ? 'text-text-primary' : 'text-text-muted'
          )}
        >
          {children}
        </Text>
      ) : (
        children
      )}
    </Pressable>
  );
}

// Tab Content Panel (optional, for controlled content switching)
interface TabsContentProps extends ViewProps {
  value: string;
  children: React.ReactNode;
}

export function TabsContent({ value, children, className, ...props }: TabsContentProps) {
  const { value: activeValue } = useTabsContext();

  if (activeValue !== value) return null;

  return (
    <View role="tabpanel" className={cn('flex-1', className)} {...props}>
      {children}
    </View>
  );
}

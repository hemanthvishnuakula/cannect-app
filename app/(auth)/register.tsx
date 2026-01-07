import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { Link, router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Mail, Lock, Eye, EyeOff, User } from 'lucide-react-native';
import { useCreateAccount } from '@/lib/hooks';

export default function RegisterScreen() {
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createAccount = useCreateAccount();

  const handleRegister = async () => {
    setError(null);

    if (!username || !email || !password) {
      setError('Please fill in all required fields');
      return;
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    // Validate username for AT Protocol (3-20 chars, alphanumeric and hyphens)
    const normalizedUsername = username.toLowerCase().replace(/[^a-z0-9-]/g, '');
    if (normalizedUsername.length < 3) {
      setError('Username must be at least 3 characters (letters, numbers, hyphens only)');
      return;
    }

    try {
      await createAccount.mutateAsync({
        email,
        password,
        handle: normalizedUsername,
        displayName: displayName.trim() || normalizedUsername,
      });

      // Success - redirect to feed
      router.replace('/(tabs)/feed');
    } catch (err: any) {
      // Parse AT Protocol errors
      const message = err.message || 'Failed to create account';

      if (message.includes('Handle already taken')) {
        setError('This username is already taken. Please choose another.');
      } else if (message.includes('Email already exists')) {
        setError('An account with this email already exists.');
      } else {
        setError(message);
      }
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-background">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        className="flex-1"
      >
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ flexGrow: 1 }}
          keyboardShouldPersistTaps="handled"
        >
          <View className="px-6 pt-4">
            <Pressable
              onPress={() => router.back()}
              className="w-10 h-10 rounded-full bg-surface-elevated items-center justify-center"
            >
              <ArrowLeft size={20} color="#FAFAFA" />
            </Pressable>
          </View>

          <View className="flex-1 px-6 pt-8">
            <Text className="text-3xl font-bold text-text-primary mb-2">Create Account</Text>
            <Text className="text-text-secondary mb-8 text-base">Join Cannect today</Text>

            {error && (
              <View className="bg-accent-error/20 border border-accent-error/50 rounded-xl p-4 mb-6">
                <Text className="text-accent-error text-center">{error}</Text>
              </View>
            )}

            <View className="gap-4">
              {/* Display Name */}
              <View className="bg-surface-elevated border border-border rounded-xl flex-row items-center px-4">
                <User size={20} color="#6B6B6B" />
                <TextInput
                  placeholder="Display Name (e.g. John Doe)"
                  placeholderTextColor="#6B6B6B"
                  value={displayName}
                  onChangeText={setDisplayName}
                  autoCapitalize="words"
                  autoCorrect={false}
                  className="flex-1 py-4 px-3 text-text-primary text-base"
                />
              </View>

              {/* Username */}
              <View className="bg-surface-elevated border border-border rounded-xl flex-row items-center px-4">
                <Text className="text-text-muted text-lg font-medium">@</Text>
                <TextInput
                  placeholder="Username"
                  placeholderTextColor="#6B6B6B"
                  value={username}
                  onChangeText={setUsername}
                  autoCapitalize="none"
                  autoCorrect={false}
                  className="flex-1 py-4 px-3 text-text-primary text-base"
                />
              </View>

              {/* Email */}
              <View className="bg-surface-elevated border border-border rounded-xl flex-row items-center px-4">
                <Mail size={20} color="#6B6B6B" />
                <TextInput
                  placeholder="Email address"
                  placeholderTextColor="#6B6B6B"
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  autoCorrect={false}
                  className="flex-1 py-4 px-3 text-text-primary text-base"
                />
              </View>

              {/* Password */}
              <View className="bg-surface-elevated border border-border rounded-xl flex-row items-center px-4">
                <Lock size={20} color="#6B6B6B" />
                <TextInput
                  placeholder="Password (min 8 characters)"
                  placeholderTextColor="#6B6B6B"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                  className="flex-1 py-4 px-3 text-text-primary text-base"
                />
                <Pressable onPress={() => setShowPassword(!showPassword)}>
                  {showPassword ? (
                    <EyeOff size={20} color="#6B6B6B" />
                  ) : (
                    <Eye size={20} color="#6B6B6B" />
                  )}
                </Pressable>
              </View>
            </View>
          </View>

          <View className="px-6 pb-8">
            <Pressable
              onPress={handleRegister}
              disabled={createAccount.isPending}
              className={`py-4 rounded-2xl bg-primary ${createAccount.isPending ? 'opacity-50' : ''}`}
            >
              {createAccount.isPending ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text className="text-white text-center font-semibold text-lg">Create Account</Text>
              )}
            </Pressable>

            <View className="flex-row justify-center mt-6">
              <Text className="text-text-secondary">Already have an account? </Text>
              <Link href="/(auth)/login" asChild>
                <Pressable>
                  <Text className="text-primary font-semibold">Sign In</Text>
                </Pressable>
              </Link>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

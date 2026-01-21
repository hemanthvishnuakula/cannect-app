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
import { ArrowLeft, Mail, Lock, Eye, EyeOff } from 'lucide-react-native';
import { useLogin } from '@/lib/hooks';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const login = useLogin();

  const handleLogin = async () => {
    setError(null);
    if (!email || !password) {
      setError('Please fill in all fields');
      return;
    }

    try {
      await login.mutateAsync({ identifier: email, password });
      router.replace('/(tabs)/feed');
    } catch (err: any) {
      setError(err.message || 'Failed to sign in');
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
            <Text className="text-3xl font-bold text-text-primary mb-2">Welcome back</Text>
            <Text className="text-text-secondary mb-8 text-base">
              Sign in to your Cannect account
            </Text>
            {error && (
              <View className="bg-accent-error/20 border border-accent-error/50 rounded-xl p-4 mb-6">
                <Text className="text-accent-error text-center">{error}</Text>
              </View>
            )}
            <View className="gap-4">
              <View className="bg-surface-elevated border border-border rounded-xl flex-row items-center px-4">
                <Mail size={20} color="#6B6B6B" />
                <TextInput
                  placeholder="Email"
                  placeholderTextColor="#6B6B6B"
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  autoComplete="email"
                  className="flex-1 py-4 px-3 text-text-primary text-base"
                />
              </View>
              <View className="bg-surface-elevated border border-border rounded-xl flex-row items-center px-4">
                <Lock size={20} color="#6B6B6B" />
                <TextInput
                  placeholder="Password"
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
              <Link href="/(auth)/forgot-password" asChild>
                <Pressable className="self-end">
                  <Text className="text-primary text-sm">Forgot password?</Text>
                </Pressable>
              </Link>
              <Text className="text-text-muted text-xs text-center mt-2">
                ★ We've migrated to a new system. Simply reset your password to continue.
              </Text>
            </View>
          </View>
          <View className="px-6 pb-8">
            <Pressable
              onPress={handleLogin}
              disabled={login.isPending}
              className={`py-4 rounded-2xl bg-primary ${login.isPending ? 'opacity-50' : ''}`}
            >
              {login.isPending ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text className="text-white text-center font-semibold text-lg">Sign In</Text>
              )}
            </Pressable>
            <View className="flex-row justify-center mt-6">
              <Text className="text-text-secondary">Don't have an account? </Text>
              <Link href="/(auth)/register" asChild>
                <Pressable>
                  <Text className="text-primary font-semibold">Create Account</Text>
                </Pressable>
              </Link>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

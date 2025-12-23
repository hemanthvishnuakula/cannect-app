import { useState } from "react";
import {
  View, Text, TextInput, Pressable, KeyboardAvoidingView,
  Platform, ScrollView, ActivityIndicator,
} from "react-native";
import { Link, router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { ArrowLeft, User, Mail, Lock, Eye, EyeOff, Globe } from "lucide-react-native";
import { useFederatedSignUp } from "@/lib/hooks/use-federated-auth";

export default function RegisterScreen() {
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [federationResult, setFederationResult] = useState<{ 
    did?: string; 
    handle?: string;
    federationError?: string;
  } | null>(null);
  const signUp = useFederatedSignUp();

  const handleRegister = async () => {
    setError(null);
    if (!name || !username || !email || !password) { setError("Please fill in all fields"); return; }
    if (password.length < 6) { setError("Password must be at least 6 characters"); return; }
    
    // Validate username for AT Protocol (3-20 chars, alphanumeric and hyphens)
    const normalizedUsername = username.toLowerCase().replace(/[^a-z0-9-]/g, '');
    if (normalizedUsername.length < 3) {
      setError("Username must be at least 3 characters (letters, numbers, hyphens only)");
      return;
    }
    
    try {
      const result = await signUp.mutateAsync({ 
        email, 
        password, 
        username: normalizedUsername,
        displayName: name,
      });
      
      // Store federation result for display
      setFederationResult({
        did: (result as any).did,
        handle: (result as any).handle,
        federationError: (result as any).federationError,
      });
      
      // Check if email confirmation is required
      if (result.needsEmailConfirmation) {
        setShowConfirmation(true);
      } else {
        router.replace("/(tabs)/feed");
      }
    } catch (err: any) { setError(err.message || "Failed to create account"); }
  };

  // Show confirmation screen
  if (showConfirmation) {
    return (
      <SafeAreaView className="flex-1 bg-background">
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-4xl mb-4">✉️</Text>
          <Text className="text-2xl font-bold text-text-primary mb-4 text-center">Check your email</Text>
          <Text className="text-text-secondary text-center mb-6">
            We've sent a confirmation link to{"\n"}
            <Text className="text-primary font-semibold">{email}</Text>
          </Text>
          
          {/* Federation status */}
          {federationResult?.handle && (
            <View className="bg-surface-elevated border border-primary/30 rounded-xl p-4 mb-4 w-full">
              <View className="flex-row items-center mb-2">
                <Globe size={16} color="#10B981" />
                <Text className="text-primary font-semibold ml-2">Federated to Bluesky</Text>
              </View>
              <Text className="text-text-secondary text-sm">
                Your handle: <Text className="text-text-primary font-mono">@{federationResult.handle}</Text>
              </Text>
              <Text className="text-text-muted text-xs mt-1">
                Your posts will be visible on Bluesky and other AT Protocol apps!
              </Text>
            </View>
          )}
          
          {federationResult?.federationError && (
            <View className="bg-accent-warning/20 border border-accent-warning/50 rounded-xl p-4 mb-4 w-full">
              <Text className="text-accent-warning text-sm text-center">
                Federation pending - you can enable it later in Settings
              </Text>
            </View>
          )}
          
          <Text className="text-text-muted text-center text-sm mb-8">
            Click the link in your email to activate your account, then come back and sign in.
          </Text>
          <Pressable 
            onPress={() => router.replace("/(auth)/login")}
            className="bg-primary px-8 py-4 rounded-2xl"
          >
            <Text className="text-white font-semibold text-lg">Go to Sign In</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-background">
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} className="flex-1">
        <ScrollView className="flex-1" contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">
          <View className="px-6 pt-4">
            <Pressable onPress={() => router.back()} className="w-10 h-10 rounded-full bg-surface-elevated items-center justify-center">
              <ArrowLeft size={20} color="#FAFAFA" />
            </Pressable>
          </View>
          <View className="flex-1 px-6 pt-8">
            <Text className="text-3xl font-bold text-text-primary mb-2">Create Account</Text>
            <Text className="text-text-secondary mb-4 text-base">Join Cannect today</Text>
            
            {/* Federation badge */}
            <View className="flex-row items-center bg-primary/10 border border-primary/30 rounded-xl px-4 py-3 mb-6">
              <Globe size={16} color="#10B981" />
              <Text className="text-text-secondary text-sm ml-2 flex-1">
                Your account federates to <Text className="text-primary font-semibold">Bluesky</Text> automatically
              </Text>
            </View>
            
            {error && (
              <View className="bg-accent-error/20 border border-accent-error/50 rounded-xl p-4 mb-6">
                <Text className="text-accent-error text-center">{error}</Text>
              </View>
            )}
            <View className="gap-4">
              <View className="bg-surface-elevated border border-border rounded-xl flex-row items-center px-4">
                <User size={20} color="#6B6B6B" />
                <TextInput 
                  placeholder="Full name" 
                  placeholderTextColor="#6B6B6B" 
                  value={name}
                  onChangeText={setName} 
                  autoCapitalize="words" 
                  className="flex-1 py-4 px-3 text-text-primary text-base" 
                />
              </View>
              <View className="bg-surface-elevated border border-border rounded-xl flex-row items-center px-4">
                <Text className="text-text-muted text-lg font-medium">@</Text>
                <TextInput 
                  placeholder="Username" 
                  placeholderTextColor="#6B6B6B" 
                  value={username}
                  onChangeText={setUsername} 
                  autoCapitalize="none" 
                  className="flex-1 py-4 px-3 text-text-primary text-base" 
                />
              </View>
              <View className="bg-surface-elevated border border-border rounded-xl flex-row items-center px-4">
                <Mail size={20} color="#6B6B6B" />
                <TextInput 
                  placeholder="Email address" 
                  placeholderTextColor="#6B6B6B" 
                  value={email}
                  onChangeText={setEmail} 
                  autoCapitalize="none" 
                  keyboardType="email-address" 
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
                  {showPassword ? <EyeOff size={20} color="#6B6B6B" /> : <Eye size={20} color="#6B6B6B" />}
                </Pressable>
              </View>
            </View>
          </View>
          <View className="px-6 pb-8">
            <Pressable 
              onPress={handleRegister} 
              disabled={signUp.isPending} 
              className={`py-4 rounded-2xl bg-primary ${signUp.isPending ? 'opacity-50' : ''}`}
            >
              {signUp.isPending ? (
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

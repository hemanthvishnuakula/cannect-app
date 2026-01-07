/**
 * AT Protocol Auth Hook
 *
 * Pure AT Protocol authentication - no Supabase.
 * Uses @atproto/api directly for login/logout.
 */

import { useEffect, useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Sentry from '@sentry/react-native';
import { useAuthStore } from '@/lib/stores/auth-store-atp';
import * as atproto from '@/lib/atproto/agent';

/**
 * Main auth hook - handles session initialization and auth state
 */
export function useAuth() {
  const {
    session,
    profile,
    isLoading,
    isAuthenticated,
    did,
    handle,
    setSession,
    setProfile,
    setLoading,
    clear,
  } = useAuthStore();

  const queryClient = useQueryClient();

  // Subscribe to session expiry events
  useEffect(() => {
    console.log('[useAuth] Setting up session expiry listener');
    const unsubscribe = atproto.onSessionExpired(() => {
      console.log('[useAuth] 🔴 Session expired callback fired - clearing all state');
      clear();
      queryClient.clear();
    });

    return () => {
      console.log('[useAuth] Cleaning up session expiry listener');
      unsubscribe();
    };
  }, [clear, queryClient]);

  // Initialize agent and restore session on mount
  useEffect(() => {
    let mounted = true;
    console.log('[useAuth] Mounting, initializing agent...');

    async function init() {
      try {
        const agent = await atproto.initializeAgent();
        console.log(
          '[useAuth] Agent initialized, session:',
          agent.session ? `did:${agent.session.did?.substring(8, 20)}` : 'none'
        );
        if (mounted && agent.session) {
          console.log('[useAuth] ✅ Setting session in store');
          setSession(agent.session);
        } else if (mounted) {
          console.log('[useAuth] No session, setting loading=false');
          setLoading(false);
        }
      } catch (err) {
        console.error('[useAuth] ❌ Failed to initialize auth:', err);
        if (mounted) {
          setLoading(false);
        }
      }
    }

    init();

    return () => {
      mounted = false;
    };
  }, [setSession, setLoading]);

  // Fetch profile when authenticated
  const { data: profileData } = useQuery({
    queryKey: ['profile', 'self', did],
    queryFn: async () => {
      if (!did) return null;
      const result = await atproto.getProfile(did);
      return result.data;
    },
    enabled: !!did && isAuthenticated,
    staleTime: 1000 * 60 * 5,
  });

  // Update profile in store when fetched
  useEffect(() => {
    if (profileData) {
      setProfile({
        did: profileData.did,
        handle: profileData.handle,
        displayName: profileData.displayName,
        description: profileData.description,
        avatar: profileData.avatar,
        banner: profileData.banner,
        followersCount: profileData.followersCount,
        followsCount: profileData.followsCount,
        postsCount: profileData.postsCount,
      });

      // 🔐 Set Sentry user context for error tracking
      Sentry.setUser({
        id: profileData.did,
        username: profileData.handle,
      });
    }
  }, [profileData, setProfile]);

  const logout = useCallback(async () => {
    await atproto.logout();
    clear();
    queryClient.clear();
    // 🔐 Clear Sentry user context on logout
    Sentry.setUser(null);
  }, [clear, queryClient]);

  return {
    session,
    profile,
    isLoading,
    isAuthenticated,
    did,
    handle,
    user: session ? { id: did, email: null } : null, // Compatibility shim
    logout,
  };
}

/**
 * Login mutation
 */
export function useLogin() {
  const { setSession, setLoading } = useAuthStore();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ identifier, password }: { identifier: string; password: string }) => {
      setLoading(true);
      await atproto.login(identifier, password);
      const session = atproto.getSession();
      if (!session) {
        throw new Error('Login failed - no session returned');
      }
      return session;
    },
    onSuccess: (session) => {
      // Reset expiry notification state on successful login
      atproto.resetExpiryState();
      setSession(session);
      queryClient.invalidateQueries();
    },
    onError: (error) => {
      setLoading(false);
      console.error('Login failed:', error);
    },
  });
}

/**
 * Logout mutation
 */
export function useLogout() {
  const { clear } = useAuthStore();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      await atproto.logout();
    },
    onSuccess: () => {
      clear();
      queryClient.clear();
    },
  });
}

/**
 * Create account mutation
 */
export function useCreateAccount() {
  const { setSession, setLoading } = useAuthStore();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      email,
      password,
      handle,
      displayName,
      inviteCode,
    }: {
      email: string;
      password: string;
      handle: string;
      displayName?: string;
      inviteCode?: string;
    }) => {
      setLoading(true);
      const result = await atproto.createAccount({ email, password, handle, displayName, inviteCode });
      const session = atproto.getSession();
      if (!session) {
        throw new Error('Account created but no session returned');
      }
      return { ...result, session };
    },
    onSuccess: ({ session }) => {
      setSession(session);
      queryClient.invalidateQueries();
    },
    onError: (error) => {
      setLoading(false);
      console.error('Create account failed:', error);
    },
  });
}

/**
 * Get current user's DID
 */
export function useCurrentDid() {
  const { did } = useAuthStore();
  return did;
}

/**
 * Check if user is authenticated
 */
export function useIsAuthenticated() {
  const { isAuthenticated, isLoading } = useAuthStore();
  return { isAuthenticated, isLoading };
}

/**
 * Check if an email exists on the legacy PDS (cannect.space)
 * Used to prevent duplicate accounts when user already has an account on old PDS
 */
export async function checkEmailExistsOnLegacyPds(email: string): Promise<boolean> {
  try {
    // Try to request password reset - if it succeeds or gives specific error, email exists
    const response = await fetch('https://cannect.space/xrpc/com.atproto.server.requestPasswordReset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    
    // 200 = email exists and reset email sent
    // 400 with "Account not found" = email doesn't exist
    if (response.ok) {
      return true; // Email exists
    }
    
    const data = await response.json().catch(() => ({}));
    // If we get "Account not found" or similar, the email doesn't exist
    if (data.message?.toLowerCase().includes('not found') || 
        data.message?.toLowerCase().includes('no account')) {
      return false;
    }
    
    // For other errors (rate limit, etc), assume email might exist to be safe
    // But don't block registration for transient errors
    console.warn('[checkEmailExistsOnLegacyPds] Unexpected response:', data);
    return false;
  } catch (err) {
    console.warn('[checkEmailExistsOnLegacyPds] Error checking email:', err);
    // On network error, don't block registration
    return false;
  }
}

/**
 * Check if a username exists on the legacy PDS (cannect.space)
 * Ensures username uniqueness across all our PDS instances for future migration
 */
export async function checkUsernameExistsOnLegacyPds(username: string): Promise<boolean> {
  try {
    // Build the full handle for legacy PDS
    const handle = `${username.toLowerCase()}.cannect.space`;
    
    // Try to resolve the handle
    const response = await fetch(
      `https://cannect.space/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`
    );
    
    if (response.ok) {
      // Handle exists and resolved to a DID
      return true;
    }
    
    // 400 with "Unable to resolve handle" = doesn't exist
    return false;
  } catch (err) {
    console.warn('[checkUsernameExistsOnLegacyPds] Error checking username:', err);
    // On network error, don't block registration
    return false;
  }
}

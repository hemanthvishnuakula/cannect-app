import React, { Component, ReactNode } from 'react';
import { View, Text, Pressable, Platform, StyleSheet } from 'react-native';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react-native';
import * as Sentry from '@sentry/react-native';
import { logger } from '@/lib/utils/logger';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * ErrorBoundary - Catches React errors and shows recovery UI
 * 
 * Prevents the dreaded "white screen of death" by:
 * - Catching render errors in child components
 * - Showing a branded error screen with retry options
 * - Logging errors for debugging (can integrate with Sentry)
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[ErrorBoundary] Caught error:', error);
    console.error('[ErrorBoundary] Component stack:', errorInfo.componentStack);
    
    // 🔒 Send to Sentry with full context
    Sentry.captureException(error, {
      extra: {
        componentStack: errorInfo.componentStack,
      },
    });
    
    // Log to remote logging service (Supabase)
    logger.system.error(error, 'ErrorBoundary');
    logger.info('error', 'component_stack', errorInfo.componentStack?.slice(0, 500));
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  handleReload = () => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  handleGoHome = () => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.location.href = '/';
    }
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <View style={styles.container}>
          <View style={styles.card}>
            {/* Icon */}
            <View style={styles.iconContainer}>
              <AlertTriangle size={32} color="#EF4444" />
            </View>
            
            {/* Title */}
            <Text style={styles.title}>Something went wrong</Text>
            
            {/* Description */}
            <Text style={styles.description}>
              We hit an unexpected error. Try again or reload the app.
            </Text>

            {/* Action Buttons */}
            <View style={styles.buttonRow}>
              <Pressable
                onPress={this.handleRetry}
                style={styles.secondaryButton}
              >
                <RefreshCw size={18} color="#A1A1AA" />
                <Text style={styles.secondaryButtonText}>Try Again</Text>
              </Pressable>
              
              <Pressable
                onPress={this.handleReload}
                style={styles.primaryButton}
              >
                <Text style={styles.primaryButtonText}>Reload App</Text>
              </Pressable>
            </View>

            {/* Go Home Option */}
            <Pressable onPress={this.handleGoHome} style={styles.homeLink}>
              <Home size={14} color="#71717A" />
              <Text style={styles.homeLinkText}>Go to Home</Text>
            </Pressable>

            {/* Debug Info (Dev Only) */}
            {__DEV__ && this.state.error && (
              <View style={styles.debugContainer}>
                <Text style={styles.debugTitle}>Debug Info:</Text>
                <Text style={styles.debugText}>
                  {this.state.error.message}
                </Text>
              </View>
            )}
          </View>
        </View>
      );
    }

    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0A0A',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: '#18181B',
    borderRadius: 24,
    padding: 32,
    maxWidth: 360,
    width: '100%',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#27272A',
  },
  iconContainer: {
    width: 64,
    height: 64,
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  title: {
    color: '#FAFAFA',
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 8,
    textAlign: 'center',
  },
  description: {
    color: '#A1A1AA',
    fontSize: 15,
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 22,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  secondaryButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#27272A',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    gap: 8,
  },
  secondaryButtonText: {
    color: '#A1A1AA',
    fontWeight: '600',
    fontSize: 15,
  },
  primaryButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#10B981',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 15,
  },
  homeLink: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 20,
    gap: 6,
  },
  homeLinkText: {
    color: '#71717A',
    fontSize: 14,
  },
  debugContainer: {
    marginTop: 24,
    padding: 12,
    backgroundColor: '#1F1F23',
    borderRadius: 8,
    width: '100%',
  },
  debugTitle: {
    color: '#EF4444',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 4,
  },
  debugText: {
    color: '#F87171',
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
});

export default ErrorBoundary;

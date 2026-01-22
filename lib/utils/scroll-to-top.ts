/**
 * Scroll to Top Event System
 *
 * When a tab bar icon is tapped while already on that tab,
 * this emits an event that the screen can listen to and scroll to top.
 *
 * Usage:
 * - In tab screens: useScrollToTop(scrollRef)
 * - In _layout.tsx: Call scrollToTop.emit('tabName') on tab press
 */

type ScrollToTopListener = () => void;

class ScrollToTopEmitter {
  private listeners: Map<string, Set<ScrollToTopListener>> = new Map();

  /**
   * Subscribe to scroll-to-top events for a specific tab
   */
  subscribe(tabName: string, listener: ScrollToTopListener): () => void {
    if (!this.listeners.has(tabName)) {
      this.listeners.set(tabName, new Set());
    }
    this.listeners.get(tabName)!.add(listener);

    // Return unsubscribe function
    return () => {
      this.listeners.get(tabName)?.delete(listener);
    };
  }

  /**
   * Emit scroll-to-top event for a tab
   */
  emit(tabName: string): void {
    const tabListeners = this.listeners.get(tabName);
    if (tabListeners) {
      tabListeners.forEach((listener) => listener());
    }
  }
}

export const scrollToTop = new ScrollToTopEmitter();

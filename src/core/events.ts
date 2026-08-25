/**
 * MediaSFU Event Emitter
 * Lightweight event handling for widgets
 */

export type EventHandler<T = unknown> = (data: T) => void;

export class EventEmitter {
  private listeners: Map<string, Set<EventHandler>> = new Map();

  /**
   * Register an event listener
   */
  on<T = unknown>(event: string, handler: EventHandler<T>): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler as EventHandler);
  }

  /**
   * Register a one-time event listener
   */
  once<T = unknown>(event: string, handler: EventHandler<T>): void {
    const onceHandler: EventHandler<T> = (data) => {
      this.off(event, onceHandler as EventHandler);
      handler(data);
    };
    this.on(event, onceHandler);
  }

  /**
   * Remove an event listener
   */
  off(event: string, handler?: EventHandler): void {
    if (!handler) {
      this.listeners.delete(event);
      return;
    }

    const handlers = this.listeners.get(event);
    if (handlers) {
      handlers.delete(handler);
      if (handlers.size === 0) {
        this.listeners.delete(event);
      }
    }
  }

  /**
   * Emit an event
   */
  emit<T = unknown>(event: string, data?: T): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      handlers.forEach((handler) => {
        try {
          handler(data);
        } catch (error) {
          console.error(`[MediaSFU] Error in event handler for "${event}":`, error);
        }
      });
    }
  }

  /**
   * Remove all event listeners
   */
  removeAllListeners(): void {
    this.listeners.clear();
  }

  /**
   * Get listener count for an event
   */
  listenerCount(event: string): number {
    return this.listeners.get(event)?.size || 0;
  }
}

/**
 * Dispatch a CustomEvent on an element
 */
export function dispatchWidgetEvent(
  element: HTMLElement,
  eventName: string,
  detail?: unknown
): void {
  const event = new CustomEvent(eventName, {
    bubbles: true,
    composed: true, // Cross shadow DOM boundary
    detail,
  });
  element.dispatchEvent(event);
}

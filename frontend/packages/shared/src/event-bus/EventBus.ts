type Handler<T> = (event: T) => void;

/**
 * Typed event bus. T is a map of { eventName: payloadType }.
 *
 * Usage:
 *   const bus = new EventBus<VideoEventMap>();
 *   const off = bus.on('fadeIn', e => console.log(e.frame));
 *   bus.emit('fadeIn', { clipId: 'c1', frame: 30, durationFrames: 15, easing: 'easeOut' });
 *   off(); // unsubscribe
 */
export class EventBus<T extends Record<keyof T, unknown>> {
  private listeners = new Map<keyof T, Set<Handler<unknown>>>();

  on<K extends keyof T>(event: K, handler: Handler<T[K]>): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler as Handler<unknown>);
    return () => this.off(event, handler);
  }

  once<K extends keyof T>(event: K, handler: Handler<T[K]>): () => void {
    const wrapped: Handler<T[K]> = (e) => { handler(e); off(); };
    const off = this.on(event, wrapped);
    return off;
  }

  emit<K extends keyof T>(event: K, data: T[K]): void {
    this.listeners.get(event)?.forEach(h => h(data));
  }

  off<K extends keyof T>(event: K, handler: Handler<T[K]>): void {
    this.listeners.get(event)?.delete(handler as Handler<unknown>);
  }

  clear<K extends keyof T>(event?: K): void {
    if (event) this.listeners.delete(event);
    else this.listeners.clear();
  }
}

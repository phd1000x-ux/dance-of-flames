/** Tiny typed event bus for cross-system notifications (HUD, audio, missions). */
export class EventBus<E extends object> {
  private handlers = new Map<keyof E, Set<(payload: any) => void>>();

  on<K extends keyof E>(event: K, handler: (payload: E[K]) => void): () => void {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(handler);
    return () => this.handlers.get(event)!.delete(handler);
  }

  emit<K extends keyof E>(event: K, payload: E[K]): void {
    const set = this.handlers.get(event);
    if (set) for (const h of [...set]) h(payload);
  }

  clear(): void {
    this.handlers.clear();
  }
}

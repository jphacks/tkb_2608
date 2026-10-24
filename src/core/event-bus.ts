// 型付きの小さなイベントバス．イベントは `type` で判別できる union とする

export type Unsubscribe = () => void;

export interface EventBus<E extends { readonly type: string }> {
  /** 指定した種類のイベントを購読する．戻り値を呼ぶと購読をやめる */
  on<T extends E["type"]>(type: T, handler: (event: Extract<E, { type: T }>) => void): Unsubscribe;
  /** すべてのイベントを購読する（ログ・録画のメタデータ用） */
  onAny(handler: (event: E) => void): Unsubscribe;
  emit(event: E): void;
  /** すべての購読を解除する（画面を作り直す時用） */
  clear(): void;
}

export function createEventBus<E extends { readonly type: string }>(): EventBus<E> {
  const handlers = new Map<string, Set<(event: E) => void>>();
  const anyHandlers = new Set<(event: E) => void>();

  return {
    on(type, handler) {
      let set = handlers.get(type);
      if (set === undefined) {
        set = new Set();
        handlers.set(type, set);
      }
      const h = handler as (event: E) => void;
      set.add(h);
      return () => {
        set.delete(h);
      };
    },
    onAny(handler) {
      anyHandlers.add(handler);
      return () => {
        anyHandlers.delete(handler);
      };
    },
    emit(event) {
      // 処理中に購読が増減しても影響しないよう，写しを回す
      for (const h of [...(handlers.get(event.type) ?? [])]) h(event);
      for (const h of [...anyHandlers]) h(event);
    },
    clear() {
      handlers.clear();
      anyHandlers.clear();
    },
  };
}

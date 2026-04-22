import { effect, Injectable, signal, Signal, WritableSignal } from '@angular/core';

export type DataKey = string;
export type DataValue = unknown;
export type Patch = Map<DataKey, DataValue>;
export type DataListener = (patch: Patch) => void;
export type RemoveDataListener = () => void;
export type IterableSource<T> = readonly T[] | ReadonlySet<T> | MapIterator<T>;
export type Entry<K, V> = readonly [K, V];
export type Entries<K, V> = ReadonlyMap<K, V> | IterableSource<Entry<K, V>>;
export interface SignalHandle {
  signal: Signal<DataValue>;
  destroy: () => void;
}

@Injectable({
  providedIn: 'root',
})
export class StateStoreService {
  private readonly state = new Map<DataKey, DataValue>();
  private readonly listenersByKey = new Map<DataKey, Set<DataListener>>();
  private readonly pendingPatchByListener = new Map<DataListener, Patch>();
  private readonly signalsByKey = new Map<DataKey, Set<WritableSignal<DataValue>>>();
  private isFlushScheduled = false;

  private readonly scheduleFlush = (): void => {
    if (this.isFlushScheduled) {
      return;
    }

    this.isFlushScheduled = true;

    queueMicrotask(() => {
      for (const [key, signals] of this.signalsByKey) {
        for (const keySignal of signals) {
          keySignal.set(this.state.get(key));
        }
      }

      for (const [listener, pendingPatch] of this.pendingPatchByListener) {
        try {
          listener(pendingPatch);
        } catch {
          // Error handler
        }
      }

      this.pendingPatchByListener.clear();
      this.isFlushScheduled = false;
    });
  };

  public readonly patch = (patch: Entries<DataKey, DataValue>): void => {
    let hasChanges = false;

    for (const [key, value] of patch) {
      if (Object.is(this.state.get(key), value)) {
        continue;
      }

      this.state.set(key, value);

      for (const listener of this.listenersByKey.get(key) ?? []) {
        let pendingPatch = this.pendingPatchByListener.get(listener);

        if (!pendingPatch) {
          pendingPatch = new Map();

          this.pendingPatchByListener.set(listener, pendingPatch);
        }

        pendingPatch.set(key, value);
      }

      hasChanges = true;
    }

    if (!hasChanges) {
      return;
    }

    this.scheduleFlush();
  };

  private readonly removeListenerFromKey = (key: DataKey, listener: DataListener): void => {
    const listeners = this.listenersByKey.get(key);

    if (!listeners) {
      return;
    }

    listeners.delete(listener);

    if (listeners.size !== 0) {
      return;
    }

    this.listenersByKey.delete(key);
  };

  private readonly removeListenerFromRemovedKeys = (
    previousKeys: Set<DataKey>,
    nextKeys: Set<DataKey>,
    listener: DataListener,
  ): void => {
    for (const key of previousKeys.difference(nextKeys)) {
      this.removeListenerFromKey(key, listener);
    }
  };

  private readonly addListenerToNewKeys = (
    previousKeys: Set<DataKey>,
    nextKeys: Set<DataKey>,
    listener: DataListener,
  ): void => {
    for (const key of nextKeys.difference(previousKeys)) {
      let listeners = this.listenersByKey.get(key);

      if (!listeners) {
        listeners = new Set();

        this.listenersByKey.set(key, listeners);
      }

      listeners.add(listener);
    }
  };

  private readonly removeListenerFromAllKeys = (
    keys: Set<DataKey>,
    listener: DataListener,
  ): void => {
    for (const key of keys) {
      this.removeListenerFromKey(key, listener);
    }
  };

  public readonly addDataListener = (
    keysSignal: Signal<IterableSource<DataKey>>,
    listener: DataListener,
  ): RemoveDataListener => {
    let previousKeys = new Set<DataKey>(keysSignal());

    this.addListenerToNewKeys(new Set<DataKey>(), previousKeys, listener);

    const ref = effect(() => {
      const nextKeys = new Set(keysSignal());

      this.removeListenerFromRemovedKeys(previousKeys, nextKeys, listener);
      this.addListenerToNewKeys(previousKeys, nextKeys, listener);

      previousKeys = nextKeys;
    });

    return () => {
      this.removeListenerFromAllKeys(previousKeys, listener);
      previousKeys.clear();
      ref.destroy();
    };
  };

  public readonly createDataSignal = (key: DataKey): SignalHandle => {
    const keySignal = signal(this.state.get(key));
    let keySignals = this.signalsByKey.get(key);

    if (!keySignals) {
      keySignals = new Set();

      this.signalsByKey.set(key, keySignals);
    }

    keySignals.add(keySignal);

    return {
      signal: keySignal.asReadonly(),
      destroy: (): void => {
        keySignals.delete(keySignal);

        if (keySignals.size !== 0) {
          return;
        }

        this.signalsByKey.delete(key);
      },
    };
  };

  public readonly getValues = (keys: IterableSource<DataKey>): ReadonlyMap<DataKey, DataValue> => {
    const data = new Map<DataKey, DataValue>();

    for (const key of keys) {
      data.set(key, this.state.get(key));
    }

    return data;
  };
}

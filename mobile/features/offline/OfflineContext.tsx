import NetInfo from '@react-native-community/netinfo';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { api } from '../../utils/api';
import { completeOperation, countPendingOperations, failOperation, getPendingOperations, initializeOfflineDatabase, subscribeOutbox } from './database';
import { applyServerSnapshot } from './cachePolicy';

type OfflineContextValue = {
  isOnline: boolean;
  pendingCount: number;
  isSyncing: boolean;
  lastSyncedAt: Date | null;
  syncNow: () => Promise<void>;
};

const OfflineContext = createContext<OfflineContextValue | null>(null);

export function OfflineProvider({ children }: { children: React.ReactNode }) {
  const [isOnline, setOnline] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);
  const [isSyncing, setSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const syncingRef = useRef(false);

  const refreshCount = useCallback(async () => setPendingCount(await countPendingOperations()), []);
  const syncNow = useCallback(async () => {
    if (!isOnline || syncingRef.current) return;
    syncingRef.current = true;
    setSyncing(true);
    try {
      const operations = await getPendingOperations();
      for (const operation of operations) {
        try {
          await api.request({
            method: operation.method,
            url: operation.url,
            data: operation.body ? JSON.parse(operation.body) : undefined,
            headers: { 'Idempotency-Key': operation.id, 'X-Offline-Replay': 'true' },
          });
          await completeOperation(operation.id);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Sync failed';
          await failOperation(operation, message);
		  break; // Preserve dependency order between locally-created entities.
        }
      }
	  const remaining = await countPendingOperations();
	  if (remaining === 0) {
		const response = await api.get('/sync/pull');
		await applyServerSnapshot(response.data);
	  }
      setLastSyncedAt(new Date());
    } finally {
      syncingRef.current = false;
      setSyncing(false);
      await refreshCount();
    }
  }, [isOnline, refreshCount]);

  useEffect(() => {
    initializeOfflineDatabase().then(refreshCount);
	const unsubscribeOutbox = subscribeOutbox(() => void refreshCount());
    const unsubscribe = NetInfo.addEventListener(state => {
      setOnline(Boolean(state.isConnected && state.isInternetReachable !== false));
    });
    const appState = AppState.addEventListener('change', state => {
      if (state === 'active') void syncNow();
    });
	return () => { unsubscribe(); unsubscribeOutbox(); appState.remove(); };
  }, [refreshCount, syncNow]);

  useEffect(() => { if (isOnline) void syncNow(); }, [isOnline, syncNow]);

  const value = useMemo(() => ({ isOnline, pendingCount, isSyncing, lastSyncedAt, syncNow }), [isOnline, pendingCount, isSyncing, lastSyncedAt, syncNow]);
  return <OfflineContext.Provider value={value}>{children}</OfflineContext.Provider>;
}

export function useOffline() {
  const context = useContext(OfflineContext);
  if (!context) throw new Error('useOffline must be used within OfflineProvider');
  return context;
}

import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SQLite from 'expo-sqlite';

export type PendingOperation = {
  id: string;
  method: string;
  url: string;
  body: string | null;
  createdAt: number;
  attempts: number;
};

const WEB_CACHE_PREFIX = '@motopulse_http_cache:';
const WEB_OUTBOX_KEY = '@motopulse_outbox';
let databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;
const outboxListeners = new Set<() => void>();
const notifyOutbox = () => outboxListeners.forEach(listener => listener());
export const subscribeOutbox = (listener: () => void) => { outboxListeners.add(listener); return () => outboxListeners.delete(listener); };

export const createOperationId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;

export async function getOfflineDatabase() {
  if (!databasePromise) {
    databasePromise = SQLite.openDatabaseAsync('motopulse.db').then(async database => {
      await database.execAsync(`
        PRAGMA journal_mode = WAL;
        PRAGMA foreign_keys = ON;
        CREATE TABLE IF NOT EXISTS response_cache (
          cache_key TEXT PRIMARY KEY NOT NULL,
          payload TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sync_outbox (
          id TEXT PRIMARY KEY NOT NULL,
          method TEXT NOT NULL,
          url TEXT NOT NULL,
          body TEXT,
          status TEXT NOT NULL DEFAULT 'pending',
          attempts INTEGER NOT NULL DEFAULT 0,
          next_attempt_at INTEGER NOT NULL,
          last_error TEXT,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_outbox_pending
          ON sync_outbox(status, next_attempt_at, created_at);
        CREATE TABLE IF NOT EXISTS sync_state (
          state_key TEXT PRIMARY KEY NOT NULL,
          state_value TEXT NOT NULL
        );
		CREATE TABLE IF NOT EXISTS active_route (
		  singleton INTEGER PRIMARY KEY NOT NULL CHECK(singleton = 1),
		  total_distance REAL NOT NULL DEFAULT 0,
		  start_time INTEGER
		);
		CREATE TABLE IF NOT EXISTS active_route_points (
		  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
		  latitude REAL NOT NULL,
		  longitude REAL NOT NULL,
		  speed REAL,
		  lean_angle REAL,
		  relative_time REAL
		);
      `);
      return database;
    });
  }
  return databasePromise;
}

export async function initializeOfflineDatabase() {
	if (Platform.OS !== 'web') await getOfflineDatabase();
}

export async function cacheResponse(key: string, value: unknown) {
  const payload = JSON.stringify(value);
  if (Platform.OS === 'web') {
    await AsyncStorage.setItem(WEB_CACHE_PREFIX + key, payload);
    return;
  }
	const database = await getOfflineDatabase();
  await database.runAsync(
    `INSERT INTO response_cache(cache_key, payload, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(cache_key) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at`,
    key, payload, Date.now(),
  );
}

export async function getCachedResponse<T>(key: string): Promise<T | null> {
  if (Platform.OS === 'web') {
    const payload = await AsyncStorage.getItem(WEB_CACHE_PREFIX + key);
    return payload ? JSON.parse(payload) as T : null;
  }
	const database = await getOfflineDatabase();
  const row = await database.getFirstAsync<{ payload: string }>('SELECT payload FROM response_cache WHERE cache_key = ?', key);
  return row ? JSON.parse(row.payload) as T : null;
}

export async function enqueueOperation(method: string, url: string, body: unknown, operationId?: string) {
	const operation: PendingOperation = { id: operationId ?? createOperationId(), method, url, body: body == null ? null : JSON.stringify(body), createdAt: Date.now(), attempts: 0 };
  if (Platform.OS === 'web') {
    const current = JSON.parse(await AsyncStorage.getItem(WEB_OUTBOX_KEY) ?? '[]') as PendingOperation[];
    await AsyncStorage.setItem(WEB_OUTBOX_KEY, JSON.stringify([...current, operation]));
	notifyOutbox();
	return operation;
  }
	const database = await getOfflineDatabase();
  await database.runAsync(
    'INSERT INTO sync_outbox(id, method, url, body, next_attempt_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    operation.id, method, url, operation.body, operation.createdAt, operation.createdAt,
  );
	notifyOutbox();
  return operation;
}

export async function getPendingOperations(limit = 50): Promise<PendingOperation[]> {
  if (Platform.OS === 'web') {
    return (JSON.parse(await AsyncStorage.getItem(WEB_OUTBOX_KEY) ?? '[]') as PendingOperation[]).slice(0, limit);
  }
	const database = await getOfflineDatabase();
  return database.getAllAsync<PendingOperation>(
    `SELECT id, method, url, body, created_at AS createdAt, attempts
     FROM sync_outbox WHERE status='pending' AND next_attempt_at <= ? ORDER BY created_at LIMIT ?`,
    Date.now(), limit,
  );
}

export async function completeOperation(id: string) {
  if (Platform.OS === 'web') {
    const current = JSON.parse(await AsyncStorage.getItem(WEB_OUTBOX_KEY) ?? '[]') as PendingOperation[];
    await AsyncStorage.setItem(WEB_OUTBOX_KEY, JSON.stringify(current.filter(item => item.id !== id)));
	notifyOutbox();
    return;
  }
	const database = await getOfflineDatabase();
  await database.runAsync('DELETE FROM sync_outbox WHERE id = ?', id);
	notifyOutbox();
}

export async function updateCachedLists(prefix: string, entityId: string, update: Record<string, unknown> | null) {
  if (Platform.OS === 'web') {
    const keys = (await AsyncStorage.getAllKeys()).filter(key => key.startsWith(WEB_CACHE_PREFIX + prefix));
    for (const key of keys) {
      const items = JSON.parse(await AsyncStorage.getItem(key) ?? '[]') as Record<string, unknown>[];
      await AsyncStorage.setItem(key, JSON.stringify(update === null ? items.filter(item => item.id !== entityId) : items.map(item => item.id === entityId ? { ...item, ...update } : item)));
    }
    return;
  }
	const database = await getOfflineDatabase();
  const rows = await database.getAllAsync<{ cache_key: string; payload: string }>('SELECT cache_key, payload FROM response_cache WHERE cache_key LIKE ?', `${prefix}%`);
  await database.withExclusiveTransactionAsync(async transaction => {
    for (const row of rows) {
      const items = JSON.parse(row.payload) as Record<string, unknown>[];
      const next = update === null ? items.filter(item => item.id !== entityId) : items.map(item => item.id === entityId ? { ...item, ...update } : item);
      await transaction.runAsync('UPDATE response_cache SET payload=?, updated_at=? WHERE cache_key=?', JSON.stringify(next), Date.now(), row.cache_key);
    }
  });
}

export async function failOperation(operation: PendingOperation, message: string) {
  if (Platform.OS === 'web') return;
	const database = await getOfflineDatabase();
  const attempts = operation.attempts + 1;
  const delay = Math.min(60 * 60_000, 2 ** Math.min(attempts, 6) * 5_000);
  await database.runAsync(
    `UPDATE sync_outbox SET attempts=?, next_attempt_at=?, last_error=?, status=? WHERE id=?`,
    attempts, Date.now() + delay, message.slice(0, 500), attempts >= 10 ? 'failed' : 'pending', operation.id,
  );
}

export async function countPendingOperations() {
  if (Platform.OS === 'web') return (JSON.parse(await AsyncStorage.getItem(WEB_OUTBOX_KEY) ?? '[]') as PendingOperation[]).length;
	const database = await getOfflineDatabase();
  const row = await database.getFirstAsync<{ count: number }>(`SELECT COUNT(*) AS count FROM sync_outbox WHERE status='pending'`);
  return row?.count ?? 0;
}

export async function clearOfflineSessionData() {
  if (Platform.OS === 'web') {
    const keys = (await AsyncStorage.getAllKeys()).filter(key => key.startsWith(WEB_CACHE_PREFIX) || key === WEB_OUTBOX_KEY || key.startsWith('@motopulse_route_v2_'));
    if (keys.length) await AsyncStorage.multiRemove(keys);
    notifyOutbox();
    return;
  }
  const database = await getOfflineDatabase();
  await database.withExclusiveTransactionAsync(async transaction => {
    await transaction.runAsync('DELETE FROM response_cache');
    await transaction.runAsync('DELETE FROM sync_outbox');
    await transaction.runAsync('DELETE FROM sync_state');
    await transaction.runAsync('DELETE FROM active_route_points');
    await transaction.runAsync('DELETE FROM active_route');
  });
  notifyOutbox();
}

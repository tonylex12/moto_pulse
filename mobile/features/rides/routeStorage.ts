import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import type { Coordinate } from '../../hooks/useLocation';
import { getOfflineDatabase } from '../offline/database';

const META_KEY = '@motopulse_route_v2_meta';
const CHUNK_PREFIX = '@motopulse_route_v2_chunk_';
const CHUNK_SIZE = 100;

type RouteMeta = { totalDistance: number; startTime: number | null; points: number; chunks: number };

export type ActiveRoute = { coordinates: Coordinate[]; totalDistance: number; startTime: number | null };

export async function initializeActiveRoute(startTime: number) {
	if (Platform.OS !== 'web') {
	  const database = await getOfflineDatabase();
	  await database.withExclusiveTransactionAsync(async transaction => {
		await transaction.runAsync('DELETE FROM active_route_points');
		await transaction.runAsync('INSERT OR REPLACE INTO active_route(singleton, total_distance, start_time) VALUES (1, 0, ?)', startTime);
	  });
	  return;
	}
  await clearActiveRoute();
  const meta: RouteMeta = { totalDistance: 0, startTime, points: 0, chunks: 0 };
  await AsyncStorage.setItem(META_KEY, JSON.stringify(meta));
}

export async function loadActiveRoute(): Promise<ActiveRoute | null> {
	if (Platform.OS !== 'web') {
	  const database = await getOfflineDatabase();
	  const meta = await database.getFirstAsync<{ total_distance: number; start_time: number | null }>('SELECT total_distance, start_time FROM active_route WHERE singleton=1');
	  if (!meta) {
		const legacyMetaRaw = await AsyncStorage.getItem(META_KEY);
		if (!legacyMetaRaw) return null;
		const legacyMeta = JSON.parse(legacyMetaRaw) as RouteMeta;
		const keys = Array.from({ length: legacyMeta.chunks }, (_, index) => `${CHUNK_PREFIX}${index}`);
		const stored = keys.length ? await AsyncStorage.multiGet(keys) : [];
		const migrated = { coordinates:stored.flatMap(([, value]) => value ? JSON.parse(value) as Coordinate[] : []), totalDistance:legacyMeta.totalDistance, startTime:legacyMeta.startTime };
		await persistActiveRoute(migrated);
		await AsyncStorage.multiRemove([META_KEY, ...keys]);
		return migrated;
	  }
	  const rows = await database.getAllAsync<{ latitude:number; longitude:number; speed:number|null; lean_angle:number|null; relative_time:number|null }>('SELECT latitude, longitude, speed, lean_angle, relative_time FROM active_route_points ORDER BY sequence');
	  return { totalDistance:meta.total_distance, startTime:meta.start_time, coordinates:rows.map(row => ({ latitude:row.latitude, longitude:row.longitude, speed:row.speed ?? undefined, leanAngle:row.lean_angle ?? undefined, time:row.relative_time ?? undefined })) };
	}
  const raw = await AsyncStorage.getItem(META_KEY);
  if (!raw) return null;
  const meta = JSON.parse(raw) as RouteMeta;
  const keys = Array.from({ length: meta.chunks }, (_, index) => `${CHUNK_PREFIX}${index}`);
  const stored = keys.length ? await AsyncStorage.multiGet(keys) : [];
  const coordinates = stored.flatMap(([, value]) => value ? JSON.parse(value) as Coordinate[] : []);
  return { coordinates, totalDistance: meta.totalDistance, startTime: meta.startTime };
}

export async function persistActiveRoute(route: ActiveRoute) {
	if (Platform.OS !== 'web') {
	  const database = await getOfflineDatabase();
	  const current = await database.getFirstAsync<{ count:number }>('SELECT COUNT(*) AS count FROM active_route_points');
	  const newPoints = route.coordinates.slice(current?.count ?? 0);
	  await database.withExclusiveTransactionAsync(async transaction => {
		for (const point of newPoints) {
		  await transaction.runAsync('INSERT INTO active_route_points(latitude, longitude, speed, lean_angle, relative_time) VALUES (?, ?, ?, ?, ?)', point.latitude, point.longitude, point.speed ?? null, point.leanAngle ?? null, point.time ?? null);
		}
		await transaction.runAsync('INSERT OR REPLACE INTO active_route(singleton, total_distance, start_time) VALUES (1, ?, ?)', route.totalDistance, route.startTime);
	  });
	  return;
	}
  const chunks = Math.ceil(route.coordinates.length / CHUNK_SIZE);
  const writes: [string, string][] = [];
  for (let index = 0; index < chunks; index++) {
    writes.push([`${CHUNK_PREFIX}${index}`, JSON.stringify(route.coordinates.slice(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE))]);
  }
  const meta: RouteMeta = { totalDistance: route.totalDistance, startTime: route.startTime, points: route.coordinates.length, chunks };
  writes.push([META_KEY, JSON.stringify(meta)]);
  await AsyncStorage.multiSet(writes);
}

export async function clearActiveRoute() {
	if (Platform.OS !== 'web') {
	  const database = await getOfflineDatabase();
	  await database.withExclusiveTransactionAsync(async transaction => { await transaction.runAsync('DELETE FROM active_route_points'); await transaction.runAsync('DELETE FROM active_route'); });
	  return;
	}
  const raw = await AsyncStorage.getItem(META_KEY);
  if (raw) {
    const meta = JSON.parse(raw) as RouteMeta;
    await AsyncStorage.multiRemove([META_KEY, ...Array.from({ length: meta.chunks }, (_, index) => `${CHUNK_PREFIX}${index}`)]);
  }
}

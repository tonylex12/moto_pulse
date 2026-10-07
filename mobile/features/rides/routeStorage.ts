import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Coordinate } from '../../hooks/useLocation';

const META_KEY = '@motopulse_route_v2_meta';
const CHUNK_PREFIX = '@motopulse_route_v2_chunk_';
const CHUNK_SIZE = 100;

type RouteMeta = { totalDistance: number; startTime: number | null; points: number; chunks: number };

export type ActiveRoute = { coordinates: Coordinate[]; totalDistance: number; startTime: number | null };

export async function initializeActiveRoute(startTime: number) {
  await clearActiveRoute();
  const meta: RouteMeta = { totalDistance: 0, startTime, points: 0, chunks: 0 };
  await AsyncStorage.setItem(META_KEY, JSON.stringify(meta));
}

export async function loadActiveRoute(): Promise<ActiveRoute | null> {
  const raw = await AsyncStorage.getItem(META_KEY);
  if (!raw) return null;
  const meta = JSON.parse(raw) as RouteMeta;
  const keys = Array.from({ length: meta.chunks }, (_, index) => `${CHUNK_PREFIX}${index}`);
  const stored = keys.length ? await AsyncStorage.multiGet(keys) : [];
  const coordinates = stored.flatMap(([, value]) => value ? JSON.parse(value) as Coordinate[] : []);
  return { coordinates, totalDistance: meta.totalDistance, startTime: meta.startTime };
}

export async function persistActiveRoute(route: ActiveRoute) {
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
  const raw = await AsyncStorage.getItem(META_KEY);
  if (raw) {
    const meta = JSON.parse(raw) as RouteMeta;
    await AsyncStorage.multiRemove([META_KEY, ...Array.from({ length: meta.chunks }, (_, index) => `${CHUNK_PREFIX}${index}`)]);
  }
}

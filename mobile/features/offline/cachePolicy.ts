import { cacheResponse, getCachedResponse, updateCachedLists } from './database';

type RecordValue = Record<string, unknown>;

async function cacheFuelStats(vehicleId: string, logs: RecordValue[]) {
  const ordered = [...logs].sort((a, b) => Number(a.odometer) - Number(b.odometer));
  const totalCost = ordered.reduce((sum, item) => sum + Number(item.price ?? 0), 0);
  const totalLiters = ordered.reduce((sum, item) => sum + Number(item.liters ?? 0), 0);
  const totalDistance = ordered.length > 1 ? Number(ordered.at(-1)?.odometer ?? 0) - Number(ordered[0].odometer ?? 0) : 0;
  const intervalLiters = ordered.slice(0, -1).reduce((sum, item) => sum + Number(item.liters ?? 0), 0);
  await cacheResponse(`/fuel-logs/stats/${vehicleId}`, {
    totalLogs:ordered.length, totalCost, totalLiters, totalDistance,
    avgConsumption:totalDistance > 0 && intervalLiters > 0 ? Math.round((totalDistance / intervalLiters) * 100) / 100 : 0,
    costPerKm:totalDistance > 0 ? Math.round((totalCost / totalDistance) * 100) / 100 : 0,
  });
}

export const normalizeCacheKey = (url = '') => '/' + url.replace(/^\/+/, '').split('?')[0];
export const createOfflineId = () => {
  const bytes = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.map(value => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

export async function applyOptimisticMutation(method: string, rawUrl: string, body: RecordValue) {
  const url = normalizeCacheKey(rawUrl);
  const now = new Date().toISOString();

  if (method === 'post' && url === '/vehicles') {
	const entity = { ...body, id: body.id ?? createOfflineId(), isActive: true, createdAt: now, updatedAt: now, _syncStatus: 'pending' };
    const vehicles = await getCachedResponse<RecordValue[]>('/vehicles') ?? [];
    await cacheResponse('/vehicles', [...vehicles.map(item => ({ ...item, isActive: false })), entity]);
    return entity;
  }
  const vehicleMatch = url.match(/^\/vehicles\/([^/]+)$/);
  if (vehicleMatch && method === 'put') {
    const vehicles = await getCachedResponse<RecordValue[]>('/vehicles') ?? [];
    const updated = vehicles.map(item => item.id === vehicleMatch[1] ? { ...item, ...body, updatedAt: now, _syncStatus: 'pending' } : item);
    await cacheResponse('/vehicles', updated);
    return updated.find(item => item.id === vehicleMatch[1]) ?? body;
  }
  const activeMatch = url.match(/^\/vehicles\/([^/]+)\/active$/);
  if (activeMatch && method === 'put') {
    const vehicles = await getCachedResponse<RecordValue[]>('/vehicles') ?? [];
    await cacheResponse('/vehicles', vehicles.map(item => ({ ...item, isActive: item.id === activeMatch[1], _syncStatus: item.id === activeMatch[1] ? 'pending' : item._syncStatus })));
    return { success: true, pending: true };
  }
  if (vehicleMatch && method === 'delete') {
    const vehicles = await getCachedResponse<RecordValue[]>('/vehicles') ?? [];
    await cacheResponse('/vehicles', vehicles.filter(item => item.id !== vehicleMatch[1]));
    return { success: true, pending: true };
  }
  if (method === 'post' && url === '/fuel-logs') {
	const entity = { ...body, id: body.id ?? createOfflineId(), date: body.date ?? now, createdAt: now, updatedAt: now, _syncStatus: 'pending' };
    const key = `/fuel-logs/vehicle/${body.vehicleId}`;
    const logs = await getCachedResponse<RecordValue[]>(key) ?? [];
	const nextLogs = [entity, ...logs];
	await cacheResponse(key, nextLogs);
	await cacheFuelStats(String(body.vehicleId), nextLogs);
    return { log: entity, updatedMileage: body.odometer };
  }
  const fuelDelete = url.match(/^\/fuel-logs\/([^/]+)$/);
	if (fuelDelete && method === 'delete') { await updateCachedLists('/fuel-logs/vehicle/', fuelDelete[1], null); return { success: true, pending: true }; }

  if (method === 'post' && url === '/alerts') {
	const entity = { ...body, id: body.id ?? createOfflineId(), isCompleted: false, createdAt: now, updatedAt: now, _syncStatus: 'pending' };
    const key = `/alerts/vehicle/${body.vehicleId}`;
    const alerts = await getCachedResponse<RecordValue[]>(key) ?? [];
    await cacheResponse(key, [entity, ...alerts]);
    return entity;
  }
  const alertMatch = url.match(/^\/alerts\/([^/]+)$/);
	if (alertMatch && method === 'put') { const update = { ...body, updatedAt: now, _syncStatus: 'pending' }; await updateCachedLists('/alerts/vehicle/', alertMatch[1], update); return { ...update, id: alertMatch[1] }; }
	if (alertMatch && method === 'delete') { await updateCachedLists('/alerts/vehicle/', alertMatch[1], null); return { success: true, pending: true }; }

  if (method === 'post' && url === '/routes') {
	const entity = { ...body, id: body.id ?? createOfflineId(), createdAt: now, updatedAt: now, _syncStatus: 'pending' };
    const routes = await getCachedResponse<RecordValue[]>('/routes') ?? [];
    await cacheResponse('/routes', [entity, ...routes]);
    return entity;
  }
  const routeDelete = url.match(/^\/routes\/([^/]+)$/);
  if (routeDelete && method === 'delete') {
    const routes = await getCachedResponse<RecordValue[]>('/routes') ?? [];
    await cacheResponse('/routes', routes.filter(item => item.id !== routeDelete[1]));
    return { success: true, pending: true };
  }
	return { ...body, id: body.id ?? createOfflineId(), pending: true };
}

export async function applyServerSnapshot(snapshot: {
  vehicles?: RecordValue[]; fuelLogs?: RecordValue[]; alerts?: RecordValue[]; routes?: RecordValue[];
}) {
  const vehicles = snapshot.vehicles ?? [];
  await cacheResponse('/vehicles', vehicles);
  await cacheResponse('/routes', snapshot.routes ?? []);
  for (const vehicle of vehicles) {
    const id = String(vehicle.id);
	const logs = (snapshot.fuelLogs ?? []).filter(item => String(item.vehicleId) === id);
	await cacheResponse(`/fuel-logs/vehicle/${id}`, logs);
	await cacheFuelStats(id, logs);
    await cacheResponse(`/alerts/vehicle/${id}`, (snapshot.alerts ?? []).filter(item => String(item.vehicleId) === id));
  }
}

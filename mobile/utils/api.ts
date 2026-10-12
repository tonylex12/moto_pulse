import axios, { AxiosError } from 'axios';
import NetInfo from '@react-native-community/netinfo';
import Constants from 'expo-constants';
import type { AxiosResponse } from 'axios';
import { applyOptimisticMutation, createOfflineId, normalizeCacheKey } from '../features/offline/cachePolicy';
import { cacheResponse, createOperationId, enqueueOperation, getCachedResponse } from '../features/offline/database';

const getDevBaseUrl = () => {
  // Constants.expoConfig?.hostUri contains the dev machine IP (e.g. "192.168.1.10:8081")
  const hostUri = Constants.expoConfig?.hostUri;
  if (hostUri) {
    const ip = hostUri.split(':')[0];
    return `http://${ip}:3000/api`;
  }
  return 'http://localhost:3000/api';
};

const getSanitizedApiUrl = () => {
  let url = process.env.EXPO_PUBLIC_API_URL || getDevBaseUrl();
  if (process.env.EXPO_PUBLIC_API_URL && !url.endsWith('/api') && !url.endsWith('/api/')) {
    url = url.replace(/\/$/, '') + '/api';
  }
  return url;
};

export const API_URL = getSanitizedApiUrl();

console.log(`🏍️ MotoPulse API URL configured: ${API_URL}`);

export const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 10000,
});

// Helper to set or clear the auth header globally in axios
let authToken: string | null = null;
let tokenResolver: (() => Promise<string | null>) | null = null;

export const setAuthToken = (token: string | null) => {
  authToken = token;
};

export const setTokenResolver = (resolver: (() => Promise<string | null>) | null) => {
  tokenResolver = resolver;
};

// Add request interceptor to dynamically inject the bearer token
api.interceptors.request.use(
  async (config) => {
	const method = (config.method ?? 'get').toLowerCase();
	if (!['get', 'head', 'options'].includes(method)) {
	  config.headers.set('Idempotency-Key', config.headers.get('Idempotency-Key') ?? createOperationId());
	  const requestData = typeof config.data === 'string' ? JSON.parse(config.data) : (config.data ?? {});
	  if (method === 'post' && ['/vehicles', '/fuel-logs', '/alerts', '/routes'].includes(normalizeCacheKey(config.url)) && !requestData.id) {
		requestData.id = createOfflineId();
		config.data = requestData;
	  }
	}
	const network = await NetInfo.fetch();
	if (!network.isConnected || network.isInternetReachable === false) {
	  throw new AxiosError('Device is offline', 'ERR_NETWORK', config);
	}
    let token = authToken;
    if (tokenResolver) {
      try {
        const resolved = await tokenResolver();
        if (resolved) token = resolved;
      } catch (err) {
        console.error('Error resolving token in interceptor:', err);
      }
    }
    
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

api.interceptors.response.use(
  async (response) => {
    if (response.config.method?.toLowerCase() === 'get') {
      await cacheResponse(normalizeCacheKey(response.config.url), response.data);
    }
    return response;
  },
  async (error: AxiosError) => {
    const config = error.config;
    if (!config) return Promise.reject(error);
    const method = (config.method ?? 'get').toLowerCase();
	const retryableStatus = error.response ? [408, 425, 429, 502, 503, 504].includes(error.response.status) : false;
	const recoverableFailure = !error.response || error.code === 'ECONNABORTED' || error.code === 'ERR_NETWORK' || retryableStatus;
	if (!recoverableFailure) return Promise.reject(error);

    if (method === 'get') {
      const cached = await getCachedResponse(normalizeCacheKey(config.url));
      if (cached !== null) {
        return { data: cached, status: 200, statusText: 'OK (offline cache)', headers: {}, config } as AxiosResponse;
      }
      return Promise.reject(error);
    }

    if (config.headers?.['X-Offline-Replay'] === 'true') return Promise.reject(error);
	const data = typeof config.data === 'string' ? JSON.parse(config.data) : (config.data ?? {});
	const operationKey = String(config.headers?.['Idempotency-Key'] ?? createOperationId());
	const operation = await enqueueOperation(method, config.url ?? '', data, operationKey);
    const optimistic = await applyOptimisticMutation(method, config.url ?? '', data);
    return {
      data: optimistic,
      status: 202,
      statusText: 'Accepted offline',
      headers: { 'x-offline-operation': operation.id },
      config,
    } as AxiosResponse;
  },
);

import axios from 'axios';
import Constants from 'expo-constants';

const getDevBaseUrl = () => {
  // Constants.expoConfig?.hostUri contains the dev machine IP (e.g. "192.168.1.10:8081")
  const hostUri = Constants.expoConfig?.hostUri;
  if (hostUri) {
    const ip = hostUri.split(':')[0];
    return `http://${ip}:3000/api`;
  }
  return 'http://localhost:3000/api';
};

export const API_URL = __DEV__ 
  ? getDevBaseUrl() 
  : 'https://your-production-backend.com/api'; // Replace with Coolify production URL later

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

export const setAuthToken = (token: string | null) => {
  authToken = token;
};

// Add request interceptor to dynamically inject the bearer token
api.interceptors.request.use(
  async (config) => {
    if (authToken) {
      config.headers.Authorization = `Bearer ${authToken}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

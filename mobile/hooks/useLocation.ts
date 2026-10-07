import { useState, useRef, useEffect } from 'react';
import { Alert, DeviceEventEmitter, AppState, AppStateStatus } from 'react-native';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { clearActiveRoute, initializeActiveRoute, loadActiveRoute, persistActiveRoute } from '../features/rides/routeStorage';

export interface Coordinate {
  latitude: number;
  longitude: number;
  speed?: number;
  leanAngle?: number;
  time?: number;
}

const LOCATION_TASK_NAME = 'background-location-task';
const IS_RECORDING_STORAGE_KEY = '@motopulse_is_recording';
const ACTIVE_ROUTE_STORAGE_KEY = '@motopulse_active_recorded_route';

// Global variables to synchronize tracking state between the background task and hook instances
let recordedRouteGlobal: Coordinate[] = [];
let totalDistanceGlobal = 0;
let startTimeGlobal: number | null = null;
let leanAngleGlobal = 0;
let isRecordingGlobal = false;
let lastLocationGlobal: { latitude: number; longitude: number; timestamp: number; speed: number } | null = null;

// Haversine formula to calculate distance between coordinates in km
const getDistanceBetweenPoints = (coords1: Coordinate, coords2: Coordinate): number => {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const R = 6371; // Earth's radius in km

  const dLat = toRad(coords2.latitude - coords1.latitude);
  const dLon = toRad(coords2.longitude - coords1.longitude);
  const lat1 = toRad(coords1.latitude);
  const lat2 = toRad(coords2.latitude);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(lat1) * Math.cos(lat2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

// Define the background location task
TaskManager.defineTask(LOCATION_TASK_NAME, async ({ data, error }) => {
  if (error) {
    console.error('[BackgroundLocationTask] Task error:', error);
    return;
  }
  if (data) {
    try {
      // Check if we are actively recording in storage (headless tasks don't share isRecordingGlobal)
      const isRecordingStored = await AsyncStorage.getItem(IS_RECORDING_STORAGE_KEY);
      const isRecording = isRecordingStored === 'true';
      if (!isRecording) return;

      const { locations } = data as { locations: Location.LocationObject[] };
      if (!locations || locations.length === 0) return;

      // Read current state from AsyncStorage
	  let activeRoute = await loadActiveRoute() ?? { coordinates: [], totalDistance: 0, startTime: null };

      let updated = false;

      for (const location of locations) {
        const currentTimestamp = location.timestamp;
        
        if (!activeRoute.startTime) {
          activeRoute.startTime = currentTimestamp;
        }
        
        const relativeTime = (currentTimestamp - activeRoute.startTime) / 1000;
        
        // Calculate speed based on geodetic distance between coordinates
        let calculatedSpeed = 0;
        if (lastLocationGlobal && lastLocationGlobal.timestamp) {
          const timeDiff = (currentTimestamp - lastLocationGlobal.timestamp) / 1000; // in seconds
          const tempCoord = { latitude: location.coords.latitude, longitude: location.coords.longitude };
          const dist = getDistanceBetweenPoints(lastLocationGlobal, tempCoord);
          
          if (dist <= 0.002 || timeDiff <= 0) {
            calculatedSpeed = 0;
          } else {
            calculatedSpeed = (dist / timeDiff) * 3600;
          }
        }

        // Determine final speed: prioritize OS sensor speed if available, otherwise fallback to calculated speed
        let finalSpeed = 0;
        const gpsSpeed = location.coords.speed;
        if (gpsSpeed !== null && gpsSpeed !== undefined && gpsSpeed > 0) {
          finalSpeed = Math.round(gpsSpeed * 3.6);
        } else {
          finalSpeed = Math.round(calculatedSpeed);
        }

        // Apply strict filter to force speed to 0 if the user moved less than 2 meters since last update
        if (lastLocationGlobal) {
          const tempCoord = { latitude: location.coords.latitude, longitude: location.coords.longitude };
          const dist = getDistanceBetweenPoints(lastLocationGlobal, tempCoord);
          if (dist <= 0.002) {
            finalSpeed = 0;
          }
        }

        // Filter out extreme telemetry speed spikes (e.g. above 250 km/h)
        if (finalSpeed > 250) {
          finalSpeed = lastLocationGlobal ? lastLocationGlobal.speed : 0;
        }

        const newCoord: Coordinate = {
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
          speed: finalSpeed,
          leanAngle: leanAngleGlobal,
          time: parseFloat(relativeTime.toFixed(1)),
        };

        // Check distance from last recorded coordinate
        let shouldAdd = false;
        let dist = 0;
        if (activeRoute.coordinates.length === 0) {
          shouldAdd = true;
        } else {
          const lastCoord = activeRoute.coordinates[activeRoute.coordinates.length - 1];
          dist = getDistanceBetweenPoints(lastCoord, newCoord);
          if (dist > 0.002) {
            shouldAdd = true;
          }
        }

        if (shouldAdd) {
          activeRoute.coordinates.push(newCoord);
          activeRoute.totalDistance += dist;
          updated = true;
          console.log(`[BackgroundLocationTask] Added point: Lat ${newCoord.latitude}, Lng ${newCoord.longitude}. Total points: ${activeRoute.coordinates.length}`);
        }

        // Update lastLocationGlobal on every location update to keep speed calculation continuous and smooth
        lastLocationGlobal = {
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
          timestamp: currentTimestamp,
          speed: finalSpeed,
        };
      }

      if (updated) {
        // Save updated state back to AsyncStorage
		await persistActiveRoute(activeRoute);

        // Also update the global module variables for any active foreground UI context
        recordedRouteGlobal = activeRoute.coordinates;
        totalDistanceGlobal = activeRoute.totalDistance;
        startTimeGlobal = activeRoute.startTime;

        // Notify active hook instances in real-time
        DeviceEventEmitter.emit('background-location-update', {
          recordedRoute: [...activeRoute.coordinates],
          totalDistance: activeRoute.totalDistance,
          speed: activeRoute.coordinates[activeRoute.coordinates.length - 1]?.speed || 0,
          currentLocation: activeRoute.coordinates[activeRoute.coordinates.length - 1],
        });
      }
    } catch (err) {
      console.error('[BackgroundLocationTask] Error saving/reading storage:', err);
    }
  }
});

export const useLocation = (currentLean?: number) => {
  const [currentLocation, setCurrentLocation] = useState<Coordinate | null>(null);
  const leanRef = useRef(0);
  const startTimeRef = useRef<number | null>(null);

  useEffect(() => {
    if (currentLean !== undefined) {
      leanRef.current = currentLean;
      leanAngleGlobal = currentLean; // Keep global value synchronized
    }
  }, [currentLean]);

  const [isRecording, setIsRecording] = useState(false);
  const [recordedRoute, setRecordedRoute] = useState<Coordinate[]>([]);
  const [totalDistance, setTotalDistance] = useState(0); // In kilometers
  const [speed, setSpeed] = useState(0); // In km/h
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const locationSubscription = useRef<Location.LocationSubscription | null>(null);

  // Load route from storage on startup or when app comes to foreground
  const loadRouteFromStorage = async () => {
    try {
	  const activeRoute = await loadActiveRoute();
	  if (activeRoute) {
        if (activeRoute && activeRoute.coordinates && activeRoute.coordinates.length > 0) {
          recordedRouteGlobal = activeRoute.coordinates;
          totalDistanceGlobal = activeRoute.totalDistance;
          startTimeGlobal = activeRoute.startTime;
          
          setRecordedRoute([...recordedRouteGlobal]);
          setTotalDistance(totalDistanceGlobal);
          
          const lastPoint = recordedRouteGlobal[recordedRouteGlobal.length - 1];
          setSpeed(lastPoint.speed || 0);
          setCurrentLocation(lastPoint);
          
          console.log(`[useLocation] Restored route from storage: ${recordedRouteGlobal.length} points, ${totalDistanceGlobal.toFixed(2)} km`);
        }
      }
    } catch (e) {
      console.error('[useLocation] Failed to load route from storage:', e);
    }
  };

  // Sync background updates to local React hook state
  useEffect(() => {
    const emitterSub = DeviceEventEmitter.addListener('background-location-update', (data) => {
      recordedRouteGlobal = data.recordedRoute;
      totalDistanceGlobal = data.totalDistance;
      
      setRecordedRoute(data.recordedRoute);
      setTotalDistance(data.totalDistance);
      setSpeed(data.speed);
      setCurrentLocation(data.currentLocation);
    });
    return () => {
      emitterSub.remove();
    };
  }, []);

  // Check active recording on hook mount/initialization
  useEffect(() => {
    const checkActiveRecording = async () => {
      try {
        const isRecordingStored = await AsyncStorage.getItem(IS_RECORDING_STORAGE_KEY);
        if (isRecordingStored === 'true') {
          console.log('[useLocation] Found active recording on hook mount. Restoring state...');
          isRecordingGlobal = true;
          setIsRecording(true);
          await loadRouteFromStorage();

          // Check if background tracking task is still running, otherwise restart it
          const started = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME);
          if (!started) {
            console.log('[useLocation] Background tracking task was stopped. Restarting location updates...');
            
            let hasBackgroundPermission = false;
            const { status: bgStatus } = await Location.getBackgroundPermissionsAsync();
            hasBackgroundPermission = bgStatus === 'granted';
            
            if (hasBackgroundPermission) {
              await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
                accuracy: Location.Accuracy.BestForNavigation,
                timeInterval: 2000,
                distanceInterval: 0,
                foregroundService: {
                  notificationTitle: 'MotoPulse - Grabando Ruta',
                  notificationBody: 'MotoPulse está registrando tu telemetría y coordenadas GPS en tiempo real.',
                  notificationColor: '#FF5A1F',
                },
              });
            } else {
              // Fallback to watchPositionAsync
              locationSubscription.current = await Location.watchPositionAsync(
                {
                  accuracy: Location.Accuracy.BestForNavigation,
                  timeInterval: 2000,
                  distanceInterval: 0,
                },
                handleLocationUpdate
              );
            }
          }
        }
      } catch (e) {
        console.warn('Failed to check active recording status:', e);
      }
    };
    checkActiveRecording();
  }, []);

  // Listen to AppState to reload route when returning to the foreground
  useEffect(() => {
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      if (nextAppState === 'active') {
        AsyncStorage.getItem(IS_RECORDING_STORAGE_KEY).then((isRecordingStored) => {
          if (isRecordingStored === 'true') {
            console.log('[useLocation] App returned to active. Reloading route from storage...');
            loadRouteFromStorage();
          }
        }).catch(err => console.warn(err));
      }
    };

    const sub = AppState.addEventListener('change', handleAppStateChange);
    return () => {
      sub.remove();
    };
  }, []);

  // Quick check and request of permissions without fetching current position (instantaneous)
  const checkAndRequestPermissions = async () => {
    try {
      const { status: existingStatus } = await Location.getForegroundPermissionsAsync();
      if (existingStatus === 'granted') {
        return true;
      }
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setErrorMsg('Location permission denied');
        Alert.alert(
          'Permiso de Ubicación Requerido',
          'MotoPulse necesita acceso a tu ubicación para rastrear tus rutas y telemetría en tiempo real. Por favor habilítalo en la configuración de tu dispositivo.'
        );
        return false;
      }
      return true;
    } catch (e) {
      console.error('Error checking permissions:', e);
      return false;
    }
  };

  // Ask for foreground permissions and get initial position (slower, queries GPS hardware for initial center)
  const requestPermissions = async () => {
    try {
      const hasPermission = await checkAndRequestPermissions();
      if (!hasPermission) return false;

      let loc = null;
      try {
        loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
      } catch (err) {
        console.warn('getCurrentPositionAsync failed, trying getLastKnownPositionAsync:', err);
        loc = await Location.getLastKnownPositionAsync();
      }

      if (loc) {
        const coord = {
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
        };
        setCurrentLocation(coord);
        return true;
      } else {
        setErrorMsg('Could not retrieve location');
        return false;
      }
    } catch (e) {
      setErrorMsg('Error requesting permissions or fetching position');
      console.error(e);
      return false;
    }
  };

  useEffect(() => {
    requestPermissions();
    return () => {
      if (locationSubscription.current) {
        locationSubscription.current.remove();
      }
    };
  }, []);

  // Unified location update handler (reused in watchPositionAsync)
  const handleLocationUpdate = (location: Location.LocationObject) => {
    const currentTimestamp = location.timestamp;
    
    if (!startTimeGlobal) {
      startTimeGlobal = currentTimestamp;
    }
    
    const relativeTime = (currentTimestamp - startTimeGlobal) / 1000;
    
    let calculatedSpeed = 0;
    if (lastLocationGlobal && lastLocationGlobal.timestamp) {
      const timeDiff = (currentTimestamp - lastLocationGlobal.timestamp) / 1000; // in seconds
      const tempCoord = { latitude: location.coords.latitude, longitude: location.coords.longitude };
      const dist = getDistanceBetweenPoints(lastLocationGlobal, tempCoord);
      
      if (dist <= 0.002 || timeDiff <= 0) {
        calculatedSpeed = 0;
      } else {
        calculatedSpeed = (dist / timeDiff) * 3600;
      }
    }

    let finalSpeed = 0;
    const gpsSpeed = location.coords.speed;
    if (gpsSpeed !== null && gpsSpeed !== undefined && gpsSpeed > 0) {
      finalSpeed = Math.round(gpsSpeed * 3.6);
    } else {
      finalSpeed = Math.round(calculatedSpeed);
    }

    if (lastLocationGlobal) {
      const tempCoord = { latitude: location.coords.latitude, longitude: location.coords.longitude };
      const dist = getDistanceBetweenPoints(lastLocationGlobal, tempCoord);
      if (dist <= 0.002) {
        finalSpeed = 0;
      }
    }

    if (finalSpeed > 250) {
      finalSpeed = lastLocationGlobal ? lastLocationGlobal.speed : 0;
    }

    setSpeed(finalSpeed);

    const newCoord: Coordinate = {
      latitude: location.coords.latitude,
      longitude: location.coords.longitude,
      speed: finalSpeed,
      leanAngle: leanRef.current,
      time: parseFloat(relativeTime.toFixed(1)),
    };

    setCurrentLocation(newCoord);

    setRecordedRoute((prevRoute) => {
      let shouldAdd = false;
      let dist = 0;
      if (recordedRouteGlobal.length === 0) {
        shouldAdd = true;
      } else {
        const lastCoord = recordedRouteGlobal[recordedRouteGlobal.length - 1];
        dist = getDistanceBetweenPoints(lastCoord, newCoord);
        if (dist > 0.002) {
          shouldAdd = true;
        }
      }

      if (shouldAdd) {
        recordedRouteGlobal.push(newCoord);
        totalDistanceGlobal += dist;
        setTotalDistance(totalDistanceGlobal);

        // Persist the updated state to AsyncStorage
		persistActiveRoute({
          coordinates: [...recordedRouteGlobal],
          totalDistance: totalDistanceGlobal,
          startTime: startTimeGlobal
		}).catch(e => console.warn('Failed to save route to storage:', e));

        console.log(`[ForegroundUpdate] Added point: Lat ${newCoord.latitude}, Lng ${newCoord.longitude}. Total points: ${recordedRouteGlobal.length}`);
        return [...recordedRouteGlobal];
      }
      return prevRoute;
    });

    // Update lastLocationGlobal on every location update
    lastLocationGlobal = {
      latitude: location.coords.latitude,
      longitude: location.coords.longitude,
      timestamp: currentTimestamp,
      speed: finalSpeed,
    };
  };

  // Start route recording
  const startRecording = async () => {
    const hasPermission = await checkAndRequestPermissions();
    if (!hasPermission) return;

    // Reset global tracking state
    recordedRouteGlobal = [];
    totalDistanceGlobal = 0;
    startTimeGlobal = Date.now();
    isRecordingGlobal = true;
    lastLocationGlobal = null;

    // Reset local React state
    setIsRecording(true);
    setRecordedRoute([]);
    setTotalDistance(0);
    setSpeed(0);
    setErrorMsg(null);
    startTimeRef.current = startTimeGlobal;

    // Clear active route and set recording active in storage
    try {
      await AsyncStorage.setItem(IS_RECORDING_STORAGE_KEY, 'true');
	  await initializeActiveRoute(startTimeGlobal);
    } catch (e) {
      console.warn('Failed to initialize AsyncStorage active route keys:', e);
    }

    // Request and check background location permissions
    let hasBackgroundPermission = false;
    try {
      const { status: bgStatus } = await Location.getBackgroundPermissionsAsync();
      hasBackgroundPermission = bgStatus === 'granted';
      if (!hasBackgroundPermission) {
        const { status: reqBgStatus } = await Location.requestBackgroundPermissionsAsync();
        hasBackgroundPermission = reqBgStatus === 'granted';
      }
    } catch (e) {
      console.warn('Failed to check background location permissions:', e);
    }

    if (hasBackgroundPermission) {
      console.log('[useLocation] Starting tracking in BACKGROUND mode (Foreground Service)');
      try {
        await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
          accuracy: Location.Accuracy.BestForNavigation,
          timeInterval: 2000, // every 2 seconds
          distanceInterval: 0, // no native distance limit, let JS check dist > 0.002
          foregroundService: {
            notificationTitle: 'MotoPulse - Grabando Ruta',
            notificationBody: 'MotoPulse está registrando tu telemetría y coordenadas GPS en tiempo real.',
            notificationColor: '#FF5A1F',
          },
        });
      } catch (err) {
        console.error('Failed to startLocationUpdatesAsync, falling back to watchPositionAsync:', err);
        hasBackgroundPermission = false;
      }
    }

    // Fallback or run concurrently in the foreground for standard watch updates
    if (!hasBackgroundPermission) {
      console.log('[useLocation] Starting tracking in FOREGROUND mode fallback');
      locationSubscription.current = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.BestForNavigation,
          timeInterval: 2000, // every 2 seconds
          distanceInterval: 0, // no native distance limit
        },
        handleLocationUpdate
      );
    }
  };

  // Stop route recording
  const stopRecording = () => {
    isRecordingGlobal = false;

    // Set recording status inactive in storage
    AsyncStorage.setItem(IS_RECORDING_STORAGE_KEY, 'false').catch((e) => {
      console.warn('Failed to update recording status in storage:', e);
    });
    
    if (locationSubscription.current) {
      locationSubscription.current.remove();
      locationSubscription.current = null;
    }

    // Stop background location updates if active
    Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME)
      .then((started) => {
        if (started) {
          Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME).catch((err) => {
            console.error('Failed to stop background location updates:', err);
          });
        }
      })
      .catch((e) => {
        console.warn('Failed checking background location status:', e);
      });

    setIsRecording(false);
    setSpeed(0);
    startTimeRef.current = null;
  };

  const clearRecordedRoute = () => {
    recordedRouteGlobal = [];
    totalDistanceGlobal = 0;
    startTimeGlobal = null;
    lastLocationGlobal = null;
    
	clearActiveRoute().catch((e) => {
      console.warn('Failed to remove active route in storage:', e);
    });
    AsyncStorage.setItem(IS_RECORDING_STORAGE_KEY, 'false').catch((e) => {
      console.warn('Failed to clear recording status in storage:', e);
    });

    setRecordedRoute([]);
    setTotalDistance(0);
    setSpeed(0);
    startTimeRef.current = null;
  };

  return {
    currentLocation,
    isRecording,
    recordedRoute,
    totalDistance: parseFloat(totalDistanceGlobal.toFixed(2)),
    speed,
    errorMsg,
    startRecording,
    stopRecording,
    clearRecordedRoute,
    requestPermissions,
  };
};

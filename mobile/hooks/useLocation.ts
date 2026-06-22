import { useState, useRef, useEffect } from 'react';
import { Alert, DeviceEventEmitter } from 'react-native';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

export interface Coordinate {
  latitude: number;
  longitude: number;
  speed?: number;
  leanAngle?: number;
  time?: number;
}

const LOCATION_TASK_NAME = 'background-location-task';

// Global variables to synchronize tracking state between the background task and hook instances
let recordedRouteGlobal: Coordinate[] = [];
let totalDistanceGlobal = 0;
let startTimeGlobal: number | null = null;
let leanAngleGlobal = 0;
let isRecordingGlobal = false;
let lastLocationGlobal: Coordinate | null = null;

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
  if (data && isRecordingGlobal) {
    const { locations } = data as { locations: Location.LocationObject[] };
    if (!locations || locations.length === 0) return;

    for (const location of locations) {
      const currentTimestamp = location.timestamp;
      
      if (!startTimeGlobal) {
        startTimeGlobal = currentTimestamp;
      }
      
      const relativeTime = (currentTimestamp - startTimeGlobal) / 1000;
      
      // Directly use the OS/sensor speed from coordinates (converted from m/s to km/h)
      const gpsSpeed = location.coords.speed;
      const speedKmh = (gpsSpeed !== null && gpsSpeed !== undefined && gpsSpeed > 0)
        ? Math.round(gpsSpeed * 3.6)
        : 0;

      const newCoord: Coordinate = {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        speed: speedKmh,
        leanAngle: leanAngleGlobal,
        time: parseFloat(relativeTime.toFixed(1)),
      };

      // Check distance from last global coordinate
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
        lastLocationGlobal = newCoord;

        // Notify active hook instances in real-time
        DeviceEventEmitter.emit('background-location-update', {
          recordedRoute: [...recordedRouteGlobal],
          totalDistance: totalDistanceGlobal,
          speed: speedKmh,
          currentLocation: newCoord,
        });

        console.log(`[BackgroundLocationTask] Added point: Lat ${newCoord.latitude}, Lng ${newCoord.longitude}. Total points: ${recordedRouteGlobal.length}`);
      }
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

  // Sync background updates to local React hook state
  useEffect(() => {
    const emitterSub = DeviceEventEmitter.addListener('background-location-update', (data) => {
      setRecordedRoute(data.recordedRoute);
      setTotalDistance(data.totalDistance);
      setSpeed(data.speed);
      setCurrentLocation(data.currentLocation);
    });
    return () => {
      emitterSub.remove();
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
            notificationColor: '#00A3E0',
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
        (location) => {
          const currentTimestamp = location.timestamp;
          const relativeTime = startTimeGlobal ? (currentTimestamp - startTimeGlobal) / 1000 : 0;
          
          const gpsSpeed = location.coords.speed;
          const speedKmh = (gpsSpeed !== null && gpsSpeed !== undefined && gpsSpeed > 0) 
            ? Math.round(gpsSpeed * 3.6) 
            : 0;
          setSpeed(speedKmh);

          const newCoord: Coordinate = {
            latitude: location.coords.latitude,
            longitude: location.coords.longitude,
            speed: speedKmh,
            leanAngle: leanRef.current,
            time: parseFloat(relativeTime.toFixed(1)),
          };

          setCurrentLocation(newCoord);
          lastLocationGlobal = newCoord;

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
              console.log(`[ForegroundLocationFallback] Added point: Lat ${newCoord.latitude}, Lng ${newCoord.longitude}. Total points: ${recordedRouteGlobal.length}`);
              return [...recordedRouteGlobal];
            }
            return prevRoute;
          });
        }
      );
    }
  };

  // Stop route recording
  const stopRecording = () => {
    isRecordingGlobal = false;
    
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

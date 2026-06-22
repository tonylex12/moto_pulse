import { useState, useRef, useEffect } from 'react';
import { Alert } from 'react-native';
import * as Location from 'expo-location';

export interface Coordinate {
  latitude: number;
  longitude: number;
}

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

export const useLocation = () => {
  const [currentLocation, setCurrentLocation] = useState<Coordinate | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordedRoute, setRecordedRoute] = useState<Coordinate[]>([]);
  const [totalDistance, setTotalDistance] = useState(0); // In kilometers
  const [speed, setSpeed] = useState(0); // In km/h
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const locationSubscription = useRef<Location.LocationSubscription | null>(null);

  // Ask for foreground permissions and get initial position
  const requestPermissions = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setErrorMsg('Location permission denied');
        Alert.alert(
          'Permiso de Ubicación Requerido',
          'MotoPulse necesita acceso a tu ubicación para rastrear tus rutas y telemetría en tiempo real. Por favor habilítalo en la configuración de tu dispositivo.'
        );
        return false;
      }

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
        setCurrentLocation({
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
        });
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
    const hasPermission = await requestPermissions();
    if (!hasPermission) return;

    setIsRecording(true);
    setRecordedRoute([]);
    setTotalDistance(0);
    setSpeed(0);
    setErrorMsg(null);

    // Watch location changes
    locationSubscription.current = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.High,
        timeInterval: 2000, // every 2 seconds
        distanceInterval: 5, // every 5 meters
      },
      (location) => {
        const newCoord: Coordinate = {
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
        };

        setCurrentLocation(newCoord);
        
        // Expose speed: convert meters/second to km/h (speed * 3.6)
        // Introduce a threshold of 1.1 m/s (~4 km/h) to filter out GPS drift/jitter when stationary
        const gpsSpeed = location.coords.speed;
        const speedKmh = gpsSpeed !== null && gpsSpeed !== undefined && gpsSpeed >= 1.1
          ? Math.max(0, Math.round(gpsSpeed * 3.6))
          : 0;
        setSpeed(speedKmh);
        
        setRecordedRoute((prevRoute) => {
          if (prevRoute.length === 0) {
            return [newCoord];
          }
          const lastCoord = prevRoute[prevRoute.length - 1];
          const dist = getDistanceBetweenPoints(lastCoord, newCoord);
          
          // Accumulate distance (only if rider has moved more than 2 meters)
          if (dist > 0.002) {
            setTotalDistance((prevDist) => prevDist + dist);
            return [...prevRoute, newCoord];
          }
          return prevRoute;
        });
      }
    );
  };

  // Stop route recording
  const stopRecording = () => {
    if (locationSubscription.current) {
      locationSubscription.current.remove();
      locationSubscription.current = null;
    }
    setIsRecording(false);
    setSpeed(0);
  };

  const clearRecordedRoute = () => {
    setRecordedRoute([]);
    setTotalDistance(0);
    setSpeed(0);
  };

  return {
    currentLocation,
    isRecording,
    recordedRoute,
    totalDistance: parseFloat(totalDistance.toFixed(2)),
    speed,
    errorMsg,
    startRecording,
    stopRecording,
    clearRecordedRoute,
    requestPermissions,
  };
};

import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, TextInput, ActivityIndicator, Modal, ScrollView, KeyboardAvoidingView, Platform, Alert } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import MapView, { Polyline, Marker, PROVIDER_DEFAULT, UrlTile } from 'react-native-maps';
import { WebView } from 'react-native-webview';
import { Play, Square, Navigation, Bookmark, X, Eye, Trash2, Video, Settings } from 'lucide-react-native';
import { Accelerometer } from 'expo-sensors';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { VideoView, useVideoPlayer } from 'expo-video';
import Svg, { Path, Circle, Line, Text as SvgText, Defs, LinearGradient, Stop, G } from 'react-native-svg';

// Safe load of expo-media-library to prevent runtime crash in environments where the native module is not compiled yet
let MediaLibrary: any = null;
try {
  MediaLibrary = require('expo-media-library');
} catch (e) {
  // Graceful fallback if native module is not compiled in the current binary (e.g. standard Expo Go or simulator)
}

import { api } from '../../utils/api';
import { useLocation, Coordinate } from '../../hooks/useLocation';
import { useAlert } from '../../utils/AlertContext';
import { useTheme } from '../../utils/ThemeContext';

interface SavedRoute {
  id: string;
  name: string;
  coordinates: Coordinate[];
  startPoint: string | null;
  endPoint: string | null;
  distance: number | null;
  notes: string | null;
  maxSpeed?: number | null;
  maxLeftLean?: number | null;
  maxRightLean?: number | null;
}

export default function RoutesMapScreen() {
  const { showAlert } = useAlert();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const mapRef = useRef<MapView | null>(null);
  const webViewRef = useRef<WebView | null>(null);

  // Telemetry States
  const [hasAccelerometer, setHasAccelerometer] = useState<boolean | null>(null);
  const [leanAngle, setLeanAngle] = useState(0);
  const [maxLeftLean, setMaxLeftLean] = useState(0);
  const [maxRightLean, setMaxRightLean] = useState(0);
  const [maxSpeed, setMaxSpeed] = useState(0);
  const [simSpeed, setSimSpeed] = useState(0);
  const [simLean, setSimLean] = useState(0);

  // Manual Inclinometer Calibration States & Refs
  const [manualCalibrationOffset, setManualCalibrationOffset] = useState(0);
  const calibrationOffsetRef = useRef(0);
  const rawLeanRef = useRef(0);

  // Acceleration/G-force Telemetry States & Refs
  const [acceleration, setAcceleration] = useState(0);
  const [maxAccel, setMaxAccel] = useState(0);
  const [maxDecel, setMaxDecel] = useState(0);
  const lastSpeedForAccelRef = useRef(0);
  const lastSpeedTimeRef = useRef(Date.now());

  const {
    currentLocation,
    isRecording,
    recordedRoute,
    totalDistance,
    speed,
    startRecording,
    stopRecording,
    clearRecordedRoute,
    requestPermissions
  } = useLocation(leanAngle);

  // States
  const [savedRoutes, setSavedRoutes] = useState<SavedRoute[]>([]);
  const [loading, setLoading] = useState(true);
  const [saveModalVisible, setSaveModalVisible] = useState(false);
  const [routesModalVisible, setRoutesModalVisible] = useState(false);

  // Camera HUD States
  const [cameraModeActive, setCameraModeActive] = useState(false);
  const [isRecordingVideo, setIsRecordingVideo] = useState(false);
  const cameraRef = useRef<CameraView | null>(null);

  // Defensive camera recording cleanup on component unmount
  useEffect(() => {
    return () => {
      if (cameraRef.current) {
        try {
          cameraRef.current.stopRecording();
        } catch (e) {
          // Ignore
        }
      }
    };
  }, []);

  // Video Playback overlay state linked to AsyncStorage
  const [recordedVideoUri, setRecordedVideoUri] = useState<string | null>(null);
  const [routeVideos, setRouteVideos] = useState<Record<string, string>>({});

  // Telemetry Player States
  const [playbackModalVisible, setPlaybackModalVisible] = useState(false);
  const [playbackVideoUri, setPlaybackVideoUri] = useState<string | null>(null);
  const [playbackRoute, setPlaybackRoute] = useState<SavedRoute | null>(null);
  const [playbackSpeed, setPlaybackSpeed] = useState(0);
  const [playbackLean, setPlaybackLean] = useState(0);
  
  // Video Playback Acceleration/Deceleration Tracking
  const lastPlaybackSpeedRef = useRef(0);
  const lastPlaybackSpeedTimeRef = useRef(Date.now());
  const [playbackAccel, setPlaybackAccel] = useState(0);

  useEffect(() => {
    const now = Date.now();
    const timeDiff = (now - lastPlaybackSpeedTimeRef.current) / 1000;
    if (timeDiff > 0.5) {
      const currentSpeedMps = playbackSpeed / 3.6;
      const prevSpeedMps = lastPlaybackSpeedRef.current / 3.6;
      const calculated = timeDiff > 0 ? (currentSpeedMps - prevSpeedMps) / timeDiff : 0;
      setPlaybackAccel(parseFloat(calculated.toFixed(1)));
      lastPlaybackSpeedRef.current = playbackSpeed;
      lastPlaybackSpeedTimeRef.current = now;
    }
  }, [playbackSpeed]);
  const [isPlayingVideo, setIsPlayingVideo] = useState(false);
  const [playbackTime, setPlaybackTime] = useState(0);
  const [playbackDuration, setPlaybackDuration] = useState(0);

  // Refs for camera video state to avoid stale closures in handleSaveRoute
  const isRecordingVideoRef = useRef(false);
  const recordedVideoUriRef = useRef<string | null>(null);

  useEffect(() => {
    isRecordingVideoRef.current = isRecordingVideo;
  }, [isRecordingVideo]);

  useEffect(() => {
    recordedVideoUriRef.current = recordedVideoUri;
  }, [recordedVideoUri]);

  // Initialize Video Player for playback (using static null source to prevent React hook re-initialization and native release crashes)
  const videoPlayer = useVideoPlayer(null, (player) => {
    player.loop = false;
    player.timeUpdateEventInterval = 0.1; // 100ms updates
  });

  // Synchronize playback timeline with route coordinates telemetry
  useEffect(() => {
    if (!videoPlayer) return;

    const timeUpdateSub = videoPlayer.addListener('timeUpdate', (event) => {
      const time = event.currentTime;
      setPlaybackTime(time);
      if (videoPlayer.duration && videoPlayer.duration !== playbackDuration) {
        setPlaybackDuration(videoPlayer.duration);
      }
      if (playbackRoute && playbackRoute.coordinates && playbackRoute.coordinates.length > 0) {
        const coords = playbackRoute.coordinates as Coordinate[];
        
        // Find the closest coordinate point in time relative to the video playhead
        let closestPoint = coords[0];
        let minDiff = Infinity;
        
        for (const point of coords) {
          const ptTime = point.time ?? 0;
          const diff = Math.abs(ptTime - time);
          if (diff < minDiff) {
            minDiff = diff;
            closestPoint = point;
          }
        }
        
        if (closestPoint) {
          setPlaybackSpeed(closestPoint.speed ?? 0);
          setPlaybackLean(closestPoint.leanAngle ?? 0);
        }
      }
    });

    const playingChangeSub = videoPlayer.addListener('playingChange', (event) => {
      setIsPlayingVideo(event.isPlaying);
    });

    return () => {
      timeUpdateSub.remove();
      playingChangeSub.remove();
    };
  }, [videoPlayer, playbackRoute]);

  // Map Type State
  const [mapType, setMapType] = useState<'standard' | 'hybrid'>('standard');

  // Permissions Hooks
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [microphonePermission, requestMicrophonePermission] = useMicrophonePermissions();

  const handleToggleCameraMode = async () => {
    if (isRecording || isRecordingVideo) {
      showAlert('Modo Cámara', 'No puedes cambiar el modo de cámara mientras se graba la ruta o se procesa el video.');
      return;
    }

    if (!cameraModeActive) {
      let camGranted = cameraPermission?.granted;
      if (!camGranted) {
        const res = await requestCameraPermission();
        camGranted = res.granted;
      }

      // Check and request microphone permission (required for video recording)
      let micGranted = microphonePermission?.granted;
      if (!micGranted) {
        try {
          const res = await requestMicrophonePermission();
          micGranted = res.granted;
        } catch (e) {
          console.warn('Failed to request microphone permission:', e);
        }
      }

      let libGranted = false;
      if (MediaLibrary) {
        try {
          const perm = await MediaLibrary.getPermissionsAsync();
          if (perm.granted) {
            libGranted = true;
          } else {
            const res = await MediaLibrary.requestPermissionsAsync();
            libGranted = res.granted === 'granted' || res.status === 'granted' || res.granted === true;
          }
        } catch (e) {
          console.warn('Failed to check media library permissions:', e);
        }
      } else {
        // Fallback if media library module is not compiled
        libGranted = true;
      }

      // We only strictly require camera and gallery permissions to enter this mode.
      // If microphone is denied, we record video in muted state as fallback.
      if (!camGranted || !libGranted) {
        showAlert('Permisos requeridos', 'Se necesitan permisos de cámara y galería de fotos para activar el visor de grabación.');
        return;
      }

      setCameraModeActive(true);
    } else {
      // Defensively stop any recording before disabling camera mode
      if (cameraRef.current) {
        try {
          cameraRef.current.stopRecording();
        } catch (err) {
          console.warn('Failed to stop recording on camera mode toggle off:', err);
        }
      }
      setIsRecordingVideo(false);
      setCameraModeActive(false);
    }
  };
  
  // Save route form state
  const [routeName, setRouteName] = useState('');
  const [startPoint, setStartPoint] = useState('');
  const [endPoint, setEndPoint] = useState('');
  const [routeNotes, setRouteNotes] = useState('');
  const [saving, setSaving] = useState(false);

  // Selected route to view on map
  const [selectedRoute, setSelectedRoute] = useState<SavedRoute | null>(null);

  // WebView synchronization effects for Android
  useEffect(() => {
    if (Platform.OS === 'android' && webViewRef.current) {
      const js = `if (window.setMapType) window.setMapType('${mapType}', ${colors.isDark});`;
      webViewRef.current.injectJavaScript(js);
    }
  }, [mapType, colors.isDark]);

  useEffect(() => {
    if (Platform.OS === 'android' && currentLocation && webViewRef.current) {
      const shouldCenter = !hasCenteredRef.current;
      const js = `if (window.updateUserLocation) window.updateUserLocation(${currentLocation.latitude}, ${currentLocation.longitude}, ${shouldCenter});`;
      webViewRef.current.injectJavaScript(js);
      if (shouldCenter) {
        hasCenteredRef.current = true;
      }
    }
  }, [currentLocation]);

  useEffect(() => {
    if (Platform.OS === 'android' && webViewRef.current) {
      const js = `if (window.updateRecordedRoute) window.updateRecordedRoute(${JSON.stringify(JSON.stringify(recordedRoute))});`;
      webViewRef.current.injectJavaScript(js);
    }
  }, [recordedRoute]);

  useEffect(() => {
    if (Platform.OS === 'android' && webViewRef.current) {
      const coords = selectedRoute ? selectedRoute.coordinates : [];
      const js = `if (window.showSelectedRoute) window.showSelectedRoute(${JSON.stringify(JSON.stringify(coords))});`;
      webViewRef.current.injectJavaScript(js);
    }
  }, [selectedRoute]);

  const fetchRoutes = async () => {
    try {
      // Changed to relative path without leading slash
      const res = await api.get('routes');
      const formatted = res.data.map((r: any) => ({
        ...r,
        coordinates: typeof r.coordinates === 'string' ? JSON.parse(r.coordinates) : r.coordinates
      }));
      setSavedRoutes(formatted);

      // Load route video links from local AsyncStorage
      try {
        const keys = formatted.map((r: any) => `route_video_${r.id}`);
        const pairs = await AsyncStorage.multiGet(keys);
        const mapping: Record<string, string> = {};
        pairs.forEach(([key, val]) => {
          if (val) {
            const routeId = key.replace('route_video_', '');
            mapping[routeId] = val;
          }
        });
        setRouteVideos(mapping);
      } catch (storageErr) {
        console.error('Error fetching route video mappings:', storageErr);
      }
    } catch (e) {
      console.error('Error fetching saved routes:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRoutes();

    // Check if Accelerometer is available
    let isMounted = true;
    Accelerometer.isAvailableAsync().then((available) => {
      if (isMounted) {
        setHasAccelerometer(available);
      }
    }).catch(() => {
      if (isMounted) {
        setHasAccelerometer(false);
      }
    });

    return () => {
      isMounted = false;
    };
  }, []);

  // Load manual calibration offset from AsyncStorage on mount
  useEffect(() => {
    AsyncStorage.getItem('@motopulse_lean_calibration_offset')
      .then((val) => {
        if (val !== null) {
          const offset = parseFloat(val);
          calibrationOffsetRef.current = offset;
          setManualCalibrationOffset(offset);
          console.log('[Telemetry] Loaded manual lean calibration offset:', offset);
        }
      })
      .catch((e) => console.warn('Failed to load manual calibration offset:', e));
  }, []);

  // Manual Calibration trigger
  const handleCalibrateLean = async () => {
    // Current raw Lean (before offset subtraction) is rawLeanRef.current.
    // Setting offset to current raw Lean will result in calibrated value being 0!
    const currentRaw = rawLeanRef.current;
    calibrationOffsetRef.current = currentRaw;
    setManualCalibrationOffset(currentRaw);
    
    // Reset all peak telemetry metrics to 0
    setMaxLeftLean(0);
    setMaxRightLean(0);
    setMaxSpeed(0);
    setAcceleration(0);
    setMaxAccel(0);
    setMaxDecel(0);
    lastSpeedForAccelRef.current = 0;
    lastSpeedTimeRef.current = Date.now();
    
    try {
      await AsyncStorage.setItem('@motopulse_lean_calibration_offset', currentRaw.toString());
      Alert.alert(
        'Calibración y Telemetría Reseteada', 
        'El inclinómetro se calibró a 0° y todos los picos de velocidad, inclinación y aceleración se reiniciaron.'
      );
    } catch (e) {
      console.warn('Failed to save manual lean calibration offset:', e);
    }
  };

  // Synchronize refs for speed and simSpeed to avoid capturing stale values in sensor listeners
  const speedRef = useRef(0);
  const simSpeedRef = useRef(0);

  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);

  useEffect(() => {
    simSpeedRef.current = simSpeed;
  }, [simSpeed]);

  // Native Accelerometer listener when screen is mounted and available
  useEffect(() => {
    if (!hasAccelerometer || Platform.OS === 'web') return;

    Accelerometer.setUpdateInterval(100); // 10Hz updates

    let prevLean = 0;
    const smoothingFactor = 0.15; // Low-pass filter smoothing
    let isCalibrated = false;
    let calibrationOffset = 0;

    const subscription = Accelerometer.addListener((data) => {
      // Calculate roll angle: atan2(x, -y)
      // data.x, data.y are in Gs
      const angleRad = Math.atan2(data.x, -data.y);
      const rawLean = angleRad * (180 / Math.PI);

      if (isNaN(rawLean)) return;

      // Smooth signal to filter engine vibration and bumps
      const smoothedLean = (1 - smoothingFactor) * prevLean + smoothingFactor * rawLean;
      prevLean = smoothedLean;

      // Read current speed from ref to ensure up-to-date value without effect re-subscription
      const currentSpeed = speedRef.current;

      // Set raw lean reference for manual calibration (uses current smoothed value before tare)
      rawLeanRef.current = smoothedLean;

      // Self-calibration fallback: when we first start moving (speed > 5 km/h) and manual calibration hasn't been set (is 0)
      if (!isCalibrated && currentSpeed > 5 && calibrationOffsetRef.current === 0) {
        calibrationOffsetRef.current = smoothedLean;
        setManualCalibrationOffset(smoothedLean);
        isCalibrated = true;
        console.log('Telemetry auto-calibrated. Offset set to:', smoothedLean);
      }

      // Apply calibration offset (either manual or auto-calibrated)
      const calibratedLean = smoothedLean - calibrationOffsetRef.current;

      const roundedLean = Math.round(calibratedLean);
      const clampedLean = Math.max(-60, Math.min(60, roundedLean));
      
      // Apply a small deadband of 1.5 degrees around 0 to avoid jitter when riding straight
      const finalLean = Math.abs(clampedLean) <= 1 ? 0 : clampedLean;
      setLeanAngle(finalLean);

      // Record peak lean angles only when actually moving (speed > 5 km/h) to avoid kickstand or stoplight noise
      if (currentSpeed > 5) {
        if (finalLean < 0) {
          setMaxLeftLean((prev) => Math.max(prev, Math.abs(finalLean)));
        } else if (finalLean > 0) {
          setMaxRightLean((prev) => Math.max(prev, finalLean));
        }
      }
    });

    return () => {
      subscription.remove();
    };
  }, [hasAccelerometer]);

  // Simulated Telemetry logic (web/simulator fallback)
  useEffect(() => {
    if (!isRecording) {
      setSimSpeed(0);
      setSimLean(0);
      return;
    }

    const useSim = Platform.OS === 'web' || hasAccelerometer === false;
    if (!useSim) return;

    let t = 0;
    const interval = setInterval(() => {
      t += 0.05;

      // Generate lean sweeps: simulate curved roads
      const wave = Math.sin(t * 0.8) * Math.cos(t * 0.2);
      let rawLean = Math.round(wave * 45); // up to 45 degrees

      // If lean is very small, make it 0 (straight road)
      if (Math.abs(rawLean) < 4) rawLean = 0;

      // Speed decreases in curves, increases in straights
      const leanFactor = Math.abs(rawLean) / 45; // 0 to 1
      const baseSpeed = 85;
      const targetSpeed = baseSpeed + (1 - leanFactor) * 35 - leanFactor * 30 + Math.sin(t * 2) * 5;
      const roundedSpeed = Math.max(0, Math.round(targetSpeed));

      setSimSpeed(roundedSpeed);
      setSimLean(rawLean);

      // Record peak values
      if (rawLean < 0) {
        setMaxLeftLean((prev) => Math.max(prev, Math.abs(rawLean)));
      } else if (rawLean > 0) {
        setMaxRightLean((prev) => Math.max(prev, rawLean));
      }
    }, 100);

    return () => clearInterval(interval);
  }, [isRecording, hasAccelerometer]);

  // Track peak speed and calculate real-time acceleration during recording
  useEffect(() => {
    if (!isRecording) {
      setAcceleration(0);
      return;
    }
    const currentSpeed = (Platform.OS === 'web' || hasAccelerometer === false) ? simSpeed : speed;
    if (currentSpeed > maxSpeed) {
      setMaxSpeed(currentSpeed);
    }

    const now = Date.now();
    const timeDiffSec = (now - lastSpeedTimeRef.current) / 1000;
    if (timeDiffSec > 0.5) {
      const currentSpeedMps = currentSpeed / 3.6;
      const prevSpeedMps = lastSpeedForAccelRef.current / 3.6;
      const rawAccel = (currentSpeedMps - prevSpeedMps) / timeDiffSec; // in m/s2
      
      // Smooth the acceleration to filter noise
      const newAccel = parseFloat((acceleration * 0.7 + rawAccel * 0.3).toFixed(1));
      setAcceleration(newAccel);
      
      if (newAccel > 0) {
        setMaxAccel((prev) => parseFloat(Math.max(prev, newAccel).toFixed(1)));
      } else if (newAccel < 0) {
        setMaxDecel((prev) => parseFloat(Math.min(prev, newAccel).toFixed(1)));
      }
      
      lastSpeedForAccelRef.current = currentSpeed;
      lastSpeedTimeRef.current = now;
    }
  }, [speed, simSpeed, isRecording, maxSpeed, acceleration]);

  // Simple blinking state for GPS/Video recording indicators to avoid NativeWind CSSInterop animation warnings
  const [hudBlink, setHudBlink] = useState(true);
  useEffect(() => {
    let interval: any;
    if (isRecording || isRecordingVideo) {
      interval = setInterval(() => {
        setHudBlink((b) => !b);
      }, 1000);
    } else {
      setHudBlink(true);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isRecording, isRecordingVideo]);

  // Automatically center map on user location when first retrieved
  const hasCenteredRef = useRef(false);
  useEffect(() => {
    if (currentLocation && mapRef.current && !hasCenteredRef.current) {
      hasCenteredRef.current = true;
      mapRef.current.animateToRegion({
        latitude: currentLocation.latitude,
        longitude: currentLocation.longitude,
        latitudeDelta: 0.015,
        longitudeDelta: 0.015,
      }, 1000);
    }
  }, [currentLocation]);

  // Center map on user location
  const centerOnUser = () => {
    if (currentLocation) {
      if (Platform.OS === 'android') {
        if (webViewRef.current) {
          const js = `if (window.centerOnUser) window.centerOnUser(${currentLocation.latitude}, ${currentLocation.longitude});`;
          webViewRef.current.injectJavaScript(js);
        }
      } else if (mapRef.current) {
        mapRef.current.animateToRegion({
          latitude: currentLocation.latitude,
          longitude: currentLocation.longitude,
          latitudeDelta: 0.015,
          longitudeDelta: 0.015,
        }, 1000);
      }
    } else {
      requestPermissions();
    }
  };

  // Start route capture
  const handleStartTracking = async () => {
    if (cameraModeActive && isRecordingVideo) {
      showAlert('Guardando video', 'Espera a que se termine de procesar y guardar la grabación anterior.');
      return;
    }

    setSelectedRoute(null);
    setLeanAngle(0);
    setMaxLeftLean(0);
    setMaxRightLean(0);
    setMaxSpeed(0);
    setSimLean(0);
    setSimSpeed(0);
    setAcceleration(0);
    setMaxAccel(0);
    setMaxDecel(0);
    lastSpeedForAccelRef.current = 0;
    lastSpeedTimeRef.current = Date.now();
    await startRecording();

    // Start recording video if in camera mode
    if (cameraModeActive && cameraRef.current) {
      try {
        setIsRecordingVideo(true);
        cameraRef.current.recordAsync().then(async (file) => {
          if (file && file.uri) {
            let savedToGallery = false;
            let videoIdentifier = file.uri;
            if (MediaLibrary) {
              try {
                // 1. Try class-based modern SDK 56 API: MediaLibrary.Asset.create
                if (MediaLibrary.Asset && typeof MediaLibrary.Asset.create === 'function') {
                  const asset = await MediaLibrary.Asset.create(file.uri);
                  savedToGallery = true;
                  if (asset && asset.uri) {
                    videoIdentifier = asset.uri;
                  }
                } 
                // 2. Try the legacy package if imported or if we can require it dynamically
                else {
                  let legacyMediaLibrary = null;
                  try {
                    legacyMediaLibrary = require('expo-media-library/legacy');
                  } catch (err) {}
                  
                  if (legacyMediaLibrary && typeof legacyMediaLibrary.saveToLibraryAsync === 'function') {
                    await legacyMediaLibrary.saveToLibraryAsync(file.uri);
                    savedToGallery = true;
                  } else if (legacyMediaLibrary && typeof legacyMediaLibrary.createAssetAsync === 'function') {
                    const asset = await legacyMediaLibrary.createAssetAsync(file.uri);
                    savedToGallery = true;
                    if (asset && asset.uri) {
                      videoIdentifier = asset.uri;
                    }
                  }
                }
              } catch (saveErr) {
                console.error('Failed to save to gallery:', saveErr);
              }
            }

            setRecordedVideoUri(videoIdentifier);

            if (savedToGallery) {
              showAlert('Video Guardado', 'El video de tu ruta se ha guardado en tu galería.');
            } else {
              showAlert('Ruta Finalizada', `Grabación guardada localmente: ${file.uri}`);
            }
          }
          setIsRecordingVideo(false);
        }).catch((err) => {
          console.warn('Error recording video:', err);
          setIsRecordingVideo(false);
          showAlert('Error de Grabación', 'No se pudo iniciar o guardar la grabación de video.');
        });
      } catch (err) {
        console.warn('Failed to start camera recording:', err);
        setIsRecordingVideo(false);
        showAlert('Error de Grabación', 'No se pudo iniciar la grabación de video.');
      }
    }

    showAlert('Ruta Iniciada', 'MotoPulse está grabando tus coordenadas GPS y telemetría.');
  };

  // Stop route capture
  const handleStopTracking = () => {
    if (cameraModeActive && cameraRef.current) {
      try {
        cameraRef.current.stopRecording();
      } catch (err) {
        console.warn('Defensive stopRecording in handleStopTracking failed:', err);
      }
    }
    stopRecording();
    if (recordedRoute.length < 2) {
      showAlert('Ruta muy corta', 'No se grabaron suficientes coordenadas para guardar la ruta.');
      clearRecordedRoute();
      return;
    }
    // Pre-fill fields
    setRouteName(`Ruta ${new Date().toLocaleDateString('es-ES')}`);
    setSaveModalVisible(true);
  };

  // Save route in db
  const handleSaveRoute = async () => {
    if (!routeName.trim()) {
      showAlert('Error', 'Por favor ingresa un nombre para la ruta');
      return;
    }

    setSaving(true);
    try {
      // If camera is active and we are still processing/recording video, wait for it to finish saving
      if (cameraModeActive && isRecordingVideoRef.current) {
        let attempts = 0;
        // Loop check every 500ms for up to 15 seconds
        while (isRecordingVideoRef.current && attempts < 30) {
          await new Promise((resolve) => setTimeout(resolve, 500));
          attempts++;
        }
      }

      const payload = {
        name: routeName.trim(),
        coordinates: recordedRoute,
        startPoint: startPoint.trim() || undefined,
        endPoint: endPoint.trim() || undefined,
        distance: totalDistance,
        notes: routeNotes.trim() || undefined,
        maxSpeed: maxSpeed || undefined,
        maxLeftLean: maxLeftLean || undefined,
        maxRightLean: maxRightLean || undefined,
      };

      // Changed to relative path without leading slash
      const res = await api.post('routes', payload);
      const savedRoute = res.data;
      const videoUri = recordedVideoUriRef.current;
      if (savedRoute && savedRoute.id && videoUri) {
        try {
          await AsyncStorage.setItem(`route_video_${savedRoute.id}`, videoUri);
          setRouteVideos(prev => ({ ...prev, [savedRoute.id]: videoUri }));
        } catch (storageErr) {
          console.error('Failed to link video in AsyncStorage:', storageErr);
        }
      }
      setRecordedVideoUri(null);

      showAlert('Ruta Guardada', 'La ruta ha sido añadida a tus favoritos.');
      
      // Reset forms & close
      setRouteName('');
      setStartPoint('');
      setEndPoint('');
      setRouteNotes('');
      setSaveModalVisible(false);
      clearRecordedRoute();

      // Refresh list
      fetchRoutes();
    } catch (e: any) {
      console.error(e);
      showAlert('Error', e.response?.data?.error || 'No se pudo guardar la ruta');
    } finally {
      setSaving(false);
    }
  };

  // Focus and draw selected route on map
  const handleViewRoute = (route: SavedRoute) => {
    setSelectedRoute(route);
    setRoutesModalVisible(false);

    if (route.coordinates.length > 0) {
      if (Platform.OS === 'android') {
        if (webViewRef.current) {
          const js = `if (window.showSelectedRoute) window.showSelectedRoute(${JSON.stringify(JSON.stringify(route.coordinates))});`;
          webViewRef.current.injectJavaScript(js);
        }
      } else if (mapRef.current) {
        const lats = route.coordinates.map(c => c.latitude);
        const lons = route.coordinates.map(c => c.longitude);
        const minLat = Math.min(...lats);
        const maxLat = Math.max(...lats);
        const minLon = Math.min(...lons);
        const maxLon = Math.max(...lons);

        mapRef.current.animateToRegion({
          latitude: (minLat + maxLat) / 2,
          longitude: (minLon + maxLon) / 2,
          latitudeDelta: (maxLat - minLat) * 1.3,
          longitudeDelta: (maxLon - minLon) * 1.3,
        }, 1000);
      }
    }
  };

  const handleDeleteRoute = (routeId: string) => {
    showAlert(
      'Eliminar Ruta',
      '¿Deseas eliminar esta ruta de tus favoritos?',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: async () => {
            try {
              // Changed to relative path without leading slash
              await api.delete(`routes/${routeId}`);
              if (selectedRoute?.id === routeId) {
                setSelectedRoute(null);
              }
              fetchRoutes();
            } catch (e) {
              console.error(e);
              showAlert('Error', 'No se pudo eliminar la ruta');
            }
          }
        }
      ]
    );
  };

  const renderBikeSensorDashboard = (
    currentSpeed: number,
    currentLean: number,
    leftMax: number,
    rightMax: number,
    tripDist: number,
    peakSpeed: number,
    currentAccel: number,
    peakAccel: number,
    peakDecel: number,
    isConnected: boolean,
    isPlaybackMode = false,
    isMiniMode = false,
    scale = 1.0
  ) => {
    // Helper math functions for SVG polar coordinates
    const polarToX = (centerX: number, centerY: number, radius: number, angleInDegrees: number) => {
      const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180.0;
      return centerX + radius * Math.cos(angleInRadians);
    };

    const polarToY = (centerX: number, centerY: number, radius: number, angleInDegrees: number) => {
      const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180.0;
      return centerY + radius * Math.sin(angleInRadians);
    };

    const getArcPath = (cx: number, cy: number, r: number, startAngle: number, endAngle: number) => {
      const startX = polarToX(cx, cy, r, startAngle);
      const startY = polarToY(cx, cy, r, startAngle);
      const endX = polarToX(cx, cy, r, endAngle);
      const endY = polarToY(cx, cy, r, endAngle);
      const largeArcFlag = endAngle - startAngle <= 180 ? '0' : '1';
      return `M ${startX} ${startY} A ${r} ${r} 0 ${largeArcFlag} 1 ${endX} ${endY}`;
    };

    // Parameters of layout
    const cx = 150;
    const cy = 160;
    const rLean = 100;
    const rOuter = 85;

    // Needle and max peak calculations
    // 0 tilt is straight up, which maps to 0 degrees of the top arc.
    // The top arc spans from -50 (left tilt) to +50 (right tilt).
    const needleAngle = currentLean;
    const leftMaxAngle = -leftMax;
    const rightMaxAngle = rightMax;

    // Speed arc calculation (0 to 250)
    // Left side spans from -135 degrees (bottom left) to -45 degrees (top left)
    const speedPercent = Math.min(1, currentSpeed / 250);
    const speedStartAngle = -135;
    const speedEndAngle = -135 + speedPercent * 90; // spans 90 degrees total

    // Accel arc calculation (from -6.0 to +6.0 m/s2)
    // Right side spans from 135 degrees (bottom right, decel) to 45 degrees (top right, accel)
    // Middle/Zero is 90 degrees (right horizontal)
    const accelVal = Math.max(-6, Math.min(6, currentAccel));
    const accelStartAngle = 90; // zero reference
    const accelEndAngle = 90 - (accelVal / 6.0) * 45; // goes up to 45 degrees or down to 135 degrees

    return (
      <View 
        className={isMiniMode 
          ? "bg-[#0F1216]/95 border border-[#202630]/60 rounded-2xl p-2 items-center justify-center relative"
          : "bg-[#0F1216]/95 border border-[#202630] rounded-3xl p-3 items-center justify-center relative self-center"
        }
        style={isMiniMode ? {
          width: 160,
          height: 142,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.4,
          shadowRadius: 6,
          elevation: 6,
        } : {
          width: 320 * scale,
          height: 335 * scale,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 8 },
          shadowOpacity: 0.5,
          shadowRadius: 10,
          elevation: 10,
        }}
      >
        <Svg width={isMiniMode ? 150 : 300 * scale} height={isMiniMode ? 132.5 : 265 * scale} viewBox="0 0 300 265">
          <Defs>
            {/* Lean Gradient */}
            <LinearGradient id="leanGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <Stop offset="0%" stopColor="#EF4444" />
              <Stop offset="20%" stopColor="#F59E0B" />
              <Stop offset="50%" stopColor="#10B981" />
              <Stop offset="80%" stopColor="#F59E0B" />
              <Stop offset="100%" stopColor="#EF4444" />
            </LinearGradient>

            {/* Speed Arc Gradient */}
            <LinearGradient id="speedGrad" x1="0%" y1="100%" x2="100%" y2="0%">
              <Stop offset="0%" stopColor="#005A9C" />
              <Stop offset="100%" stopColor="#00E5FF" />
            </LinearGradient>

            {/* Acceleration Arc Gradient */}
            <LinearGradient id="accelGrad" x1="0%" y1="100%" x2="0%" y2="0%">
              <Stop offset="0%" stopColor="#F59E0B" />
              <Stop offset="100%" stopColor="#10B981" />
            </LinearGradient>
          </Defs>

          {/* === TOP LEAN GAUGE === */}
          {/* Background Track */}
          <Path 
            d={getArcPath(cx, cy, rLean, -50, 50)} 
            fill="none" 
            stroke="#1A202C" 
            strokeWidth={10} 
            strokeLinecap="round" 
          />
          {/* Gradient Visual Layer */}
          <Path 
            d={getArcPath(cx, cy, rLean, -50, 50)} 
            fill="none" 
            stroke="url(#leanGrad)" 
            strokeWidth={8} 
            strokeLinecap="round" 
            opacity={0.8}
          />
          {/* Center Zero Marker */}
          <Line 
            x1={polarToX(cx, cy, rLean - 8, 0)} 
            y1={polarToY(cx, cy, rLean - 8, 0)} 
            x2={polarToX(cx, cy, rLean + 8, 0)} 
            y2={polarToY(cx, cy, rLean + 8, 0)} 
            stroke="#FFFFFF" 
            strokeWidth={2} 
          />
          
          {/* Standard scale ticks */}
          {[-30, 30].map((tick) => (
            <G key={`lean-tick-${tick}`}>
              <Line 
                x1={polarToX(cx, cy, rLean - 5, tick)} 
                y1={polarToY(cx, cy, rLean - 5, tick)} 
                x2={polarToX(cx, cy, rLean + 5, tick)} 
                y2={polarToY(cx, cy, rLean + 5, tick)} 
                stroke="#A0AEC0" 
                strokeWidth={1.5} 
              />
              <SvgText
                x={polarToX(cx, cy, rLean + 14, tick)}
                y={polarToY(cx, cy, rLean + 14, tick) + 3}
                fill="#8F9CAE"
                fontSize={9}
                fontWeight="bold"
                textAnchor="middle"
              >
                {Math.abs(tick)}
              </SvgText>
            </G>
          ))}

          {/* Current Lean Needle */}
          <Line 
            x1={polarToX(cx, cy, rLean - 10, needleAngle)} 
            y1={polarToY(cx, cy, rLean - 10, needleAngle)} 
            x2={polarToX(cx, cy, rLean + 10, needleAngle)} 
            y2={polarToY(cx, cy, rLean + 10, needleAngle)} 
            stroke="#FFFFFF" 
            strokeWidth={3.5} 
            strokeLinecap="round" 
          />

          {/* Max Left Peak Marker */}
          {leftMax > 0 && (
            <G>
              <Line 
                x1={polarToX(cx, cy, rLean - 8, leftMaxAngle)} 
                y1={polarToY(cx, cy, rLean - 8, leftMaxAngle)} 
                x2={polarToX(cx, cy, rLean + 8, leftMaxAngle)} 
                y2={polarToY(cx, cy, rLean + 8, leftMaxAngle)} 
                stroke="#EF4444" 
                strokeWidth={2.5} 
              />
              <SvgText
                x={polarToX(cx, cy, rLean - 20, leftMaxAngle)}
                y={polarToY(cx, cy, rLean - 20, leftMaxAngle) + 4}
                fill="#EF4444"
                fontSize={12}
                fontWeight="bold"
                textAnchor="middle"
              >
                {leftMax}°
              </SvgText>
            </G>
          )}

          {/* Max Right Peak Marker */}
          {rightMax > 0 && (
            <G>
              <Line 
                x1={polarToX(cx, cy, rLean - 8, rightMaxAngle)} 
                y1={polarToY(cx, cy, rLean - 8, rightMaxAngle)} 
                x2={polarToX(cx, cy, rLean + 8, rightMaxAngle)} 
                y2={polarToY(cx, cy, rLean + 8, rightMaxAngle)} 
                stroke="#10B981" 
                strokeWidth={2.5} 
              />
              <SvgText
                x={polarToX(cx, cy, rLean + 20, rightMaxAngle)}
                y={polarToY(cx, cy, rLean + 20, rightMaxAngle) + 4}
                fill="#10B981"
                fontSize={12}
                fontWeight="bold"
                textAnchor="middle"
              >
                {rightMax}°
              </SvgText>
            </G>
          )}

          {/* Current Lean text HUD */}
          <SvgText
            x={cx}
            y={cy - 74}
            fill="#10B981"
            fontSize={20}
            fontWeight="bold"
            textAnchor="middle"
          >
            {Math.abs(currentLean)}°
          </SvgText>


          {/* === CENTER DIAL FRAME === */}
          <Circle 
            cx={cx} 
            cy={cy} 
            r={70} 
            fill="#0F1216" 
            stroke="#202630" 
            strokeWidth={3} 
          />
          {/* Divider Line in the middle of Speed Dial */}
          <Line
            x1={cx - 50}
            y1={cy + 8}
            x2={cx + 50}
            y2={cy + 8}
            stroke="#202630"
            strokeWidth={1.5}
          />

          {/* Speed display */}
          <SvgText
            x={cx}
            y={cy - 12}
            fill="#FFFFFF"
            fontSize={38}
            fontWeight="bold"
            textAnchor="middle"
          >
            {currentSpeed}
          </SvgText>
          <SvgText
            x={cx}
            y={cy + 2}
            fill="#8F9CAE"
            fontSize={9}
            fontWeight="bold"
            textAnchor="middle"
          >
            km/h
          </SvgText>

          {/* Trip text */}
          <SvgText
            x={cx}
            y={cy + 22}
            fill="#8F9CAE"
            fontSize={8}
            textAnchor="middle"
          >
            Trip(km)
          </SvgText>
          <SvgText
            x={cx}
            y={cy + 36}
            fill="#FFFFFF"
            fontSize={12}
            fontWeight="bold"
            textAnchor="middle"
          >
            {tripDist.toFixed(1)}
          </SvgText>

          {/* Max Speed text */}
          <SvgText
            x={cx}
            y={cy + 48}
            fill="#8F9CAE"
            fontSize={7.5}
            textAnchor="middle"
          >
            max Speed
          </SvgText>
          <SvgText
            x={cx}
            y={cy + 60}
            fill="#FFFFFF"
            fontSize={10.5}
            fontWeight="bold"
            textAnchor="middle"
          >
            {Math.round(peakSpeed)}
          </SvgText>


          {/* === LEFT SPEED PROGRESS ARC === */}
          {/* Background track */}
          <Path 
            d={getArcPath(cx, cy, rOuter, -135, -45)} 
            fill="none" 
            stroke="#1A202C" 
            strokeWidth={6} 
            strokeLinecap="round" 
          />
          {/* Active speed path */}
          {speedPercent > 0 && (
            <Path 
              d={getArcPath(cx, cy, rOuter, -135, speedEndAngle)} 
              fill="none" 
              stroke="url(#speedGrad)" 
              strokeWidth={6} 
              strokeLinecap="round" 
            />
          )}

          {/* Speed Scale Ticks & Labels */}
          {[-135, -105, -75, -45].map((angle, index) => {
            const speedValues = [0, 100, 200, 250];
            const val = speedValues[index];
            return (
              <G key={`speed-tick-${val}`}>
                <Line
                  x1={polarToX(cx, cy, rOuter - 4, angle)}
                  y1={polarToY(cx, cy, rOuter - 4, angle)}
                  x2={polarToX(cx, cy, rOuter + 4, angle)}
                  y2={polarToY(cx, cy, rOuter + 4, angle)}
                  stroke="#202630"
                  strokeWidth={1.5}
                />
                <SvgText
                  x={polarToX(cx, cy, rOuter - 14, angle)}
                  y={polarToY(cx, cy, rOuter - 14, angle) + 3}
                  fill="#8F9CAE"
                  fontSize={8}
                  fontWeight="bold"
                  textAnchor="middle"
                >
                  {val}
                </SvgText>
              </G>
            );
          })}


          {/* === RIGHT ACCEL/DECEL PROGRESS ARC === */}
          {/* Background track */}
          <Path 
            d={getArcPath(cx, cy, rOuter, 45, 135)} 
            fill="none" 
            stroke="#1A202C" 
            strokeWidth={6} 
            strokeLinecap="round" 
          />
          {/* Active acceleration/braking path */}
          {accelVal > 0 ? (
            // Accelerating (towards top right 45deg, starting from zero at 90deg)
            <Path 
              d={getArcPath(cx, cy, rOuter, accelEndAngle, 90)} 
              fill="none" 
              stroke="url(#accelGrad)" 
              strokeWidth={6} 
              strokeLinecap="round" 
            />
          ) : accelVal < 0 ? (
            // Braking (towards bottom right 135deg, starting from zero at 90deg)
            <Path 
              d={getArcPath(cx, cy, rOuter, 90, accelEndAngle)} 
              fill="none" 
              stroke="#EF4444" 
              strokeWidth={6} 
              strokeLinecap="round" 
            />
          ) : null}

          {/* Accel Scale Ticks & Labels */}
          {[45, 90, 135].map((angle, index) => {
            const labels = ['5.2', '0', '-4.9'];
            return (
              <G key={`accel-tick-${index}`}>
                <Line
                  x1={polarToX(cx, cy, rOuter - 4, angle)}
                  y1={polarToY(cx, cy, rOuter - 4, angle)}
                  x2={polarToX(cx, cy, rOuter + 4, angle)}
                  y2={polarToY(cx, cy, rOuter + 4, angle)}
                  stroke="#202630"
                  strokeWidth={1.5}
                />
                <SvgText
                  x={polarToX(cx, cy, rOuter + 14, angle)}
                  y={polarToY(cx, cy, rOuter + 14, angle) + 3}
                  fill="#8F9CAE"
                  fontSize={7.5}
                  fontWeight="bold"
                  textAnchor="middle"
                >
                  {labels[index]}
                </SvgText>
              </G>
            );
          })}

          {/* Current acceleration text unit label overlay in the middle of right arc */}
          <SvgText
            x={polarToX(cx, cy, rOuter + 28, 90)}
            y={polarToY(cx, cy, rOuter + 28, 90) + 3}
            fill={accelVal > 0 ? '#10B981' : accelVal < 0 ? '#EF4444' : '#8F9CAE'}
            fontSize={8}
            fontWeight="bold"
            textAnchor="middle"
          >
            {accelVal > 0 ? `+${accelVal}` : accelVal} m/s²
          </SvgText>
        </Svg>

        {!isMiniMode && (
          <View 
            className="flex-row items-center justify-between w-full border-t border-[#202630]/60 px-2"
            style={{
              marginTop: Math.max(2, 6 * scale),
              paddingTop: Math.max(6, 12 * scale),
            }}
          >
            <View className="flex-row items-center">
              <View 
                className={`w-1.5 h-1.5 rounded-full mr-1.5 ${isConnected ? 'bg-[#00E5FF]' : 'bg-[#EF4444]'}`}
                style={{
                  shadowColor: isConnected ? '#00E5FF' : '#EF4444',
                  shadowOffset: { width: 0, height: 0 },
                  shadowOpacity: 0.8,
                  shadowRadius: 3,
                }}
              />
              <Text 
                className="text-[#8F9CAE] font-bold uppercase tracking-wider"
                style={{ fontSize: Math.max(7, 8.5 * scale) }}
              >
                {isPlaybackMode 
                  ? 'REPRODUCCIÓN' 
                  : isRecording 
                    ? 'GRABANDO RUTA' 
                    : isConnected 
                      ? 'PREPARADO - TELEMETRÍA' 
                      : 'PREPARADO - SIMULADOR'}
              </Text>
            </View>

            {!isPlaybackMode && !isRecording && (
              <TouchableOpacity 
                onPress={handleCalibrateLean}
                className="bg-[#202630] border border-[#2D3748] rounded-full flex-row items-center"
                style={{
                  paddingHorizontal: Math.max(6, 10 * scale),
                  paddingVertical: Math.max(3, 5 * scale)
                }}
              >
                <Settings size={Math.max(8, 10 * scale)} color="#00E5FF" className="mr-1" />
                <Text style={{ fontSize: Math.max(8, 10 * scale), color: '#00E5FF', fontWeight: 'bold' }}>
                  CALIBRAR CERO
                </Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>
    );
  };

  return (
    <SafeAreaView className={`flex-1 ${colors.bg}`}>
      <View style={{ flex: 1, flexDirection: 'column', position: 'relative' }}>
        {/* Top Section: Map View */}
        <View 
          style={{ 
            height: cameraModeActive ? '45%' : '100%', 
            width: '100%', 
            position: 'relative' 
          }}
        >
          {Platform.OS === 'android' ? (
            <WebView
              ref={webViewRef}
              originWhitelist={['*']}
              source={{ html: LEAFLET_HTML }}
              style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
              javaScriptEnabled={true}
              domStorageEnabled={true}
              onLoadEnd={() => {
                if (webViewRef.current) {
                  const initJs = `
                    if (window.setMapType) window.setMapType('${mapType}', ${colors.isDark});
                    if (window.updateUserLocation && ${currentLocation ? 'true' : 'false'}) {
                      window.updateUserLocation(${currentLocation?.latitude || 19.4326}, ${currentLocation?.longitude || -99.1332}, true);
                    }
                    if (window.showSelectedRoute && ${selectedRoute ? 'true' : 'false'}) {
                      window.showSelectedRoute(${JSON.stringify(JSON.stringify(selectedRoute?.coordinates || []))});
                    }
                  `;
                  webViewRef.current.injectJavaScript(initJs);
                }
              }}
            />
          ) : (
            <MapView
              ref={mapRef}
              provider={PROVIDER_DEFAULT}
              mapType={mapType === 'standard' ? 'standard' : 'hybrid'}
              style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
              showsUserLocation={true}
              showsMyLocationButton={false}
              initialRegion={{
                latitude: currentLocation?.latitude || 19.4326,
                longitude: currentLocation?.longitude || -99.1332,
                latitudeDelta: 0.05,
                longitudeDelta: 0.05,
              }}
            >
              {/* Active recording route overlay */}
              {isRecording && recordedRoute.length > 1 && (
                <Polyline
                  coordinates={recordedRoute}
                  strokeColor={colors.bmwLightBlue}
                  strokeWidth={5}
                />
              )}

              {/* Selected historical route overlay */}
              {selectedRoute && selectedRoute.coordinates.length > 1 && (
                <>
                  <Polyline
                    coordinates={selectedRoute.coordinates}
                    strokeColor={colors.bmwRed}
                    strokeWidth={5}
                  />
                  <Marker
                    coordinate={selectedRoute.coordinates[0]}
                    title="Inicio"
                    pinColor={colors.statusGreen}
                  />
                  <Marker
                    coordinate={selectedRoute.coordinates[selectedRoute.coordinates.length - 1]}
                    title="Fin"
                    pinColor={colors.bmwRed}
                  />
                </>
              )}
            </MapView>
          )}
        </View>

        {/* Bottom Section: Camera view (Only when cameraModeActive is true) */}
        {cameraModeActive && (
          <View 
            style={{ 
              height: '55%', 
              width: '100%', 
              position: 'relative', 
              backgroundColor: '#000000',
              borderTopWidth: 1,
              borderTopColor: 'rgba(0, 163, 224, 0.2)'
            }}
          >
            <CameraView
              ref={cameraRef}
              mode="video"
              videoQuality="720p"
              style={{ width: '100%', height: '100%' }}
              mute={!microphonePermission?.granted}
            />

            {/* Telemetry HUD floating on top of camera preview (top left, 1/4 scaled) */}
            <View className="absolute top-4 left-4 z-20">
              {renderBikeSensorDashboard(
                Platform.OS === 'web' || !hasAccelerometer ? simSpeed : speed,
                Platform.OS === 'web' || !hasAccelerometer ? simLean : leanAngle,
                maxLeftLean,
                maxRightLean,
                totalDistance,
                maxSpeed,
                acceleration,
                maxAccel,
                maxDecel,
                Platform.OS !== 'web' && hasAccelerometer === true,
                false, // isPlaybackMode
                true   // isMiniMode (1/4 size)
              )}
            </View>

            {/* Guide Overlay for camera framing (rendered as absolute sibling) */}
            {!isRecording && (
              <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', opacity: 0.4 }}>
                <Text style={{ color: '#FFFFFF', fontSize: 10, fontFamily: 'BarlowCondensed-Bold', letterSpacing: 1.5, backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' }}>
                  VISOR DE CÁMARA LISTO
                </Text>
              </View>
            )}
          </View>
        )}

        {/* Dashboard floating HUD */}
        <View 
          className="absolute top-4 left-4 right-36 flex-row items-center z-10"
          pointerEvents="box-none"
        >
          {isRecording ? (
            <View 
              className={`${colors.card}/95 border border-red-500 rounded-xl p-3 flex-row items-center space-x-4 pointer-events-auto`}
              style={{
                shadowColor: colors.bmwRed,
                shadowOffset: { width: 0, height: 0 },
                shadowOpacity: 0.5,
                shadowRadius: 10,
                elevation: 5
              }}
            >
              <View 
                className="w-2.5 h-2.5 rounded-full bg-red-600" 
                style={{ opacity: hudBlink ? 1 : 0.3 }}
              />
              <View>
                <Text className={`text-[10px] ${colors.textMuted} uppercase tracking-[1px] font-barlow-condensed-bold font-bold`}>GRABANDO RUTA</Text>
                <Text className={`${colors.text} font-rajdhani-bold font-bold text-sm`}>{totalDistance} km</Text>
              </View>
            </View>
          ) : selectedRoute ? (
            <View 
              className={`${colors.card} border ${colors.border} rounded-xl p-3 flex-row items-center justify-between flex-1 pointer-events-auto`}
              style={{
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: colors.isDark ? 0.3 : 0.08,
                shadowRadius: 6,
                elevation: 4
              }}
            >
              <View className="flex-1">
                <Text className={`${colors.textMuted} text-[10px] tracking-[1px] font-barlow-condensed-bold font-bold`}>VIENDO RUTA</Text>
                <Text className={`${colors.text} font-bold text-sm`}>{selectedRoute.name}</Text>
                {selectedRoute.distance && (
                  <Text className="font-rajdhani-semibold text-xs font-semibold" style={{ color: colors.bmwBlue }}>{selectedRoute.distance} km</Text>
                )}
              </View>
              <TouchableOpacity onPress={() => setSelectedRoute(null)} className="p-1">
                <X size={18} color={colors.bmwRed} />
              </TouchableOpacity>
            </View>
          ) : (
            <View />
          )}
        </View>

        {/* Standalone Toggle Camera Mode button */}
        <TouchableOpacity
          onPress={handleToggleCameraMode}
          className="absolute top-4 right-4 z-20 px-3.5 py-2.5 rounded-xl border flex-row items-center space-x-1.5"
          style={{
            backgroundColor: cameraModeActive ? colors.bmwRed : colors.card,
            borderColor: cameraModeActive ? colors.bmwRed : colors.border,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.15,
            shadowRadius: 3,
            elevation: 4
          }}
        >
          <View 
            className="w-2 h-2 rounded-full" 
            style={{ 
              opacity: isRecordingVideo ? (hudBlink ? 1 : 0.3) : 1,
              backgroundColor: cameraModeActive ? '#FFFFFF' : '#EF4444'
            }} 
          />
          <Text 
            style={{ fontFamily: 'Rajdhani-Bold', fontSize: 11 }}
            className={cameraModeActive ? 'text-white font-bold' : `${colors.text} font-bold`}
          >
            {cameraModeActive ? 'SOLO MAPA' : 'CÁMARA HUD'}
          </Text>
        </TouchableOpacity>

        {/* Telemetry TFT HUD Overlay */}
        {!cameraModeActive && (
          <View 
            style={{
              position: 'absolute',
              bottom: 96,
              alignSelf: 'center',
              zIndex: 10
            }}
          >
            {renderBikeSensorDashboard(
              Platform.OS === 'web' || !hasAccelerometer ? simSpeed : speed,
              Platform.OS === 'web' || !hasAccelerometer ? simLean : leanAngle,
              maxLeftLean,
              maxRightLean,
              totalDistance,
              maxSpeed,
              acceleration,
              maxAccel,
              maxDecel,
              Platform.OS !== 'web' && hasAccelerometer === true,
              false, // isPlaybackMode
              false, // isMiniMode
              0.7    // scale (reduced by 30% total)
            )}
          </View>
        )}

        {/* Floating actions HUD */}
        <View className="absolute bottom-6 right-6 left-6 flex-row justify-between items-center z-10">
          {/* Favorites List button */}
          <TouchableOpacity
            onPress={() => setRoutesModalVisible(true)}
            className={`w-12 h-12 rounded-full ${colors.card} border ${colors.border} items-center justify-center`}
            style={{
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: colors.isDark ? 0.3 : 0.08,
              shadowRadius: 5,
              elevation: 5
            }}
          >
            <Bookmark size={20} color={colors.bmwBlue} />
          </TouchableOpacity>

          {/* Tracking button */}
          {isRecording ? (
            <TouchableOpacity
              onPress={handleStopTracking}
              className="w-16 h-16 rounded-full items-center justify-center border-2 border-white"
              style={{
                backgroundColor: colors.bmwRed,
                shadowColor: colors.bmwRed,
                shadowOffset: { width: 0, height: 0 },
                shadowOpacity: 0.5,
                shadowRadius: 15,
                elevation: 6
              }}
            >
              <Square size={24} color="#F8F9FA" />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              onPress={handleStartTracking}
              disabled={cameraModeActive && isRecordingVideo}
              className="w-16 h-16 rounded-full items-center justify-center border-2 border-white"
              style={{
                backgroundColor: (cameraModeActive && isRecordingVideo) ? '#8F9CAE' : colors.bmwBlue,
                shadowColor: (cameraModeActive && isRecordingVideo) ? 'transparent' : colors.bmwBlue,
                shadowOffset: { width: 0, height: 0 },
                shadowOpacity: (cameraModeActive && isRecordingVideo) ? 0 : 0.5,
                shadowRadius: 15,
                elevation: 6
              }}
            >
              {(cameraModeActive && isRecordingVideo) ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <Play size={24} color="#FFFFFF" className="ml-1" />
              )}
            </TouchableOpacity>
          )}

          {/* Right actions container */}
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            {/* GPS Center button */}
            <TouchableOpacity
              onPress={centerOnUser}
              className={`w-12 h-12 rounded-full ${colors.card} border ${colors.border} items-center justify-center`}
              style={{
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: colors.isDark ? 0.3 : 0.08,
                shadowRadius: 5,
                elevation: 5
              }}
            >
              <Navigation size={20} color={colors.statusGreen} />
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* Save Route Modal */}
      <Modal visible={saveModalVisible} animationType="slide" transparent={true}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          className="flex-1"
        >
          <View className="flex-1 bg-black/60 justify-end">
            <View 
              className={`${colors.card} border-t ${colors.border} rounded-t-3xl max-h-[85%]`}
              style={{
                shadowColor: '#000',
                shadowOffset: { width: 0, height: -10 },
                shadowOpacity: colors.isDark ? 0.4 : 0.1,
                shadowRadius: 15,
                elevation: 8
              }}
            >
              <ScrollView 
                contentContainerStyle={{ padding: 24, paddingBottom: insets.bottom > 0 ? insets.bottom + 30 : 60 }}
                className="w-full"
                keyboardShouldPersistTaps="handled"
              >
                <View className="flex-row justify-between items-center mb-6">
                  <Text className={`${colors.text} font-rajdhani-bold text-base font-bold uppercase tracking-[2px]`}>
                    GUARDAR RUTA DE RIDER
                  </Text>
                  <TouchableOpacity onPress={() => setSaveModalVisible(false)} className="p-1">
                    <X size={24} color={colors.isDark ? '#F8F9FA' : '#4E5E72'} />
                  </TouchableOpacity>
                </View>

                <View className={`mb-4 ${colors.isDark ? 'bg-[#1A202C]' : 'bg-[#EBF0F5]'} border ${colors.border} rounded-xl p-4 items-center`}>
                  <Text className={`font-barlow-condensed-bold text-[10px] uppercase tracking-wider ${colors.textMuted}`}>Distancia total recorrida</Text>
                  <Text className="font-rajdhani-bold text-2xl font-bold tracking-widest mt-1" style={{ color: colors.bmwBlue }}>{totalDistance} km</Text>
                </View>

                {/* Name */}
                <View className="mb-4">
                  <Text className={`${colors.textSec} text-xs uppercase mb-1.5 font-medium tracking-wide`}>
                    Nombre de la Ruta
                  </Text>
                  <TextInput
                    value={routeName}
                    placeholder="Ej. Curvas de la Sierra, Ruta del Fin de Semana"
                    placeholderTextColor={colors.isDark ? '#556070' : '#8E9FBC'}
                    onChangeText={setRouteName}
                    className={`w-full ${colors.isDark ? 'bg-[#1A202C] text-white' : 'bg-[#F4F5F7] text-[#002C5B]'} ${colors.isDark ? 'border ' + colors.border : ''} rounded-xl px-4 py-3 text-sm`}
                  />
                </View>

                {/* Start / End */}
                <View className="mb-4 flex-row">
                  <View className="flex-1 mr-2">
                    <Text className={`${colors.textSec} text-xs uppercase mb-1.5 font-medium tracking-wide`}>
                      Punto de Inicio
                    </Text>
                    <TextInput
                      value={startPoint}
                      placeholder="Ej. Gasolinera km 10"
                      placeholderTextColor={colors.isDark ? '#556070' : '#8E9FBC'}
                      onChangeText={setStartPoint}
                      className={`w-full ${colors.isDark ? 'bg-[#1A202C] text-white' : 'bg-[#F4F5F7] text-[#002C5B]'} ${colors.isDark ? 'border ' + colors.border : ''} rounded-xl px-4 py-3 text-sm`}
                    />
                  </View>

                  <View className="flex-1 ml-2">
                    <Text className={`${colors.textSec} text-xs uppercase mb-1.5 font-medium tracking-wide`}>
                      Punto de Destino
                    </Text>
                    <TextInput
                      value={endPoint}
                      placeholder="Ej. Mirador San Mateo"
                      placeholderTextColor={colors.isDark ? '#556070' : '#8E9FBC'}
                      onChangeText={setEndPoint}
                      className={`w-full ${colors.isDark ? 'bg-[#1A202C] text-white' : 'bg-[#F4F5F7] text-[#002C5B]'} ${colors.isDark ? 'border ' + colors.border : ''} rounded-xl px-4 py-3 text-sm`}
                    />
                  </View>
                </View>

                {/* Notes */}
                <View className="mb-6">
                  <Text className={`${colors.textSec} text-xs uppercase mb-1.5 font-medium tracking-wide`}>
                    Comentarios / Estado del Asfalto
                  </Text>
                  <TextInput
                    value={routeNotes}
                    placeholder="Ej. Buenas curvas, pocas imperfecciones, ideal para domingo."
                    placeholderTextColor={colors.isDark ? '#556070' : '#8E9FBC'}
                    onChangeText={setRouteNotes}
                    className={`w-full ${colors.isDark ? 'bg-[#1A202C] text-white' : 'bg-[#F4F5F7] text-[#002C5B]'} ${colors.isDark ? 'border ' + colors.border : ''} rounded-xl px-4 py-3 text-sm`}
                  />
                </View>

                <TouchableOpacity
                  onPress={handleSaveRoute}
                  disabled={saving || (cameraModeActive && isRecordingVideo)}
                  className="w-full rounded-xl py-3.5 items-center justify-center border"
                  style={{
                    backgroundColor: (saving || (cameraModeActive && isRecordingVideo)) ? '#8F9CAE' : colors.bmwBlue,
                    borderColor: (saving || (cameraModeActive && isRecordingVideo)) ? '#8F9CAE' : colors.bmwBlue,
                    shadowColor: (saving || (cameraModeActive && isRecordingVideo)) ? 'transparent' : colors.bmwBlue,
                    shadowOffset: { width: 0, height: 4 },
                    shadowOpacity: (saving || (cameraModeActive && isRecordingVideo)) ? 0 : 0.3,
                    shadowRadius: 8,
                    elevation: 4
                  }}
                >
                  {saving ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : cameraModeActive && isRecordingVideo ? (
                    <View className="flex-row items-center justify-center" style={{ gap: 8 }}>
                      <ActivityIndicator color="#FFFFFF" size="small" />
                      <Text className="text-white font-bold text-sm uppercase tracking-widest">
                        Procesando Video...
                      </Text>
                    </View>
                  ) : (
                    <Text className="text-white font-bold text-sm uppercase tracking-widest">
                      GUARDAR EN HISTORIAL
                    </Text>
                  )}
                </TouchableOpacity>
              </ScrollView>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Favorite Routes Drawer Modal */}
      <Modal visible={routesModalVisible} animationType="slide" transparent={true}>
        <View className="flex-1 bg-black/60 justify-end">
          <View 
            className={`${colors.card} border-t ${colors.border} rounded-t-3xl h-[70%]`}
            style={{
              paddingLeft: 24,
              paddingRight: 24,
              paddingTop: 24,
              paddingBottom: insets.bottom > 0 ? insets.bottom + 12 : 24,
              shadowColor: '#000',
              shadowOffset: { width: 0, height: -10 },
              shadowOpacity: colors.isDark ? 0.4 : 0.1,
              shadowRadius: 15,
              elevation: 8
            }}
          >
            <View className="flex-row justify-between items-center mb-6">
              <Text className={`${colors.text} font-rajdhani-bold text-base font-bold uppercase tracking-[2px]`}>
                MIS RUTAS FAVORITAS
              </Text>
              <TouchableOpacity onPress={() => setRoutesModalVisible(false)} className="p-1">
                <X size={24} color={colors.isDark ? '#F8F9FA' : '#4E5E72'} />
              </TouchableOpacity>
            </View>

            {loading ? (
              <ActivityIndicator size="large" color={colors.bmwBlue} className="my-auto" />
            ) : (
              <ScrollView className="flex-1">
                {savedRoutes.length > 0 ? (
                  savedRoutes.map((route) => (
                    <View
                      key={route.id}
                      className={`${colors.isDark ? 'bg-[#1A202C]' : 'bg-[#EBF0F5]'} border ${colors.border} rounded-xl p-4 mb-3`}
                    >
                      <View className="flex-row justify-between items-start">
                        <View className="flex-1">
                          <Text className={`${colors.text} font-bold text-base`}>{route.name}</Text>
                          {route.distance && (
                            <View className="flex-row flex-wrap items-center mt-1">
                              <Text className="font-rajdhani-semibold text-xs font-semibold" style={{ color: colors.bmwBlue }}>
                                {route.distance.toFixed(1)} km
                              </Text>
                              {route.maxSpeed !== undefined && route.maxSpeed !== null && (
                                <>
                                  <Text className={`text-xs font-barlow-condensed-bold mx-2 uppercase ${colors.textMuted}`}>•</Text>
                                  <Text className={`font-rajdhani-semibold text-xs font-semibold ${colors.textSec}`}>
                                    MÁX VEL: {Math.round(route.maxSpeed)} km/h
                                  </Text>
                                </>
                              )}
                              {route.maxLeftLean !== undefined && route.maxLeftLean !== null && (
                                <>
                                  <Text className={`text-xs font-barlow-condensed-bold mx-2 uppercase ${colors.textMuted}`}>•</Text>
                                  <Text className={`font-rajdhani-semibold text-xs font-semibold ${colors.textSec}`}>
                                    MÁX INC: L{Math.round(route.maxLeftLean)}° | R{Math.round(route.maxRightLean || 0)}°
                                  </Text>
                                </>
                              )}
                            </View>
                          )}
                          {(route.startPoint || route.endPoint) && (
                            <Text className={`${colors.textSec} text-xs mt-1.5`}>
                              {route.startPoint || 'Inicio'} → {route.endPoint || 'Fin'}
                            </Text>
                          )}
                          {route.notes && (
                            <Text className={`${colors.textMuted} text-xs italic mt-2`}>"{route.notes}"</Text>
                          )}
                        </View>
                        
                        <View className="flex-row ml-4" style={{ gap: 8 }}>
                          {routeVideos[route.id] && (
                            <TouchableOpacity
                              onPress={() => {
                                const videoUri = routeVideos[route.id];
                                setRoutesModalVisible(false);
                                setPlaybackVideoUri(videoUri);
                                setPlaybackRoute(route);
                                setPlaybackSpeed(0);
                                setPlaybackLean(0);
                                setPlaybackTime(0);
                                setPlaybackDuration(0);
                                if (videoPlayer && videoUri) {
                                  try {
                                    videoPlayer.replace(videoUri);
                                  } catch (replaceErr) {
                                    console.warn('Failed to replace video source:', replaceErr);
                                  }
                                }
                                setPlaybackModalVisible(true);
                                // Play automatically after modal animation
                                setTimeout(() => {
                                  if (videoPlayer) {
                                    try {
                                      videoPlayer.play();
                                    } catch (playErr) {
                                      console.warn('Failed to play video automatically:', playErr);
                                    }
                                  }
                                }, 500);
                              }}
                              className={`${colors.card} border ${colors.border} p-2 rounded-lg`}
                            >
                              <Video size={16} color="#00E5FF" />
                            </TouchableOpacity>
                          )}
                          <TouchableOpacity
                            onPress={() => handleViewRoute(route)}
                            className={`${colors.card} border ${colors.border} p-2 rounded-lg`}
                          >
                            <Eye size={16} color={colors.statusGreen} />
                          </TouchableOpacity>
                          <TouchableOpacity
                            onPress={() => handleDeleteRoute(route.id)}
                            className={`${colors.card} border ${colors.border} p-2 rounded-lg`}
                          >
                            <Trash2 size={16} color={colors.bmwRed} />
                          </TouchableOpacity>
                        </View>
                      </View>
                    </View>
                  ))
                ) : (
                  <View className="items-center py-20">
                    <Bookmark size={36} color={colors.isDark ? '#8F9CAE' : '#8E9FBC'} />
                    <Text className={`${colors.text} font-medium mt-2`}>No has guardado ninguna ruta</Text>
                    <Text className={`${colors.textMuted} text-center text-xs mt-1`}>Graba un recorrido en el mapa y aparecerá aquí.</Text>
                  </View>
                )}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* Video Playback Modal with Telemetry Overlay */}
      <Modal visible={playbackModalVisible} animationType="fade" transparent={true}>
        <View className="flex-1 bg-black justify-between">
          {/* Full Screen Video view */}
          {playbackVideoUri && (
            <VideoView 
              player={videoPlayer} 
              style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
              nativeControls={false} 
            />
          )}

          {/* Top Bar with route name and close button */}
          <SafeAreaView edges={['top']} className="w-full flex-row justify-between items-center p-4 bg-gradient-to-b from-black/80 to-transparent z-10">
            <View>
              <Text className="text-white font-rajdhani-bold text-lg font-bold uppercase tracking-[2px]">
                {playbackRoute?.name}
              </Text>
              <Text className="text-gray-400 font-barlow-condensed text-xs uppercase">
                REPRODUCCIÓN DE TELEMETRÍA
              </Text>
            </View>
            <TouchableOpacity 
              onPress={() => {
                if (videoPlayer) {
                  try {
                    videoPlayer.pause();
                    videoPlayer.replace(null);
                  } catch (e) {
                    console.warn('Failed to clean up video player on close:', e);
                  }
                }
                setPlaybackModalVisible(false);
                setPlaybackVideoUri(null);
                setPlaybackRoute(null);
              }} 
              className="p-2 bg-black/60 rounded-full border border-white/20"
            >
              <X size={20} color="white" />
            </TouchableOpacity>
          </SafeAreaView>

          {/* Centered Horizon indicator overlay (just empty flex spacer for layout) */}
          <View className="flex-1 justify-center items-center pointer-events-none" />

          {/* Bottom Bar: Telemetry gauges and controls (using insets.bottom to prevent navbar overlap) */}
          <View 
            className="w-full bg-gradient-to-t from-black/90 via-black/60 to-transparent z-10"
            style={{ 
              paddingHorizontal: 24,
              paddingTop: 24,
              paddingBottom: insets.bottom > 0 ? insets.bottom + 16 : 24
            }}
          >
            {/* Speed and Lean HUD (BikeSensor style overlay) */}
            <View className="mb-6">
              {renderBikeSensorDashboard(
                playbackSpeed,
                playbackLean,
                playbackRoute?.maxLeftLean || 0,
                playbackRoute?.maxRightLean || 0,
                playbackRoute?.distance || 0,
                playbackRoute?.maxSpeed || 0,
                playbackAccel,
                0,
                0,
                true,
                true
              )}
            </View>

            {/* Custom Video Playback Controls */}
            <View className="flex-row items-center justify-between">
              {/* Play/Pause Button */}
              <TouchableOpacity 
                onPress={() => {
                  try {
                    if (isPlayingVideo) {
                      videoPlayer.pause();
                    } else {
                      videoPlayer.play();
                    }
                  } catch (e) {
                    console.warn('Failed to toggle play/pause:', e);
                  }
                }}
                className="p-3 bg-[#00A3E0] rounded-full"
              >
                {isPlayingVideo ? (
                  <View className="flex-row justify-center items-center" style={{ gap: 4 }}>
                    <View className="w-1.5 h-4 bg-white rounded-sm" />
                    <View className="w-1.5 h-4 bg-white rounded-sm" />
                  </View>
                ) : (
                  <Play size={18} color="white" fill="white" />
                )}
              </TouchableOpacity>

              {/* Video Timeline Scrubber */}
              <View className="flex-1 mx-4 h-1.5 bg-white/20 rounded-full overflow-hidden justify-center">
                <View 
                  style={{ 
                    width: `${playbackDuration > 0 ? (playbackTime / playbackDuration) * 100 : 0}%`,
                    height: '100%',
                    backgroundColor: '#00A3E0'
                  }} 
                />
              </View>

              {/* Timing info */}
              <Text className="text-white font-orbitron text-2xs">
                {formatTime(playbackTime)} / {formatTime(playbackDuration)}
              </Text>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const formatTime = (seconds: number) => {
  if (isNaN(seconds)) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
};

// Sleek Dark Map Theme styling for Google Maps (Android)
const darkMapStyle = [
  { "elementType": "geometry", "stylers": [{ "color": "#171B22" }] },
  { "elementType": "labels.text.fill", "stylers": [{ "color": "#8F9CAE" }] },
  { "elementType": "labels.text.stroke", "stylers": [{ "color": "#171B22" }] },
  { "featureType": "administrative", "elementType": "geometry.stroke", "stylers": [{ "color": "#202630" }] },
  { "featureType": "administrative.land_parcel", "elementType": "labels.text.fill", "stylers": [{ "color": "#556070" }] },
  { "featureType": "landscape.natural", "elementType": "geometry", "stylers": [{ "color": "#0F1216" }] },
  { "featureType": "poi", "elementType": "geometry", "stylers": [{ "color": "#171B22" }] },
  { "featureType": "poi", "elementType": "labels.text.fill", "stylers": [{ "color": "#8F9CAE" }] },
  { "featureType": "road", "elementType": "geometry", "stylers": [{ "color": "#0B0D10" }] },
  { "featureType": "road", "elementType": "geometry.stroke", "stylers": [{ "color": "#1c2128" }] },
  { "featureType": "road", "elementType": "labels.text.fill", "stylers": [{ "color": "#8F9CAE" }] },
  { "featureType": "road.highway", "elementType": "geometry", "stylers": [{ "color": "#202630" }] },
  { "featureType": "road.highway", "elementType": "geometry.stroke", "stylers": [{ "color": "#2d3543" }] },
  { "featureType": "water", "elementType": "geometry", "stylers": [{ "color": "#07080a" }] },
  { "featureType": "water", "elementType": "labels.text.fill", "stylers": [{ "color": "#556070" }] }
];

// Local Leaflet Map source for Android (bypasses Google Maps API Key requirement)
const LEAFLET_HTML = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" crossorigin="" />
  <style>
    html, body, #map {
      height: 100%;
      margin: 0;
      padding: 0;
      background-color: #0A0D12;
    }
    .leaflet-control-zoom {
      display: none !important;
    }
    .leaflet-control-attribution {
      font-size: 8px !important;
      background: rgba(0,0,0,0.6) !important;
      color: #8F9CAE !important;
    }
  </style>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=" crossorigin=""></script>
</head>
<body>
  <div id="map"></div>
  <script>
    var map = L.map('map', {
      zoomControl: false,
      attributionControl: false
    }).setView([19.4326, -99.1332], 13);

    var googleRoads = L.tileLayer('https://{s}.google.com/vt/lyrs=m&hl=es&x={x}&y={y}&z={z}', {
      maxZoom: 20,
      subdomains: ['mt0', 'mt1', 'mt2', 'mt3']
    });
    var dark = L.tileLayer('https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png', { maxZoom: 19 });
    var googleHybrid = L.tileLayer('https://{s}.google.com/vt/lyrs=y&hl=es&x={x}&y={y}&z={z}', {
      maxZoom: 20,
      subdomains: ['mt0', 'mt1', 'mt2', 'mt3']
    });

    var currentLayer = googleRoads;
    currentLayer.addTo(map);

    var userMarker = null;
    var userIcon = L.divIcon({
      className: 'user-location-icon',
      html: '<div style="width: 14px; height: 14px; background-color: #00A3E0; border: 2px solid white; border-radius: 50%; box-shadow: 0 0 8px #00A3E0;"></div>',
      iconSize: [14, 14],
      iconAnchor: [7, 7]
    });

    var activePolyline = L.polyline([], { color: '#00A3E0', weight: 5 }).addTo(map);
    var selectedPolyline = L.polyline([], { color: '#EF4444', weight: 5 }).addTo(map);
    var startMarker = null;
    var endMarker = null;

    var startIcon = L.divIcon({
      className: 'start-route-icon',
      html: '<div style="width: 12px; height: 12px; background-color: #10B981; border: 2px solid white; border-radius: 50%;"></div>',
      iconSize: [12, 12],
      iconAnchor: [6, 6]
    });

    var endIcon = L.divIcon({
      className: 'end-route-icon',
      html: '<div style="width: 12px; height: 12px; background-color: #EF4444; border: 2px solid white; border-radius: 50%;"></div>',
      iconSize: [12, 12],
      iconAnchor: [6, 6]
    });

    window.setMapType = function(type, isDark) {
      map.removeLayer(currentLayer);
      if (type === 'hybrid') {
        currentLayer = googleHybrid;
      } else {
        currentLayer = googleRoads;
      }
      currentLayer.addTo(map);
    };

    window.updateUserLocation = function(lat, lng, shouldCenter) {
      var pos = [lat, lng];
      if (!userMarker) {
        userMarker = L.marker(pos, { icon: userIcon }).addTo(map);
      } else {
        userMarker.setLatLng(pos);
      }
      if (shouldCenter) {
        map.setView(pos, 16);
      }
    };

    window.updateRecordedRoute = function(coordsJson) {
      var coords = JSON.parse(coordsJson);
      var latlngs = coords.map(function(c) { return [c.latitude, c.longitude]; });
      activePolyline.setLatLngs(latlngs);
    };

    window.showSelectedRoute = function(coordsJson) {
      if (startMarker) { map.removeLayer(startMarker); startMarker = null; }
      if (endMarker) { map.removeLayer(endMarker); endMarker = null; }
      
      var coords = JSON.parse(coordsJson);
      if (coords.length > 0) {
        var latlngs = coords.map(function(c) { return [c.latitude, c.longitude]; });
        selectedPolyline.setLatLngs(latlngs);
        
        startMarker = L.marker(latlngs[0], { icon: startIcon }).addTo(map);
        endMarker = L.marker(latlngs[latlngs.length - 1], { icon: endIcon }).addTo(map);
        
        var bounds = L.latLngBounds(latlngs);
        map.fitBounds(bounds, { padding: [30, 30] });
      } else {
        selectedPolyline.setLatLngs([]);
      }
    };

    window.centerOnUser = function(lat, lng) {
      map.setView([lat, lng], 16);
    };
  </script>
</body>
</html>
`;

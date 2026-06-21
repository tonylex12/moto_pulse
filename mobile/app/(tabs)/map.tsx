import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, TextInput, ActivityIndicator, Modal, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import MapView, { Polyline, Marker, PROVIDER_DEFAULT, UrlTile } from 'react-native-maps';
import { Play, Square, Navigation, Bookmark, X, Eye, Trash2, Layers } from 'lucide-react-native';
import { Accelerometer } from 'expo-sensors';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';

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
}

export default function RoutesMapScreen() {
  const { showAlert } = useAlert();
  const { colors } = useTheme();

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
  } = useLocation();

  const mapRef = useRef<MapView | null>(null);

  // States
  const [savedRoutes, setSavedRoutes] = useState<SavedRoute[]>([]);
  const [loading, setLoading] = useState(true);
  const [saveModalVisible, setSaveModalVisible] = useState(false);
  const [routesModalVisible, setRoutesModalVisible] = useState(false);

  // Telemetry States
  const [hasAccelerometer, setHasAccelerometer] = useState<boolean | null>(null);
  const [leanAngle, setLeanAngle] = useState(0);
  const [maxLeftLean, setMaxLeftLean] = useState(0);
  const [maxRightLean, setMaxRightLean] = useState(0);
  const [simSpeed, setSimSpeed] = useState(0);
  const [simLean, setSimLean] = useState(0);

  // Camera HUD States
  const [cameraModeActive, setCameraModeActive] = useState(false);
  const [isRecordingVideo, setIsRecordingVideo] = useState(false);
  const cameraRef = useRef<CameraView | null>(null);

  // Map Type State
  const [mapType, setMapType] = useState<'standard' | 'hybrid'>('standard');

  // Permissions Hooks
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [microphonePermission, requestMicrophonePermission] = useMicrophonePermissions();

  const handleToggleCameraMode = async () => {
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

  const fetchRoutes = async () => {
    try {
      // Changed to relative path without leading slash
      const res = await api.get('routes');
      const formatted = res.data.map((r: any) => ({
        ...r,
        coordinates: typeof r.coordinates === 'string' ? JSON.parse(r.coordinates) : r.coordinates
      }));
      setSavedRoutes(formatted);
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

  // Native Accelerometer listener when active recording and available
  useEffect(() => {
    if (!isRecording || !hasAccelerometer || Platform.OS === 'web') return;

    Accelerometer.setUpdateInterval(100); // 10Hz updates

    let prevLean = 0;
    const smoothingFactor = 0.15; // Low-pass filter smoothing

    const subscription = Accelerometer.addListener((data) => {
      // Calculate roll angle: atan2(x, -y)
      // data.x, data.y are in Gs
      const angleRad = Math.atan2(data.x, -data.y);
      const rawLean = angleRad * (180 / Math.PI);

      if (isNaN(rawLean)) return;

      // Smooth signal to filter engine vibration and bumps
      const smoothedLean = (1 - smoothingFactor) * prevLean + smoothingFactor * rawLean;
      prevLean = smoothedLean;

      const roundedLean = Math.round(smoothedLean);
      const clampedLean = Math.max(-60, Math.min(60, roundedLean));
      setLeanAngle(clampedLean);

      // Record peak lean angles
      if (clampedLean < 0) {
        setMaxLeftLean((prev) => Math.max(prev, Math.abs(clampedLean)));
      } else if (clampedLean > 0) {
        setMaxRightLean((prev) => Math.max(prev, clampedLean));
      }
    });

    return () => {
      subscription.remove();
    };
  }, [isRecording, hasAccelerometer]);

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
    if (currentLocation && mapRef.current) {
      mapRef.current.animateToRegion({
        latitude: currentLocation.latitude,
        longitude: currentLocation.longitude,
        latitudeDelta: 0.015,
        longitudeDelta: 0.015,
      }, 1000);
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
    setSimLean(0);
    setSimSpeed(0);
    await startRecording();

    // Start recording video if in camera mode
    if (cameraModeActive && cameraRef.current) {
      try {
        setIsRecordingVideo(true);
        cameraRef.current.recordAsync().then(async (file) => {
          if (file && file.uri) {
            if (MediaLibrary && typeof MediaLibrary.saveToLibraryAsync === 'function') {
              try {
                await MediaLibrary.saveToLibraryAsync(file.uri);
                showAlert('Video Guardado', 'El video de tu ruta se ha guardado en tu galería.');
              } catch (saveErr) {
                console.error('Failed to save to gallery:', saveErr);
                showAlert('Ruta Finalizada', `Grabación guardada localmente: ${file.uri}`);
              }
            } else {
              showAlert('Ruta Finalizada', `Grabación guardada localmente: ${file.uri}`);
            }
          }
          setIsRecordingVideo(false);
        }).catch((err) => {
          console.error('Error recording video:', err);
          setIsRecordingVideo(false);
        });
      } catch (err) {
        console.error('Failed to start camera recording:', err);
        setIsRecordingVideo(false);
      }
    }

    showAlert('Ruta Iniciada', 'MotoPulse está grabando tus coordenadas GPS y telemetría.');
  };

  // Stop route capture
  const handleStopTracking = () => {
    if (cameraModeActive && cameraRef.current && isRecordingVideo) {
      cameraRef.current.stopRecording();
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
      const payload = {
        name: routeName.trim(),
        coordinates: recordedRoute,
        startPoint: startPoint.trim() || undefined,
        endPoint: endPoint.trim() || undefined,
        distance: totalDistance,
        notes: routeNotes.trim() || undefined,
      };

      // Changed to relative path without leading slash
      await api.post('routes', payload);
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

    if (route.coordinates.length > 0 && mapRef.current) {
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
          <MapView
            ref={mapRef}
            provider={PROVIDER_DEFAULT}
            mapType={Platform.OS === 'android' ? 'none' : (mapType === 'standard' ? 'standard' : 'hybrid')}
            style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
            customMapStyle={mapType === 'standard' && Platform.OS === 'android' && colors.isDark ? darkMapStyle : undefined}
            showsUserLocation={true}
            showsMyLocationButton={false}
            initialRegion={{
              latitude: currentLocation?.latitude || 19.4326,
              longitude: currentLocation?.longitude || -99.1332,
              latitudeDelta: 0.05,
              longitudeDelta: 0.05,
            }}
          >
            {/* Custom URL Tiles overlay for Android (allows rendering high detail road and satellite maps without Google Maps API keys) */}
            {Platform.OS === 'android' && (
              <UrlTile
                urlTemplate={
                  mapType === 'hybrid'
                    ? "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                    : (colors.isDark
                        ? "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png"
                        : "https://tile.openstreetmap.org/{z}/{x}/{y}.png")
                }
                maximumZ={19}
                tileSize={256}
              />
            )}
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

            {/* Telemetry HUD floating on top of camera preview (rendered as absolute sibling) */}
            {isRecording && (
              <View 
                className="absolute inset-x-4 top-4 bg-[#0F1216]/95 border border-[#00A3E0]/30 rounded-2xl p-4 flex-row items-center justify-between z-20"
                style={{
                  shadowColor: '#000',
                  shadowOffset: { width: 0, height: 6 },
                  shadowOpacity: 0.4,
                  shadowRadius: 8,
                  elevation: 8
                }}
              >
                {/* Speedometer */}
                <View className="flex-col justify-center items-center px-2">
                  <Text className="text-[#8F9CAE] text-[9px] font-barlow-condensed-bold font-bold uppercase tracking-wider">VELOCIDAD</Text>
                  <View className="flex-row items-baseline mt-1">
                    <Text style={{ fontFamily: 'Orbitron-Bold', fontSize: 32, color: '#FFFFFF', lineHeight: 36 }}>
                      {Platform.OS === 'web' || !hasAccelerometer ? simSpeed : speed}
                    </Text>
                    <Text style={{ fontFamily: 'Orbitron-Bold', fontSize: 9, color: '#00A3E0', marginLeft: 4 }}>KM/H</Text>
                  </View>
                </View>

                {/* Visual Lean Indicator Gauge */}
                <View className="flex-col items-center justify-center border-l border-r border-[#202630] px-4 flex-1">
                  <Text className="text-[#8F9CAE] text-[9px] font-barlow-condensed-bold font-bold uppercase tracking-wider mb-1.5">INCLINACIÓN</Text>
                  
                  <View className="flex-row items-center justify-between w-full">
                    {/* Left Max */}
                    <View className="items-center">
                      <Text className="text-[#8F9CAE] text-[8px] font-barlow-condensed-bold font-bold">MÁX I</Text>
                      <Text style={{ fontFamily: 'Rajdhani-Bold', fontSize: 15, color: '#FF3B30' }}>{maxLeftLean}°</Text>
                    </View>

                    {/* Rotating Horizon / Attitude Indicator */}
                    <View className="items-center justify-center relative w-14 h-14">
                      <View className="absolute w-12 h-12 rounded-full border border-dashed border-[#8F9CAE]/20" />
                      <View 
                        style={{ 
                          transform: [{ rotate: `${Platform.OS === 'web' || !hasAccelerometer ? simLean : leanAngle}deg` }] 
                        }}
                        className="items-center justify-center"
                      >
                        <View className="w-9 h-0.5 bg-[#8F9CAE]/30 absolute" />
                        <View className="w-5 h-1.5 bg-[#00A3E0] rounded-full items-center justify-center">
                          <View className="w-1.5 h-1.5 bg-[#FFFFFF] rounded-full" />
                        </View>
                      </View>
                      <View className="absolute bottom-[-4px] bg-[#0F1216] px-1 py-0.5 rounded border border-[#202630]">
                        <Text style={{ fontFamily: 'Rajdhani-Bold', fontSize: 10, color: '#00E5FF' }}>
                          {Math.abs(Platform.OS === 'web' || !hasAccelerometer ? simLean : leanAngle)}°
                        </Text>
                      </View>
                    </View>

                    {/* Right Max */}
                    <View className="items-center">
                      <Text className="text-[#8F9CAE] text-[8px] font-barlow-condensed-bold font-bold">MÁX D</Text>
                      <Text style={{ fontFamily: 'Rajdhani-Bold', fontSize: 15, color: '#34C759' }}>{maxRightLean}°</Text>
                    </View>
                  </View>
                </View>

                {/* Active Telemetry Status */}
                <View className="flex-col justify-center items-center px-2">
                  <Text className="text-[#8F9CAE] text-[9px] font-barlow-condensed-bold font-bold uppercase tracking-wider">ESTADO</Text>
                  <View className="items-center mt-2">
                    <View 
                      className="w-2 h-2 rounded-full bg-[#00E5FF] mb-1" 
                      style={{
                        shadowColor: '#00E5FF',
                        shadowOffset: { width: 0, height: 0 },
                        shadowOpacity: 0.8,
                        shadowRadius: 4,
                      }}
                    />
                    <Text style={{ fontFamily: 'BarlowCondensed-Bold', fontSize: 8, color: '#00E5FF', letterSpacing: 0.5 }}>
                      {Platform.OS === 'web' || !hasAccelerometer ? 'SIMULADO' : 'CONECTADO'}
                    </Text>
                  </View>
                </View>
              </View>
            )}

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
        <View className="absolute top-4 left-4 right-36 flex-row items-center z-10 pointer-events-none">
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
        {!cameraModeActive && isRecording && (
          <View 
            className="absolute bottom-24 left-6 right-6 z-10 bg-[#0F1216]/95 border border-[#00A3E0]/30 rounded-2xl p-4 flex-row items-center justify-between"
            style={{
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 6 },
              shadowOpacity: 0.4,
              shadowRadius: 8,
              elevation: 8
            }}
          >
            {/* Speedometer */}
            <View className="flex-col justify-center items-center px-2">
              <Text className="text-[#8F9CAE] text-[9px] font-barlow-condensed-bold font-bold uppercase tracking-wider">VELOCIDAD</Text>
              <View className="flex-row items-baseline mt-1">
                <Text style={{ fontFamily: 'Orbitron-Bold', fontSize: 32, color: '#FFFFFF', lineHeight: 36 }}>
                  {Platform.OS === 'web' || !hasAccelerometer ? simSpeed : speed}
                </Text>
                <Text style={{ fontFamily: 'Orbitron-Bold', fontSize: 9, color: '#00A3E0', marginLeft: 4 }}>KM/H</Text>
              </View>
            </View>

            {/* Visual Lean Indicator Gauge */}
            <View className="flex-col items-center justify-center border-l border-r border-[#202630] px-4 flex-1">
              <Text className="text-[#8F9CAE] text-[9px] font-barlow-condensed-bold font-bold uppercase tracking-wider mb-1.5">INCLINACIÓN</Text>
              
              <View className="flex-row items-center justify-between w-full">
                {/* Left Max */}
                <View className="items-center">
                  <Text className="text-[#8F9CAE] text-[8px] font-barlow-condensed-bold font-bold">MÁX I</Text>
                  <Text style={{ fontFamily: 'Rajdhani-Bold', fontSize: 15, color: '#FF3B30' }}>{maxLeftLean}°</Text>
                </View>

                {/* Rotating Horizon / Attitude Indicator */}
                <View className="items-center justify-center relative w-14 h-14">
                  {/* Outer Circular Scale */}
                  <View className="absolute w-12 h-12 rounded-full border border-dashed border-[#8F9CAE]/20" />
                  
                  {/* Tilting Indicator */}
                  <View 
                    style={{ 
                      transform: [{ rotate: `${Platform.OS === 'web' || !hasAccelerometer ? simLean : leanAngle}deg` }] 
                    }}
                    className="items-center justify-center"
                  >
                    {/* Horizon line */}
                    <View className="w-9 h-0.5 bg-[#8F9CAE]/30 absolute" />
                    {/* Inner circle marker */}
                    <View className="w-5 h-1.5 bg-[#00A3E0] rounded-full items-center justify-center">
                      <View className="w-1 h-1 bg-[#FFFFFF] rounded-full" />
                    </View>
                  </View>

                  {/* Current Lean Angle Text overlaid at the bottom */}
                  <View className="absolute bottom-[-4px] bg-[#0F1216] px-1 py-0.5 rounded border border-[#202630]">
                    <Text style={{ fontFamily: 'Rajdhani-Bold', fontSize: 10, color: '#00E5FF' }}>
                      {Math.abs(Platform.OS === 'web' || !hasAccelerometer ? simLean : leanAngle)}°
                    </Text>
                  </View>
                </View>

                {/* Right Max */}
                <View className="items-center">
                  <Text className="text-[#8F9CAE] text-[8px] font-barlow-condensed-bold font-bold">MÁX D</Text>
                  <Text style={{ fontFamily: 'Rajdhani-Bold', fontSize: 15, color: '#34C759' }}>{maxRightLean}°</Text>
                </View>
              </View>
            </View>

            {/* Active Telemetry Status */}
            <View className="flex-col justify-center items-center px-2">
              <Text className="text-[#8F9CAE] text-[9px] font-barlow-condensed-bold font-bold uppercase tracking-wider">ESTADO</Text>
              <View className="items-center mt-2">
                <View 
                  className="w-2 h-2 rounded-full bg-[#00E5FF] mb-1" 
                  style={{
                    shadowColor: '#00E5FF',
                    shadowOffset: { width: 0, height: 0 },
                    shadowOpacity: 0.8,
                    shadowRadius: 4,
                  }}
                />
                <Text style={{ fontFamily: 'BarlowCondensed-Bold', fontSize: 8, color: '#00E5FF', letterSpacing: 0.5 }}>
                  {Platform.OS === 'web' || !hasAccelerometer ? 'SIMULADO' : 'CONECTADO'}
                </Text>
              </View>
            </View>
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
            {/* Map Type layers button */}
            <TouchableOpacity
              onPress={() => setMapType((prev) => (prev === 'standard' ? 'hybrid' : 'standard'))}
              className={`w-12 h-12 rounded-full ${colors.card} border ${colors.border} items-center justify-center`}
              style={{
                marginRight: 8,
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: colors.isDark ? 0.3 : 0.08,
                shadowRadius: 5,
                elevation: 5
              }}
            >
              <Layers size={20} color={mapType === 'hybrid' ? colors.bmwLightBlue : colors.bmwBlue} />
            </TouchableOpacity>

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
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
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
                contentContainerStyle={{ padding: 24, paddingBottom: 60 }}
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
                  disabled={saving}
                  className="w-full rounded-xl py-3.5 items-center justify-center border"
                  style={{
                    backgroundColor: colors.bmwBlue,
                    borderColor: colors.bmwBlue,
                    shadowColor: colors.bmwBlue,
                    shadowOffset: { width: 0, height: 4 },
                    shadowOpacity: 0.3,
                    shadowRadius: 8,
                    elevation: 4
                  }}
                >
                  {saving ? (
                    <ActivityIndicator color="#FFFFFF" />
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
            className={`${colors.card} border-t ${colors.border} rounded-t-3xl p-6 h-[70%]`}
            style={{
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
                            <Text className="font-rajdhani-semibold text-xs font-semibold mt-0.5" style={{ color: colors.bmwBlue }}>
                              {route.distance} km
                            </Text>
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
                        
                        <View className="flex-row space-x-2 ml-4">
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
    </SafeAreaView>
  );
}

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

import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, TextInput, ActivityIndicator, Alert, Modal, ScrollView, Dimensions, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import MapView, { Polyline, Marker, PROVIDER_DEFAULT } from 'react-native-maps';
import { Play, Square, Navigation, Bookmark, X, Save, Eye, Trash2 } from 'lucide-react-native';
import { api } from '../../utils/api';
import { useLocation, Coordinate } from '../../hooks/useLocation';

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
  const {
    currentLocation,
    isRecording,
    recordedRoute,
    totalDistance,
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
      const res = await api.get('/routes');
      // Format coordinates if returned as string from postgres json
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
  }, []);

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
    setSelectedRoute(null);
    await startRecording();
    Alert.alert('Ruta Iniciada 🏁', 'MotoPulse está grabando tus coordenadas GPS.');
  };

  // Stop route capture
  const handleStopTracking = () => {
    stopRecording();
    if (recordedRoute.length < 2) {
      Alert.alert('Ruta muy corta', 'No se grabaron suficientes coordenadas para guardar la ruta.');
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
      Alert.alert('Error', 'Por favor ingresa un nombre para la ruta');
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

      await api.post('/routes', payload);
      Alert.alert('¡Ruta Guardada! 🗺️', 'La ruta ha sido añadida a tus favoritos.');
      
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
      Alert.alert('Error', e.response?.data?.error || 'No se pudo guardar la ruta');
    } finally {
      setSaving(false);
    }
  };

  // Focus and draw selected route on map
  const handleViewRoute = (route: SavedRoute) => {
    setSelectedRoute(route);
    setRoutesModalVisible(false);

    if (route.coordinates.length > 0 && mapRef.current) {
      // Find bounding box to fit the route on screen
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
    Alert.alert(
      'Eliminar Ruta',
      '¿Deseas eliminar esta ruta de tus favoritos?',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.delete(`/routes/${routeId}`);
              if (selectedRoute?.id === routeId) {
                setSelectedRoute(null);
              }
              fetchRoutes();
            } catch (e) {
              console.error(e);
              Alert.alert('Error', 'No se pudo eliminar la ruta');
            }
          }
        }
      ]
    );
  };

  return (
    <SafeAreaView className="flex-1 bg-carbon-matte">
      {/* Map view */}
      <View className="flex-1 relative">
        <MapView
          ref={mapRef}
          provider={PROVIDER_DEFAULT}
          className="w-full h-full"
          customMapStyle={darkMapStyle}
          showsUserLocation={true}
          showsMyLocationButton={false}
          initialRegion={{
            latitude: currentLocation?.latitude || 19.4326, // Default CDMX or user
            longitude: currentLocation?.longitude || -99.1332,
            latitudeDelta: 0.05,
            longitudeDelta: 0.05,
          }}
        >
          {/* Active recording route overlay */}
          {isRecording && recordedRoute.length > 1 && (
            <Polyline
              coordinates={recordedRoute}
              strokeColor="#00E5FF" // Speedometer Cyan
              strokeWidth={5}
            />
          )}

          {/* Selected historical route overlay */}
          {selectedRoute && selectedRoute.coordinates.length > 1 && (
            <>
              <Polyline
                coordinates={selectedRoute.coordinates}
                strokeColor="#FF6B00" // KTM Orange
                strokeWidth={5}
              />
              <Marker
                coordinate={selectedRoute.coordinates[0]}
                title="Inicio"
                pinColor="#2CFF0A"
              />
              <Marker
                coordinate={selectedRoute.coordinates[selectedRoute.coordinates.length - 1]}
                title="Fin"
                pinColor="#FF2A3B"
              />
            </>
          )}
        </MapView>

        {/* Dashboard floating HUD */}
        <View className="absolute top-4 left-4 right-4 flex-row justify-between items-center z-10 pointer-events-none">
          {isRecording ? (
            <View className="bg-carbon-matte/90 border border-speedo-cyan rounded-xl p-3 flex-row items-center space-x-4 shadow-[0_0_12px_#00E5FF]">
              <View className="w-2.5 h-2.5 rounded-full bg-ducati-red animate-pulse" />
              <View>
                <Text className="text-xxs text-neutral-400 uppercase tracking-widest font-bold">GRABANDO RUTA</Text>
                <Text className="text-white font-orbitron font-bold text-sm">{totalDistance} km</Text>
              </View>
            </View>
          ) : selectedRoute ? (
            <View className="bg-carbon-matte/95 border border-tarmac-light rounded-xl p-3 flex-row items-center justify-between flex-1 pointer-events-auto">
              <View className="flex-1">
                <Text className="text-neutral-400 text-xxs uppercase tracking-widest font-bold">VIENDO RUTA</Text>
                <Text className="text-white font-bold text-sm">{selectedRoute.name}</Text>
                {selectedRoute.distance && (
                  <Text className="text-ktm-orange font-orbitron text-xs font-semibold">{selectedRoute.distance} km</Text>
                )}
              </View>
              <TouchableOpacity onPress={() => setSelectedRoute(null)} className="p-1">
                <X size={18} color="#FF2A3B" />
              </TouchableOpacity>
            </View>
          ) : (
            <View />
          )}
        </View>

        {/* Floating actions HUD */}
        <View className="absolute bottom-6 right-6 left-6 flex-row justify-between items-center z-10">
          {/* Favorites List button */}
          <TouchableOpacity
            onPress={() => setRoutesModalVisible(true)}
            className="w-12 h-12 rounded-full bg-tarmac/95 border border-tarmac-light items-center justify-center shadow-lg"
          >
            <Bookmark size={20} color="#00E5FF" />
          </TouchableOpacity>

          {/* Tracking button */}
          {isRecording ? (
            <TouchableOpacity
              onPress={handleStopTracking}
              className="w-16 h-16 rounded-full bg-ducati-red items-center justify-center border-2 border-white shadow-[0_0_15px_rgba(255,42,59,0.5)]"
            >
              <Square size={24} color="#F8F9FA" />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              onPress={handleStartTracking}
              className="w-16 h-16 rounded-full bg-speedo-cyan items-center justify-center border-2 border-white shadow-[0_0_15px_rgba(0,229,255,0.5)]"
            >
              <Play size={24} color="#0B0D10" className="ml-1" />
            </TouchableOpacity>
          )}

          {/* GPS Center button */}
          <TouchableOpacity
            onPress={centerOnUser}
            className="w-12 h-12 rounded-full bg-tarmac/95 border border-tarmac-light items-center justify-center shadow-lg"
          >
            <Navigation size={20} color="#2CFF0A" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Save Route Modal */}
      <Modal visible={saveModalVisible} animationType="slide" transparent={true}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          className="flex-1"
        >
          <View className="flex-1 bg-black/80 justify-end">
            <View className="bg-tarmac border-t border-tarmac-light rounded-t-3xl shadow-2xl max-h-[85%]">
              <ScrollView 
                contentContainerStyle={{ padding: 24, paddingBottom: 60 }}
                className="w-full"
                keyboardShouldPersistTaps="handled"
              >
                <View className="flex-row justify-between items-center mb-6">
                  <Text className="text-white font-orbitron text-base font-bold uppercase tracking-wider">
                    GUARDAR RUTA DE RIDER
                  </Text>
                  <TouchableOpacity onPress={() => setSaveModalVisible(false)} className="p-1">
                    <X size={24} color="#F8F9FA" />
                  </TouchableOpacity>
                </View>

                <View className="mb-4 bg-carbon-dark border border-tarmac-light rounded-xl p-4 items-center">
                  <Text className="text-neutral-400 text-xxs uppercase tracking-wider">Distancia total recorrida</Text>
                  <Text className="text-speedo-cyan font-orbitron text-2xl font-bold tracking-widest mt-1">{totalDistance} km</Text>
                </View>

                {/* Name */}
                <View className="mb-4">
                  <Text className="text-neutral-400 text-xs uppercase mb-1.5 font-medium tracking-wide">
                    Nombre de la Ruta
                  </Text>
                  <TextInput
                    value={routeName}
                    placeholder="Ej. Curvas de la Sierra, Ruta del Fin de Semana"
                    placeholderTextColor="#556070"
                    onChangeText={setRouteName}
                    className="w-full bg-carbon-dark text-white border border-tarmac-light rounded-xl px-4 py-3 text-sm focus:border-speedo-cyan"
                  />
                </View>

                {/* Start / End */}
                <View className="mb-4 flex-row space-x-4">
                  <View className="flex-1">
                    <Text className="text-neutral-400 text-xs uppercase mb-1.5 font-medium tracking-wide">
                      Punto de Inicio
                    </Text>
                    <TextInput
                      value={startPoint}
                      placeholder="Ej. Gasolinera km 10"
                      placeholderTextColor="#556070"
                      onChangeText={setStartPoint}
                      className="w-full bg-carbon-dark text-white border border-tarmac-light rounded-xl px-4 py-3 text-sm focus:border-speedo-cyan"
                    />
                  </View>

                  <View className="flex-1">
                    <Text className="text-neutral-400 text-xs uppercase mb-1.5 font-medium tracking-wide">
                      Punto de Destino
                    </Text>
                    <TextInput
                      value={endPoint}
                      placeholder="Ej. Mirador San Mateo"
                      placeholderTextColor="#556070"
                      onChangeText={setEndPoint}
                      className="w-full bg-carbon-dark text-white border border-tarmac-light rounded-xl px-4 py-3 text-sm focus:border-speedo-cyan"
                    />
                  </View>
                </View>

                {/* Notes */}
                <View className="mb-6">
                  <Text className="text-neutral-400 text-xs uppercase mb-1.5 font-medium tracking-wide">
                    Comentarios / Estado del Asfalto
                  </Text>
                  <TextInput
                    value={routeNotes}
                    placeholder="Ej. Buenas curvas, pocas imperfecciones, ideal para domingo."
                    placeholderTextColor="#556070"
                    onChangeText={setRouteNotes}
                    className="w-full bg-carbon-dark text-white border border-tarmac-light rounded-xl px-4 py-3 text-sm focus:border-speedo-cyan"
                  />
                </View>

                <TouchableOpacity
                  onPress={handleSaveRoute}
                  disabled={saving}
                  className="w-full bg-speedo-cyan rounded-xl py-3.5 items-center justify-center border border-speedo-cyan shadow-[0_0_12px_rgba(0,229,255,0.4)]"
                >
                  {saving ? (
                    <ActivityIndicator color="#0B0D10" />
                  ) : (
                    <Text className="text-carbon-matte font-bold text-sm uppercase tracking-widest">
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
        <View className="flex-1 bg-black/80 justify-end">
          <View className="bg-tarmac border-t border-tarmac-light rounded-t-3xl p-6 shadow-2xl h-[70%]">
            <View className="flex-row justify-between items-center mb-6">
              <Text className="text-white font-orbitron text-base font-bold uppercase tracking-wider">
                MIS RUTAS FAVORITAS
              </Text>
              <TouchableOpacity onPress={() => setRoutesModalVisible(false)} className="p-1">
                <X size={24} color="#F8F9FA" />
              </TouchableOpacity>
            </View>

            {loading ? (
              <ActivityIndicator size="large" color="#00E5FF" className="my-auto" />
            ) : (
              <ScrollView className="flex-1">
                {savedRoutes.length > 0 ? (
                  savedRoutes.map((route) => (
                    <View
                      key={route.id}
                      className="bg-carbon-dark border border-tarmac-light rounded-xl p-4 mb-3"
                    >
                      <View className="flex-row justify-between items-start">
                        <View className="flex-1">
                          <Text className="text-white font-bold text-base">{route.name}</Text>
                          {route.distance && (
                            <Text className="text-speedo-cyan font-orbitron text-xs font-semibold mt-0.5">
                              {route.distance} km
                            </Text>
                          )}
                          {(route.startPoint || route.endPoint) && (
                            <Text className="text-neutral-400 text-xs mt-1.5">
                              {route.startPoint || 'Inicio'} → {route.endPoint || 'Fin'}
                            </Text>
                          )}
                          {route.notes && (
                            <Text className="text-neutral-400 text-xs italic mt-2">"{route.notes}"</Text>
                          )}
                        </View>
                        
                        <View className="flex-row space-x-2 ml-4">
                          <TouchableOpacity
                            onPress={() => handleViewRoute(route)}
                            className="bg-tarmac border border-tarmac-light p-2 rounded-lg"
                          >
                            <Eye size={16} color="#2CFF0A" />
                          </TouchableOpacity>
                          <TouchableOpacity
                            onPress={() => handleDeleteRoute(route.id)}
                            className="bg-tarmac border border-tarmac-light p-2 rounded-lg"
                          >
                            <Trash2 size={16} color="#FF2A3B" />
                          </TouchableOpacity>
                        </View>
                      </View>
                    </View>
                  ))
                ) : (
                  <View className="items-center py-20">
                    <Bookmark size={36} color="#8F9CAE" />
                    <Text className="text-white font-medium mt-2">No has guardado ninguna ruta</Text>
                    <Text className="text-neutral-400 text-center text-xs mt-1">Graba un recorrido en el mapa y aparecerá aquí.</Text>
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

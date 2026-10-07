import React, { useState, useEffect, useRef } from 'react';
import { View, Text, ScrollView, ActivityIndicator, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Bookmark, Navigation, Phone, Eye, Trash2, Globe, Play, Square, Route, X } from 'lucide-react-native';
import { api } from '../../utils/api';
import { useTheme } from '../../utils/ThemeContext';

interface SavedRoute {
  id: string;
  name: string;
  coordinates: any[];
  distance: number | null;
  startPoint: string | null;
  endPoint: string | null;
  notes: string | null;
  maxSpeed?: number | null;
  maxLeftLean?: number | null;
  maxRightLean?: number | null;
}

export default function RoutesMapWebScreen() {
  const { colors, theme } = useTheme();
  const [savedRoutes, setSavedRoutes] = useState<SavedRoute[]>([]);
  const [loading, setLoading] = useState(true);

  // Live Simulator States
  const [isSimulating, setIsSimulating] = useState(false);
  const [simSpeed, setSimSpeed] = useState(0);
  const [simLean, setSimLean] = useState(0);
  const [maxLeftLean, setMaxLeftLean] = useState(0);
  const [maxRightLean, setMaxRightLean] = useState(0);
  const [simDistance, setSimDistance] = useState(0);

  const [mapType, setMapType] = useState<'standard' | 'hybrid'>('standard');
  const [selectedRoute, setSelectedRoute] = useState<SavedRoute | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  // Sync state to iframe on change
  useEffect(() => {
    if (iframeRef.current && iframeRef.current.contentWindow) {
      iframeRef.current.contentWindow.postMessage({
        type: 'SET_MAP_TYPE',
        mapType,
        isDark: colors.isDark
      }, '*');
    }
  }, [mapType, colors.isDark]);

  useEffect(() => {
    if (iframeRef.current && iframeRef.current.contentWindow) {
      const coords = selectedRoute ? selectedRoute.coordinates : [];
      iframeRef.current.contentWindow.postMessage({
        type: 'SHOW_SELECTED_ROUTE',
        coordsJson: JSON.stringify(coords)
      }, '*');
    }
  }, [selectedRoute]);

  const fetchRoutes = async () => {
    try {
      const res = await api.get('/routes');
      const formatted = res.data.map((r: any) => ({
        ...r,
        coordinates: typeof r.coordinates === 'string' ? JSON.parse(r.coordinates) : r.coordinates
      }));
      setSavedRoutes(formatted);
    } catch (e) {
      console.error('Error fetching saved routes on web:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRoutes();
  }, []);

  // Simulation runner
  useEffect(() => {
    if (!isSimulating) {
      setSimSpeed(0);
      setSimLean(0);
      return;
    }

    let t = 0;
    const interval = setInterval(() => {
      t += 0.05;

      // Simulate curved road leans (between -40 and +40 degrees)
      const wave = Math.sin(t * 0.8) * Math.cos(t * 0.2);
      let rawLean = Math.round(wave * 45);
      if (Math.abs(rawLean) < 4) rawLean = 0;

      // Simulate motorcycle speed reacting to curves
      const leanFactor = Math.abs(rawLean) / 45;
      const baseSpeed = 85;
      const targetSpeed = baseSpeed + (1 - leanFactor) * 35 - leanFactor * 30 + Math.sin(t * 2) * 5;
      const roundedSpeed = Math.max(0, Math.round(targetSpeed));

      setSimSpeed(roundedSpeed);
      setSimLean(rawLean);

      // Accumulate simulated distance (roundedSpeed km/h converted to km/tick)
      setSimDistance((prev) => prev + (roundedSpeed / 3600) * 0.1);

      // Record peak lean limits
      if (rawLean < 0) {
        setMaxLeftLean((prev) => Math.max(prev, Math.abs(rawLean)));
      } else if (rawLean > 0) {
        setMaxRightLean((prev) => Math.max(prev, rawLean));
      }
    }, 100);

    return () => clearInterval(interval);
  }, [isSimulating]);

  const startSimulation = () => {
    setSimDistance(0);
    setMaxLeftLean(0);
    setMaxRightLean(0);
    setSimLean(0);
    setSimSpeed(0);
    setIsSimulating(true);
  };

  const handleDeleteRoute = (routeId: string) => {
    // Standard confirm for web
    if (confirm('¿Deseas eliminar esta ruta de tus favoritos?')) {
      api.delete(`/routes/${routeId}`)
        .then(() => fetchRoutes())
        .catch(err => {
          console.error(err);
          alert('No se pudo eliminar la ruta');
        });
    }
  };

  return (
    <SafeAreaView className={`flex-1 ${colors.bg}`}>
      {/* Header */}
      <View
        className="flex-row justify-between items-center px-6 py-4"
        style={{
          borderBottomWidth: 1,
          borderBottomColor: theme === "light" ? "#D8E0EB" : "#242D3D",
        }}
      >
        <Text className={`${colors.text} font-orbitron text-lg font-bold tracking-wider uppercase`}>
          RUTAS Y GPS (WEB CONSOLE)
        </Text>
      </View>

      <View className="flex-1 flex-row md:flex-row flex-col">
        {/* Left Side: Web Map Mockup / Telemetry Simulator */}
        <View className={`flex-1 ${colors.isDark ? 'bg-[#0A0D12]' : 'bg-[#F4F5F7]'} p-6 justify-center items-center border-r ${colors.border}`}>
          {isSimulating ? (
            <View className="w-full max-w-md items-center">
              {/* Perspective Road View */}
              <View 
                className="w-full h-64 rounded-2xl mb-6 relative overflow-hidden bg-[#0F1216] border border-[#FF5A1F]/30 justify-center items-center"
                style={{
                  shadowColor: '#000',
                  shadowOffset: { width: 0, height: 10 },
                  shadowOpacity: 0.3,
                  shadowRadius: 15,
                }}
              >
                {/* Horizontal Perspective Horizon Line */}
                <View 
                  style={{ 
                    transform: [{ rotate: `${-simLean}deg` }],
                    width: '200%',
                    height: 4,
                    backgroundColor: '#1E2530',
                    position: 'absolute',
                    top: '55%',
                  }} 
                />

                {/* Road center line */}
                <View 
                  style={{
                    transform: [{ rotate: `${-simLean * 1.3}deg` }, { scaleY: 1.5 }],
                    width: 3,
                    height: 100,
                    borderStyle: 'dashed',
                    borderWidth: 2,
                    borderColor: '#FFFFFF',
                    opacity: 0.5,
                  }}
                />

                {/* Status indicator overlay */}
                <View className="absolute top-4 left-4 right-4 flex-row justify-between items-center bg-[#0F1216]/90 p-2.5 rounded-xl border border-[#202630]">
                  <View className="flex-row items-center space-x-2">
                    <View className="w-2.5 h-2.5 rounded-full bg-red-600 animate-pulse" />
                    <Text className="text-red-500 font-barlow-condensed-bold font-bold text-[10px] uppercase tracking-wider">SIMULADOR ACTIVO</Text>
                  </View>
                  <Text style={{ fontFamily: 'Rajdhani-Bold', fontSize: 13, color: '#FF5A1F' }}>{simDistance.toFixed(2)} km</Text>
                </View>

                {/* TFT Telemetry HUD overlay matching native styling */}
                <View 
                  className="absolute bottom-4 left-4 right-4 bg-[#0F1216]/95 border border-[#FF5A1F]/30 rounded-xl p-3 flex-row items-center justify-between"
                  style={{
                    shadowColor: '#000',
                    shadowOffset: { width: 0, height: 4 },
                    shadowOpacity: 0.3,
                    shadowRadius: 6,
                  }}
                >
                  {/* Speedometer */}
                  <View className="items-center px-1">
                    <Text className="text-[#8F9CAE] text-[8px] font-barlow-condensed-bold font-bold uppercase tracking-wider">VELOCIDAD</Text>
                    <View className="flex-row items-baseline mt-0.5">
                      <Text style={{ fontFamily: 'Orbitron-Bold', fontSize: 24, color: '#FFFFFF', lineHeight: 28 }}>{simSpeed}</Text>
                      <Text style={{ fontFamily: 'Orbitron-Bold', fontSize: 8, color: '#FF5A1F', marginLeft: 2 }}>KM/H</Text>
                    </View>
                  </View>

                  {/* Inclination indicator */}
                  <View className="border-l border-r border-[#202630] px-3 flex-1 items-center justify-center">
                    <Text className="text-[#8F9CAE] text-[8px] font-barlow-condensed-bold font-bold uppercase tracking-wider mb-1">INCLINACIÓN</Text>
                    
                    <View className="flex-row items-center justify-between w-full">
                      {/* Left Max */}
                      <View className="items-center">
                        <Text className="text-[#8F9CAE] text-[7px] font-barlow-condensed-bold font-bold">MÁX I</Text>
                        <Text style={{ fontFamily: 'Rajdhani-Bold', fontSize: 12, color: '#FF3B30' }}>{maxLeftLean}°</Text>
                      </View>

                      {/* Moving horizon visual */}
                      <View className="items-center justify-center relative w-10 h-10">
                        <View className="absolute w-9 h-9 rounded-full border border-dashed border-[#8F9CAE]/20" />
                        <View 
                          style={{ transform: [{ rotate: `${simLean}deg` }] }}
                          className="items-center justify-center"
                        >
                          <View className="w-7 h-0.5 bg-[#8F9CAE]/30 absolute" />
                          <View className="w-4 h-1 bg-[#FF5A1F] rounded-full" />
                        </View>
                        <View className="absolute bottom-[-4px] bg-[#0F1216] px-1 py-0.2 rounded border border-[#202630]">
                          <Text style={{ fontFamily: 'Rajdhani-Bold', fontSize: 8, color: '#FF5A1F' }}>{Math.abs(simLean)}°</Text>
                        </View>
                      </View>

                      {/* Right Max */}
                      <View className="items-center">
                        <Text className="text-[#8F9CAE] text-[7px] font-barlow-condensed-bold font-bold">MÁX D</Text>
                        <Text style={{ fontFamily: 'Rajdhani-Bold', fontSize: 12, color: '#34C759' }}>{maxRightLean}°</Text>
                      </View>
                    </View>
                  </View>

                  {/* Status */}
                  <View className="items-center px-1">
                    <Text className="text-[#8F9CAE] text-[8px] font-barlow-condensed-bold font-bold uppercase tracking-wider">ESTADO</Text>
                    <View className="items-center mt-1">
                      <View className="w-1.5 h-1.5 rounded-full bg-[#FF5A1F] mb-0.5" />
                      <Text style={{ fontFamily: 'BarlowCondensed-Bold', fontSize: 7, color: '#FF5A1F' }}>SIMULADO</Text>
                    </View>
                  </View>
                </View>
              </View>

              <TouchableOpacity
                onPress={() => setIsSimulating(false)}
                className="flex-row items-center space-x-2 bg-red-600 rounded-xl px-6 py-3 border border-red-500 shadow-md"
              >
                <Square size={16} color="#FFFFFF" />
                <Text className="text-white font-bold text-xs uppercase tracking-wider">DETENER SIMULACIÓN</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={{ width: '100%', height: '100%', position: 'relative' }}>
              <iframe
                ref={iframeRef}
                srcDoc={LEAFLET_HTML}
                style={{ width: '100%', height: '100%', border: 'none', borderRadius: 16 }}
                onLoad={() => {
                  if (iframeRef.current && iframeRef.current.contentWindow) {
                    iframeRef.current.contentWindow.postMessage({
                      type: 'INIT',
                      mapType,
                      isDark: colors.isDark
                    }, '*');
                  }
                }}
              />
              {/* Floating controls */}
              <View style={{ position: 'absolute', bottom: 16, right: 16, flexDirection: 'row', alignItems: 'center', zIndex: 10 }}>
                <TouchableOpacity
                  onPress={() => {
                    if (iframeRef.current && iframeRef.current.contentWindow) {
                      iframeRef.current.contentWindow.postMessage({
                        type: 'SHOW_SELECTED_ROUTE',
                        coordsJson: JSON.stringify(selectedRoute ? selectedRoute.coordinates : [])
                      }, '*');
                    }
                  }}
                  className={`w-10 h-10 rounded-full ${colors.card} border ${colors.border} items-center justify-center`}
                  style={{
                    shadowColor: '#000',
                    shadowOffset: { width: 0, height: 2 },
                    shadowOpacity: 0.15,
                    shadowRadius: 3,
                  }}
                >
                  <Navigation size={18} color={colors.statusGreen} />
                </TouchableOpacity>
              </View>

              {/* Simulation Launcher Top Banner */}
              <View 
                className="absolute top-4 left-4 right-4 bg-[#0F1216]/95 border border-[#FF5A1F]/30 rounded-xl p-3 flex-row items-center justify-between z-10"
                style={{
                  shadowColor: '#000',
                  shadowOffset: { width: 0, height: 4 },
                  shadowOpacity: 0.3,
                  shadowRadius: 6,
                }}
              >
                <View className="flex-1 mr-4">
                  <Text className="text-white font-bold text-xs uppercase tracking-wide">RASTREO GPS & MAPAS</Text>
                  <Text className="text-[#8F9CAE] text-[10px] mt-0.5">Visualiza tus curvas y rutas favoritas guardadas o inicia la simulación de telemetría.</Text>
                </View>
                <TouchableOpacity
                  onPress={startSimulation}
                  className="bg-[#FF5A1F] rounded-lg px-3 py-1.5 border border-[#FF5A1F] shadow-sm flex-row items-center space-x-1"
                >
                  <Play size={12} color="#FFFFFF" />
                  <Text className="text-white font-bold text-[10px] uppercase tracking-wider">SIMULAR</Text>
                </TouchableOpacity>
              </View>

              {/* Selected Route Info banner on the map */}
              {selectedRoute && (
                <View 
                  className="absolute bottom-4 left-4 right-16 bg-[#0F1216]/95 border border-[#EF4444]/30 rounded-xl p-3 flex-row items-center justify-between z-10"
                  style={{
                    shadowColor: '#000',
                    shadowOffset: { width: 0, height: 4 },
                    shadowOpacity: 0.3,
                    shadowRadius: 6,
                  }}
                >
                  <View className="flex-grow">
                    <Text className="text-[#EF4444] text-[8px] font-barlow-condensed-bold font-bold uppercase tracking-wider">VIENDO RUTA</Text>
                    <Text className="text-white font-bold text-xs mt-0.5">{selectedRoute.name}</Text>
                    {selectedRoute.distance && (
                      <Text className="font-orbitron text-[10px] font-semibold mt-0.5" style={{ color: colors.bmwBlue }}>{selectedRoute.distance} km</Text>
                    )}
                  </View>
                  <TouchableOpacity onPress={() => setSelectedRoute(null)} className="p-1">
                    <X size={16} color={colors.bmwRed} />
                  </TouchableOpacity>
                </View>
              )}
            </View>
          )}
        </View>

        {/* Right Side: Saved Routes List */}
        <View className={`w-full md:w-[450px] p-6 ${colors.bg}`}>
          <Text className={`${colors.textSec} font-bold text-xs uppercase tracking-widest mb-4 flex-row items-center`}>
            <Bookmark size={14} color={colors.isDark ? '#8F9CAE' : '#8E9FBC'} className="mr-1.5" />
            MIS RUTAS FAVORITAS
          </Text>

          {loading ? (
            <ActivityIndicator size="large" color={colors.bmwBlue} className="my-auto" />
          ) : (
            <ScrollView className="flex-grow">
              {savedRoutes.length > 0 ? (
                savedRoutes.map((route) => (
                  <View
                    key={route.id}
                    className={`${colors.card} border ${colors.border} rounded-xl p-4 mb-3`}
                  >
                    <View className="flex-row justify-between items-start">
                      <View className="flex-1">
                        <Text className={`${colors.text} font-bold text-base`}>{route.name}</Text>
                        {route.distance && (
                          <View className="flex-row flex-wrap items-center mt-1">
                            <Text className="font-orbitron text-xs font-semibold" style={{ color: colors.bmwBlue }}>
                              {route.distance.toFixed(1)} km
                            </Text>
                            {route.maxSpeed !== undefined && route.maxSpeed !== null && (
                              <>
                                <Text className="text-xs font-barlow-condensed-bold mx-2 uppercase" style={{ color: colors.textMuted }}>•</Text>
                                <Text className="font-rajdhani-semibold text-xs font-semibold" style={{ color: colors.textSec }}>
                                  MÁX VEL: {Math.round(route.maxSpeed)} km/h
                                </Text>
                              </>
                            )}
                            {route.maxLeftLean !== undefined && route.maxLeftLean !== null && (
                              <>
                                <Text className="text-xs font-barlow-condensed-bold mx-2 uppercase" style={{ color: colors.textMuted }}>•</Text>
                                <Text className="font-rajdhani-semibold text-xs font-semibold" style={{ color: colors.textSec }}>
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
                      
                      <View className="flex-row space-x-2 ml-4">
                        <TouchableOpacity
                          onPress={() => setSelectedRoute(route)}
                          className={`${colors.isDark ? 'bg-[#1A202C]' : 'bg-[#EBF0F5]'} border ${colors.border} p-2 rounded-lg`}
                        >
                          <Eye size={16} color={colors.bmwBlue} />
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => handleDeleteRoute(route.id)}
                          className={`${colors.isDark ? 'bg-[#1A202C]' : 'bg-[#EBF0F5]'} border ${colors.border} p-2 rounded-lg`}
                        >
                          <Trash2 size={16} color={colors.bmwRed} />
                        </TouchableOpacity>
                      </View>
                    </View>
                  </View>
                ))
              ) : (
                <View className={`items-center py-20 ${colors.card} rounded-xl border ${colors.border} border-dashed`}>
                  <Globe size={32} color={colors.isDark ? '#8F9CAE' : '#8E9FBC'} />
                  <Text className={`${colors.text} font-medium mt-2 text-center text-sm`}>No has guardado ninguna ruta</Text>
                  <Text className={`${colors.textMuted} text-center text-xs mt-1 px-4`}>
                    Graba tus recorridos en carretera desde tu celular para consultarlos en esta lista.
                  </Text>
                </View>
              )}
            </ScrollView>
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}

// Leaflet HTML template for Web iframe map
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
      display: block !important;
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
      zoomControl: true,
      attributionControl: true
    }).setView([19.4326, -99.1332], 13);

    var osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 });
    var dark = L.tileLayer('https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png', { maxZoom: 19 });
    var satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19 });

    var currentLayer = dark;
    currentLayer.addTo(map);

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
        currentLayer = satellite;
      } else {
        currentLayer = isDark ? dark : osm;
      }
      currentLayer.addTo(map);
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

    window.addEventListener('message', function(event) {
      var data = event.data;
      if (!data) return;
      if (data.type === 'INIT' || data.type === 'SET_MAP_TYPE') {
        window.setMapType(data.mapType, data.isDark);
      } else if (data.type === 'SHOW_SELECTED_ROUTE') {
        window.showSelectedRoute(data.coordsJson);
      }
    });
  </script>
</body>
</html>
`;

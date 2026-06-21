import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, ActivityIndicator, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Bookmark, Navigation, Phone, Eye, Trash2, Globe, Play, Square, Route } from 'lucide-react-native';
import { api } from '../../utils/api';
import { useTheme } from '../../utils/ThemeContext';

interface SavedRoute {
  id: string;
  name: string;
  distance: number | null;
  startPoint: string | null;
  endPoint: string | null;
  notes: string | null;
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

  const fetchRoutes = async () => {
    try {
      const res = await api.get('/routes');
      setSavedRoutes(res.data);
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
                className="w-full h-64 rounded-2xl mb-6 relative overflow-hidden bg-[#0F1216] border border-[#00A3E0]/30 justify-center items-center"
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
                  <Text style={{ fontFamily: 'Rajdhani-Bold', fontSize: 13, color: '#00E5FF' }}>{simDistance.toFixed(2)} km</Text>
                </View>

                {/* TFT Telemetry HUD overlay matching native styling */}
                <View 
                  className="absolute bottom-4 left-4 right-4 bg-[#0F1216]/95 border border-[#00A3E0]/30 rounded-xl p-3 flex-row items-center justify-between"
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
                      <Text style={{ fontFamily: 'Orbitron-Bold', fontSize: 8, color: '#00A3E0', marginLeft: 2 }}>KM/H</Text>
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
                          <View className="w-4 h-1 bg-[#00A3E0] rounded-full" />
                        </View>
                        <View className="absolute bottom-[-4px] bg-[#0F1216] px-1 py-0.2 rounded border border-[#202630]">
                          <Text style={{ fontFamily: 'Rajdhani-Bold', fontSize: 8, color: '#00E5FF' }}>{Math.abs(simLean)}°</Text>
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
                      <View className="w-1.5 h-1.5 rounded-full bg-[#00E5FF] mb-0.5" />
                      <Text style={{ fontFamily: 'BarlowCondensed-Bold', fontSize: 7, color: '#00E5FF' }}>SIMULADO</Text>
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
            <View className={`max-w-md items-center text-center p-6 ${colors.card} border ${colors.border} rounded-2xl shadow-xl`}>
              <View className={`w-12 h-12 rounded-full ${colors.isDark ? 'bg-[#00A3E0]/20' : 'bg-[#1C69D4]/20'} items-center justify-center mb-4`}>
                <Route size={24} color={colors.bmwBlue} />
              </View>
              <Text className={`${colors.text} font-orbitron text-base font-bold uppercase mb-2`}>
                Rastreo GPS & Telemetría
              </Text>
              <Text className={`${colors.textMuted} text-xs leading-relaxed mb-6`}>
                La grabación de rutas y la telemetría TFT en tiempo real (velocidad e inclinación) utilizan sensores nativos de tu celular. 
                Inicia la simulación para visualizar cómo opera el HUD interactivo de curvas y velocidad en la aplicación móvil.
              </Text>

              <View className="w-full flex-col space-y-3">
                <TouchableOpacity
                  onPress={startSimulation}
                  className="w-full flex-row items-center justify-center space-x-2 rounded-xl py-3 border"
                  style={{
                    backgroundColor: colors.bmwBlue,
                    borderColor: colors.bmwBlue,
                  }}
                >
                  <Play size={16} color="#FFFFFF" className="ml-1" />
                  <Text className="text-white font-bold text-xs uppercase tracking-wider">PROBAR SIMULADOR TFT</Text>
                </TouchableOpacity>

                <View className={`flex-row items-center justify-center ${colors.isDark ? 'bg-[#1A202C]' : 'bg-[#EBF0F5]'} border ${colors.border} rounded-xl p-3 w-full space-x-3`}>
                  <Phone size={18} color={colors.bmwBlue} />
                  <Text className={`${colors.textSec} text-xxs font-semibold uppercase tracking-wider`}>
                    Disponible en iOS y Android
                  </Text>
                </View>
              </View>
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
                          <Text className="font-orbitron text-xs font-semibold mt-0.5" style={{ color: colors.bmwBlue }}>
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
                          onPress={() => alert('Para visualizar el recorrido en el mapa, abre la aplicación en tu celular.')}
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

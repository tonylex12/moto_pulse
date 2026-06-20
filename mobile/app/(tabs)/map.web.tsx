import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, ActivityIndicator, TouchableOpacity, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Bookmark, Navigation, Phone, Eye, Trash2, Globe } from 'lucide-react-native';
import { api } from '../../utils/api';

interface SavedRoute {
  id: string;
  name: string;
  distance: number | null;
  startPoint: string | null;
  endPoint: string | null;
  notes: string | null;
}

export default function RoutesMapWebScreen() {
  const [savedRoutes, setSavedRoutes] = useState<SavedRoute[]>([]);
  const [loading, setLoading] = useState(true);

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
    <SafeAreaView className="flex-1 bg-carbon-matte">
      {/* Header */}
      <View className="flex-row justify-between items-center px-6 py-4 border-b border-tarmac">
        <Text className="text-white font-orbitron text-lg font-bold tracking-wider uppercase">
          RUTAS Y GPS (WEB CONSOLE)
        </Text>
      </View>

      <View className="flex-1 flex-row md:flex-row flex-col">
        {/* Left Side: Web Map Mockup / Info */}
        <View className="flex-1 bg-carbon-dark p-6 justify-center items-center border-r border-tarmac">
          <View className="max-w-md items-center text-center p-6 bg-tarmac border border-tarmac-light rounded-2xl shadow-xl">
            <View className="w-12 h-12 rounded-full bg-speedo-cyan/20 items-center justify-center mb-4">
              <Navigation size={24} color="#00E5FF" />
            </View>
            <Text className="text-white font-orbitron text-lg font-bold uppercase mb-2">
              Rastreo GPS en Celular
            </Text>
            <Text className="text-neutral-400 text-xs leading-relaxed mb-6">
              El rastreo GPS en tiempo real y la grabación de recorridos requieren sensores nativos de alta precisión. 
              Por favor abre **MotoPulse** en tu dispositivo físico Android o iOS (mediante Expo Go) para registrar una nueva ruta.
            </Text>

            <View className="flex-row items-center bg-carbon-matte border border-tarmac-light rounded-xl p-3 w-full space-x-3">
              <Phone size={18} color="#FF6B00" />
              <Text className="text-neutral-300 text-xxs font-semibold uppercase tracking-wider">
                Disponible en iOS y Android
              </Text>
            </View>
          </View>
        </View>

        {/* Right Side: Saved Routes List */}
        <View className="w-full md:w-[450px] p-6 bg-carbon-matte">
          <Text className="text-neutral-400 font-bold text-xs uppercase tracking-widest mb-4 flex-row items-center">
            <Bookmark size={14} color="#8F9CAE" className="mr-1.5" />
            MIS RUTAS FAVORITAS
          </Text>

          {loading ? (
            <ActivityIndicator size="large" color="#00E5FF" className="my-auto" />
          ) : (
            <ScrollView className="flex-grow">
              {savedRoutes.length > 0 ? (
                savedRoutes.map((route) => (
                  <View
                    key={route.id}
                    className="bg-tarmac border border-tarmac-light rounded-xl p-4 mb-3"
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
                          onPress={() => alert('Para visualizar el recorrido en el mapa, abre la aplicación en tu celular.')}
                          className="bg-carbon-matte border border-tarmac-light p-2 rounded-lg"
                        >
                          <Eye size={16} color="#00E5FF" />
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => handleDeleteRoute(route.id)}
                          className="bg-carbon-matte border border-tarmac-light p-2 rounded-lg"
                        >
                          <Trash2 size={16} color="#FF2A3B" />
                        </TouchableOpacity>
                      </View>
                    </View>
                  </View>
                ))
              ) : (
                <View className="items-center py-20 bg-tarmac/40 rounded-xl border border-tarmac-light border-dashed">
                  <Globe size={32} color="#8F9CAE" />
                  <Text className="text-white font-medium mt-2 text-center text-sm">No has guardado ninguna ruta</Text>
                  <Text className="text-neutral-400 text-center text-xs mt-1 px-4">
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

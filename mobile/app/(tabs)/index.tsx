import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, Alert, Modal, Platform, KeyboardAvoidingView, Keyboard } from 'react-native';
import { useUser, useAuth } from '@clerk/clerk-expo';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LogOut, Plus, AlertTriangle, ShieldCheck, CheckCircle2, ChevronDown } from 'lucide-react-native';
import { api } from '../../utils/api';
import { usePushNotifications } from '../../hooks/usePushNotifications';
import { TachometerGauge } from '../../components/ui/TachometerGauge';

interface Vehicle {
  id: string;
  brand: string;
  model: string;
  year: number;
  currentMileage: number;
}

interface AlertData {
  id: string;
  type: 'OIL_CHANGE' | 'BRAKE_PADS' | 'INSURANCE_RENEWAL' | 'CUSTOM';
  title: string;
  triggerType: 'MILEAGE' | 'DATE';
  triggerValue: string;
  isCompleted: boolean;
}

const POPULAR_BRANDS = [
  'Honda',
  'Yamaha',
  'Suzuki',
  'Kawasaki',
  'KTM',
  'Ducati',
  'BMW',
  'Harley-Davidson',
  'Triumph',
  'Bajaj',
  'Benelli',
  'Royal Enfield',
  'Otro / Manual'
];

export default function DashboardScreen() {
  const { user } = useUser();
  const { signOut } = useAuth();
  const { expoPushToken } = usePushNotifications();

  // State
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [alerts, setAlerts] = useState<AlertData[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Form State for Vehicle Registration
  const [brand, setBrand] = useState('Honda');
  const [customBrand, setCustomBrand] = useState('');
  const [isBrandDropdownOpen, setIsBrandDropdownOpen] = useState(false);
  const [model, setModel] = useState('');
  const [year, setYear] = useState(new Date().getFullYear().toString());
  const [currentMileage, setCurrentMileage] = useState('');
  const [registering, setRegistering] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);

  useEffect(() => {
    const showSubscription = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      () => setKeyboardVisible(true)
    );
    const hideSubscription = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => setKeyboardVisible(false)
    );

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  // Fetch active vehicle and alerts
  const fetchData = async () => {
    try {
      const response = await api.get('/vehicles');
      if (response.data && response.data.length > 0) {
        const activeVehicle = response.data[0];
        setVehicle(activeVehicle);
        
        // Fetch alerts for this vehicle
        const alertsResponse = await api.get(`/alerts/vehicle/${activeVehicle.id}`);
        setAlerts(alertsResponse.data);
      } else {
        setVehicle(null);
        setAlerts([]);
      }
    } catch (e) {
      console.error('Error fetching dashboard data:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Sync Push Token with backend once Clerk and Expo notifications resolve
  useEffect(() => {
    if (expoPushToken) {
      api.post('/users/push-token', { expoPushToken })
        .then(() => console.log('Push token successfully registered in backend!'))
        .catch(err => console.error('Failed to sync push token with backend:', err));
    }
  }, [expoPushToken]);

  // Register New Vehicle
  const handleRegisterVehicle = async () => {
    const finalBrand = brand === 'Otro / Manual' ? customBrand.trim() : brand;
    if (!finalBrand) {
      Alert.alert('Error', 'Por favor ingresa la marca de tu moto');
      return;
    }
    if (!model.trim() || !year || !currentMileage) {
      Alert.alert('Error', 'Por favor completa todos los campos del vehículo');
      return;
    }

    setRegistering(true);
    try {
      const payload = {
        brand: finalBrand,
        model: model.trim(),
        year: parseInt(year),
        currentMileage: parseInt(currentMileage),
      };

      const response = await api.post('/vehicles', payload);
      setVehicle(response.data);
      
      // Auto-create default alerts for new riders
      const bikeId = response.data.id;
      const initialMileage = response.data.currentMileage;

      // 1. Oil change alert in 3,000 km
      await api.post('/alerts', {
        vehicleId: bikeId,
        type: 'OIL_CHANGE',
        title: 'Cambio de Aceite',
        triggerType: 'MILEAGE',
        triggerValue: (initialMileage + 3000).toString(),
      });

      // 2. Brake pads check in 10,000 km
      await api.post('/alerts', {
        vehicleId: bikeId,
        type: 'BRAKE_PADS',
        title: 'Pastillas de Freno',
        triggerType: 'MILEAGE',
        triggerValue: (initialMileage + 10000).toString(),
      });

      // 3. Insurance renewal in 1 year
      const nextYear = new Date();
      nextYear.setFullYear(nextYear.getFullYear() + 1);
      await api.post('/alerts', {
        vehicleId: bikeId,
        type: 'INSURANCE_RENEWAL',
        title: 'Renovación de Seguro',
        triggerType: 'DATE',
        triggerValue: nextYear.toISOString(),
      });

      Alert.alert('¡Motor Encendido!', 'Tu vehículo y alertas iniciales han sido registrados con éxito.');
      fetchData();
    } catch (e: any) {
      console.error(e);
      Alert.alert('Error', e.response?.data?.error || 'No se pudo registrar la moto');
    } finally {
      setRegistering(false);
    }
  };

  const handleLogout = () => {
    Alert.alert(
      'Cerrar Sesión',
      '¿Estás seguro de que quieres apagar el motor y salir?',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Salir', style: 'destructive', onPress: () => signOut() },
      ]
    );
  };

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: '#0B0D10', justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#00E5FF" />
      </View>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-carbon-matte">
      {/* Custom App Header */}
      <View className="flex-row justify-between items-center px-6 py-4 border-b border-tarmac">
        <View className="flex-row items-center">
          <View className="w-8 h-8 rounded-full bg-speedo-cyan items-center justify-center mr-2 shadow-[0_0_8px_#00E5FF]">
            <Text className="text-carbon-matte font-bold text-base">M</Text>
          </View>
          <Text className="text-white font-orbitron text-lg font-bold tracking-widest">
            MOTO<Text className="text-speedo-cyan">PULSE</Text>
          </Text>
        </View>
        <TouchableOpacity onPress={handleLogout} className="p-2 bg-tarmac border border-tarmac-light rounded-lg">
          <LogOut size={16} color="#FF2A3B" />
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1"
      >
        <ScrollView 
          contentContainerStyle={{ 
            flexGrow: 1, 
            justifyContent: (!vehicle && !keyboardVisible) ? 'center' : 'flex-start', 
            padding: 24, 
            paddingBottom: keyboardVisible ? 80 : 60 
          }}
          className="flex-1"
          keyboardShouldPersistTaps="handled"
        >
        {vehicle ? (
          // Active Dashboard View
          <View className="pb-10">
            {/* Superbike Digital Speedometer Cluster */}
            <View className="bg-tarmac border-2 border-tarmac-light rounded-3xl p-6 items-center shadow-2xl mb-6 relative overflow-hidden">
              <View className="absolute top-0 right-0 left-0 h-1 bg-speedo-cyan shadow-[0_0_10px_#00E5FF]" />
              <Text className="text-neutral-400 text-xxs tracking-[3px] uppercase font-bold mb-1">
                ODÓMETRO TOTAL
              </Text>
              <Text className="text-speedo-cyan font-orbitron text-4xl font-bold tracking-wider shadow-sm select-none">
                {vehicle.currentMileage.toLocaleString()}
              </Text>
              <Text className="text-neutral-400 text-xs mt-1 uppercase tracking-widest">
                KILÓMETROS RECORRIDOS
              </Text>
              <View className="flex-row items-center mt-3 bg-carbon-dark border border-tarmac-light rounded-full px-4 py-1.5">
                <Text className="text-white text-xs font-semibold uppercase mr-2 tracking-wider">
                  {vehicle.brand} {vehicle.model}
                </Text>
                <View className="w-2.5 h-2.5 rounded-full bg-kawasaki-green shadow-[0_0_6px_#2CFF0A]" />
              </View>
            </View>

            {/* Dashboard Subtitle */}
            <Text className="text-neutral-400 font-bold text-xs uppercase tracking-widest mb-4">
              ESTADO DEL VEHÍCULO (RPM HEALTH)
            </Text>

            {/* Tachometer Alert Bars */}
            {alerts.length > 0 ? (
              alerts.map((alert) => (
                <TachometerGauge
                  key={alert.id}
                  label={alert.title}
                  value={vehicle.currentMileage}
                  target={alert.triggerType === 'MILEAGE' ? parseInt(alert.triggerValue) : (alert.triggerValue as any)}
                  type={alert.triggerType}
                />
              ))
            ) : (
              <View className="bg-tarmac border border-tarmac-light rounded-xl p-6 items-center">
                <CheckCircle2 size={32} color="#2CFF0A" />
                <Text className="text-white text-center mt-2 font-medium">No hay alertas configuradas</Text>
                <Text className="text-neutral-400 text-center text-xs mt-1">Configura alertas en la pestaña correspondiente.</Text>
              </View>
            )}
          </View>
        ) : (
          // Register Vehicle View
          <View className="pb-10 justify-center">
            <View className="items-center mb-6">
              <AlertTriangle size={48} color="#FF6B00" className="animate-pulse" />
              <Text className="text-white font-orbitron text-xl font-bold mt-2 text-center">
                REGISTRA TU MOTO
              </Text>
              <Text className="text-neutral-400 text-xs text-center mt-1">
                Ingresa los datos del vehículo para activar el tablero digital
              </Text>
            </View>

            <View className="bg-tarmac border border-tarmac-light rounded-2xl p-6 shadow-lg">
              {/* Brand Picker Dropdown */}
              <View className="mb-4 relative">
                <Text className="text-neutral-400 text-xs uppercase mb-1.5 font-medium tracking-wide">
                  Marca de la Moto
                </Text>
                <TouchableOpacity
                  onPress={() => setIsBrandDropdownOpen(!isBrandDropdownOpen)}
                  className="flex-row justify-between items-center w-full bg-carbon-dark text-white border border-tarmac-light rounded-xl px-4 py-3"
                >
                  <Text className="text-white font-semibold">{brand}</Text>
                  <ChevronDown size={18} color="#00E5FF" />
                </TouchableOpacity>

                {/* Dropdown Options List */}
                {isBrandDropdownOpen && (
                  <View className="absolute top-[75px] left-0 right-0 bg-tarmac border border-tarmac-light rounded-xl max-h-52 overflow-hidden z-50 shadow-2xl">
                    <ScrollView nestedScrollEnabled={true}>
                      {POPULAR_BRANDS.map((item) => (
                        <TouchableOpacity
                          key={item}
                          onPress={() => {
                            setBrand(item);
                            setIsBrandDropdownOpen(false);
                          }}
                          className="px-4 py-3 border-b border-carbon-matte hover:bg-carbon-dark active:bg-carbon-dark"
                        >
                          <Text className="text-white font-medium">{item}</Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </View>
                )}
              </View>

              {/* Custom Manual Brand Entry (if "Otro" selected) */}
              {brand === 'Otro / Manual' && (
                <View className="mb-4">
                  <Text className="text-neutral-400 text-xs uppercase mb-1.5 font-medium tracking-wide">
                    Escribe la Marca Personalizada
                  </Text>
                  <TextInput
                    value={customBrand}
                    placeholder="Ej. Vespa, Bajaj, Vento, etc."
                    placeholderTextColor="#556070"
                    onChangeText={setCustomBrand}
                    className="w-full bg-carbon-dark text-white border border-tarmac-light rounded-xl px-4 py-3 text-sm focus:border-speedo-cyan"
                  />
                </View>
              )}

              {/* Model */}
              <View className="mb-4">
                <Text className="text-neutral-400 text-xs uppercase mb-1.5 font-medium tracking-wide">
                  Modelo
                </Text>
                <TextInput
                  value={model}
                  placeholder="Ej. MT-09, Duke 390, CB300F"
                  placeholderTextColor="#556070"
                  onChangeText={setModel}
                  className="w-full bg-carbon-dark text-white border border-tarmac-light rounded-xl px-4 py-3 text-sm focus:border-speedo-cyan"
                />
              </View>

              {/* Year */}
              <View className="mb-4 flex-row space-x-4">
                <View className="flex-1">
                  <Text className="text-neutral-400 text-xs uppercase mb-1.5 font-medium tracking-wide">
                    Año
                  </Text>
                  <TextInput
                    value={year}
                    placeholder="Ej. 2024"
                    placeholderTextColor="#556070"
                    keyboardType="numeric"
                    onChangeText={setYear}
                    className="w-full bg-carbon-dark text-white border border-tarmac-light rounded-xl px-4 py-3 text-sm focus:border-speedo-cyan"
                  />
                </View>

                {/* Mileage */}
                <View className="flex-1">
                  <Text className="text-neutral-400 text-xs uppercase mb-1.5 font-medium tracking-wide">
                    Kilometraje Actual
                  </Text>
                  <TextInput
                    value={currentMileage}
                    placeholder="Ej. 8500"
                    placeholderTextColor="#556070"
                    keyboardType="numeric"
                    onChangeText={setCurrentMileage}
                    className="w-full bg-carbon-dark text-white border border-tarmac-light rounded-xl px-4 py-3 text-sm focus:border-speedo-cyan"
                  />
                </View>
              </View>

              <TouchableOpacity
                onPress={handleRegisterVehicle}
                disabled={registering}
                className="w-full bg-speedo-cyan rounded-xl py-3.5 items-center justify-center border border-speedo-cyan shadow-[0_0_12px_rgba(0,229,255,0.3)] mt-2"
              >
                {registering ? (
                  <ActivityIndicator color="#0B0D10" />
                ) : (
                  <Text className="text-carbon-matte font-bold text-sm uppercase tracking-widest">
                    REGISTRAR MOTO
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

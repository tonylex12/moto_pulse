import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, Alert, Modal, RefreshControl, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Plus, Bell, Calendar, Activity, Check, Trash2, X, ChevronDown, CheckCircle2 } from 'lucide-react-native';
import { api } from '../../utils/api';

interface Vehicle {
  id: string;
  brand: string;
  model: string;
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

const ALERT_TYPES = [
  { label: 'Cambio de Aceite', value: 'OIL_CHANGE' },
  { label: 'Pastillas de Freno', value: 'BRAKE_PADS' },
  { label: 'Seguros / Trámites', value: 'INSURANCE_RENEWAL' },
  { label: 'Personalizado', value: 'CUSTOM' },
];

export default function AlertsScreen() {
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [alerts, setAlerts] = useState<AlertData[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);

  // Form states
  const [type, setType] = useState<'OIL_CHANGE' | 'BRAKE_PADS' | 'INSURANCE_RENEWAL' | 'CUSTOM'>('OIL_CHANGE');
  const [typeLabel, setTypeLabel] = useState('Cambio de Aceite');
  const [isTypeDropdownOpen, setIsTypeDropdownOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [triggerType, setTriggerType] = useState<'MILEAGE' | 'DATE'>('MILEAGE');
  const [triggerValue, setTriggerValue] = useState('');
  const [saving, setSaving] = useState(false);

  const loadData = async () => {
    try {
      const response = await api.get('/vehicles');
      if (response.data && response.data.length > 0) {
        const activeVehicle = response.data[0];
        setVehicle(activeVehicle);

        // Fetch alerts
        const alertsResponse = await api.get(`/alerts/vehicle/${activeVehicle.id}`);
        setAlerts(alertsResponse.data);
      } else {
        setVehicle(null);
        setAlerts([]);
      }
    } catch (e) {
      console.error('Error fetching alerts:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const onRefresh = () => {
    setRefreshing(true);
    loadData();
  };

  const handleCreateAlert = async () => {
    if (!vehicle) return;
    if (!title.trim() || !triggerValue) {
      Alert.alert('Error', 'Por favor completa todos los campos del recordatorio');
      return;
    }

    // Input validation
    if (triggerType === 'MILEAGE') {
      const mileageVal = parseInt(triggerValue);
      if (isNaN(mileageVal) || mileageVal <= 0) {
        Alert.alert('Error', 'El odómetro objetivo debe ser un número positivo');
        return;
      }
      if (mileageVal <= vehicle.currentMileage) {
        Alert.alert('Advertencia', 'El kilometraje objetivo ya se ha superado en tu odómetro actual');
      }
    } else {
      const dateVal = Date.parse(triggerValue);
      if (isNaN(dateVal)) {
        Alert.alert('Error', 'Ingresa una fecha de expiración válida (Formato YYYY-MM-DD)');
        return;
      }
    }

    setSaving(true);
    try {
      const payload = {
        vehicleId: vehicle.id,
        type,
        title: title.trim(),
        triggerType,
        triggerValue,
      };

      await api.post('/alerts', payload);
      Alert.alert('Alerta Creada', 'El recordatorio de mantenimiento se ha configurado.');
      
      // Reset form & close
      setTitle('');
      setTriggerValue('');
      setModalVisible(false);
      
      // Refresh
      loadData();
    } catch (e: any) {
      console.error(e);
      Alert.alert('Error', e.response?.data?.error || 'No se pudo configurar la alerta');
    } finally {
      setSaving(false);
    }
  };

  const handleResolveAlert = async (alertId: string) => {
    Alert.alert(
      'Completar Mantenimiento',
      '¿Deseas marcar esta alerta como realizada/completada?',
      [
        { text: 'No', style: 'cancel' },
        {
          text: 'Resolver',
          onPress: async () => {
            try {
              await api.put(`/alerts/${alertId}`, { isCompleted: true });
              loadData();
            } catch (e) {
              console.error(e);
              Alert.alert('Error', 'No se pudo actualizar la alerta');
            }
          }
        }
      ]
    );
  };

  const handleDeleteAlert = (alertId: string) => {
    Alert.alert(
      'Borrar Recordatorio',
      '¿Estás seguro de que quieres eliminar esta alerta?',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.delete(`/alerts/${alertId}`);
              loadData();
            } catch (e) {
              console.error(e);
              Alert.alert('Error', 'No se pudo eliminar la alerta');
            }
          }
        }
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
      {/* Header */}
      <View className="flex-row justify-between items-center px-6 py-4 border-b border-tarmac">
        <Text className="text-white font-orbitron text-lg font-bold tracking-wider uppercase">
          ALERTAS Y MANTENIMIENTO
        </Text>
        {vehicle && (
          <TouchableOpacity
            onPress={() => setModalVisible(true)}
            className="flex-row items-center bg-speedo-cyan rounded-lg px-3 py-1.5 border border-speedo-cyan"
          >
            <Plus size={16} color="#0B0D10" />
            <Text className="text-carbon-matte font-bold text-xs uppercase tracking-wider ml-1">
              NUEVO
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {!vehicle ? (
        <View className="flex-grow justify-center items-center p-6">
          <Bell size={48} color="#FF6B00" />
          <Text className="text-white text-center font-orbitron text-base font-bold mt-4 uppercase">
            REGISTRA TU MOTO PRIMERO
          </Text>
          <Text className="text-neutral-400 text-center text-xs mt-1">
            Debes registrar una moto en el Panel principal antes de configurar alertas de mantenimiento.
          </Text>
        </View>
      ) : (
        <ScrollView
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          className="flex-grow p-6"
        >
          {/* Active Alerts Timeline */}
          <Text className="text-neutral-400 font-bold text-xs uppercase tracking-widest mb-4">
            ALERTAS PROGRAMADAS
          </Text>

          {alerts.length > 0 ? (
            alerts.map((alert) => {
              // Calculate status
              let statusBorder = 'border-tarmac-light';
              let badgeColor = 'bg-neutral-800 text-neutral-400';
              let triggerDesc = '';

              if (alert.isCompleted) {
                statusBorder = 'border-neutral-800 opacity-60';
                badgeColor = 'bg-neutral-900 text-neutral-500';
              } else if (alert.triggerType === 'MILEAGE') {
                const targetOdo = parseInt(alert.triggerValue);
                const remaining = targetOdo - vehicle.currentMileage;
                if (remaining <= 0) {
                  statusBorder = 'border-l-4 border-l-ducati-red';
                  badgeColor = 'bg-ducati-red/20 text-ducati-red';
                } else if (remaining <= 500) {
                  statusBorder = 'border-l-4 border-l-ktm-orange';
                  badgeColor = 'bg-ktm-orange/20 text-ktm-orange';
                } else {
                  statusBorder = 'border-l-4 border-l-kawasaki-green';
                  badgeColor = 'bg-kawasaki-green/20 text-kawasaki-green';
                }
                triggerDesc = `A los ${targetOdo.toLocaleString()} km`;
              } else {
                // Date trigger
                const today = new Date().getTime();
                const targetTime = new Date(alert.triggerValue).getTime();
                const daysLeft = Math.ceil((targetTime - today) / (1000 * 60 * 60 * 24));
                
                if (daysLeft <= 0) {
                  statusBorder = 'border-l-4 border-l-ducati-red';
                  badgeColor = 'bg-ducati-red/20 text-ducati-red';
                } else if (daysLeft <= 7) {
                  statusBorder = 'border-l-4 border-l-ktm-orange';
                  badgeColor = 'bg-ktm-orange/20 text-ktm-orange';
                } else {
                  statusBorder = 'border-l-4 border-l-speedo-cyan';
                  badgeColor = 'bg-speedo-cyan/20 text-speedo-cyan';
                }
                
                triggerDesc = `Expiración: ${new Date(alert.triggerValue).toLocaleDateString('es-ES')}`;
              }

              return (
                <View
                  key={alert.id}
                  className={`bg-tarmac border border-tarmac-light rounded-xl p-4 mb-3 flex-row justify-between items-center ${statusBorder}`}
                >
                  <View className="flex-1">
                    <View className="flex-row items-center mb-1 space-x-2">
                      <Text className="text-white font-semibold text-sm uppercase tracking-wide">
                        {alert.title}
                      </Text>
                      {alert.isCompleted && (
                        <View className="bg-neutral-900 border border-neutral-800 rounded px-1.5 py-0.5">
                          <Text className="text-[9px] text-neutral-500 font-bold uppercase">Hecho</Text>
                        </View>
                      )}
                    </View>
                    <View className="flex-row items-center space-x-3 mt-1">
                      {alert.triggerType === 'MILEAGE' ? (
                        <Activity size={12} color="#8F9CAE" />
                      ) : (
                        <Calendar size={12} color="#8F9CAE" />
                      )}
                      <Text className="text-neutral-400 text-xs font-medium">{triggerDesc}</Text>
                    </View>
                  </View>

                  {/* Actions */}
                  <View className="flex-row space-x-2 ml-4">
                    {!alert.isCompleted && (
                      <TouchableOpacity
                        onPress={() => handleResolveAlert(alert.id)}
                        className="bg-carbon-matte border border-tarmac-light p-2 rounded-lg"
                      >
                        <Check size={16} color="#2CFF0A" />
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity
                      onPress={() => handleDeleteAlert(alert.id)}
                      className="bg-carbon-matte border border-tarmac-light p-2 rounded-lg"
                    >
                      <Trash2 size={16} color="#FF2A3B" />
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })
          ) : (
            <View className="bg-tarmac border border-tarmac-light rounded-xl p-6 items-center">
              <CheckCircle2 size={32} color="#8F9CAE" />
              <Text className="text-white text-center mt-2 font-medium">No tienes alertas creadas</Text>
              <Text className="text-neutral-400 text-center text-xs mt-1">Crea recordatorios de aceite, frenos o seguro con el botón superior.</Text>
            </View>
          )}
        </ScrollView>
      )}

      {/* Add Alert Modal */}
      <Modal visible={modalVisible} animationType="slide" transparent={true}>
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
            {/* Header */}
            <View className="flex-row justify-between items-center mb-6">
              <Text className="text-white font-orbitron text-lg font-bold uppercase tracking-wider">
                NUEVO RECORDATORIO
              </Text>
              <TouchableOpacity onPress={() => setModalVisible(false)} className="p-1">
                <X size={24} color="#F8F9FA" />
              </TouchableOpacity>
            </View>

            {/* Alert Type Selection */}
            <View className="mb-4 relative">
              <Text className="text-neutral-400 text-xs uppercase mb-1.5 font-medium tracking-wide">
                Categoría del Mantenimiento
              </Text>
              <TouchableOpacity
                onPress={() => setIsTypeDropdownOpen(!isTypeDropdownOpen)}
                className="flex-row justify-between items-center w-full bg-carbon-dark text-white border border-tarmac-light rounded-xl px-4 py-3"
              >
                <Text className="text-white font-semibold">{typeLabel}</Text>
                <ChevronDown size={18} color="#00E5FF" />
              </TouchableOpacity>

              {isTypeDropdownOpen && (
                <View className="absolute top-[75px] left-0 right-0 bg-tarmac border border-tarmac-light rounded-xl z-50 shadow-2xl">
                  {ALERT_TYPES.map((item) => (
                    <TouchableOpacity
                      key={item.value}
                      onPress={() => {
                        setType(item.value as any);
                        setTypeLabel(item.label);
                        setTitle(item.label); // Auto seed title
                        setIsTypeDropdownOpen(false);
                      }}
                      className="px-4 py-3 border-b border-carbon-matte"
                    >
                      <Text className="text-white font-medium">{item.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>

            {/* Custom Title */}
            <View className="mb-4">
              <Text className="text-neutral-400 text-xs uppercase mb-1.5 font-medium tracking-wide">
                Título / Descripción
              </Text>
              <TextInput
                value={title}
                placeholder="Ej. Cambio de Aceite 15w50"
                placeholderTextColor="#556070"
                onChangeText={setTitle}
                className="w-full bg-carbon-dark text-white border border-tarmac-light rounded-xl px-4 py-3 text-sm focus:border-speedo-cyan"
              />
            </View>

            {/* Trigger Type Toggle */}
            <View className="mb-4">
              <Text className="text-neutral-400 text-xs uppercase mb-1.5 font-medium tracking-wide">
                Gatillo del Recordatorio
              </Text>
              <View className="flex-row bg-carbon-dark border border-tarmac-light rounded-xl p-1">
                <TouchableOpacity
                  onPress={() => {
                    setTriggerType('MILEAGE');
                    setTriggerValue('');
                  }}
                  className={`flex-1 py-2 rounded-lg items-center ${
                    triggerType === 'MILEAGE' ? 'bg-speedo-cyan' : ''
                  }`}
                >
                  <Text
                    className={`font-semibold text-xs uppercase tracking-wider ${
                      triggerType === 'MILEAGE' ? 'text-carbon-matte font-bold' : 'text-neutral-400'
                    }`}
                  >
                    Por Kilometraje
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => {
                    setTriggerType('DATE');
                    setTriggerValue(new Date().toISOString().split('T')[0]);
                  }}
                  className={`flex-1 py-2 rounded-lg items-center ${
                    triggerType === 'DATE' ? 'bg-speedo-cyan' : ''
                  }`}
                >
                  <Text
                    className={`font-semibold text-xs uppercase tracking-wider ${
                      triggerType === 'DATE' ? 'text-carbon-matte font-bold' : 'text-neutral-400'
                    }`}
                  >
                    Por Fecha
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Trigger Value Input */}
            <View className="mb-6">
              <Text className="text-neutral-400 text-xs uppercase mb-1.5 font-medium tracking-wide">
                {triggerType === 'MILEAGE'
                  ? 'Odómetro Objetivo (km)'
                  : 'Fecha de Expiración (YYYY-MM-DD)'}
              </Text>
              <TextInput
                value={triggerValue}
                placeholder={triggerType === 'MILEAGE' ? 'Ej. 12000' : 'YYYY-MM-DD'}
                placeholderTextColor="#556070"
                keyboardType={triggerType === 'MILEAGE' ? 'numeric' : 'default'}
                onChangeText={setTriggerValue}
                className="w-full bg-carbon-dark text-white border border-tarmac-light rounded-xl px-4 py-3 text-sm focus:border-speedo-cyan"
              />
            </View>

            {/* Submit */}
            <TouchableOpacity
              onPress={handleCreateAlert}
              disabled={saving}
              className="w-full bg-speedo-cyan rounded-xl py-3.5 items-center justify-center border border-speedo-cyan shadow-[0_0_12px_rgba(0,229,255,0.4)]"
            >
              {saving ? (
                <ActivityIndicator color="#0B0D10" />
              ) : (
                <Text className="text-carbon-matte font-bold text-sm uppercase tracking-widest">
                  GUARDAR ALERTA
                </Text>
              )}
            </TouchableOpacity>
              </ScrollView>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

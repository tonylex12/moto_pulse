import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, Modal, RefreshControl, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Plus, Bell, Calendar, Activity, Check, Trash2, X, ChevronDown, CheckCircle2 } from 'lucide-react-native';
import { api } from '../../utils/api';
import { useAlert } from '../../utils/AlertContext';
import { useTheme } from '../../utils/ThemeContext';

interface Vehicle {
  id: string;
  brand: string;
  model: string;
  currentMileage: number;
  isActive: boolean;
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
  const { showAlert } = useAlert();
  const { theme, colors } = useTheme();
  const activeBmwColor = theme === 'light' ? colors.bmwBlue : colors.bmwLightBlue;

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
      // Changed to relative path without leading slash
      const response = await api.get('vehicles');
      const list = response.data || [];
      if (list.length > 0) {
        // Find the active vehicle dynamically
        const activeVehicle = list.find((v: any) => v.isActive) || list[0];
        setVehicle(activeVehicle);

        // Fetch alerts (relative path)
        const alertsResponse = await api.get(`alerts/vehicle/${activeVehicle.id}`);
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
      showAlert('Error', 'Por favor completa todos los campos del recordatorio');
      return;
    }

    // Input validation
    if (triggerType === 'MILEAGE') {
      const mileageVal = parseInt(triggerValue);
      if (isNaN(mileageVal) || mileageVal <= 0) {
        showAlert('Error', 'El odómetro objetivo debe ser un número positivo');
        return;
      }
      if (mileageVal <= vehicle.currentMileage) {
        showAlert('Advertencia', 'El kilometraje objetivo ya se ha superado en tu odómetro actual');
      }
    } else {
      const dateVal = Date.parse(triggerValue);
      if (isNaN(dateVal)) {
        showAlert('Error', 'Ingresa una fecha de expiración válida (Formato YYYY-MM-DD)');
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

      // Changed to relative paths without leading slash
      await api.post('alerts', payload);
      showAlert('Alerta Creada', 'El recordatorio de mantenimiento se ha configurado.');
      
      // Reset form & close
      setTitle('');
      setTriggerValue('');
      setModalVisible(false);
      
      // Refresh
      loadData();
    } catch (e: any) {
      console.error(e);
      showAlert('Error', e.response?.data?.error || 'No se pudo configurar la alerta');
    } finally {
      setSaving(false);
    }
  };

  const handleResolveAlert = async (alertId: string) => {
    showAlert(
      'Completar Mantenimiento',
      '¿Deseas marcar esta alerta como realizada/completada?',
      [
        { text: 'No', style: 'cancel' },
        {
          text: 'Resolver',
          onPress: async () => {
            try {
              // Changed to relative path
              await api.put(`alerts/${alertId}`, { isCompleted: true });
              loadData();
            } catch (e) {
              console.error(e);
              showAlert('Error', 'No se pudo actualizar la alerta');
            }
          }
        }
      ]
    );
  };

  const handleDeleteAlert = (alertId: string) => {
    showAlert(
      'Borrar Recordatorio',
      '¿Estás seguro de que quieres eliminar esta alerta?',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: async () => {
            try {
              // Changed to relative path
              await api.delete(`alerts/${alertId}`);
              loadData();
            } catch (e) {
              console.error(e);
              showAlert('Error', 'No se pudo eliminar la alerta');
            }
          }
        }
      ]
    );
  };

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.isDark ? '#0A0D12' : '#F4F5F7', justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color={activeBmwColor} />
      </View>
    );
  }

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
        <Text className={`font-orbitron text-lg font-bold tracking-wider uppercase ${colors.text}`}>
          ALERTAS DE MANTENIMIENTO
        </Text>
        {vehicle && (
          <TouchableOpacity
            onPress={() => setModalVisible(true)}
            className="flex-row items-center bg-[#1C69D4] rounded-lg px-3 py-1.5 border border-[#1C69D4]"
          >
            <Plus size={16} color="#FFFFFF" />
            <Text className="text-white font-bold text-xs uppercase tracking-wider ml-1">
              ALERTAS
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {!vehicle ? (
        <View className="flex-grow justify-center items-center p-6">
          <Bell size={48} color={colors.bmwRed} />
          <Text className={`text-center font-orbitron text-base font-bold mt-4 uppercase ${colors.text}`}>
            REGISTRA TU MOTO PRIMERO
          </Text>
          <Text className={`${colors.textSec} text-center text-xs mt-1`}>
            Debes registrar una moto en el Panel principal antes de configurar alertas de mantenimiento.
          </Text>
        </View>
      ) : (
        <ScrollView
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          className="flex-grow p-6"
        >
          {/* Active Alerts Timeline */}
          <Text className={`${colors.textSec} font-bold text-xs uppercase tracking-widest mb-4`}>
            ALERTAS PROGRAMADAS
          </Text>

          {alerts.length > 0 ? (
            alerts.map((alert) => {
              // Calculate status
              let statusBorder = `border-${theme === 'light' ? 'neutral-200' : 'tarmac-light'}`;
              let badgeColor = theme === 'light' ? 'bg-neutral-200 text-neutral-600' : 'bg-neutral-800 text-neutral-400';
              let triggerDesc = '';

              if (alert.isCompleted) {
                statusBorder = `border-${theme === 'light' ? 'neutral-300' : 'neutral-800'} opacity-60`;
                badgeColor = theme === 'light' ? 'bg-neutral-100 text-neutral-400' : 'bg-neutral-900 text-neutral-500';
              } else if (alert.triggerType === 'MILEAGE') {
                const targetOdo = parseInt(alert.triggerValue);
                const remaining = targetOdo - vehicle.currentMileage;
                if (remaining <= 0) {
                  statusBorder = 'border-l-4 border-l-[#E30613]';
                  badgeColor = 'bg-[#E30613]/15 text-[#E30613]';
                } else if (remaining <= 500) {
                  statusBorder = 'border-l-4 border-l-[#FF9E00]';
                  badgeColor = 'bg-[#FF9E00]/15 text-[#FF9E00]';
                } else {
                  statusBorder = `border-l-4 ${theme === 'light' ? 'border-l-[#008A22]' : 'border-l-[#2CFF0A]'}`;
                  badgeColor = theme === 'light' ? 'bg-[#008A22]/10 text-[#008A22]' : 'bg-[#2CFF0A]/20 text-[#2CFF0A]';
                }
                triggerDesc = `A los ${targetOdo.toLocaleString()} km`;
              } else {
                // Date trigger
                const today = new Date().getTime();
                const targetTime = new Date(alert.triggerValue).getTime();
                const daysLeft = Math.ceil((targetTime - today) / (1000 * 60 * 60 * 24));
                
                if (daysLeft <= 0) {
                  statusBorder = 'border-l-4 border-l-[#E30613]';
                  badgeColor = 'bg-[#E30613]/15 text-[#E30613]';
                } else if (daysLeft <= 7) {
                  statusBorder = 'border-l-4 border-l-[#FF9E00]';
                  badgeColor = 'bg-[#FF9E00]/15 text-[#FF9E00]';
                } else {
                  statusBorder = `border-l-4 ${theme === 'light' ? 'border-l-[#1C69D4]' : 'border-l-[#00A3E0]'}`;
                  badgeColor = theme === 'light' ? 'bg-[#1C69D4]/10 text-[#1C69D4]' : 'bg-[#00A3E0]/20 text-[#00A3E0]';
                }
                
                triggerDesc = `Expiración: ${new Date(alert.triggerValue).toLocaleDateString('es-ES')}`;
              }

              return (
                <View
                  key={alert.id}
                  className={`${colors.card} border ${colors.border} rounded-xl p-4 mb-3 flex-row justify-between items-center ${statusBorder}`}
                >
                  <View className="flex-1">
                    <View className="flex-row items-center mb-1 space-x-2">
                      <Text className={`${colors.text} font-semibold text-sm uppercase tracking-wide`}>
                        {alert.title}
                      </Text>
                      {alert.isCompleted && (
                        <View className={`border ${theme === 'light' ? 'bg-neutral-100 border-neutral-200' : 'bg-neutral-900 border-neutral-800'} rounded px-1.5 py-0.5`}>
                          <Text className="text-[9px] text-neutral-500 font-bold uppercase">Hecho</Text>
                        </View>
                      )}
                    </View>
                    <View className="flex-row items-center space-x-3 mt-1">
                      {alert.triggerType === 'MILEAGE' ? (
                        <Activity size={12} color={theme === 'light' ? '#4E5E72' : '#8F9CAE'} />
                      ) : (
                        <Calendar size={12} color={theme === 'light' ? '#4E5E72' : '#8F9CAE'} />
                      )}
                      <Text className={`${colors.textSec} text-xs font-medium`}>{triggerDesc}</Text>
                    </View>
                  </View>

                  {/* Actions */}
                  <View className="flex-row space-x-2 ml-4">
                    {!alert.isCompleted && (
                      <TouchableOpacity
                        onPress={() => handleResolveAlert(alert.id)}
                        className={`${colors.subCard} border ${colors.border} p-2 rounded-lg`}
                      >
                        <Check size={16} color={colors.statusGreen} />
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity
                      onPress={() => handleDeleteAlert(alert.id)}
                      className={`${colors.subCard} border ${colors.border} p-2 rounded-lg`}
                    >
                      <Trash2 size={16} color={colors.bmwRed} />
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })
          ) : (
            <View className={`${colors.card} border ${colors.border} rounded-xl p-6 items-center`}>
              <CheckCircle2 size={32} color={colors.bmwBlue} />
              <Text className={`${colors.text} text-center mt-2 font-medium`}>Sin alertas programadas</Text>
              <Text className={`${colors.textSec} text-center text-xs mt-1`}>Presiona el botón superior para agregar un recordatorio.</Text>
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
          <View className="flex-1 bg-black/60 justify-end">
            <View 
              className={`${colors.card} border-t ${colors.border} rounded-t-3xl max-h-[85%]`}
              style={{
                shadowColor: '#000',
                shadowOffset: { width: 0, height: -10 },
                shadowOpacity: theme === 'light' ? 0.05 : 0.4,
                shadowRadius: 15,
                elevation: 8
              }}
            >
              <ScrollView 
                contentContainerStyle={{ padding: 24, paddingBottom: 60 }}
                className="w-full"
                keyboardShouldPersistTaps="handled"
              >
                {/* Header */}
                <View className="flex-row justify-between items-center mb-6">
                  <Text className={`font-orbitron text-lg font-bold uppercase tracking-wider ${colors.text}`}>
                    NUEVO RECORDATORIO
                  </Text>
                  <TouchableOpacity onPress={() => setModalVisible(false)} className="p-1">
                    <X size={24} color={theme === 'light' ? '#002C5B' : '#F8F9FA'} />
                  </TouchableOpacity>
                </View>

                {/* Alert Type Selection */}
                <View className="mb-4 relative">
                  <Text className={`${colors.textSec} text-xs uppercase mb-1.5 font-medium tracking-wide`}>
                    Categoría del Mantenimiento
                  </Text>
                  <TouchableOpacity
                    onPress={() => setIsTypeDropdownOpen(!isTypeDropdownOpen)}
                    className={`flex-row justify-between items-center w-full ${colors.subCard} border ${colors.border} rounded-xl px-4 py-3`}
                  >
                    <Text className={`${colors.text} font-semibold`}>{typeLabel}</Text>
                    <ChevronDown size={18} color={activeBmwColor} />
                  </TouchableOpacity>

                  {isTypeDropdownOpen && (
                    <View 
                      className={`absolute top-[75px] left-0 right-0 border ${colors.border} rounded-xl`}
                      style={{
                        backgroundColor: theme === 'light' ? '#FFFFFF' : '#121620',
                        zIndex: 50,
                        shadowColor: '#000',
                        shadowOffset: { width: 0, height: 10 },
                        shadowOpacity: theme === 'light' ? 0.05 : 0.4,
                        shadowRadius: 15,
                        elevation: 8
                      }}
                    >
                      {ALERT_TYPES.map((item) => (
                        <TouchableOpacity
                          key={item.value}
                          onPress={() => {
                            setType(item.value as any);
                            setTypeLabel(item.label);
                            setTitle(item.label); // Auto seed title
                            setIsTypeDropdownOpen(false);
                          }}
                          className={`px-4 py-3 border-b ${colors.border} active:${colors.subCard}`}
                        >
                          <Text className={`${colors.text} font-medium`}>{item.label}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}
                </View>

                {/* Custom Title */}
                <View className="mb-4">
                  <Text className={`${colors.textSec} text-xs uppercase mb-1.5 font-medium tracking-wide`}>
                    Título / Descripción
                  </Text>
                  <TextInput
                    value={title}
                    placeholder="Ej. Cambio de Aceite 15w50"
                    placeholderTextColor={theme === 'light' ? '#8E9FBC' : '#556070'}
                    onChangeText={setTitle}
                    className={`w-full ${colors.subCard} ${colors.text} border ${colors.border} rounded-xl px-4 py-3 text-sm focus:border-[#1C69D4]`}
                  />
                </View>

                {/* Trigger Type Toggle */}
                <View className="mb-4">
                  <Text className={`${colors.textSec} text-xs uppercase mb-1.5 font-medium tracking-wide`}>
                    Gatillo del Recordatorio
                  </Text>
                  <View className={`flex-row ${colors.subCard} border ${colors.border} rounded-xl p-1`}>
                    <TouchableOpacity
                      onPress={() => {
                        setTriggerType('MILEAGE');
                        setTriggerValue('');
                      }}
                      className={`flex-1 py-2 rounded-lg items-center ${
                        triggerType === 'MILEAGE' ? 'bg-[#1C69D4]' : ''
                      }`}
                    >
                      <Text
                        className={`font-semibold text-xs uppercase tracking-wider ${
                          triggerType === 'MILEAGE' ? 'text-white font-bold' : colors.textMuted
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
                        triggerType === 'DATE' ? 'bg-[#1C69D4]' : ''
                      }`}
                    >
                      <Text
                        className={`font-semibold text-xs uppercase tracking-wider ${
                          triggerType === 'DATE' ? 'text-white font-bold' : colors.textMuted
                        }`}
                      >
                        Por Fecha
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>

                {/* Trigger Value Input */}
                <View className="mb-6">
                  <Text className={`${colors.textSec} text-xs uppercase mb-1.5 font-medium tracking-wide`}>
                    {triggerType === 'MILEAGE'
                      ? 'Odómetro Objetivo (km)'
                      : 'Fecha de Expiración (YYYY-MM-DD)'}
                  </Text>
                  <TextInput
                    value={triggerValue}
                    placeholder={triggerType === 'MILEAGE' ? 'Ej. 12000' : 'YYYY-MM-DD'}
                    placeholderTextColor={theme === 'light' ? '#8E9FBC' : '#556070'}
                    keyboardType={triggerType === 'MILEAGE' ? 'numeric' : 'default'}
                    onChangeText={setTriggerValue}
                    className={`w-full ${colors.subCard} ${colors.text} border ${colors.border} rounded-xl px-4 py-3 text-sm focus:border-[#1C69D4]`}
                  />
                </View>

                {/* Submit */}
                <TouchableOpacity
                  onPress={handleCreateAlert}
                  disabled={saving}
                  className="w-full bg-[#1C69D4] rounded-xl py-3.5 items-center justify-center border border-[#1C69D4]"
                  style={{
                    shadowColor: '#1C69D4',
                    shadowOffset: { width: 0, height: 0 },
                    shadowOpacity: 0.4,
                    shadowRadius: 12,
                    elevation: 4
                  }}
                >
                  {saving ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <Text className="text-white font-bold text-sm uppercase tracking-widest">
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

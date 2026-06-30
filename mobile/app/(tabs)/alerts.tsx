import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, Modal, RefreshControl, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import DateTimePicker from '@react-native-community/datetimepicker';
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
  type: 'OIL_CHANGE' | 'BRAKE_PADS' | 'INSURANCE_RENEWAL' | 'PREVENTIVE_MAINTENANCE' | 'CUSTOM';
  title: string;
  triggerType: 'MILEAGE' | 'DATE';
  triggerValue: string;
  isCompleted: boolean;
  lastPerformedValue?: string | null;
}

const ALERT_TYPES = [
  { label: 'Cambio de Aceite', value: 'OIL_CHANGE' },
  { label: 'Mantenimiento Preventivo', value: 'PREVENTIVE_MAINTENANCE' },
  { label: 'Pastillas de Freno', value: 'BRAKE_PADS' },
  { label: 'Seguros / Trámites', value: 'INSURANCE_RENEWAL' },
  { label: 'Personalizado', value: 'CUSTOM' },
];

const parseIsoDate = (dateStr: string) => {
  if (!dateStr) return new Date();
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    const year = parseInt(parts[0]);
    const month = parseInt(parts[1]) - 1;
    const day = parseInt(parts[2]);
    return new Date(year, month, day);
  }
  const parsed = Date.parse(dateStr);
  return isNaN(parsed) ? new Date() : new Date(parsed);
};

const formatIsoDate = (date: Date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

export default function AlertsScreen() {
  const { showAlert } = useAlert();
  const { theme, colors } = useTheme();
  const activeBmwColor = theme === 'light' ? colors.bmwBlue : colors.bmwLightBlue;
  const insets = useSafeAreaInsets();

  const tftStyles = {
    bezelBg: theme === "light" ? "#FFFFFF" : "#0F1216",
    bezelBorder: theme === "light" ? "#D8E0EB" : "#242D3D",
    screenBg: theme === "light" ? "#EBF0F5" : "#050709",
    screenBorder: theme === "light" ? "#D8E0EB" : "#171B22",
    headerBorder: theme === "light" ? "#D8E0EB" : "rgba(255,255,255,0.08)",
    headerText: theme === "light" ? "#1C69D4" : "#00A3E0",
    timeText: theme === "light" ? "#4E5E72" : "#8E9FBC",
    textMain: theme === "light" ? "#002C5B" : "#FFFFFF",
    textSec: theme === "light" ? "#4E5E72" : "#A0AEC0",
    cardBg: theme === "light" ? "#FFFFFF" : "#121620",
    cardBorder: theme === "light" ? "#D8E0EB" : "#242D3D",
    // Accent colors
    accentBlue: theme === "light" ? "#1C69D4" : "#00E5FF",
    accentRed: colors.bmwRed,
  };

  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [alerts, setAlerts] = useState<AlertData[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);

  // Form states
  const [type, setType] = useState<'OIL_CHANGE' | 'BRAKE_PADS' | 'INSURANCE_RENEWAL' | 'PREVENTIVE_MAINTENANCE' | 'CUSTOM'>('OIL_CHANGE');
  const [typeLabel, setTypeLabel] = useState('Cambio de Aceite');
  const [isTypeDropdownOpen, setIsTypeDropdownOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [triggerType, setTriggerType] = useState<'MILEAGE' | 'DATE'>('MILEAGE');
  const [triggerValue, setTriggerValue] = useState('');
  const [lastPerformedValue, setLastPerformedValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [showLastPerformedDatePicker, setShowLastPerformedDatePicker] = useState(false);
  const [showTriggerDatePicker, setShowTriggerDatePicker] = useState(false);

  // Edit/Resolve states
  const [editingAlertId, setEditingAlertId] = useState<string | null>(null);
  const [modalMode, setModalMode] = useState<'CREATE' | 'RESOLVE'>('CREATE');

  const loadData = async () => {
    try {
      const response = await api.get('vehicles');
      const list = response.data || [];
      if (list.length > 0) {
        const activeVehicle = list.find((v: any) => v.isActive) || list[0];
        setVehicle(activeVehicle);

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

  const handleSaveAlert = async () => {
    if (!vehicle) return;
    if (!triggerValue || !lastPerformedValue) {
      showAlert('Error', 'Por favor completa todos los campos');
      return;
    }

    if (triggerType === 'MILEAGE') {
      const mileageVal = parseInt(triggerValue);
      const lastVal = parseInt(lastPerformedValue);
      if (isNaN(mileageVal) || mileageVal <= 0 || isNaN(lastVal) || lastVal < 0) {
        showAlert('Error', 'Los valores del odómetro deben ser números positivos');
        return;
      }
      if (mileageVal <= lastVal) {
        showAlert('Error', 'El odómetro objetivo debe ser mayor que el del último mantenimiento');
        return;
      }
    } else {
      const dateVal = Date.parse(triggerValue);
      const lastDateVal = Date.parse(lastPerformedValue);
      if (isNaN(dateVal) || isNaN(lastDateVal)) {
        showAlert('Error', 'Ingresa fechas válidas (Formato YYYY-MM-DD)');
        return;
      }
      if (dateVal <= lastDateVal) {
        showAlert('Error', 'La fecha de expiración debe ser posterior a la del último mantenimiento');
        return;
      }
    }

    setSaving(true);
    try {
      if (modalMode === 'CREATE') {
        const payload = {
          vehicleId: vehicle.id,
          type,
          title: title.trim(),
          triggerType,
          triggerValue,
          lastPerformedValue,
        };
        await api.post('alerts', payload);
        showAlert('Alerta Creada', 'El recordatorio de mantenimiento se ha configurado.');
      } else {
        const payload = {
          lastPerformedValue,
          triggerValue,
          isCompleted: false,
        };
        await api.put(`alerts/${editingAlertId}`, payload);
        showAlert('Mantenimiento Registrado', 'Se ha actualizado el ciclo del recordatorio.');
      }
      
      setTitle('');
      setTriggerValue('');
      setLastPerformedValue('');
      setEditingAlertId(null);
      setModalVisible(false);
      
      loadData();
    } catch (e: any) {
      console.error(e);
      showAlert('Error', e.response?.data?.error || 'No se pudo guardar la alerta');
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
    <SafeAreaView edges={['top', 'left', 'right']} className={`flex-1 ${colors.bg}`}>
      {/* Header */}
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          paddingHorizontal: 24,
          paddingVertical: 16,
          borderBottomWidth: 1,
          borderBottomColor: theme === "light" ? "#D8E0EB" : "#242D3D",
        }}
      >
        <Text style={{ flex: 1, fontFamily: 'Rajdhani-Bold', fontSize: 18, color: tftStyles.textMain, letterSpacing: 2, textTransform: 'uppercase', marginRight: 16 }}>
          ALERTAS DE MANTENIMIENTO
        </Text>
        {vehicle && (
          <TouchableOpacity
            onPress={() => {
              setModalMode('CREATE');
              setTitle('Cambio de Aceite');
              setType('OIL_CHANGE');
              setTypeLabel('Cambio de Aceite');
              setTriggerType('MILEAGE');
              setLastPerformedValue(vehicle.currentMileage.toString());
              setTriggerValue((vehicle.currentMileage + 3000).toString());
              setModalVisible(true);
            }}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              backgroundColor: '#1C69D4',
              borderRadius: 20,
              paddingHorizontal: 12,
              paddingVertical: 6,
              borderWidth: 1,
              borderColor: '#1C69D4',
            }}
          >
            <Plus size={14} color="#FFFFFF" />
            <Text style={{ fontFamily: 'BarlowCondensed-Bold', fontSize: 11, color: '#FFFFFF', textTransform: 'uppercase', letterSpacing: 1, marginLeft: 4 }}>
              + ALERTA
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {!vehicle ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 }}>
          <Bell size={48} color={colors.bmwRed} style={{ marginBottom: 16 }} />
          <Text style={{ fontFamily: 'Rajdhani-Bold', fontSize: 16, color: tftStyles.textMain, textTransform: 'uppercase', letterSpacing: 1.5 }}>
            REGISTRA TU MOTO PRIMERO
          </Text>
          <Text style={{ fontFamily: 'BarlowCondensed-Medium', fontSize: 12, color: tftStyles.textSec, textAlign: 'center', marginTop: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Debes registrar una moto en el Panel principal antes de configurar alertas de mantenimiento.
          </Text>
        </View>
      ) : (
        <ScrollView
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
          style={{ flex: 1 }}
        >
          {/* Section Title */}
          <Text style={{ fontFamily: 'Rajdhani-Bold', fontSize: 12, color: tftStyles.textSec, letterSpacing: 2, textTransform: 'uppercase', marginBottom: 12 }}>
            ALERTAS PROGRAMADAS
          </Text>

          {alerts.length > 0 ? (
            alerts.map((alert) => {
              let accentColor = theme === 'light' ? '#CBD5E0' : '#242D3D';
              let triggerDesc = '';
              let isWarning = false;
              let isCritical = false;

              if (alert.isCompleted) {
                accentColor = theme === 'light' ? '#CBD5E0' : '#242D3D';
              } else if (alert.triggerType === 'MILEAGE') {
                const targetOdo = parseInt(alert.triggerValue);
                const remaining = targetOdo - vehicle.currentMileage;
                if (remaining <= 0) {
                  accentColor = '#E30613';
                  isCritical = true;
                } else if (remaining <= 500) {
                  accentColor = '#FF9E00';
                  isWarning = true;
                } else {
                  accentColor = colors.statusGreen;
                }
                triggerDesc = `A LOS ${targetOdo.toLocaleString()} KM`;
              } else {
                const today = new Date().getTime();
                const targetTime = new Date(alert.triggerValue).getTime();
                const daysLeft = Math.ceil((targetTime - today) / (1000 * 60 * 60 * 24));
                
                if (daysLeft <= 0) {
                  accentColor = '#E30613';
                  isCritical = true;
                } else if (daysLeft <= 7) {
                  accentColor = '#FF9E00';
                  isWarning = true;
                } else {
                  accentColor = theme === 'light' ? '#1C69D4' : '#00A3E0';
                }
                
                triggerDesc = `EXPIRACIÓN: ${new Date(alert.triggerValue).toLocaleDateString('es-ES')}`;
              }

              return (
                <View
                  key={alert.id}
                  style={{
                    backgroundColor: tftStyles.cardBg,
                    borderColor: tftStyles.cardBorder,
                    borderWidth: 1,
                    borderRadius: 16,
                    padding: 14,
                    marginBottom: 14, // Spacing between cards to prevent them from sticking
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    borderLeftWidth: 4,
                    borderLeftColor: accentColor,
                    opacity: alert.isCompleted ? 0.6 : 1,
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4, flexWrap: 'wrap', gap: 6 }}>
                      <Text style={{ 
                        fontFamily: 'Rajdhani-Bold', 
                        fontSize: 15, 
                        color: tftStyles.textMain, 
                        textTransform: 'uppercase',
                        letterSpacing: 0.5 
                      }}>
                        {alert.title}
                      </Text>
                      {alert.isCompleted && (
                        <View style={{ 
                          backgroundColor: colors.statusGreen + '15', 
                          borderColor: colors.statusGreen, 
                          borderWidth: 0.5,
                          borderRadius: 4, 
                          paddingHorizontal: 6, 
                          paddingVertical: 1 
                        }}>
                          <Text style={{ fontFamily: 'BarlowCondensed-Bold', fontSize: 8, color: colors.statusGreen, textTransform: 'uppercase' }}>
                            HECHO
                          </Text>
                        </View>
                      )}
                      {isCritical && !alert.isCompleted && (
                        <View style={{ 
                          backgroundColor: 'rgba(227,6,19,0.1)', 
                          borderColor: '#E30613', 
                          borderWidth: 0.5,
                          borderRadius: 4, 
                          paddingHorizontal: 6, 
                          paddingVertical: 1 
                        }}>
                          <Text style={{ fontFamily: 'BarlowCondensed-Bold', fontSize: 8, color: '#E30613', textTransform: 'uppercase' }}>
                            CRÍTICO
                          </Text>
                        </View>
                      )}
                      {isWarning && !alert.isCompleted && (
                        <View style={{ 
                          backgroundColor: 'rgba(255,158,0,0.1)', 
                          borderColor: '#FF9E00', 
                          borderWidth: 0.5,
                          borderRadius: 4, 
                          paddingHorizontal: 6, 
                          paddingVertical: 1 
                        }}>
                          <Text style={{ fontFamily: 'BarlowCondensed-Bold', fontSize: 8, color: '#FF9E00', textTransform: 'uppercase' }}>
                            ATENCIÓN
                          </Text>
                        </View>
                      )}
                    </View>

                    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                      {alert.triggerType === 'MILEAGE' ? (
                        <Activity size={12} color={accentColor} />
                      ) : (
                        <Calendar size={12} color={accentColor} />
                      )}
                      <Text style={{ 
                        fontFamily: 'BarlowCondensed-Bold', 
                        fontSize: 12, 
                        color: tftStyles.textSec, 
                        marginLeft: 6,
                        textTransform: 'uppercase',
                        letterSpacing: 0.5
                      }}>
                        {triggerDesc}
                      </Text>
                    </View>

                    {alert.lastPerformedValue && (
                      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4, opacity: 0.8 }}>
                        <CheckCircle2 size={11} color={tftStyles.timeText} />
                        <Text style={{ 
                          fontFamily: 'BarlowCondensed-Medium', 
                          fontSize: 10, 
                          color: theme === 'light' ? '#718096' : '#A0AEC0', 
                          marginLeft: 4,
                          textTransform: 'uppercase',
                          letterSpacing: 0.5
                        }}>
                          Último: {alert.triggerType === 'MILEAGE'
                            ? `${parseInt(alert.lastPerformedValue).toLocaleString()} km`
                            : new Date(alert.lastPerformedValue).toLocaleDateString('es-ES')
                          }
                        </Text>
                      </View>
                    )}
                  </View>

                  {/* Actions */}
                  <View style={{ flexDirection: 'row', gap: 8, marginLeft: 16 }}>
                    {!alert.isCompleted && (
                      <TouchableOpacity
                        onPress={() => {
                          setEditingAlertId(alert.id);
                          setModalMode('RESOLVE');
                          setTitle(alert.title);
                          setTriggerType(alert.triggerType);
                          
                          if (alert.triggerType === 'MILEAGE') {
                            const currentOdo = vehicle.currentMileage;
                            setLastPerformedValue(currentOdo.toString());
                            
                            let interval = 3000;
                            if (alert.lastPerformedValue) {
                              const prevLast = parseInt(alert.lastPerformedValue);
                              const prevTarget = parseInt(alert.triggerValue);
                              if (prevTarget > prevLast) interval = prevTarget - prevLast;
                            }
                            setTriggerValue((currentOdo + interval).toString());
                          } else {
                            const todayStr = new Date().toISOString().split('T')[0];
                            setLastPerformedValue(todayStr);
                            
                            const nextYear = new Date();
                            nextYear.setFullYear(nextYear.getFullYear() + 1);
                            setTriggerValue(nextYear.toISOString().split('T')[0]);
                          }
                          setModalVisible(true);
                        }}
                        style={{
                          padding: 8,
                          backgroundColor: colors.statusGreen + '15',
                          borderRadius: 10,
                          borderColor: colors.statusGreen,
                          borderWidth: 0.5,
                          justifyContent: 'center',
                          alignItems: 'center',
                        }}
                      >
                        <Check size={14} color={colors.statusGreen} />
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity
                      onPress={() => handleDeleteAlert(alert.id)}
                      style={{
                        padding: 8,
                        backgroundColor: theme === 'light' ? 'rgba(224,0,0,0.06)' : 'rgba(224,0,0,0.12)',
                        borderRadius: 10,
                        borderColor: colors.bmwRed,
                        borderWidth: 0.5,
                        justifyContent: 'center',
                        alignItems: 'center',
                      }}
                    >
                      <Trash2 size={14} color={colors.bmwRed} />
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })
          ) : (
            <View 
              style={{
                backgroundColor: tftStyles.cardBg,
                borderColor: tftStyles.cardBorder,
                borderWidth: 1,
                borderRadius: 16,
                padding: 24,
                alignItems: 'center',
                borderStyle: 'dashed',
              }}
            >
              <Bell size={28} color={theme === 'light' ? '#4E5E72' : '#8E9FBC'} style={{ opacity: 0.6, marginBottom: 8 }} />
              <Text style={{ fontFamily: 'Rajdhani-Bold', fontSize: 14, color: tftStyles.textMain, textTransform: 'uppercase', letterSpacing: 1 }}>
                Sin alertas programadas
              </Text>
              <Text style={{ fontFamily: 'BarlowCondensed-Medium', fontSize: 11, color: tftStyles.textSec, textAlign: 'center', marginTop: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Presiona "+ ALERTA" para configurar un recordatorio.
              </Text>
            </View>
          )}
        </ScrollView>
      )}

      {/* Add Alert Modal */}
      <Modal visible={modalVisible} animationType="slide" transparent={true} statusBarTranslucent={true}>
        <KeyboardAvoidingView
          behavior="padding"
          style={{ flex: 1 }}
        >
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' }}>
            <View 
              style={{
                backgroundColor: tftStyles.cardBg,
                borderTopWidth: 1,
                borderTopColor: tftStyles.cardBorder,
                borderTopLeftRadius: 24,
                borderTopRightRadius: 24,
                maxHeight: '85%',
                shadowColor: '#000',
                shadowOffset: { width: 0, height: -10 },
                shadowOpacity: theme === 'light' ? 0.05 : 0.4,
                shadowRadius: 15,
                elevation: 8
              }}
            >
              <ScrollView 
                contentContainerStyle={{ padding: 24, paddingBottom: insets.bottom > 0 ? insets.bottom + 30 : 60 }}
                style={{ width: '100%' }}
                keyboardShouldPersistTaps="handled"
              >
                {/* Header */}
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
                  <Text style={{ fontFamily: 'Rajdhani-Bold', fontSize: 18, color: tftStyles.textMain, textTransform: 'uppercase', letterSpacing: 2 }}>
                    {modalMode === 'CREATE' ? 'NUEVO RECORDATORIO' : 'REGISTRAR MANTENIMIENTO'}
                  </Text>
                  <TouchableOpacity onPress={() => setModalVisible(false)} style={{ padding: 4 }}>
                    <X size={24} color={theme === 'light' ? '#002C5B' : '#F8F9FA'} />
                  </TouchableOpacity>
                </View>

                {modalMode === 'RESOLVE' && (
                  <View style={{ 
                    marginBottom: 16, 
                    backgroundColor: theme === 'light' ? '#F4F5F7' : '#0A0D12', 
                    borderWidth: 1, 
                    borderColor: tftStyles.cardBorder, 
                    borderRadius: 12, 
                    padding: 14 
                  }}>
                    <Text style={{ fontFamily: 'BarlowCondensed-Bold', fontSize: 9, color: theme === 'light' ? '#718096' : '#A0AEC0', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 }}>
                      Mantenimiento Activo
                    </Text>
                    <Text style={{ fontFamily: 'Rajdhani-Bold', fontSize: 15, color: tftStyles.textMain, textTransform: 'uppercase' }}>
                      {title}
                    </Text>
                    <Text style={{ fontFamily: 'BarlowCondensed-Medium', fontSize: 11, color: tftStyles.textSec, marginTop: 6, textTransform: 'uppercase' }}>
                      Odómetro actual de la moto: <Text style={{ fontFamily: 'Orbitron-Bold', fontSize: 11 }}>{vehicle?.currentMileage.toLocaleString()}</Text> km
                    </Text>
                  </View>
                )}

                {modalMode === 'CREATE' && (
                  <>
                    {/* Alert Type Selection */}
                    <View style={{ marginBottom: 16, zIndex: 100 }}>
                      <Text style={{ fontFamily: 'BarlowCondensed-Bold', fontSize: 11, color: tftStyles.textSec, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
                        Categoría del Mantenimiento
                      </Text>
                      <TouchableOpacity
                        onPress={() => setIsTypeDropdownOpen(!isTypeDropdownOpen)}
                        style={{
                          flexDirection: 'row',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          width: '100%',
                          backgroundColor: theme === 'light' ? '#F4F5F7' : '#0A0D12',
                          borderWidth: 1,
                          borderColor: tftStyles.cardBorder,
                          borderRadius: 12,
                          paddingHorizontal: 16,
                          paddingVertical: 12,
                        }}
                      >
                        <Text style={{ fontFamily: 'Rajdhani-SemiBold', fontSize: 14, color: tftStyles.textMain }}>{typeLabel}</Text>
                        <ChevronDown size={18} color={activeBmwColor} />
                      </TouchableOpacity>

                      {isTypeDropdownOpen && (
                        <View 
                          style={{
                            marginTop: 8,
                            borderWidth: 1,
                            borderColor: tftStyles.cardBorder,
                            borderRadius: 12,
                            backgroundColor: theme === 'light' ? '#FFFFFF' : '#121620',
                            maxHeight: 200,
                            overflow: 'hidden',
                          }}
                        >
                          <ScrollView nestedScrollEnabled={true}>
                            {ALERT_TYPES.map((item) => (
                              <TouchableOpacity
                                key={item.value}
                                onPress={() => {
                                  setType(item.value as any);
                                  setTypeLabel(item.label);
                                  setTitle(item.label);
                                  setIsTypeDropdownOpen(false);
                                }}
                                style={{
                                  paddingHorizontal: 16,
                                  paddingVertical: 12,
                                  borderBottomWidth: 0.5,
                                  borderBottomColor: tftStyles.cardBorder,
                                }}
                              >
                                <Text style={{ fontFamily: 'Rajdhani-SemiBold', fontSize: 14, color: tftStyles.textMain }}>{item.label}</Text>
                              </TouchableOpacity>
                            ))}
                          </ScrollView>
                        </View>
                      )}
                    </View>

                    {/* Custom Title */}
                    <View style={{ marginBottom: 16 }}>
                      <Text style={{ fontFamily: 'BarlowCondensed-Bold', fontSize: 11, color: tftStyles.textSec, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
                        Título / Descripción
                      </Text>
                      <TextInput
                        value={title}
                        placeholder="Ej. Cambio de Aceite 15w50"
                        placeholderTextColor={theme === 'light' ? '#8E9FBC' : '#556070'}
                        onChangeText={setTitle}
                        style={{
                          width: '100%',
                          backgroundColor: theme === 'light' ? '#F4F5F7' : '#0A0D12',
                          color: tftStyles.textMain,
                          fontFamily: 'Rajdhani-SemiBold',
                          fontSize: 14,
                          borderRadius: 12,
                          borderWidth: 1,
                          borderColor: tftStyles.cardBorder,
                          paddingHorizontal: 16,
                          paddingVertical: 12,
                        }}
                      />
                    </View>

                    {/* Trigger Type Toggle */}
                    <View style={{ marginBottom: 16 }}>
                      <Text style={{ fontFamily: 'BarlowCondensed-Bold', fontSize: 11, color: tftStyles.textSec, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
                        Gatillo del Recordatorio
                      </Text>
                      <View style={{ 
                        flexDirection: 'row', 
                        backgroundColor: theme === 'light' ? '#F4F5F7' : '#0A0D12', 
                        borderWidth: 1, 
                        borderColor: tftStyles.cardBorder, 
                        borderRadius: 12, 
                        padding: 4 
                      }}>
                        <TouchableOpacity
                          onPress={() => {
                            setTriggerType('MILEAGE');
                            setLastPerformedValue(vehicle ? vehicle.currentMileage.toString() : '');
                            setTriggerValue(vehicle ? (vehicle.currentMileage + 3000).toString() : '');
                          }}
                          style={{
                            flex: 1,
                            paddingVertical: 8,
                            borderRadius: 8,
                            alignItems: 'center',
                            backgroundColor: triggerType === 'MILEAGE' ? '#1C69D4' : 'transparent'
                          }}
                        >
                          <Text style={{
                            fontFamily: 'BarlowCondensed-Bold',
                            fontSize: 11,
                            textTransform: 'uppercase',
                            letterSpacing: 1,
                            color: triggerType === 'MILEAGE' ? '#FFFFFF' : tftStyles.textSec
                          }}>
                            Por Kilometraje
                          </Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          onPress={() => {
                            setTriggerType('DATE');
                            setLastPerformedValue(new Date().toISOString().split('T')[0]);
                            const nextYear = new Date();
                            nextYear.setFullYear(nextYear.getFullYear() + 1);
                            setTriggerValue(nextYear.toISOString().split('T')[0]);
                          }}
                          style={{
                            flex: 1,
                            paddingVertical: 8,
                            borderRadius: 8,
                            alignItems: 'center',
                            backgroundColor: triggerType === 'DATE' ? '#1C69D4' : 'transparent'
                          }}
                        >
                          <Text style={{
                            fontFamily: 'BarlowCondensed-Bold',
                            fontSize: 11,
                            textTransform: 'uppercase',
                            letterSpacing: 1,
                            color: triggerType === 'DATE' ? '#FFFFFF' : tftStyles.textSec
                          }}>
                            Por Fecha
                          </Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  </>
                )}

                {/* Last Performed Input */}
                <View style={{ marginBottom: 16 }}>
                  <Text style={{ fontFamily: 'BarlowCondensed-Bold', fontSize: 11, color: tftStyles.textSec, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
                    {triggerType === 'MILEAGE'
                      ? 'Último cambio / realizado (km)'
                      : 'Fecha del último cambio'}
                  </Text>
                  {triggerType === 'MILEAGE' ? (
                    <TextInput
                      value={lastPerformedValue}
                      placeholder={`Ej. ${vehicle?.currentMileage}`}
                      placeholderTextColor={theme === 'light' ? '#8E9FBC' : '#556070'}
                      keyboardType="numeric"
                      onChangeText={setLastPerformedValue}
                      style={{
                        width: '100%',
                        backgroundColor: theme === 'light' ? '#F4F5F7' : '#0A0D12',
                        color: tftStyles.textMain,
                        fontFamily: 'Rajdhani-SemiBold',
                        fontSize: 14,
                        borderRadius: 12,
                        borderWidth: 1,
                        borderColor: tftStyles.cardBorder,
                        paddingHorizontal: 16,
                        paddingVertical: 12,
                      }}
                    />
                  ) : (
                    <TouchableOpacity
                      onPress={() => setShowLastPerformedDatePicker(true)}
                      style={{
                        width: '100%',
                        backgroundColor: theme === 'light' ? '#F4F5F7' : '#0A0D12',
                        borderWidth: 1,
                        borderColor: tftStyles.cardBorder,
                        borderRadius: 12,
                        paddingHorizontal: 16,
                        paddingVertical: 12,
                        justifyContent: 'center',
                      }}
                    >
                      <Text style={{ fontFamily: 'Rajdhani-SemiBold', fontSize: 14, color: lastPerformedValue ? tftStyles.textMain : '#8E9FBC' }}>
                        {lastPerformedValue ? parseIsoDate(lastPerformedValue).toLocaleDateString('es-ES') : 'Seleccionar fecha'}
                      </Text>
                    </TouchableOpacity>
                  )}
                  {showLastPerformedDatePicker && (
                    <DateTimePicker
                      value={parseIsoDate(lastPerformedValue)}
                      mode="date"
                      display="default"
                      {...((Platform.OS === 'web'
                        ? {
                            onValueChange: (selectedDate: Date) => {
                              setShowLastPerformedDatePicker(false);
                              if (selectedDate) setLastPerformedValue(formatIsoDate(selectedDate));
                            }
                          }
                        : {
                            onChange: (event: any, selectedDate?: Date) => {
                              setShowLastPerformedDatePicker(false);
                              if (selectedDate) setLastPerformedValue(formatIsoDate(selectedDate));
                            }
                          }
                      ) as any)}
                    />
                  )}
                </View>

                {/* Trigger Value Input */}
                <View style={{ marginBottom: 24 }}>
                  <Text style={{ fontFamily: 'BarlowCondensed-Bold', fontSize: 11, color: tftStyles.textSec, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
                    {triggerType === 'MILEAGE'
                      ? 'Próximo objetivo / límite (km)'
                      : 'Próxima expiración / límite'}
                  </Text>
                  {triggerType === 'MILEAGE' ? (
                    <TextInput
                      value={triggerValue}
                      placeholder={vehicle ? (vehicle.currentMileage + 3000).toString() : '12000'}
                      placeholderTextColor={theme === 'light' ? '#8E9FBC' : '#556070'}
                      keyboardType="numeric"
                      onChangeText={setTriggerValue}
                      style={{
                        width: '100%',
                        backgroundColor: theme === 'light' ? '#F4F5F7' : '#0A0D12',
                        color: tftStyles.textMain,
                        fontFamily: 'Rajdhani-SemiBold',
                        fontSize: 14,
                        borderRadius: 12,
                        borderWidth: 1,
                        borderColor: tftStyles.cardBorder,
                        paddingHorizontal: 16,
                        paddingVertical: 12,
                      }}
                    />
                  ) : (
                    <TouchableOpacity
                      onPress={() => setShowTriggerDatePicker(true)}
                      style={{
                        width: '100%',
                        backgroundColor: theme === 'light' ? '#F4F5F7' : '#0A0D12',
                        borderWidth: 1,
                        borderColor: tftStyles.cardBorder,
                        borderRadius: 12,
                        paddingHorizontal: 16,
                        paddingVertical: 12,
                        justifyContent: 'center',
                      }}
                    >
                      <Text style={{ fontFamily: 'Rajdhani-SemiBold', fontSize: 14, color: triggerValue ? tftStyles.textMain : '#8E9FBC' }}>
                        {triggerValue ? parseIsoDate(triggerValue).toLocaleDateString('es-ES') : 'Seleccionar fecha'}
                      </Text>
                    </TouchableOpacity>
                  )}
                  {showTriggerDatePicker && (
                    <DateTimePicker
                      value={parseIsoDate(triggerValue)}
                      mode="date"
                      display="default"
                      {...((Platform.OS === 'web'
                        ? {
                            onValueChange: (selectedDate: Date) => {
                              setShowTriggerDatePicker(false);
                              if (selectedDate) setTriggerValue(formatIsoDate(selectedDate));
                            }
                          }
                        : {
                            onChange: (event: any, selectedDate?: Date) => {
                              setShowTriggerDatePicker(false);
                              if (selectedDate) setTriggerValue(formatIsoDate(selectedDate));
                            }
                          }
                      ) as any)}
                    />
                  )}
                </View>

                {/* Submit */}
                <TouchableOpacity
                  onPress={handleSaveAlert}
                  disabled={saving}
                  style={{
                    width: '100%',
                    backgroundColor: '#1C69D4',
                    borderRadius: 12,
                    paddingVertical: 14,
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderWidth: 1,
                    borderColor: '#1C69D4',
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
                    <Text style={{ fontFamily: 'Rajdhani-Bold', fontSize: 14, color: '#FFFFFF', textTransform: 'uppercase', letterSpacing: 2 }}>
                      {modalMode === 'CREATE' ? 'GUARDAR RECORDATORIO' : 'GUARDAR MANTENIMIENTO'}
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

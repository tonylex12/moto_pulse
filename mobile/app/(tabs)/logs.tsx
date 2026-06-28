import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, Modal, RefreshControl, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Plus, Fuel, DollarSign, Activity, Calendar, Trash2, X, CheckCircle2 } from 'lucide-react-native';
import { api } from '../../utils/api';
import { useAlert } from '../../utils/AlertContext';
import { useTheme } from '../../utils/ThemeContext';

const parseIsoDate = (dateStr: string) => {
  if (!dateStr) return new Date();
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    const year = parseInt(parts[0]);
    const month = parseInt(parts[1]) - 1; // 0-based
    const day = parseInt(parts[2]);
    return new Date(year, month, day);
  }
  return new Date(dateStr);
};

const formatIsoDate = (date: Date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

interface Vehicle {
  id: string;
  brand: string;
  model: string;
  currentMileage: number;
  isActive: boolean;
}

interface FuelLog {
  id: string;
  odometer: number;
  liters: number;
  price: number;
  notes: string | null;
  date: string;
}

interface Stats {
  totalLogs: number;
  totalCost: number;
  totalLiters: number;
  totalDistance: number;
  avgConsumption: number;
  costPerKm: number;
}

export default function FuelLogsScreen() {
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
  const [logs, setLogs] = useState<FuelLog[]>([]);
  const [stats, setStats] = useState<Stats>({
    totalLogs: 0,
    totalCost: 0,
    totalLiters: 0,
    totalDistance: 0,
    avgConsumption: 0,
    costPerKm: 0,
  });
  
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);

  // Form state
  const [odometer, setOdometer] = useState('');
  const [liters, setLiters] = useState('');
  const [price, setPrice] = useState('');
  const [notes, setNotes] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [logging, setLogging] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);

  const loadData = async () => {
    try {
      const vehicleRes = await api.get('vehicles');
      const list = vehicleRes.data || [];
      if (list.length > 0) {
        const activeVehicle = list.find((v: any) => v.isActive) || list[0];
        setVehicle(activeVehicle);

        const [logsRes, statsRes] = await Promise.all([
          api.get(`fuel-logs/vehicle/${activeVehicle.id}`),
          api.get(`fuel-logs/stats/${activeVehicle.id}`)
        ]);
        setLogs(logsRes.data);
        setStats(statsRes.data);
        
        setOdometer(activeVehicle.currentMileage.toString());
      } else {
        setVehicle(null);
      }
    } catch (e) {
      console.error('Error fetching logs/stats:', e);
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

  const handleAddLog = async () => {
    if (!vehicle) return;
    if (!odometer || !liters || !price) {
      showAlert('Error', 'Por favor ingresa kilometraje, litros y precio total');
      return;
    }

    const odoNum = parseInt(odometer);
    const litNum = parseFloat(liters);
    const priceNum = parseFloat(price);

    if (odoNum < vehicle.currentMileage) {
      showAlert(
        'Kilometraje Advertencia', 
        `El kilometraje ingresado (${odoNum} km) es menor que el actual registrado de la moto (${vehicle.currentMileage} km). ¿Estás seguro?`,
        [
          { text: 'Corregir', style: 'cancel' },
          { text: 'Continuar', onPress: () => submitLog(odoNum, litNum, priceNum) }
        ]
      );
    } else {
      submitLog(odoNum, litNum, priceNum);
    }
  };

  const submitLog = async (odo: number, lits: number, prc: number) => {
    if (!vehicle) return;
    setLogging(true);
    try {
      const payload = {
        vehicleId: vehicle.id,
        odometer: odo,
        liters: lits,
        price: prc,
        notes: notes.trim() || undefined,
        date: new Date(date).toISOString(),
      };

      await api.post('fuel-logs', payload);
      
      // Close the modal first, clear inputs, then load data and show success alert to prevent rendering flicker
      setModalVisible(false);
      setNotes('');
      setLiters('');
      setPrice('');

      setTimeout(() => {
        loadData();
        showAlert('Combustible Registrado', 'Bitácora guardada y odómetro actualizado.');
      }, 300);
    } catch (e: any) {
      console.error(e);
      showAlert('Error', e.response?.data?.error || 'No se pudo guardar la bitácora');
    } finally {
      setLogging(false);
    }
  };

  const handleDeleteLog = (logId: string) => {
    showAlert(
      'Eliminar Registro',
      '¿Estás seguro de que deseas borrar este registro de combustible?',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.delete(`fuel-logs/${logId}`);
              loadData();
            } catch (e) {
              console.error(e);
              showAlert('Error', 'No se pudo eliminar el registro');
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
        <Text style={{ fontFamily: 'Rajdhani-Bold', fontSize: 18, color: tftStyles.textMain, letterSpacing: 2, textTransform: 'uppercase' }}>
          CONSUMO Y LOGS
        </Text>
        {vehicle && (
          <TouchableOpacity
            onPress={() => setModalVisible(true)}
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
              + LOGS
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {!vehicle ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 }}>
          <Fuel size={48} color={colors.bmwRed} style={{ marginBottom: 16 }} />
          <Text style={{ fontFamily: 'Rajdhani-Bold', fontSize: 16, color: tftStyles.textMain, textTransform: 'uppercase', letterSpacing: 1.5 }}>
            REGISTRA TU MOTO PRIMERO
          </Text>
          <Text style={{ fontFamily: 'BarlowCondensed-Medium', fontSize: 12, color: tftStyles.textSec, textAlign: 'center', marginTop: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Debes registrar una moto en el Panel principal antes de guardar bitácoras de consumo.
          </Text>
        </View>
      ) : (
        <ScrollView
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
          style={{ flex: 1 }}
        >
          {/* MotoPulse Telemetry TFT Block */}
          <View 
            style={{ 
              backgroundColor: tftStyles.bezelBg,
              borderColor: tftStyles.bezelBorder,
              borderWidth: 1,
              borderRadius: 20,
              padding: 4,
              marginBottom: 24,
            }}
          >
            <View 
              style={{
                backgroundColor: tftStyles.screenBg,
                borderColor: tftStyles.screenBorder,
                borderWidth: 1,
                borderRadius: 16,
                padding: 12,
              }}
            >
              {/* Telemetry Header */}
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, borderBottomWidth: 1, borderBottomColor: tftStyles.headerBorder, paddingBottom: 6 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  {/* Small Telemetry Badge */}
                  <View style={{ flexDirection: 'row', marginRight: 8 }}>
                    <View style={{ width: 6, height: 8, backgroundColor: '#00E5FF', borderRadius: 1 }} />
                  </View>
                  <Text style={{ fontFamily: 'Rajdhani-Bold', fontSize: 11, color: '#00E5FF', letterSpacing: 1.5, textTransform: 'uppercase' }}>
                    TELEMETRÍA DE CONSUMO
                  </Text>
                </View>
                <Text style={{ fontFamily: 'Orbitron-Bold', fontSize: 9, color: tftStyles.timeText, opacity: 0.8 }}>
                  LOG-SYS V4.2
                </Text>
              </View>

              {/* Three Gauges Row */}
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 10 }}>
                {/* Avg Consumption */}
                <View style={{ flex: 1, backgroundColor: theme === 'light' ? '#FFFFFF' : '#121620', borderColor: tftStyles.screenBorder, borderWidth: 0.5, borderRadius: 10, padding: 8, alignItems: 'center' }}>
                  <Activity size={16} color={theme === 'light' ? '#1C69D4' : '#00A3E0'} style={{ marginBottom: 4 }} />
                  <Text style={{ fontFamily: 'BarlowCondensed-Bold', fontSize: 8, color: tftStyles.textSec, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 }}>
                    RENDIMIENTO
                  </Text>
                  <Text style={{ fontFamily: 'Rajdhani-Bold', fontSize: 16, color: tftStyles.textMain, letterSpacing: -0.5 }}>
                    {stats.avgConsumption > 0 ? `${stats.avgConsumption}` : '---'}
                  </Text>
                  <Text style={{ fontFamily: 'BarlowCondensed-SemiBold', fontSize: 8, color: theme === 'light' ? '#1C69D4' : '#00E5FF', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 1 }}>
                    KM / LITRO
                  </Text>
                </View>

                {/* Total Spend */}
                <View style={{ flex: 1, backgroundColor: theme === 'light' ? '#FFFFFF' : '#121620', borderColor: tftStyles.screenBorder, borderWidth: 0.5, borderRadius: 10, padding: 8, alignItems: 'center' }}>
                  <DollarSign size={16} color={theme === 'light' ? '#1C69D4' : '#00A3E0'} style={{ marginBottom: 4 }} />
                  <Text style={{ fontFamily: 'BarlowCondensed-Bold', fontSize: 8, color: tftStyles.textSec, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 }}>
                    GASTO TOTAL
                  </Text>
                  <Text style={{ fontFamily: 'Rajdhani-Bold', fontSize: 16, color: tftStyles.textMain, letterSpacing: -0.5 }}>
                    ${stats.totalCost.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 1 })}
                  </Text>
                  <Text style={{ fontFamily: 'BarlowCondensed-SemiBold', fontSize: 8, color: theme === 'light' ? '#1C69D4' : '#00E5FF', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 1 }}>
                    COP / USD
                  </Text>
                </View>

                {/* Cost Per Km */}
                <View style={{ flex: 1, backgroundColor: theme === 'light' ? '#FFFFFF' : '#121620', borderColor: tftStyles.screenBorder, borderWidth: 0.5, borderRadius: 10, padding: 8, alignItems: 'center' }}>
                  <Fuel size={16} color={colors.bmwRed} style={{ marginBottom: 4 }} />
                  <Text style={{ fontFamily: 'BarlowCondensed-Bold', fontSize: 8, color: tftStyles.textSec, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 }}>
                    COSTO / KM
                  </Text>
                  <Text style={{ fontFamily: 'Rajdhani-Bold', fontSize: 16, color: tftStyles.textMain, letterSpacing: -0.5 }}>
                    ${stats.costPerKm > 0 ? `${stats.costPerKm}` : '---'}
                  </Text>
                  <Text style={{ fontFamily: 'BarlowCondensed-SemiBold', fontSize: 8, color: colors.bmwRed, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 1 }}>
                    COSTO PROM
                  </Text>
                </View>
              </View>
            </View>
          </View>

          {/* Logs History Title */}
          <Text style={{ fontFamily: 'Rajdhani-Bold', fontSize: 12, color: tftStyles.textSec, letterSpacing: 2, textTransform: 'uppercase', marginBottom: 12 }}>
            HISTORIAL DE CARGAS
          </Text>

          {/* Logs Feed */}
          {logs.length > 0 ? (
            logs.map((log) => (
              <View
                key={log.id}
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
                  borderLeftColor: theme === 'light' ? '#1C69D4' : '#00E5FF',
                }}
              >
                <View style={{ flex: 1 }}>
                  {/* Date & Icon */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
                    <Calendar size={11} color={theme === 'light' ? '#1C69D4' : '#00E5FF'} />
                    <Text style={{ 
                      fontFamily: 'BarlowCondensed-Bold', 
                      fontSize: 10, 
                      color: tftStyles.textSec, 
                      marginLeft: 5, 
                      textTransform: 'uppercase',
                      letterSpacing: 1
                    }}>
                      {new Date(log.date).toLocaleDateString('es-ES', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </Text>
                  </View>
                  
                  {/* Main Details */}
                  <View style={{ flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap' }}>
                    <Text style={{ fontFamily: 'Rajdhani-Bold', fontSize: 16, color: tftStyles.textMain }}>
                      {log.liters} L
                    </Text>
                    <Text style={{ fontFamily: 'BarlowCondensed-Medium', fontSize: 10, color: tftStyles.textSec, marginLeft: 4, marginRight: 8, textTransform: 'uppercase' }}>
                      CARGADOS
                    </Text>
                    
                    <Text style={{ fontFamily: 'BarlowCondensed-Medium', fontSize: 10, color: tftStyles.textSec, marginRight: 4, textTransform: 'uppercase' }}>
                      A LOS
                    </Text>
                    <Text style={{ fontFamily: 'Orbitron-Bold', fontSize: 12, color: theme === 'light' ? '#002C5B' : '#00E5FF', letterSpacing: 0.5 }}>
                      {log.odometer.toLocaleString()}
                    </Text>
                    <Text style={{ fontFamily: 'BarlowCondensed-Bold', fontSize: 10, color: theme === 'light' ? '#1C69D4' : '#00E5FF', marginLeft: 3 }}>
                      KM
                    </Text>
                  </View>

                  {/* Notes */}
                  {log.notes && (
                    <Text style={{ 
                      fontFamily: 'BarlowCondensed-Medium', 
                      fontSize: 11, 
                      color: tftStyles.textSec, 
                      fontStyle: 'italic', 
                      marginTop: 6,
                      opacity: 0.8 
                    }}>
                      📝 {log.notes}
                    </Text>
                  )}
                </View>

                {/* Right side: Price & Action */}
                <View style={{ alignItems: 'flex-end', marginLeft: 16, gap: 10 }}>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={{ fontFamily: 'BarlowCondensed-Bold', fontSize: 9, color: tftStyles.textSec, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                      COSTO TOTAL
                    </Text>
                    <Text style={{ fontFamily: 'Rajdhani-Bold', fontSize: 18, color: tftStyles.textMain, lineHeight: 22 }}>
                      ${log.price.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                    </Text>
                  </View>
                  
                  <TouchableOpacity 
                    onPress={() => handleDeleteLog(log.id)} 
                    style={{ 
                      padding: 6,
                      backgroundColor: theme === 'light' ? 'rgba(224, 0, 0, 0.06)' : 'rgba(224, 0, 0, 0.12)',
                      borderRadius: 8,
                      borderColor: colors.bmwRed,
                      borderWidth: 0.5,
                    }}
                  >
                    <Trash2 size={13} color={colors.bmwRed} />
                  </TouchableOpacity>
                </View>
              </View>
            ))
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
              <Fuel size={28} color={theme === 'light' ? '#4E5E72' : '#8E9FBC'} style={{ opacity: 0.6, marginBottom: 8 }} />
              <Text style={{ fontFamily: 'Rajdhani-Bold', fontSize: 14, color: tftStyles.textMain, textTransform: 'uppercase', letterSpacing: 1 }}>
                Sin cargas registradas
              </Text>
              <Text style={{ fontFamily: 'BarlowCondensed-Medium', fontSize: 11, color: tftStyles.textSec, textAlign: 'center', marginTop: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Presiona "+ LOGS" para registrar tu primera recarga de combustible.
              </Text>
            </View>
          )}
        </ScrollView>
      )}

      {/* Add Fuel Log Modal */}
      <Modal visible={modalVisible} animationType="slide" transparent={true}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
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
                {/* Modal Header */}
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
                  <Text style={{ fontFamily: 'Rajdhani-Bold', fontSize: 18, color: tftStyles.textMain, textTransform: 'uppercase', letterSpacing: 2 }}>
                    REGISTRAR CARGA
                  </Text>
                  <TouchableOpacity onPress={() => setModalVisible(false)} style={{ padding: 4 }}>
                    <X size={24} color={theme === 'light' ? '#002C5B' : '#F8F9FA'} />
                  </TouchableOpacity>
                </View>

                {/* Odometer */}
                <View style={{ marginBottom: 16 }}>
                  <Text style={{ fontFamily: 'BarlowCondensed-Bold', fontSize: 11, color: tftStyles.textSec, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
                    Odómetro Actual (km)
                  </Text>
                  <TextInput
                    value={odometer}
                    placeholder="Kilometraje"
                    placeholderTextColor={theme === 'light' ? '#8E9FBC' : '#556070'}
                    keyboardType="numeric"
                    onChangeText={setOdometer}
                    style={{
                      width: '100%',
                      backgroundColor: theme === 'light' ? '#F4F5F7' : '#0A0D12',
                      color: tftStyles.textMain,
                      fontFamily: 'Rajdhani-SemiBold',
                      fontSize: 14,
                      borderRadius: 12,
                      borderWidth: theme === 'light' ? 0 : 1,
                      borderColor: tftStyles.cardBorder,
                      paddingHorizontal: 16,
                      paddingVertical: 12,
                    }}
                  />
                </View>

                {/* Liters & Price */}
                <View style={{ marginBottom: 16, flexDirection: 'row', gap: 12 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontFamily: 'BarlowCondensed-Bold', fontSize: 11, color: tftStyles.textSec, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
                      Litros Cargados
                    </Text>
                    <TextInput
                      value={liters}
                      placeholder="Volumen en L"
                      placeholderTextColor={theme === 'light' ? '#8E9FBC' : '#556070'}
                      keyboardType="numeric"
                      onChangeText={setLiters}
                      style={{
                        width: '100%',
                        backgroundColor: theme === 'light' ? '#F4F5F7' : '#0A0D12',
                        color: tftStyles.textMain,
                        fontFamily: 'Rajdhani-SemiBold',
                        fontSize: 14,
                        borderRadius: 12,
                        borderWidth: theme === 'light' ? 0 : 1,
                        borderColor: tftStyles.cardBorder,
                        paddingHorizontal: 16,
                        paddingVertical: 12,
                      }}
                    />
                  </View>

                  <View style={{ flex: 1 }}>
                    <Text style={{ fontFamily: 'BarlowCondensed-Bold', fontSize: 11, color: tftStyles.textSec, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
                      Costo Total ($)
                    </Text>
                    <TextInput
                      value={price}
                      placeholder="Precio pagado"
                      placeholderTextColor={theme === 'light' ? '#8E9FBC' : '#556070'}
                      keyboardType="numeric"
                      onChangeText={setPrice}
                      style={{
                        width: '100%',
                        backgroundColor: theme === 'light' ? '#F4F5F7' : '#0A0D12',
                        color: tftStyles.textMain,
                        fontFamily: 'Rajdhani-SemiBold',
                        fontSize: 14,
                        borderRadius: 12,
                        borderWidth: theme === 'light' ? 0 : 1,
                        borderColor: tftStyles.cardBorder,
                        paddingHorizontal: 16,
                        paddingVertical: 12,
                      }}
                    />
                  </View>
                </View>

                {/* Date */}
                <View style={{ marginBottom: 16 }}>
                  <Text style={{ fontFamily: 'BarlowCondensed-Bold', fontSize: 11, color: tftStyles.textSec, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
                    Fecha
                  </Text>
                  <TouchableOpacity
                    onPress={() => setShowDatePicker(true)}
                    style={{
                      width: '100%',
                      backgroundColor: theme === 'light' ? '#F4F5F7' : '#0A0D12',
                      borderRadius: 12,
                      borderWidth: 1,
                      borderColor: tftStyles.cardBorder,
                      paddingHorizontal: 16,
                      paddingVertical: 12,
                      justifyContent: 'center',
                      height: 48,
                    }}
                  >
                    <Text style={{ fontFamily: 'Rajdhani-SemiBold', fontSize: 14, color: tftStyles.textMain }}>
                      {date ? parseIsoDate(date).toLocaleDateString('es-ES') : 'Seleccionar fecha'}
                    </Text>
                  </TouchableOpacity>
                  {showDatePicker && (
                    <DateTimePicker
                      value={parseIsoDate(date)}
                      mode="date"
                      display="default"
                      {...((Platform.OS === 'web'
                        ? {
                            onValueChange: (selectedDate: Date) => {
                              setShowDatePicker(false);
                              if (selectedDate) setDate(formatIsoDate(selectedDate));
                            }
                          }
                        : {
                            onChange: (event: any, selectedDate?: Date) => {
                              setShowDatePicker(false);
                              if (selectedDate) setDate(formatIsoDate(selectedDate));
                            }
                          }
                      ) as any)}
                    />
                  )}
                </View>

                {/* Notes */}
                <View style={{ marginBottom: 24 }}>
                  <Text style={{ fontFamily: 'BarlowCondensed-Bold', fontSize: 11, color: tftStyles.textSec, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
                    Notas / Gasolinera
                  </Text>
                  <TextInput
                    value={notes}
                    placeholder="Ej. Gasolinera Repsol, Aditivo añadido"
                    placeholderTextColor={theme === 'light' ? '#8E9FBC' : '#556070'}
                    onChangeText={setNotes}
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

                {/* Action Buttons */}
                <TouchableOpacity
                  onPress={handleAddLog}
                  disabled={logging}
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
                  {logging ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <Text style={{ fontFamily: 'Rajdhani-Bold', fontSize: 14, color: '#FFFFFF', textTransform: 'uppercase', letterSpacing: 2 }}>
                      REGISTRAR REPOSTAJE
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

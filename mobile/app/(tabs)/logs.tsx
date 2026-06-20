import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, Alert, Modal, RefreshControl, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Plus, Fuel, DollarSign, Activity, Calendar, Trash2, X, CheckCircle2 } from 'lucide-react-native';
import { api } from '../../utils/api';

interface Vehicle {
  id: string;
  brand: string;
  model: string;
  currentMileage: number;
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

  const loadData = async () => {
    try {
      const vehicleRes = await api.get('/vehicles');
      if (vehicleRes.data && vehicleRes.data.length > 0) {
        const activeVehicle = vehicleRes.data[0];
        setVehicle(activeVehicle);

        // Fetch logs
        const logsRes = await api.get(`/fuel-logs/vehicle/${activeVehicle.id}`);
        setLogs(logsRes.data);

        // Fetch stats
        const statsRes = await api.get(`/fuel-logs/stats/${activeVehicle.id}`);
        setStats(statsRes.data);
        
        // Seed default odometer on form
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
      Alert.alert('Error', 'Por favor ingresa kilometraje, litros y precio total');
      return;
    }

    const odoNum = parseInt(odometer);
    const litNum = parseFloat(liters);
    const priceNum = parseFloat(price);

    if (odoNum < vehicle.currentMileage) {
      Alert.alert(
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

      await api.post('/fuel-logs', payload);
      Alert.alert('Combustible Registrado', 'Bitácora guardada y odómetro actualizado.');
      
      // Reset form and close modal
      setNotes('');
      setLiters('');
      setPrice('');
      setModalVisible(false);

      // Refresh list
      loadData();
    } catch (e: any) {
      console.error(e);
      Alert.alert('Error', e.response?.data?.error || 'No se pudo guardar la bitácora');
    } finally {
      setLogging(false);
    }
  };

  const handleDeleteLog = (logId: string) => {
    Alert.alert(
      'Eliminar Registro',
      '¿Estás seguro de que deseas borrar este registro de combustible?',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.delete(`/fuel-logs/${logId}`);
              loadData();
            } catch (e) {
              console.error(e);
              Alert.alert('Error', 'No se pudo eliminar el registro');
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
          CONSUMO Y LOGS
        </Text>
        {vehicle && (
          <TouchableOpacity
            onPress={() => setModalVisible(true)}
            className="flex-row items-center bg-speedo-cyan rounded-lg px-3 py-1.5 border border-speedo-cyan"
          >
            <Plus size={16} color="#0B0D10" />
            <Text className="text-carbon-matte font-bold text-xs uppercase tracking-wider ml-1">
              LOGS
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {!vehicle ? (
        <View className="flex-grow justify-center items-center p-6">
          <Fuel size={48} color="#FF6B00" />
          <Text className="text-white text-center font-orbitron text-base font-bold mt-4 uppercase">
            REGISTRA TU MOTO PRIMERO
          </Text>
          <Text className="text-neutral-400 text-center text-xs mt-1">
            Debes registrar una moto en el Panel principal antes de guardar bitácoras de consumo.
          </Text>
        </View>
      ) : (
        <ScrollView
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          className="flex-grow p-6"
        >
          {/* Quick Metrics Cards Row */}
          <View className="flex-row justify-between space-x-3 mb-6">
            {/* Avg Consumption */}
            <View className="flex-1 bg-tarmac border border-tarmac-light rounded-xl p-4 items-center">
              <Activity size={20} color="#2CFF0A" />
              <Text className="text-neutral-400 text-xxs uppercase tracking-wider mt-1.5 mb-0.5">
                Rendimiento
              </Text>
              <Text className="text-white font-orbitron text-base font-bold tracking-tight text-center">
                {stats.avgConsumption > 0 ? `${stats.avgConsumption}` : '---'}{' '}
                <Text className="text-neutral-400 font-sans text-xs">km/L</Text>
              </Text>
            </View>

            {/* Total Spend */}
            <View className="flex-1 bg-tarmac border border-tarmac-light rounded-xl p-4 items-center">
              <DollarSign size={20} color="#00E5FF" />
              <Text className="text-neutral-400 text-xxs uppercase tracking-wider mt-1.5 mb-0.5">
                Gasto Total
              </Text>
              <Text className="text-white font-orbitron text-base font-bold tracking-tight text-center">
                ${stats.totalCost.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
              </Text>
            </View>

            {/* Cost Per Km */}
            <View className="flex-1 bg-tarmac border border-tarmac-light rounded-xl p-4 items-center">
              <Fuel size={20} color="#FF6B00" />
              <Text className="text-neutral-400 text-xxs uppercase tracking-wider mt-1.5 mb-0.5">
                Costo / km
              </Text>
              <Text className="text-white font-orbitron text-base font-bold tracking-tight text-center">
                ${stats.costPerKm > 0 ? `${stats.costPerKm}` : '---'}
              </Text>
            </View>
          </View>

          {/* Logs History Title */}
          <Text className="text-neutral-400 font-bold text-xs uppercase tracking-widest mb-4">
            HISTORIAL DE CARGAS
          </Text>

          {/* Logs Feed */}
          {logs.length > 0 ? (
            logs.map((log) => (
              <View
                key={log.id}
                className="bg-tarmac border border-tarmac-light rounded-xl p-4 mb-3 flex-row justify-between items-center"
              >
                <View className="flex-1">
                  <View className="flex-row items-center mb-1">
                    <Calendar size={12} color="#8F9CAE" />
                    <Text className="text-neutral-400 text-xs ml-1">
                      {new Date(log.date).toLocaleDateString('es-ES', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </Text>
                  </View>
                  <Text className="text-white font-semibold text-sm">
                    Carga de <Text className="text-speedo-cyan font-bold">{log.liters} L</Text> a los{' '}
                    <Text className="text-speedo-cyan font-orbitron text-sm">{log.odometer.toLocaleString()} km</Text>
                  </Text>
                  {log.notes && <Text className="text-neutral-400 text-xs italic mt-1">"{log.notes}"</Text>}
                </View>
                
                <View className="items-end space-y-2 ml-4">
                  <Text className="text-white font-bold text-base">${log.price.toFixed(1)}</Text>
                  <TouchableOpacity onPress={() => handleDeleteLog(log.id)} className="p-1">
                    <Trash2 size={16} color="#FF2A3B" />
                  </TouchableOpacity>
                </View>
              </View>
            ))
          ) : (
            <View className="bg-tarmac border border-tarmac-light rounded-xl p-6 items-center">
              <CheckCircle2 size={32} color="#8F9CAE" />
              <Text className="text-white text-center mt-2 font-medium">Sin cargas registradas</Text>
              <Text className="text-neutral-400 text-center text-xs mt-1">Presiona "LOGS" para registrar tu primera recarga de combustible.</Text>
            </View>
          )}
        </ScrollView>
      )}

      {/* Add Fuel Log Modal */}
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
            {/* Modal Header */}
            <View className="flex-row justify-between items-center mb-6">
              <Text className="text-white font-orbitron text-lg font-bold uppercase tracking-wider">
                REGISTRAR CARGA
              </Text>
              <TouchableOpacity onPress={() => setModalVisible(false)} className="p-1">
                <X size={24} color="#F8F9FA" />
              </TouchableOpacity>
            </View>

            {/* Odometer */}
            <View className="mb-4">
              <Text className="text-neutral-400 text-xs uppercase mb-1.5 font-medium tracking-wide">
                Odómetro Actual (km)
              </Text>
              <TextInput
                value={odometer}
                placeholder="Kilometraje"
                placeholderTextColor="#556070"
                keyboardType="numeric"
                onChangeText={setOdometer}
                className="w-full bg-carbon-dark text-white border border-tarmac-light rounded-xl px-4 py-3 text-sm focus:border-speedo-cyan"
              />
            </View>

            {/* Liters & Price */}
            <View className="mb-4 flex-row space-x-4">
              <View className="flex-1">
                <Text className="text-neutral-400 text-xs uppercase mb-1.5 font-medium tracking-wide">
                  Litros Cargados
                </Text>
                <TextInput
                  value={liters}
                  placeholder="Volumen en L"
                  placeholderTextColor="#556070"
                  keyboardType="numeric"
                  onChangeText={setLiters}
                  className="w-full bg-carbon-dark text-white border border-tarmac-light rounded-xl px-4 py-3 text-sm focus:border-speedo-cyan"
                />
              </View>

              <View className="flex-1">
                <Text className="text-neutral-400 text-xs uppercase mb-1.5 font-medium tracking-wide">
                  Costo Total ($)
                </Text>
                <TextInput
                  value={price}
                  placeholder="Precio pagado"
                  placeholderTextColor="#556070"
                  keyboardType="numeric"
                  onChangeText={setPrice}
                  className="w-full bg-carbon-dark text-white border border-tarmac-light rounded-xl px-4 py-3 text-sm focus:border-speedo-cyan"
                />
              </View>
            </View>

            {/* Date */}
            <View className="mb-4">
              <Text className="text-neutral-400 text-xs uppercase mb-1.5 font-medium tracking-wide">
                Fecha
              </Text>
              <TextInput
                value={date}
                placeholder="YYYY-MM-DD"
                placeholderTextColor="#556070"
                onChangeText={setDate}
                className="w-full bg-carbon-dark text-white border border-tarmac-light rounded-xl px-4 py-3 text-sm focus:border-speedo-cyan"
              />
            </View>

            {/* Notes */}
            <View className="mb-6">
              <Text className="text-neutral-400 text-xs uppercase mb-1.5 font-medium tracking-wide">
                Notas / Gasolinera
              </Text>
              <TextInput
                value={notes}
                placeholder="Ej. Gasolinera Repsol, Aditivo añadido"
                placeholderTextColor="#556070"
                onChangeText={setNotes}
                className="w-full bg-carbon-dark text-white border border-tarmac-light rounded-xl px-4 py-3 text-sm focus:border-speedo-cyan"
              />
            </View>

            {/* Action Buttons */}
            <TouchableOpacity
              onPress={handleAddLog}
              disabled={logging}
              className="w-full bg-speedo-cyan rounded-xl py-3.5 items-center justify-center border border-speedo-cyan shadow-[0_0_12px_rgba(0,229,255,0.4)]"
            >
              {logging ? (
                <ActivityIndicator color="#0B0D10" />
              ) : (
                <Text className="text-carbon-matte font-bold text-sm uppercase tracking-widest">
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

import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Modal,
  Platform,
  KeyboardAvoidingView,
  Keyboard,
  StyleSheet,
  Image,
} from "react-native";
import DateTimePicker from '@react-native-community/datetimepicker';
import { useUser, useAuth } from "@clerk/clerk-expo";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import {
  LogOut,
  Plus,
  AlertTriangle,
  ShieldCheck,
  CheckCircle2,
  ChevronDown,
  X,
  Sun,
  Moon,
  Pencil,
  Trash2,
} from "lucide-react-native";
import { api } from "../../utils/api";
import { usePushNotifications } from "../../hooks/usePushNotifications";
import { TachometerGauge } from "../../components/ui/TachometerGauge";
import { useAlert } from "../../utils/AlertContext";
import { useTheme } from "../../utils/ThemeContext";

interface Vehicle {
  id: string;
  brand: string;
  model: string;
  year: number;
  currentMileage: number;
  isActive: boolean;
  tankSize?: string | null;
  frontBrake?: string | null;
  rearBrake?: string | null;
  frontSuspension?: string | null;
  rearSuspension?: string | null;
  frontTire?: string | null;
  rearTire?: string | null;
  engineCc?: string | null;
  power?: string | null;
  torque?: string | null;
  transmission?: string | null;
  weight?: string | null;
  seatHeight?: string | null;
  specSource?: string | null;
  imageUrl?: string | null;
}

interface AlertData {
  id: string;
  type: "OIL_CHANGE" | "BRAKE_PADS" | "INSURANCE_RENEWAL" | "PREVENTIVE_MAINTENANCE" | "CUSTOM";
  title: string;
  triggerType: "MILEAGE" | "DATE";
  triggerValue: string;
  isCompleted: boolean;
  lastPerformedValue?: string | null;
}

const POPULAR_BRANDS = [
  "Honda",
  "Yamaha",
  "Suzuki",
  "Kawasaki",
  "KTM",
  "Ducati",
  "BMW",
  "Harley-Davidson",
  "Triumph",
  "Bajaj",
  "Benelli",
  "Royal Enfield",
  "Otro / Manual",
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

export default function DashboardScreen() {
  const { user } = useUser();
  const { signOut } = useAuth();
  const { showAlert } = useAlert();
  const { expoPushToken } = usePushNotifications();
  const { theme, colors, toggleTheme } = useTheme();
  const insets = useSafeAreaInsets();

  // State
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [alerts, setAlerts] = useState<AlertData[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isGarageOpen, setIsGarageOpen] = useState(false);
  const [isRegisteringNew, setIsRegisteringNew] = useState(false);

  // Maintenance Resolve Modal States
  const [maintenanceModalVisible, setMaintenanceModalVisible] = useState(false);
  const [selectedAlert, setSelectedAlert] = useState<AlertData | null>(null);
  const [lastPerformedValue, setLastPerformedValue] = useState("");
  const [triggerValue, setTriggerValue] = useState("");
  const [savingMaintenance, setSavingMaintenance] = useState(false);
  const [showLastPerformedDatePicker, setShowLastPerformedDatePicker] = useState(false);
  const [showTriggerDatePicker, setShowTriggerDatePicker] = useState(false);

  // Form State for Vehicle Registration
  const [brand, setBrand] = useState("Honda");
  const [customBrand, setCustomBrand] = useState("");
  const [isBrandDropdownOpen, setIsBrandDropdownOpen] = useState(false);
  const [model, setModel] = useState("");
  const [year, setYear] = useState(new Date().getFullYear().toString());
  const [currentMileage, setCurrentMileage] = useState("");
  const [registering, setRegistering] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [fetchingSpecs, setFetchingSpecs] = useState(false);

  // Edit Odometer States
  const [editOdoModalVisible, setEditOdoModalVisible] = useState(false);
  const [newOdometerValue, setNewOdometerValue] = useState("");
  const [savingOdometer, setSavingOdometer] = useState(false);

  const openEditOdoModal = () => {
    if (!vehicle) return;
    setNewOdometerValue(vehicle.currentMileage.toString());
    setEditOdoModalVisible(true);
  };

  const handleSaveOdometer = async () => {
    if (!vehicle) return;
    const mileageVal = parseInt(newOdometerValue);
    if (isNaN(mileageVal) || mileageVal < 0) {
      showAlert("Error", "El odómetro debe ser un número válido mayor o igual a 0.");
      return;
    }

    try {
      setSavingOdometer(true);
      const res = await api.put(`vehicles/${vehicle.id}`, {
        brand: vehicle.brand,
        model: vehicle.model,
        year: vehicle.year,
        currentMileage: mileageVal,
      });

      setVehicle(res.data);
      setVehicles(prev => prev.map(v => v.id === vehicle.id ? res.data : v));
      setEditOdoModalVisible(false);
      
      // Refresh alerts to reflect status changes due to the new mileage
      const alertsResponse = await api.get(`alerts/vehicle/${vehicle.id}`);
      setAlerts(alertsResponse.data);

      showAlert('Odómetro Actualizado', `El odómetro se ha actualizado a ${mileageVal} km.`);
    } catch (e) {
      console.error('Error saving odometer mileage:', e);
      showAlert('Error', 'No se pudo actualizar el odómetro.');
    } finally {
      setSavingOdometer(false);
    }
  };

  // Specs Edit Modal States
  const [editSpecsModalVisible, setEditSpecsModalVisible] = useState(false);
  const [editEngineCc, setEditEngineCc] = useState('');
  const [editTankSize, setEditTankSize] = useState('');
  const [editPower, setEditPower] = useState('');
  const [editTorque, setEditTorque] = useState('');
  const [editTransmission, setEditTransmission] = useState('');
  const [editWeight, setEditWeight] = useState('');
  const [editFrontTire, setEditFrontTire] = useState('');
  const [editRearTire, setEditRearTire] = useState('');
  const [editFrontBrake, setEditFrontBrake] = useState('');
  const [editRearBrake, setEditRearBrake] = useState('');
  const [editFrontSuspension, setEditFrontSuspension] = useState('');
  const [editRearSuspension, setEditRearSuspension] = useState('');
  const [savingSpecs, setSavingSpecs] = useState(false);

  const openEditSpecsModal = () => {
    if (!vehicle) return;
    setEditEngineCc(vehicle.engineCc || '');
    setEditTankSize(vehicle.tankSize || '');
    setEditPower(vehicle.power || '');
    setEditTorque(vehicle.torque || '');
    setEditTransmission(vehicle.transmission || '');
    setEditWeight(vehicle.weight || '');
    setEditFrontTire(vehicle.frontTire || '');
    setEditRearTire(vehicle.rearTire || '');
    setEditFrontBrake(vehicle.frontBrake || '');
    setEditRearBrake(vehicle.rearBrake || '');
    setEditFrontSuspension(vehicle.frontSuspension || '');
    setEditRearSuspension(vehicle.rearSuspension || '');
    setEditSpecsModalVisible(true);
  };

  const handleSaveSpecs = async () => {
    if (!vehicle) return;
    try {
      setSavingSpecs(true);
      const res = await api.put(`vehicles/${vehicle.id}`, {
        brand: vehicle.brand,
        model: vehicle.model,
        year: vehicle.year,
        currentMileage: vehicle.currentMileage,
        engineCc: editEngineCc || null,
        tankSize: editTankSize || null,
        power: editPower || null,
        torque: editTorque || null,
        transmission: editTransmission || null,
        weight: editWeight || null,
        frontTire: editFrontTire || null,
        rearTire: editRearTire || null,
        frontBrake: editFrontBrake || null,
        rearBrake: editRearBrake || null,
        frontSuspension: editFrontSuspension || null,
        rearSuspension: editRearSuspension || null,
        specSource: vehicle.specSource || 'Manual',
      });
      
      setVehicle(res.data);
      setVehicles(prev => prev.map(v => v.id === vehicle.id ? res.data : v));
      setEditSpecsModalVisible(false);
      showAlert('Ficha Técnica', 'Ficha técnica actualizada correctamente.');
    } catch (e) {
      console.error('Error saving specs manually:', e);
      showAlert('Error', 'No se pudieron guardar las especificaciones.');
    } finally {
      setSavingSpecs(false);
    }
  };

  const handleFetchSpecs = async () => {
    if (!vehicle) return;
    setFetchingSpecs(true);
    try {
      const response = await api.post(`vehicles/${vehicle.id}/fetch-specs`);
      if (response.data) {
        setVehicle(response.data);
        // Also update in the vehicles list
        setVehicles((prev) =>
          prev.map((v) => (v.id === vehicle.id ? response.data : v)),
        );
        showAlert(
          "Ficha Técnica",
          "Ficha técnica actualizada correctamente usando Inteligencia Artificial.",
        );
      }
    } catch (err: any) {
      console.error("Error fetching specs:", err);
      const errMsg =
        err.response?.data?.error ||
        "No se pudieron obtener las especificaciones de la moto. Revisa tu API key en backend/.env o inténtalo de nuevo.";
      showAlert("Error al buscar", errMsg);
    } finally {
      setFetchingSpecs(false);
    }
  };

  useEffect(() => {
    const showSubscription = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow",
      () => setKeyboardVisible(true),
    );
    const hideSubscription = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide",
      () => setKeyboardVisible(false),
    );

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  // Fetch active vehicle and alerts
  const fetchData = async () => {
    try {
      // Changed to relative paths without leading slash
      const response = await api.get("vehicles");
      const list = response.data || [];
      setVehicles(list);

      if (list.length > 0) {
        const activeVehicle = list.find((v: any) => v.isActive) || list[0];
        setVehicle(activeVehicle);
        setIsRegisteringNew(false);

        // Fetch alerts for this active vehicle
        const alertsResponse = await api.get(
          `alerts/vehicle/${activeVehicle.id}`,
        );
        setAlerts(alertsResponse.data);
      } else {
        setVehicle(null);
        setAlerts([]);
      }
    } catch (e) {
      console.error("Error fetching dashboard data:", e);
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
      api
        .post("users/push-token", { expoPushToken })
        .then(() =>
          console.log("Push token successfully registered in backend!"),
        )
        .catch((err) =>
          console.error("Failed to sync push token with backend:", err),
        );
    }
  }, [expoPushToken]);

  // Register New Vehicle
  const handleRegisterVehicle = async () => {
    const finalBrand = brand === "Otro / Manual" ? customBrand.trim() : brand;
    if (!finalBrand) {
      showAlert("Error", "Por favor ingresa la marca de tu moto");
      return;
    }
    if (!model.trim() || !year || !currentMileage) {
      showAlert("Error", "Por favor completa todos los campos del vehículo");
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

      // Create vehicle in backend (schedules Gemini spec search)
      const response = await api.post("vehicles", payload);
      const newBike = response.data;
      setVehicle(newBike);
      setIsRegisteringNew(false);

      // Auto-create default alerts for new riders
      const bikeId = newBike.id;
      const initialMileage = newBike.currentMileage;
      const todayStr = new Date().toISOString();

      // 1. Oil change alert in 3,000 km
      await api.post("alerts", {
        vehicleId: bikeId,
        type: "OIL_CHANGE",
        title: "Cambio de Aceite",
        triggerType: "MILEAGE",
        triggerValue: (initialMileage + 3000).toString(),
        lastPerformedValue: initialMileage.toString(),
      });

      // 2. Mantenimiento Preventivo in 6,000 km
      await api.post("alerts", {
        vehicleId: bikeId,
        type: "PREVENTIVE_MAINTENANCE",
        title: "Mantenimiento Preventivo",
        triggerType: "MILEAGE",
        triggerValue: (initialMileage + 6000).toString(),
        lastPerformedValue: initialMileage.toString(),
      });

      // 3. Brake pads check in 10,000 km
      await api.post("alerts", {
        vehicleId: bikeId,
        type: "BRAKE_PADS",
        title: "Pastillas de Freno",
        triggerType: "MILEAGE",
        triggerValue: (initialMileage + 10000).toString(),
        lastPerformedValue: initialMileage.toString(),
      });

      // 4. Insurance renewal in 1 year
      const nextYear = new Date();
      nextYear.setFullYear(nextYear.getFullYear() + 1);
      await api.post("alerts", {
        vehicleId: bikeId,
        type: "INSURANCE_RENEWAL",
        title: "Renovación de Seguro",
        triggerType: "DATE",
        triggerValue: nextYear.toISOString(),
        lastPerformedValue: todayStr,
      });

      showAlert(
        "¡Motor Encendido!",
        "Tu vehículo y alertas iniciales han sido registrados con éxito.",
      );
      fetchData();

      // Clear form inputs
      setModel("");
      setCustomBrand("");
      setBrand("Honda");
      setCurrentMileage("");
    } catch (e: any) {
      console.error(e);
      showAlert(
        "Error",
        e.response?.data?.error || "No se pudo registrar la moto",
      );
    } finally {
      setRegistering(false);
    }
  };

  const handleSwitchVehicle = async (id: string) => {
    setLoading(true);
    setIsGarageOpen(false);
    try {
      await api.put(`vehicles/${id}/active`);
      await fetchData();
    } catch (e) {
      console.error("Error switching active vehicle:", e);
      showAlert("Error", "No se pudo activar la motocicleta");
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteVehicle = (id: string, name: string) => {
    setIsGarageOpen(false);
    showAlert(
      "Eliminar Motocicleta",
      `¿Estás seguro de que deseas eliminar la motocicleta ${name} de tu garaje? Se borrarán también todos sus registros e historial. Esta acción no se puede deshacer.`,
      [
        { 
          text: "Cancelar", 
          style: "cancel",
          onPress: () => {
            setIsGarageOpen(true);
          }
        },
        { 
          text: "Eliminar", 
          style: "destructive", 
          onPress: () => performDeleteVehicle(id) 
        },
      ],
      "warning"
    );
  };

  const performDeleteVehicle = async (id: string) => {
    setLoading(true);
    setIsGarageOpen(false);
    try {
      await api.delete(`vehicles/${id}`);
      
      const updatedVehicles = vehicles.filter(v => v.id !== id);
      setVehicles(updatedVehicles);

      if (vehicle?.id === id) {
        if (updatedVehicles.length > 0) {
          await api.put(`vehicles/${updatedVehicles[0].id}/active`);
          await fetchData();
        } else {
          setVehicle(null);
          setIsRegisteringNew(true);
        }
      } else {
        await fetchData();
      }
      
      showAlert("Eliminado", "La motocicleta ha sido eliminada de tu garaje.");
    } catch (e) {
      console.error("Error deleting vehicle:", e);
      showAlert("Error", "No se pudo eliminar la motocicleta.");
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    showAlert(
      "Cerrar Sesión",
      "¿Estás seguro de que quieres apagar el motor y salir?",
      [
        { text: "Cancelar", style: "cancel" },
        { text: "Salir", style: "destructive", onPress: () => signOut() },
      ],
    );
  };

  const handleSaveMaintenance = async () => {
    if (!vehicle || !selectedAlert) return;
    if (!triggerValue || !lastPerformedValue) {
      showAlert("Error", "Por favor completa todos los campos");
      return;
    }

    if (selectedAlert.triggerType === "MILEAGE") {
      const mileageVal = parseInt(triggerValue);
      const lastVal = parseInt(lastPerformedValue);
      if (isNaN(mileageVal) || mileageVal <= 0 || isNaN(lastVal) || lastVal < 0) {
        showAlert("Error", "Los valores del odómetro deben ser números positivos");
        return;
      }
      if (mileageVal <= lastVal) {
        showAlert("Error", "El odómetro objetivo debe ser mayor que el del último mantenimiento");
        return;
      }
    } else {
      const dateVal = Date.parse(triggerValue);
      const lastDateVal = Date.parse(lastPerformedValue);
      if (isNaN(dateVal) || isNaN(lastDateVal)) {
        showAlert("Error", "Ingresa fechas válidas (Formato YYYY-MM-DD)");
        return;
      }
      if (dateVal <= lastDateVal) {
        showAlert("Error", "La fecha de expiración debe ser posterior a la del último mantenimiento");
        return;
      }
    }

    setSavingMaintenance(true);
    try {
      const payload = {
        lastPerformedValue,
        triggerValue,
        isCompleted: false, // reset back to active
      };
      await api.put(`alerts/${selectedAlert.id}`, payload);
      showAlert("Mantenimiento Registrado", "Se ha actualizado el ciclo del recordatorio.");
      setMaintenanceModalVisible(false);
      fetchData();
    } catch (e: any) {
      console.error(e);
      showAlert("Error", e.response?.data?.error || "No se pudo registrar el mantenimiento");
    } finally {
      setSavingMaintenance(false);
    }
  };

  const activeBmwColor =
    theme === "light" ? colors.bmwBlue : colors.bmwLightBlue;

  const tftStyles = {
    bezelBg: theme === "light" ? "#FFFFFF" : "#0F1216",
    bezelBorder: theme === "light" ? "#D8E0EB" : "#242D3D",
    screenBg: theme === "light" ? "#EBF0F5" : "#050709",
    screenBorder: theme === "light" ? "#D8E0EB" : "#171B22",
    headerBorder: theme === "light" ? "#D8E0EB" : "rgba(255,255,255,0.08)",
    headerText: theme === "light" ? "#1C69D4" : "#00A3E0",
    timeText: theme === "light" ? "#4E5E72" : "#8E9FBC",
    speedText: theme === "light" ? "#002C5B" : "#FFFFFF",
    speedUnit: theme === "light" ? "#4E5E72" : "#8E9FBC",
    gearBg: "rgba(52, 199, 89, 0.12)",
    gearText: "#34C759",
    gearLabel: theme === "light" ? "#4E5E72" : "#8E9FBC",
    odoTitle: theme === "light" ? "#4E5E72" : "#8E9FBC",
    odoBg: theme === "light" ? "#D8E0EB" : "#0A0D12",
    odoBorder: theme === "light" ? "#CBD5E0" : "#171B22",
    odoBgDigits: theme === "light" ? "rgba(0, 0, 0, 0.06)" : "rgba(255, 255, 255, 0.04)",
    odoText: theme === "light" ? "#1C69D4" : "#00E5FF",
    odoShadow: theme === "light" ? "rgba(28, 105, 212, 0.3)" : "rgba(0, 229, 255, 0.6)",
    odoUnit: theme === "light" ? "#1C69D4" : "#00E5FF",
    footerText: theme === "light" ? "#002C5B" : "#FFFFFF",
    footerSecText: theme === "light" ? "#4E5E72" : "#8E9FBC",
    statusLed: "#34C759",
    rpmLedEmptyBg: theme === "light" ? "#D8E0EB" : "#EBF0F5",
    rpmLedEmptyOpacity: theme === "light" ? 0.6 : 0.1,
  };

  if (loading) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: colors.isDark ? "#0A0D12" : "#F4F5F7",
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <ActivityIndicator size="large" color={activeBmwColor} />
      </View>
    );
  }

  return (
    <SafeAreaView className={`flex-1 ${colors.bg}`}>
      {/* Custom App Header with Garage Toggle */}
      <View
        className="flex-row justify-between items-center px-6 py-4"
        style={{
          borderBottomWidth: 1,
          borderBottomColor: theme === "light" ? "#D8E0EB" : "#242D3D",
        }}
      >
        <TouchableOpacity
          onPress={() => {
            if (vehicles.length > 0) setIsGarageOpen(true);
          }}
          className="flex-row items-center"
          disabled={vehicles.length === 0}
        >
          <View
            className="w-8 h-8 rounded-full bg-[#1C69D4] items-center justify-center mr-2"
            style={{
              shadowColor: "#1C69D4",
              shadowOffset: { width: 0, height: 0 },
              shadowOpacity: 0.8,
              shadowRadius: 8,
              elevation: 4,
            }}
          >
            <Text className="text-white font-bold text-base">M</Text>
          </View>
          <View>
            <Text
              className={`font-rajdhani-bold text-base font-bold tracking-[3px] leading-none ${colors.text}`}
            >
              MOTO
              <Text
                className={
                  theme === "light" ? "text-[#1C69D4]" : "text-[#00A3E0]"
                }
              >
                PULSE
              </Text>
            </Text>
            {vehicle && (
              <View className="flex-row items-center mt-0.5">
                <Text
                  className={`${theme === "light" ? "text-[#1C69D4]" : "text-[#00A3E0]"} font-barlow-condensed-bold text-xs font-bold uppercase tracking-wider mr-1`}
                >
                  {vehicle.brand} {vehicle.model}
                </Text>
                <ChevronDown size={12} color={activeBmwColor} />
              </View>
            )}
          </View>
        </TouchableOpacity>

        <View className="flex-row items-center">
          <TouchableOpacity
            onPress={toggleTheme}
            className={`p-2 ${colors.card} mr-2`}
            style={{
              borderWidth: 1,
              borderColor: theme === "light" ? "#D8E0EB" : "#242D3D",
              borderRadius: 20,
            }}
          >
            {theme === "light" ? (
              <Moon size={16} color={colors.bmwBlue} />
            ) : (
              <Sun size={16} color={colors.bmwLightBlue} />
            )}
          </TouchableOpacity>
          {vehicle && (
            <TouchableOpacity
              onPress={() => setIsRegisteringNew(true)}
              className={`p-2 ${colors.card} mr-2`}
              style={{
                borderWidth: 1,
                borderColor: theme === "light" ? "#D8E0EB" : "#242D3D",
                borderRadius: 20,
              }}
            >
              <Plus size={16} color={activeBmwColor} />
            </TouchableOpacity>
          )}
          <TouchableOpacity
            onPress={handleLogout}
            className={`p-2 ${colors.card}`}
            style={{
              borderWidth: 1,
              borderColor: theme === "light" ? "#D8E0EB" : "#242D3D",
              borderRadius: 20,
            }}
          >
            <LogOut size={16} color={colors.bmwRed} />
          </TouchableOpacity>
        </View>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        className="flex-1"
      >
        <ScrollView
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent:
              (!vehicle || isRegisteringNew) && !keyboardVisible
                ? "center"
                : "flex-start",
            padding: 24,
            paddingBottom: keyboardVisible ? 80 : 60,
          }}
          className="flex-1"
          keyboardShouldPersistTaps="handled"
        >
          {vehicle && !isRegisteringNew ? (
            // Active Dashboard View
            <View className="pb-10">
              {/* MotoPulse Sport TFT Digital Instrument Cluster */}
              <View
                style={{
                  backgroundColor: tftStyles.bezelBg,
                  borderRadius: 24,
                  borderWidth: 2,
                  borderColor: tftStyles.bezelBorder,
                  padding: 16,
                  marginBottom: 24,
                }}
              >
                <View style={{ height: 4, borderRadius: 2, backgroundColor: tftStyles.headerText, marginBottom: 12 }} />

                <View
                  style={{
                    backgroundColor: tftStyles.screenBg,
                    borderRadius: 18,
                    borderWidth: 1,
                    borderColor: tftStyles.screenBorder,
                    padding: 16,
                    overflow: 'hidden',
                  }}
                >
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, borderBottomWidth: 1, borderBottomColor: tftStyles.headerBorder, paddingBottom: 8 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: tftStyles.statusLed }} />
                      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: tftStyles.statusLed }} />
                      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: tftStyles.statusLed }} />
                      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: tftStyles.rpmLedEmptyBg, opacity: tftStyles.rpmLedEmptyOpacity }} />
                      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: tftStyles.rpmLedEmptyBg, opacity: tftStyles.rpmLedEmptyOpacity }} />
                      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#FF1E27', opacity: 0.1 }} />
                    </View>

                    <Text style={{ fontFamily: 'Orbitron-Bold', fontSize: 10, color: tftStyles.headerText, letterSpacing: 1 }}>
                      MOTO PULSE
                    </Text>

                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      <Text style={{ 
                        fontFamily: 'Orbitron-Bold', 
                        fontSize: 12, 
                        color: '#10B981', 
                        fontWeight: 'bold',
                        textShadowColor: '#10B981',
                        textShadowOffset: { width: 0, height: 0 },
                        textShadowRadius: 6,
                      }}>
                        ←
                      </Text>
                      <Text style={{ 
                        fontFamily: 'Orbitron-Bold', 
                        fontSize: 12, 
                        color: '#10B981', 
                        fontWeight: 'bold',
                        textShadowColor: '#10B981',
                        textShadowOffset: { width: 0, height: 0 },
                        textShadowRadius: 6,
                      }}>
                        →
                      </Text>
                    </View>
                  </View>

                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
                        <Text style={{ fontFamily: 'Orbitron-Bold', fontSize: 44, color: tftStyles.speedText, lineHeight: 48 }}>
                          0
                        </Text>
                        <Text style={{ fontFamily: 'Orbitron-Bold', fontSize: 10, color: tftStyles.speedUnit, marginLeft: 4, textTransform: 'uppercase' }}>
                          km/h
                        </Text>
                      </View>
                      
                      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                        <View style={{ 
                          width: 24, 
                          height: 24, 
                          borderRadius: 6, 
                          backgroundColor: tftStyles.gearBg, 
                          borderWidth: 1, 
                          borderColor: tftStyles.statusLed,
                          alignItems: 'center',
                          justifyContent: 'center'
                        }}>
                          <Text style={{ fontFamily: 'Orbitron-Bold', fontSize: 12, color: tftStyles.gearText }}>
                            N
                          </Text>
                        </View>
                        <Text style={{ fontFamily: 'Barlow-SemiBold', fontSize: 11, color: tftStyles.gearLabel, marginLeft: 6 }}>
                          NEUTRAL
                        </Text>
                      </View>
                    </View>

                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={{ fontFamily: 'Orbitron-Bold', fontSize: 9, color: tftStyles.odoText, letterSpacing: 1, marginBottom: 4, textTransform: 'uppercase' }}>
                        ODÓMETRO TOTAL
                      </Text>
                      
                      <TouchableOpacity 
                        onPress={openEditOdoModal}
                        activeOpacity={0.7}
                        style={{ 
                          backgroundColor: tftStyles.odoBg, 
                          borderRadius: 12, 
                          borderWidth: 1.5, 
                          borderColor: theme === 'light' ? 'rgba(28, 105, 212, 0.4)' : 'rgba(0, 229, 255, 0.4)',
                          paddingVertical: 6, 
                          paddingHorizontal: 12,
                          position: 'relative',
                          justifyContent: 'center',
                          alignItems: 'center',
                          minWidth: 140,
                          shadowColor: tftStyles.odoText,
                          shadowOffset: { width: 0, height: 0 },
                          shadowOpacity: 0.15,
                          shadowRadius: 4,
                          elevation: 2
                        }}
                      >
                        <Text
                          style={{
                            fontFamily: 'Orbitron-Bold',
                            fontSize: 22,
                            color: theme === 'light' ? 'rgba(28, 105, 212, 0.05)' : 'rgba(0, 229, 255, 0.05)',
                            letterSpacing: 2,
                          }}
                        >
                          888888
                        </Text>

                        <Text
                          style={{
                            position: 'absolute',
                            fontFamily: 'Orbitron-Bold',
                            fontSize: 22,
                            color: tftStyles.odoText,
                            letterSpacing: 2,
                            textShadowColor: theme === 'light' ? 'rgba(28, 105, 212, 0.8)' : 'rgba(0, 229, 255, 0.8)',
                            textShadowOffset: { width: 0, height: 0 },
                            textShadowRadius: 8,
                          }}
                        >
                          {String(vehicle.currentMileage).padStart(6, '0')}
                        </Text>
                      </TouchableOpacity>

                      <Text style={{ fontFamily: 'Orbitron-Bold', fontSize: 8, color: '#8F9CAE', marginTop: 4, letterSpacing: 0.5 }}>
                        TOCA PARA EDITAR
                      </Text>
                    </View>
                  </View>

                  <View style={{ 
                    flexDirection: 'row', 
                    justifyContent: 'space-between', 
                    alignItems: 'center', 
                    marginTop: 16, 
                    borderTopWidth: 1, 
                    borderTopColor: tftStyles.headerBorder, 
                    paddingTop: 10 
                  }}>
                    <Text style={{ fontFamily: 'Barlow-Bold', fontSize: 10, color: tftStyles.footerText, textTransform: 'uppercase' }}>
                      {vehicle.brand} {vehicle.model}
                    </Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <Text style={{ fontFamily: 'Barlow-SemiBold', fontSize: 10, color: tftStyles.footerSecText, marginRight: 6 }}>
                        SYS OK
                      </Text>
                      <View style={{ 
                        width: 8, 
                        height: 8, 
                        borderRadius: 4, 
                        backgroundColor: tftStyles.statusLed,
                        shadowColor: tftStyles.statusLed,
                        shadowOffset: { width: 0, height: 0 },
                        shadowOpacity: 0.8,
                        shadowRadius: 4,
                        elevation: 2
                      }} />
                    </View>
                  </View>

                </View>
              </View>

              {/* Ficha Técnica specs grid populated dynamically by Gemini */}
              <Text
                style={{ color: theme === 'light' ? '#4E5E72' : '#E2E8F0' }}
                className="font-rajdhani-bold text-xs font-bold uppercase tracking-[2px] mb-4"
              >
                FICHA TÉCNICA (ESPECIFICACIONES)
              </Text>

              <View
                className="p-5 mb-6"
                style={{
                  backgroundColor: theme === "light" ? "#FFFFFF" : "#121620",
                  borderRadius: 20,
                  borderWidth: 1,
                  borderColor: theme === "light" ? "#D8E0EB" : "#242D3D",
                }}
              >
                {vehicle.imageUrl && !fetchingSpecs && (
                  <View 
                    style={{ 
                      height: 160, 
                      width: '100%', 
                      borderRadius: 12, 
                      overflow: 'hidden', 
                      marginBottom: 16,
                      borderWidth: 1,
                      borderColor: theme === 'light' ? '#D8E0EB' : '#242D3D'
                    }}
                  >
                    <Image
                      source={{ uri: vehicle.imageUrl }}
                      style={{ width: '100%', height: '100%' }}
                      resizeMode="cover"
                    />
                  </View>
                )}

                {fetchingSpecs ? (
                  <View
                    className="py-4 items-center justify-center mb-4"
                    style={{
                      borderBottomWidth: 1,
                      borderBottomColor: theme === "light" ? "#D8E0EB" : "#242D3D",
                    }}
                  >
                    <ActivityIndicator size="small" color={activeBmwColor} />
                    <Text
                      style={{ color: theme === 'light' ? '#4E5E72' : '#E2E8F0' }}
                      className="text-[10px] font-semibold mt-2 tracking-wider uppercase"
                    >
                      Buscando ficha técnica en la web con AI...
                    </Text>
                  </View>
                ) : !vehicle.specSource ? (
                  <View
                    className="border border-dashed rounded-xl p-4 mb-4 items-center justify-center"
                    style={{ borderColor: theme === "light" ? "#D8E0EB" : "#242D3D" }}
                  >
                    <Text
                      style={{ color: theme === 'light' ? '#4E5E72' : '#E2E8F0' }}
                      className="text-xs text-center mb-3 leading-normal font-sans"
                    >
                      Ficha técnica vacía. Puedes buscar sus especificaciones
                      técnicas reales en la web utilizando Inteligencia
                      Artificial, o ingresarlas tú mismo.
                    </Text>
                    <View className="flex-row flex-wrap justify-center gap-2">
                      <TouchableOpacity
                        onPress={handleFetchSpecs}
                        className="bg-[#1C69D4] px-4 py-2.5 rounded-xl flex-row items-center mr-2"
                        style={{
                          shadowColor: "#1C69D4",
                          shadowOffset: { width: 0, height: 2 },
                          shadowOpacity: 0.5,
                          shadowRadius: 6,
                          elevation: 3,
                        }}
                      >
                        <Text className="text-white text-xs font-bold uppercase tracking-wider">
                          Buscar con AI
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={openEditSpecsModal}
                        className="bg-neutral-500/10 border border-neutral-400/30 px-4 py-2.5 rounded-xl flex-row items-center"
                      >
                        <Pencil size={12} color={theme === 'light' ? '#1C69D4' : '#00A3E0'} style={{ marginRight: 4 }} />
                        <Text className="text-xs font-bold uppercase tracking-wider ml-1" style={{ color: theme === 'light' ? '#1C69D4' : '#00A3E0' }}>
                          Ingresar Datos
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : (
                  <View
                    className="mb-4 pb-3"
                    style={{
                      borderBottomWidth: 1,
                      borderBottomColor: theme === "light" ? "#D8E0EB" : "#242D3D",
                    }}
                  >
                    <View className="flex-row justify-between items-center mb-1.5">
                      <View className="flex-row items-center">
                        <ShieldCheck size={16} color={colors.statusGreen} />
                        <Text
                          style={{ color: theme === 'light' ? '#002C5B' : '#FFFFFF' }}
                          className="text-xs font-bold uppercase ml-1.5 tracking-wider"
                        >
                          {vehicle.specSource === 'Manual' ? 'Datos Manuales' : 'Datos de Internet'}
                        </Text>
                      </View>
                      <TouchableOpacity
                        onPress={openEditSpecsModal}
                        className="px-2 py-1 bg-neutral-500/10 rounded-lg flex-row items-center"
                      >
                        <Pencil size={10} color={theme === 'light' ? '#1C69D4' : '#00A3E0'} />
                        <Text className="text-[9px] font-bold uppercase ml-1" style={{ color: theme === 'light' ? '#1C69D4' : '#00A3E0' }}>Editar</Text>
                      </TouchableOpacity>
                    </View>
                    <Text className="text-[9px] text-neutral-500 uppercase tracking-widest mt-1">
                      Fuente: {vehicle.specSource}
                    </Text>
                  </View>
                )}

                <View className="flex-row flex-wrap">
                  <View className="w-1/2 pr-2 mb-3.5">
                    <Text
                      style={{ color: theme === 'light' ? '#8E9FBC' : '#A0AEC0' }}
                      className="font-barlow-condensed-bold text-[10px] uppercase font-bold tracking-wider mb-0.5"
                    >
                      Motor / Cilindrada
                    </Text>
                    <Text
                      style={{ color: theme === 'light' ? '#002C5B' : '#FFFFFF' }}
                      className="font-rajdhani-semibold text-base font-semibold"
                    >
                      {vehicle.engineCc || "No disponible"}
                    </Text>
                  </View>
                  <View className="w-1/2 pl-2 mb-3.5">
                    <Text
                      style={{ color: theme === 'light' ? '#8E9FBC' : '#A0AEC0' }}
                      className="font-barlow-condensed-bold text-[10px] uppercase font-bold tracking-wider mb-0.5"
                    >
                      Depósito
                    </Text>
                    <Text
                      style={{ color: theme === 'light' ? '#002C5B' : '#FFFFFF' }}
                      className="font-rajdhani-semibold text-base font-semibold"
                    >
                      {vehicle.tankSize || "No disponible"}
                    </Text>
                  </View>

                  <View className="w-1/2 pr-2 mb-3.5">
                    <Text
                      style={{ color: theme === 'light' ? '#8E9FBC' : '#A0AEC0' }}
                      className="font-barlow-condensed-bold text-[10px] uppercase font-bold tracking-wider mb-0.5"
                    >
                      Potencia
                    </Text>
                    <Text
                      style={{ color: theme === 'light' ? '#002C5B' : '#FFFFFF' }}
                      className="font-rajdhani-semibold text-base font-semibold"
                    >
                      {vehicle.power || "No disponible"}
                    </Text>
                  </View>
                  <View className="w-1/2 pl-2 mb-3.5">
                    <Text
                      style={{ color: theme === 'light' ? '#8E9FBC' : '#A0AEC0' }}
                      className="font-barlow-condensed-bold text-[10px] uppercase font-bold tracking-wider mb-0.5"
                    >
                      Torque
                    </Text>
                    <Text
                      style={{ color: theme === 'light' ? '#002C5B' : '#FFFFFF' }}
                      className="font-rajdhani-semibold text-base font-semibold"
                    >
                      {vehicle.torque || "No disponible"}
                    </Text>
                  </View>

                  <View className="w-1/2 pr-2 mb-3.5">
                    <Text
                      style={{ color: theme === 'light' ? '#8E9FBC' : '#A0AEC0' }}
                      className="font-barlow-condensed-bold text-[10px] uppercase font-bold tracking-wider mb-0.5"
                    >
                      Transmisión
                    </Text>
                    <Text
                      style={{ color: theme === 'light' ? '#002C5B' : '#FFFFFF' }}
                      className="font-rajdhani-semibold text-base font-semibold"
                    >
                      {vehicle.transmission || "No disponible"}
                    </Text>
                  </View>
                  <View className="w-1/2 pl-2 mb-3.5">
                    <Text
                      style={{ color: theme === 'light' ? '#8E9FBC' : '#A0AEC0' }}
                      className="font-barlow-condensed-bold text-[10px] uppercase font-bold tracking-wider mb-0.5"
                    >
                      Peso
                    </Text>
                    <Text
                      style={{ color: theme === 'light' ? '#002C5B' : '#FFFFFF' }}
                      className="font-rajdhani-semibold text-base font-semibold"
                    >
                      {vehicle.weight || "No disponible"}
                    </Text>
                  </View>

                  <View
                    className="w-full pt-3 mt-1.5 mb-3.5"
                    style={{
                      borderTopWidth: 1,
                      borderTopColor: theme === "light" ? "#D8E0EB" : "#242D3D",
                    }}
                  >
                    <Text
                      style={{ color: theme === 'light' ? '#8E9FBC' : '#A0AEC0' }}
                      className="font-barlow-condensed-bold text-[10px] uppercase font-bold tracking-wider mb-1"
                    >
                      Neumáticos (Del / Tras)
                    </Text>
                    <Text
                      style={{ color: theme === 'light' ? '#002C5B' : '#FFFFFF' }}
                      className="font-rajdhani-semibold text-base font-semibold"
                    >
                      {vehicle.frontTire || "No disp."} /{" "}
                      {vehicle.rearTire || "No disp."}
                    </Text>
                  </View>

                  <View className="w-full mb-3.5">
                    <Text
                      style={{ color: theme === 'light' ? '#8E9FBC' : '#A0AEC0' }}
                      className="font-barlow-condensed-bold text-[10px] uppercase font-bold tracking-wider mb-1"
                    >
                      Freno Delantero
                    </Text>
                    <Text
                      style={{ color: theme === 'light' ? '#002C5B' : '#FFFFFF' }}
                      className="font-rajdhani-semibold text-base font-semibold"
                    >
                      {vehicle.frontBrake || "No disponible"}
                    </Text>
                  </View>
                  <View className="w-full mb-3.5">
                    <Text
                      style={{ color: theme === 'light' ? '#8E9FBC' : '#A0AEC0' }}
                      className="font-barlow-condensed-bold text-[10px] uppercase font-bold tracking-wider mb-1"
                    >
                      Freno Trasero
                    </Text>
                    <Text
                      style={{ color: theme === 'light' ? '#002C5B' : '#FFFFFF' }}
                      className="font-rajdhani-semibold text-base font-semibold"
                    >
                      {vehicle.rearBrake || "No disponible"}
                    </Text>
                  </View>

                  <View className="w-full mb-3.5">
                    <Text
                      style={{ color: theme === 'light' ? '#8E9FBC' : '#A0AEC0' }}
                      className="font-barlow-condensed-bold text-[10px] uppercase font-bold tracking-wider mb-1"
                    >
                      Suspensión Delantera
                    </Text>
                    <Text
                      style={{ color: theme === 'light' ? '#002C5B' : '#FFFFFF' }}
                      className="font-rajdhani-semibold text-base font-semibold"
                    >
                      {vehicle.frontSuspension || "No disponible"}
                    </Text>
                  </View>
                  <View className="w-full">
                    <Text
                      style={{ color: theme === 'light' ? '#8E9FBC' : '#A0AEC0' }}
                      className="font-barlow-condensed-bold text-[10px] uppercase font-bold tracking-wider mb-1"
                    >
                      Suspensión Trasera
                    </Text>
                    <Text
                      style={{ color: theme === 'light' ? '#002C5B' : '#FFFFFF' }}
                      className="font-rajdhani-semibold text-base font-semibold"
                    >
                      {vehicle.rearSuspension || "No disponible"}
                    </Text>
                  </View>
                </View>
              </View>

              {/* Dashboard Subtitle */}
              <Text
                className={`${colors.textSec} font-rajdhani-bold text-xs font-bold uppercase tracking-[2px] mb-4`}
              >
                ESTADO DEL VEHÍCULO (RPM HEALTH)
              </Text>

              {/* Tachometer Alert Bars */}
              {alerts.length > 0 ? (
                alerts.map((alert) => (
                  <TachometerGauge
                    key={alert.id}
                    label={alert.title}
                    value={vehicle.currentMileage}
                    target={
                      alert.triggerType === "MILEAGE"
                        ? parseInt(alert.triggerValue)
                        : (alert.triggerValue as any)
                    }
                    lastPerformedValue={alert.lastPerformedValue}
                    type={alert.triggerType}
                    onPress={alert.isCompleted ? undefined : () => {
                      setSelectedAlert(alert);
                      
                      if (alert.triggerType === "MILEAGE") {
                        const currentOdo = vehicle.currentMileage;
                        setLastPerformedValue(currentOdo.toString());
                        
                        // Calculate interval
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
                        
                        // Default 1 year interval
                        const nextYear = new Date();
                        nextYear.setFullYear(nextYear.getFullYear() + 1);
                        setTriggerValue(nextYear.toISOString().split('T')[0]);
                      }
                      setMaintenanceModalVisible(true);
                    }}
                  />
                ))
              ) : (
                <View
                  className={`${colors.card} border ${colors.border} rounded-xl p-6 items-center`}
                >
                  <CheckCircle2 size={32} color={colors.statusGreen} />
                  <Text
                    className={`${colors.text} text-center mt-2 font-medium`}
                  >
                    No hay alertas configuradas
                  </Text>
                  <Text
                    className={`${colors.textSec} text-center text-xs mt-1`}
                  >
                    Configura alertas en la pestaña correspondiente.
                  </Text>
                </View>
              )}
            </View>
          ) : (
            // Register Vehicle View
            <View className="pb-10 justify-center">
              <View className="items-center mb-6">
                <AlertTriangle
                  size={48}
                  color={colors.bmwRed}
                  className="animate-pulse"
                />
                <Text
                  className={`${colors.text} font-barlow-bold text-xl font-bold mt-2 text-center`}
                >
                  REGISTRA TU MOTO
                </Text>
                <Text className={`${colors.textSec} text-xs text-center mt-1`}>
                  Ingresa los datos del vehículo para activar el tablero digital
                </Text>
              </View>

              <View
                className={`${colors.card} p-6`}
                style={{
                  borderRadius: 20,
                  borderWidth: 1,
                  borderColor: theme === 'light' ? '#D8E0EB' : '#242D3D',
                }}
              >
                {/* Brand Picker Dropdown */}
                <View className="mb-4 relative" style={{ zIndex: 10 }}>
                  <Text
                    className={`${colors.textSec} text-xs uppercase mb-1.5 font-medium tracking-wide`}
                  >
                    Marca de la Moto
                  </Text>
                  <TouchableOpacity
                    onPress={() => setIsBrandDropdownOpen(!isBrandDropdownOpen)}
                    className={`flex-row justify-between items-center w-full ${colors.subCard} ${colors.text} ${colors.isDark ? "border " + colors.border : ""} rounded-xl px-4 py-3`}
                  >
                    <Text className={`${colors.text} font-semibold`}>
                      {brand}
                    </Text>
                    <ChevronDown size={18} color={activeBmwColor} />
                  </TouchableOpacity>

                  {/* Dropdown Options List */}
                  {isBrandDropdownOpen && (
                    <View
                      className={`mt-2 border ${colors.border} rounded-xl max-h-52 overflow-hidden`}
                      style={{
                        backgroundColor:
                          theme === "light" ? "#FFFFFF" : "#121620",
                      }}
                    >
                      <ScrollView nestedScrollEnabled={true}>
                        {POPULAR_BRANDS.map((item) => (
                          <TouchableOpacity
                            key={item}
                            onPress={() => {
                              setBrand(item);
                              setIsBrandDropdownOpen(false);
                            }}
                            className={`px-4 py-3 border-b ${colors.border} active:${colors.subCard}`}
                          >
                            <Text className={`${colors.text} font-medium`}>
                              {item}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </ScrollView>
                    </View>
                  )}
                </View>

                {/* Custom Manual Brand Entry (if "Otro" selected) */}
                {brand === "Otro / Manual" && (
                  <View className="mb-4">
                    <Text
                      className={`${colors.textSec} text-xs uppercase mb-1.5 font-medium tracking-wide`}
                    >
                      Escribe la Marca Personalizada
                    </Text>
                    <TextInput
                      value={customBrand}
                      placeholder="Ej. Vespa, Bajaj, Vento, etc."
                      placeholderTextColor={
                        theme === "light" ? "#8E9FBC" : "#556070"
                      }
                      onChangeText={setCustomBrand}
                      className={`w-full ${colors.subCard} ${colors.text} ${colors.isDark ? "border " + colors.border : ""} rounded-xl px-4 py-3 text-sm`}
                    />
                  </View>
                )}

                {/* Model */}
                <View className="mb-4">
                  <Text
                    className={`${colors.textSec} text-xs uppercase mb-1.5 font-medium tracking-wide`}
                  >
                    Modelo
                  </Text>
                  <TextInput
                    value={model}
                    placeholder="Ej. MT-09, Duke 390, CB300F"
                    placeholderTextColor={
                      theme === "light" ? "#8E9FBC" : "#556070"
                    }
                    onChangeText={setModel}
                    className={`w-full ${colors.subCard} ${colors.text} ${colors.isDark ? "border " + colors.border : ""} rounded-xl px-4 py-3 text-sm`}
                  />
                </View>

                {/* Year & Mileage Row */}
                <View className="mb-4 flex-row">
                  <View className="flex-1 mr-2">
                    <Text
                      className={`${colors.textSec} text-xs uppercase mb-1.5 font-medium tracking-wide`}
                    >
                      Año
                    </Text>
                    <TextInput
                      value={year}
                      placeholder="Ej. 2024"
                      placeholderTextColor={
                        theme === "light" ? "#8E9FBC" : "#556070"
                      }
                      keyboardType="numeric"
                      onChangeText={setYear}
                      className={`w-full ${colors.subCard} ${colors.text} ${colors.isDark ? "border " + colors.border : ""} rounded-xl px-4 py-3 text-sm`}
                    />
                  </View>

                  {/* Mileage */}
                  <View className="flex-1 ml-2">
                    <Text
                      className={`${colors.textSec} text-xs uppercase mb-1.5 font-medium tracking-wide`}
                    >
                      Kilometraje Actual
                    </Text>
                    <TextInput
                      value={currentMileage}
                      placeholder="Ej. 8500"
                      placeholderTextColor={
                        theme === "light" ? "#8E9FBC" : "#556070"
                      }
                      keyboardType="numeric"
                      onChangeText={setCurrentMileage}
                      className={`w-full ${colors.subCard} ${colors.text} ${colors.isDark ? "border " + colors.border : ""} rounded-xl px-4 py-3 text-sm`}
                    />
                  </View>
                </View>

                <TouchableOpacity
                  onPress={handleRegisterVehicle}
                  disabled={registering}
                  className="w-full bg-[#1C69D4] rounded-xl py-3.5 items-center justify-center border border-[#1C69D4] mt-2"
                  style={{
                    shadowColor: "#1C69D4",
                    shadowOffset: { width: 0, height: 0 },
                    shadowOpacity: 0.4,
                    shadowRadius: 12,
                    elevation: 4,
                  }}
                >
                  {registering ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <Text className="text-white font-bold text-sm uppercase tracking-widest">
                      REGISTRAR MOTO
                    </Text>
                  )}
                </TouchableOpacity>

                {vehicle && (
                  <TouchableOpacity
                    onPress={() => setIsRegisteringNew(false)}
                    className="w-full mt-4 py-2 items-center justify-center"
                  >
                    <Text
                      className={`${colors.textSec} text-xs uppercase font-bold tracking-wider`}
                    >
                      Cancelar y Volver
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Garage Selector Modal */}
      <Modal
        visible={isGarageOpen}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setIsGarageOpen(false)}
      >
        <View className="flex-1 bg-black/60 justify-end">
          <View
            className={`${colors.card} border-t ${colors.border} rounded-t-3xl`}
            style={{
              paddingLeft: 24,
              paddingRight: 24,
              paddingTop: 24,
              paddingBottom: insets.bottom > 0 ? insets.bottom + 12 : 24,
              height: '60%',
              shadowColor: "#000",
              shadowOffset: { width: 0, height: -10 },
              shadowOpacity: theme === "light" ? 0.05 : 0.4,
              shadowRadius: 15,
              elevation: 8,
            }}
          >
            <View className="flex-row justify-between items-center mb-6">
              <Text
                className={`${colors.text} font-barlow-bold text-base font-bold uppercase tracking-wider`}
              >
                MI GARAJE
              </Text>
              <TouchableOpacity
                onPress={() => setIsGarageOpen(false)}
                className="p-1"
              >
                <X
                  size={24}
                  color={theme === "light" ? "#002C5B" : "#F8F9FA"}
                />
              </TouchableOpacity>
            </View>

            <ScrollView className="flex-1 mb-6">
              {vehicles.map((item) => {
                const isActive = item.id === vehicle?.id;
                return (
                  <View
                    key={item.id}
                    className={`p-4 rounded-xl border mb-3 flex-row justify-between items-center ${
                      isActive
                        ? `${colors.subCard} ${colors.borderAccent}`
                        : `${colors.card} ${colors.border}`
                    }`}
                  >
                    <TouchableOpacity
                      onPress={() => handleSwitchVehicle(item.id)}
                      className="flex-1"
                    >
                      <Text className={`${colors.text} font-bold text-base`}>
                        {item.brand} {item.model}
                      </Text>
                      <Text className={`${colors.textSec} text-xs mt-0.5`}>
                        Año: {item.year} | Odómetro:{" "}
                        {item.currentMileage.toLocaleString()} km
                      </Text>
                    </TouchableOpacity>
                    
                    <View className="flex-row items-center">
                      <TouchableOpacity
                        onPress={() => handleSwitchVehicle(item.id)}
                        disabled={isActive}
                      >
                        {isActive ? (
                          <View
                            className={`${theme === "light" ? "bg-[#1C69D4]/10 border-[#1C69D4]" : "bg-[#00A3E0]/20 border-[#00A3E0]"} border rounded-full px-2.5 py-1 flex-row items-center`}
                          >
                            <View
                              className="w-1.5 h-1.5 rounded-full mr-1.5"
                              style={{
                                backgroundColor: activeBmwColor,
                                shadowColor: activeBmwColor,
                                shadowOffset: { width: 0, height: 0 },
                                shadowOpacity: 0.8,
                                shadowRadius: 6,
                                elevation: 3,
                              }}
                            />
                            <Text
                              className={`${theme === "light" ? "text-[#1C69D4]" : "text-[#00A3E0]"} text-xxs font-bold uppercase tracking-wider`}
                            >
                              Activa
                            </Text>
                          </View>
                        ) : (
                          <Text
                            className={`${colors.textAccent} text-xs font-bold uppercase tracking-wider px-2 py-1`}
                          >
                            Seleccionar
                          </Text>
                        )}
                      </TouchableOpacity>

                      <TouchableOpacity
                        onPress={() => handleDeleteVehicle(item.id, `${item.brand} ${item.model}`)}
                        className="p-2 ml-2"
                        style={{
                          backgroundColor: 'rgba(227, 6, 19, 0.06)',
                          borderRadius: 8,
                          borderWidth: 0.5,
                          borderColor: 'rgba(227, 6, 19, 0.2)',
                        }}
                      >
                        <Trash2 size={16} color={colors.bmwRed} />
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })}
            </ScrollView>

            <TouchableOpacity
              onPress={() => {
                setIsGarageOpen(false);
                setIsRegisteringNew(true);
              }}
              className="w-full bg-[#1C69D4] rounded-xl py-3.5 items-center justify-center border border-[#1C69D4]"
              style={{
                shadowColor: "#1C69D4",
                shadowOffset: { width: 0, height: 0 },
                shadowOpacity: 0.4,
                shadowRadius: 12,
                elevation: 4,
              }}
            >
              <Text className="text-white font-bold text-sm uppercase tracking-widest">
                + REGISTRAR NUEVA MOTO
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Quick Maintenance Resolve Modal */}
      <Modal
        visible={maintenanceModalVisible}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setMaintenanceModalVisible(false)}
        statusBarTranslucent={true}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'padding'}
          className="flex-1"
        >
          <View className="flex-1 bg-black/60 justify-end">
            <View
              className={`${colors.card} border-t ${colors.border} rounded-t-3xl`}
              style={{
                shadowColor: '#000',
                shadowOffset: { width: 0, height: -10 },
                shadowOpacity: theme === 'light' ? 0.05 : 0.4,
                shadowRadius: 15,
                elevation: 8,
                backgroundColor: theme === 'light' ? '#FFFFFF' : '#121620',
              }}
            >
              <ScrollView
                contentContainerStyle={{ padding: 24, paddingBottom: insets.bottom > 0 ? insets.bottom + 30 : 60 }}
                className="w-full"
                keyboardShouldPersistTaps="handled"
              >
                {/* Header */}
                <View className="flex-row justify-between items-center mb-6">
                  <Text className={`font-barlow-bold text-base font-bold uppercase tracking-wider ${colors.text}`}>
                    REGISTRAR MANTENIMIENTO
                  </Text>
                  <TouchableOpacity onPress={() => setMaintenanceModalVisible(false)} className="p-1">
                    <X size={24} color={theme === 'light' ? '#002C5B' : '#F8F9FA'} />
                  </TouchableOpacity>
                </View>

                {selectedAlert && (
                  <View className={`mb-4 ${colors.subCard} border ${colors.border} rounded-xl p-4`}>
                    <Text className={`${colors.textMuted} text-[10px] uppercase tracking-wider mb-1`}>Mantenimiento Activo</Text>
                    <Text className={`${colors.text} font-bold text-sm uppercase`}>{selectedAlert.title}</Text>
                    <Text className={`${colors.textSec} text-xs mt-1.5`}>Odómetro actual de la moto: <Text className="font-semibold">{vehicle?.currentMileage.toLocaleString()} km</Text></Text>
                  </View>
                )}

                {/* Last Performed Input */}
                <View className="mb-4">
                  <Text className={`${colors.textSec} text-xs uppercase mb-1.5 font-medium tracking-wide`}>
                    {selectedAlert?.triggerType === 'MILEAGE'
                      ? 'Último cambio / realizado (km)'
                      : 'Fecha del último cambio'}
                  </Text>
                  {selectedAlert?.triggerType === 'MILEAGE' ? (
                    <TextInput
                      value={lastPerformedValue}
                      placeholder={`Ej. ${vehicle?.currentMileage}`}
                      placeholderTextColor={theme === 'light' ? '#8E9FBC' : '#556070'}
                      keyboardType="numeric"
                      onChangeText={setLastPerformedValue}
                      className={`w-full ${colors.subCard} ${colors.text} border ${colors.border} rounded-xl px-4 py-3 text-sm focus:border-[#1C69D4]`}
                    />
                  ) : (
                    <TouchableOpacity
                      onPress={() => setShowLastPerformedDatePicker(true)}
                      className={`w-full ${colors.subCard} border ${colors.border} rounded-xl px-4 py-3 justify-center h-[48px]`}
                    >
                      <Text className={lastPerformedValue ? colors.text : colors.textMuted}>
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
                <View className="mb-6">
                  <Text className={`${colors.textSec} text-xs uppercase mb-1.5 font-medium tracking-wide`}>
                    {selectedAlert?.triggerType === 'MILEAGE'
                      ? 'Próximo objetivo / límite (km)'
                      : 'Próxima expiración / límite'}
                  </Text>
                  {selectedAlert?.triggerType === 'MILEAGE' ? (
                    <TextInput
                      value={triggerValue}
                      placeholder={vehicle ? (vehicle.currentMileage + 3000).toString() : '12000'}
                      placeholderTextColor={theme === 'light' ? '#8E9FBC' : '#556070'}
                      keyboardType="numeric"
                      onChangeText={setTriggerValue}
                      className={`w-full ${colors.subCard} ${colors.text} border ${colors.border} rounded-xl px-4 py-3 text-sm focus:border-[#1C69D4]`}
                    />
                  ) : (
                    <TouchableOpacity
                      onPress={() => setShowTriggerDatePicker(true)}
                      className={`w-full ${colors.subCard} border ${colors.border} rounded-xl px-4 py-3 justify-center h-[48px]`}
                    >
                      <Text className={triggerValue ? colors.text : colors.textMuted}>
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
                  onPress={handleSaveMaintenance}
                  disabled={savingMaintenance}
                  className="w-full bg-[#1C69D4] rounded-xl py-3.5 items-center justify-center border border-[#1C69D4]"
                  style={{
                    shadowColor: '#1C69D4',
                    shadowOffset: { width: 0, height: 0 },
                    shadowOpacity: 0.4,
                    shadowRadius: 12,
                    elevation: 4
                  }}
                >
                  {savingMaintenance ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <Text className="text-white font-bold text-sm uppercase tracking-widest">
                      GUARDAR MANTENIMIENTO
                    </Text>
                  )}
                </TouchableOpacity>
              </ScrollView>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Edit Specifications Modal */}
      <Modal
        visible={editSpecsModalVisible}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setEditSpecsModalVisible(false)}
        statusBarTranslucent={true}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'padding'}
          className="flex-1"
        >
          <View className="flex-1 bg-black/60 justify-end">
            <View
              className="border-t rounded-t-3xl"
              style={{
                shadowColor: '#000',
                shadowOffset: { width: 0, height: -10 },
                shadowOpacity: theme === 'light' ? 0.05 : 0.4,
                shadowRadius: 15,
                elevation: 8,
                backgroundColor: theme === 'light' ? '#FFFFFF' : '#121620',
                borderColor: theme === 'light' ? '#D8E0EB' : '#242D3D',
                maxHeight: '80%',
              }}
            >
              <ScrollView
                contentContainerStyle={{ padding: 24, paddingBottom: insets.bottom > 0 ? insets.bottom + 30 : 60 }}
                className="w-full"
                keyboardShouldPersistTaps="handled"
              >
                {/* Header */}
                <View className="flex-row justify-between items-center mb-6">
                  <Text className={`font-rajdhani-bold text-base font-bold uppercase tracking-wider ${colors.text}`}>
                    EDITAR FICHA TÉCNICA
                  </Text>
                  <TouchableOpacity onPress={() => setEditSpecsModalVisible(false)} className="p-1">
                    <X size={24} color={theme === 'light' ? '#002C5B' : '#F8F9FA'} />
                  </TouchableOpacity>
                </View>

                {/* Form fields */}
                <View>
                  <View className="mb-3.5">
                    <Text className={`font-barlow-condensed-bold text-xs uppercase font-bold tracking-wider mb-1 ${colors.textSec}`}>
                      Motor / Cilindrada
                    </Text>
                    <TextInput
                      value={editEngineCc}
                      placeholder="Ej. 125 cc"
                      placeholderTextColor={theme === 'light' ? '#8E9FBC' : '#556070'}
                      onChangeText={setEditEngineCc}
                      className={`w-full ${colors.subCard} ${colors.text} border ${colors.border} rounded-xl px-4 py-2.5 text-sm focus:border-[#1C69D4]`}
                    />
                  </View>

                  <View className="mb-3.5">
                    <Text className={`font-barlow-condensed-bold text-xs uppercase font-bold tracking-wider mb-1 ${colors.textSec}`}>
                      Depósito
                    </Text>
                    <TextInput
                      value={editTankSize}
                      placeholder="Ej. 12 Litros"
                      placeholderTextColor={theme === 'light' ? '#8E9FBC' : '#556070'}
                      onChangeText={setEditTankSize}
                      className={`w-full ${colors.subCard} ${colors.text} border ${colors.border} rounded-xl px-4 py-2.5 text-sm focus:border-[#1C69D4]`}
                    />
                  </View>

                  <View className="mb-3.5">
                    <Text className={`font-barlow-condensed-bold text-xs uppercase font-bold tracking-wider mb-1 ${colors.textSec}`}>
                      Potencia
                    </Text>
                    <TextInput
                      value={editPower}
                      placeholder="Ej. 15 HP"
                      placeholderTextColor={theme === 'light' ? '#8E9FBC' : '#556070'}
                      onChangeText={setEditPower}
                      className={`w-full ${colors.subCard} ${colors.text} border ${colors.border} rounded-xl px-4 py-2.5 text-sm focus:border-[#1C69D4]`}
                    />
                  </View>

                  <View className="mb-3.5">
                    <Text className={`font-barlow-condensed-bold text-xs uppercase font-bold tracking-wider mb-1 ${colors.textSec}`}>
                      Torque
                    </Text>
                    <TextInput
                      value={editTorque}
                      placeholder="Ej. 12 Nm"
                      placeholderTextColor={theme === 'light' ? '#8E9FBC' : '#556070'}
                      onChangeText={setEditTorque}
                      className={`w-full ${colors.subCard} ${colors.text} border ${colors.border} rounded-xl px-4 py-2.5 text-sm focus:border-[#1C69D4]`}
                    />
                  </View>

                  <View className="mb-3.5">
                    <Text className={`font-barlow-condensed-bold text-xs uppercase font-bold tracking-wider mb-1 ${colors.textSec}`}>
                      Transmisión
                    </Text>
                    <TextInput
                      value={editTransmission}
                      placeholder="Ej. 5 velocidades"
                      placeholderTextColor={theme === 'light' ? '#8E9FBC' : '#556070'}
                      onChangeText={setEditTransmission}
                      className={`w-full ${colors.subCard} ${colors.text} border ${colors.border} rounded-xl px-4 py-2.5 text-sm focus:border-[#1C69D4]`}
                    />
                  </View>

                  <View className="mb-3.5">
                    <Text className={`font-barlow-condensed-bold text-xs uppercase font-bold tracking-wider mb-1 ${colors.textSec}`}>
                      Peso
                    </Text>
                    <TextInput
                      value={editWeight}
                      placeholder="Ej. 130 kg"
                      placeholderTextColor={theme === 'light' ? '#8E9FBC' : '#556070'}
                      onChangeText={setEditWeight}
                      className={`w-full ${colors.subCard} ${colors.text} border ${colors.border} rounded-xl px-4 py-2.5 text-sm focus:border-[#1C69D4]`}
                    />
                  </View>

                  <View className="mb-3.5">
                    <Text className={`font-barlow-condensed-bold text-xs uppercase font-bold tracking-wider mb-1 ${colors.textSec}`}>
                      Neumático Delantero
                    </Text>
                    <TextInput
                      value={editFrontTire}
                      placeholder="Ej. 90/90-19"
                      placeholderTextColor={theme === 'light' ? '#8E9FBC' : '#556070'}
                      onChangeText={setEditFrontTire}
                      className={`w-full ${colors.subCard} ${colors.text} border ${colors.border} rounded-xl px-4 py-2.5 text-sm focus:border-[#1C69D4]`}
                    />
                  </View>

                  <View className="mb-3.5">
                    <Text className={`font-barlow-condensed-bold text-xs uppercase font-bold tracking-wider mb-1 ${colors.textSec}`}>
                      Neumático Trasero
                    </Text>
                    <TextInput
                      value={editRearTire}
                      placeholder="Ej. 110/90-17"
                      placeholderTextColor={theme === 'light' ? '#8E9FBC' : '#556070'}
                      onChangeText={setEditRearTire}
                      className={`w-full ${colors.subCard} ${colors.text} border ${colors.border} rounded-xl px-4 py-2.5 text-sm focus:border-[#1C69D4]`}
                    />
                  </View>

                  <View className="mb-3.5">
                    <Text className={`font-barlow-condensed-bold text-xs uppercase font-bold tracking-wider mb-1 ${colors.textSec}`}>
                      Freno Delantero
                    </Text>
                    <TextInput
                      value={editFrontBrake}
                      placeholder="Ej. Disco 240mm"
                      placeholderTextColor={theme === 'light' ? '#8E9FBC' : '#556070'}
                      onChangeText={setEditFrontBrake}
                      className={`w-full ${colors.subCard} ${colors.text} border ${colors.border} rounded-xl px-4 py-2.5 text-sm focus:border-[#1C69D4]`}
                    />
                  </View>

                  <View className="mb-3.5">
                    <Text className={`font-barlow-condensed-bold text-xs uppercase font-bold tracking-wider mb-1 ${colors.textSec}`}>
                      Freno Trasero
                    </Text>
                    <TextInput
                      value={editRearBrake}
                      placeholder="Ej. Tambor 130mm"
                      placeholderTextColor={theme === 'light' ? '#8E9FBC' : '#556070'}
                      onChangeText={setEditRearBrake}
                      className={`w-full ${colors.subCard} ${colors.text} border ${colors.border} rounded-xl px-4 py-2.5 text-sm focus:border-[#1C69D4]`}
                    />
                  </View>

                  <View className="mb-3.5">
                    <Text className={`font-barlow-condensed-bold text-xs uppercase font-bold tracking-wider mb-1 ${colors.textSec}`}>
                      Suspensión Delantera
                    </Text>
                    <TextInput
                      value={editFrontSuspension}
                      placeholder="Ej. Horquilla telescópica"
                      placeholderTextColor={theme === 'light' ? '#8E9FBC' : '#556070'}
                      onChangeText={setEditFrontSuspension}
                      className={`w-full ${colors.subCard} ${colors.text} border ${colors.border} rounded-xl px-4 py-2.5 text-sm focus:border-[#1C69D4]`}
                    />
                  </View>

                  <View className="mb-6">
                    <Text className={`font-barlow-condensed-bold text-xs uppercase font-bold tracking-wider mb-1 ${colors.textSec}`}>
                      Suspensión Trasera
                    </Text>
                    <TextInput
                      value={editRearSuspension}
                      placeholder="Ej. Doble amortiguador"
                      placeholderTextColor={theme === 'light' ? '#8E9FBC' : '#556070'}
                      onChangeText={setEditRearSuspension}
                      className={`w-full ${colors.subCard} ${colors.text} border ${colors.border} rounded-xl px-4 py-2.5 text-sm focus:border-[#1C69D4]`}
                    />
                  </View>
                </View>

                {/* Submit */}
                <TouchableOpacity
                  onPress={handleSaveSpecs}
                  disabled={savingSpecs}
                  className="w-full bg-[#1C69D4] rounded-xl py-3.5 items-center justify-center border border-[#1C69D4]"
                  style={{
                    shadowColor: '#1C69D4',
                    shadowOffset: { width: 0, height: 0 },
                    shadowOpacity: 0.4,
                    shadowRadius: 12,
                    elevation: 4
                  }}
                >
                  {savingSpecs ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <Text className="text-white font-bold text-sm uppercase tracking-widest">
                      GUARDAR FICHA TÉCNICA
                    </Text>
                  )}
                </TouchableOpacity>
              </ScrollView>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Edit Odometer Modal */}
      <Modal 
        visible={editOdoModalVisible} 
        animationType="slide" 
        transparent={true}
        statusBarTranslucent={true}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'padding'}
          className="flex-1"
        >
          <View className="flex-1 bg-black/60 justify-end">
            <View 
              className={`${colors.card} border-t ${colors.border} rounded-t-3xl`}
              style={{
                paddingLeft: 24,
                paddingRight: 24,
                paddingTop: 24,
                paddingBottom: insets.bottom > 0 ? insets.bottom + 16 : 24,
                shadowColor: '#000',
                shadowOffset: { width: 0, height: -10 },
                shadowOpacity: colors.isDark ? 0.4 : 0.1,
                shadowRadius: 15,
                elevation: 8
              }}
            >
              <View className="flex-row justify-between items-center mb-6">
                <Text className={`${colors.text} font-rajdhani-bold text-base font-bold uppercase tracking-[2px]`}>
                  AJUSTAR ODÓMETRO
                </Text>
                <TouchableOpacity onPress={() => setEditOdoModalVisible(false)} className="p-1">
                  <X size={24} color={colors.isDark ? '#F8F9FA' : '#4E5E72'} />
                </TouchableOpacity>
              </View>

              <Text className={`${colors.textSec} text-xs mb-6`}>
                Ingresa el kilometraje actual total de tu motocicleta. Esto actualizará el estado de todos tus recordatorios y mantenimientos basados en distancia.
              </Text>

              <View className="mb-6">
                <Text className={`${colors.textSec} text-xs uppercase mb-1.5 font-medium tracking-wide`}>
                  Kilometraje Actual (KM)
                </Text>
                <TextInput
                  value={newOdometerValue}
                  placeholder="Ej. 12500"
                  placeholderTextColor={colors.isDark ? '#556070' : '#8E9FBC'}
                  keyboardType="number-pad"
                  onChangeText={setNewOdometerValue}
                  className={`w-full ${colors.isDark ? 'bg-[#1A202C]' : 'bg-[#F4F5F7]'} ${colors.isDark ? 'border ' + colors.border : ''} rounded-xl px-4 py-3 text-sm text-black dark:text-white`}
                />
              </View>

              <TouchableOpacity
                onPress={handleSaveOdometer}
                disabled={savingOdometer}
                className="w-full rounded-xl py-3.5 items-center justify-center border"
                style={{
                  backgroundColor: colors.bmwBlue,
                  borderColor: colors.bmwBlue,
                  shadowColor: colors.bmwBlue,
                  shadowOffset: { width: 0, height: 4 },
                  shadowOpacity: 0.3,
                  shadowRadius: 8,
                  elevation: 4
                }}
              >
                {savingOdometer ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text className="text-white font-bold text-sm uppercase tracking-widest">
                    GUARDAR KILOMETRAJE
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

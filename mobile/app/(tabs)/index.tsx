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
} from "react-native";
import { useUser, useAuth } from "@clerk/clerk-expo";
import { SafeAreaView } from "react-native-safe-area-context";
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
}

interface AlertData {
  id: string;
  type: "OIL_CHANGE" | "BRAKE_PADS" | "INSURANCE_RENEWAL" | "CUSTOM";
  title: string;
  triggerType: "MILEAGE" | "DATE";
  triggerValue: string;
  isCompleted: boolean;
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

export default function DashboardScreen() {
  const { user } = useUser();
  const { signOut } = useAuth();
  const { showAlert } = useAlert();
  const { expoPushToken } = usePushNotifications();
  const { theme, colors, toggleTheme } = useTheme();

  // State
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [alerts, setAlerts] = useState<AlertData[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isGarageOpen, setIsGarageOpen] = useState(false);
  const [isRegisteringNew, setIsRegisteringNew] = useState(false);

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

      // 1. Oil change alert in 3,000 km
      await api.post("alerts", {
        vehicleId: bikeId,
        type: "OIL_CHANGE",
        title: "Cambio de Aceite",
        triggerType: "MILEAGE",
        triggerValue: (initialMileage + 3000).toString(),
      });

      // 2. Brake pads check in 10,000 km
      await api.post("alerts", {
        vehicleId: bikeId,
        type: "BRAKE_PADS",
        title: "Pastillas de Freno",
        triggerType: "MILEAGE",
        triggerValue: (initialMileage + 10000).toString(),
      });

      // 3. Insurance renewal in 1 year
      const nextYear = new Date();
      nextYear.setFullYear(nextYear.getFullYear() + 1);
      await api.post("alerts", {
        vehicleId: bikeId,
        type: "INSURANCE_RENEWAL",
        title: "Renovación de Seguro",
        triggerType: "DATE",
        triggerValue: nextYear.toISOString(),
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
    gearBg: theme === "light" ? "rgba(0, 138, 34, 0.08)" : "rgba(0, 138, 34, 0.15)",
    gearText: theme === "light" ? "#008A22" : "#2CFF0A",
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
    statusLed: theme === "light" ? "#008A22" : "#2CFF0A",
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
              className={`font-orbitron text-sm font-bold tracking-widest leading-none ${colors.text}`}
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
                  className={`${theme === "light" ? "text-[#1C69D4]" : "text-[#00A3E0]"} text-xs font-semibold mr-1`}
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
              {/* BMW Motorrad Sport TFT Digital Instrument Cluster */}
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
                <View style={{ flexDirection: 'row', height: 4, borderRadius: 2, overflow: 'hidden', marginBottom: 12 }}>
                  <View style={{ flex: 1, backgroundColor: '#00A3E0' }} />
                  <View style={{ flex: 1, backgroundColor: '#002C5B' }} />
                  <View style={{ flex: 1, backgroundColor: '#E30613' }} />
                </View>

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
                      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#008A22' }} />
                      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#008A22' }} />
                      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#008A22' }} />
                      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: tftStyles.rpmLedEmptyBg, opacity: tftStyles.rpmLedEmptyOpacity }} />
                      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: tftStyles.rpmLedEmptyBg, opacity: tftStyles.rpmLedEmptyOpacity }} />
                      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#FF1E27', opacity: 0.1 }} />
                    </View>

                    <Text style={{ fontFamily: 'Orbitron-Bold', fontSize: 10, color: tftStyles.headerText, letterSpacing: 1 }}>
                      BMW M-SPORT
                    </Text>

                    <Text style={{ fontFamily: 'Orbitron-Bold', fontSize: 10, color: tftStyles.timeText, opacity: 0.8 }}>
                      12:45
                    </Text>
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
                          borderColor: '#008A22',
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
                      <Text style={{ fontFamily: 'Orbitron-Bold', fontSize: 9, color: tftStyles.odoTitle, letterSpacing: 1, marginBottom: 4, textTransform: 'uppercase' }}>
                        ODÓMETRO TOTAL
                      </Text>
                      
                      <View style={{ 
                        backgroundColor: tftStyles.odoBg, 
                        borderRadius: 8, 
                        borderWidth: 1, 
                        borderColor: tftStyles.odoBorder,
                        paddingVertical: 6, 
                        paddingHorizontal: 12,
                        position: 'relative',
                        justifyContent: 'center',
                        alignItems: 'center',
                        minWidth: 140
                      }}>
                        <Text
                          style={{
                            fontFamily: 'Orbitron-Bold',
                            fontSize: 22,
                            color: tftStyles.odoBgDigits,
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
                            textShadowColor: tftStyles.odoShadow,
                            textShadowOffset: { width: 0, height: 0 },
                            textShadowRadius: 6,
                          }}
                        >
                          {String(vehicle.currentMileage).padStart(6, '0')}
                        </Text>
                      </View>

                      <Text style={{ fontFamily: 'Orbitron-Bold', fontSize: 9, color: tftStyles.odoUnit, marginTop: 4, letterSpacing: 0.5 }}>
                        TOTAL KM
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
                className={`${colors.textSec} font-bold text-xs uppercase tracking-widest mb-4`}
              >
                FICHA TÉCNICA (ESPECIFICACIONES)
              </Text>

              <View
                className={`${colors.card} p-5 mb-6`}
                style={{
                  borderRadius: 20,
                  borderWidth: 1,
                  borderColor: theme === "light" ? "#D8E0EB" : "#242D3D",
                }}
              >
                {fetchingSpecs ? (
                  <View
                    className={`py-4 items-center justify-center border-b ${colors.border} mb-4`}
                  >
                    <ActivityIndicator size="small" color={activeBmwColor} />
                    <Text
                      className={`${colors.textSec} text-[10px] font-semibold mt-2 tracking-wider uppercase`}
                    >
                      Buscando ficha técnica en la web con AI...
                    </Text>
                  </View>
                ) : !vehicle.specSource ? (
                  <View
                    className={`${colors.subCard} border border-dashed ${colors.border} rounded-xl p-4 mb-4 items-center justify-center`}
                  >
                    <Text
                      className={`${colors.textSec} text-xs text-center mb-3 leading-normal font-sans`}
                    >
                      Ficha técnica vacía. Puedes buscar sus especificaciones
                      técnicas reales en la web utilizando Inteligencia
                      Artificial.
                    </Text>
                    <TouchableOpacity
                      onPress={handleFetchSpecs}
                      className="bg-[#1C69D4] px-5 py-2.5 rounded-xl flex-row items-center"
                      style={{
                        shadowColor: "#1C69D4",
                        shadowOffset: { width: 0, height: 2 },
                        shadowOpacity: 0.5,
                        shadowRadius: 6,
                        elevation: 3,
                      }}
                    >
                      <Text className="text-white text-xs font-bold uppercase tracking-wider">
                        Buscar Ficha Técnica con AI
                      </Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <View
                    className={`flex-row justify-between items-center mb-4 border-b ${colors.border} pb-3`}
                  >
                    <View className="flex-row items-center">
                      <ShieldCheck size={16} color={colors.statusGreen} />
                      <Text
                        className={`${colors.text} text-xs font-bold uppercase ml-1.5 tracking-wider`}
                      >
                        Datos de Internet
                      </Text>
                    </View>
                    <Text className="text-[9px] text-neutral-500 uppercase tracking-widest">
                      Fuente: {vehicle.specSource}
                    </Text>
                  </View>
                )}

                <View className="flex-row flex-wrap">
                  <View className="w-1/2 pr-2 mb-3.5">
                    <Text
                      className={`${colors.textMuted} text-[10px] uppercase font-bold tracking-wider mb-0.5`}
                    >
                      Motor / Cilindrada
                    </Text>
                    <Text className={`${colors.text} text-sm font-semibold`}>
                      {vehicle.engineCc || "No disponible"}
                    </Text>
                  </View>
                  <View className="w-1/2 pl-2 mb-3.5">
                    <Text
                      className={`${colors.textMuted} text-[10px] uppercase font-bold tracking-wider mb-0.5 font-sans`}
                    >
                      Depósito
                    </Text>
                    <Text className={`${colors.text} text-sm font-semibold`}>
                      {vehicle.tankSize || "No disponible"}
                    </Text>
                  </View>

                  <View className="w-1/2 pr-2 mb-3.5">
                    <Text
                      className={`${colors.textMuted} text-[10px] uppercase font-bold tracking-wider mb-0.5 font-sans`}
                    >
                      Potencia
                    </Text>
                    <Text className={`${colors.text} text-sm font-semibold`}>
                      {vehicle.power || "No disponible"}
                    </Text>
                  </View>
                  <View className="w-1/2 pl-2 mb-3.5">
                    <Text
                      className={`${colors.textMuted} text-[10px] uppercase font-bold tracking-wider mb-0.5`}
                    >
                      Torque
                    </Text>
                    <Text className={`${colors.text} text-sm font-semibold`}>
                      {vehicle.torque || "No disponible"}
                    </Text>
                  </View>

                  <View className="w-1/2 pr-2 mb-3.5">
                    <Text
                      className={`${colors.textMuted} text-[10px] uppercase font-bold tracking-wider mb-0.5`}
                    >
                      Transmisión
                    </Text>
                    <Text className={`${colors.text} text-sm font-semibold`}>
                      {vehicle.transmission || "No disponible"}
                    </Text>
                  </View>
                  <View className="w-1/2 pl-2 mb-3.5">
                    <Text
                      className={`${colors.textMuted} text-[10px] uppercase font-bold tracking-wider mb-0.5`}
                    >
                      Peso
                    </Text>
                    <Text className={`${colors.text} text-sm font-semibold`}>
                      {vehicle.weight || "No disponible"}
                    </Text>
                  </View>

                  <View
                    className={`w-full border-t ${colors.border} pt-3 mt-1.5 mb-3.5`}
                  >
                    <Text
                      className={`${colors.textMuted} text-[10px] uppercase font-bold tracking-wider mb-1`}
                    >
                      Neumáticos (Del / Tras)
                    </Text>
                    <Text className={`${colors.text} text-sm font-semibold`}>
                      {vehicle.frontTire || "No disp."} /{" "}
                      {vehicle.rearTire || "No disp."}
                    </Text>
                  </View>

                  <View className="w-full mb-3.5">
                    <Text
                      className={`${colors.textMuted} text-[10px] uppercase font-bold tracking-wider mb-1`}
                    >
                      Freno Delantero
                    </Text>
                    <Text className={`${colors.text} text-sm font-semibold`}>
                      {vehicle.frontBrake || "No disponible"}
                    </Text>
                  </View>
                  <View className="w-full mb-3.5">
                    <Text
                      className={`${colors.textMuted} text-[10px] uppercase font-bold tracking-wider mb-1`}
                    >
                      Freno Trasero
                    </Text>
                    <Text className={`${colors.text} text-sm font-semibold`}>
                      {vehicle.rearBrake || "No disponible"}
                    </Text>
                  </View>

                  <View className="w-full mb-3.5">
                    <Text
                      className={`${colors.textMuted} text-[10px] uppercase font-bold tracking-wider mb-1`}
                    >
                      Suspensión Delantera
                    </Text>
                    <Text className={`${colors.text} text-sm font-semibold`}>
                      {vehicle.frontSuspension || "No disponible"}
                    </Text>
                  </View>
                  <View className="w-full">
                    <Text
                      className={`${colors.textMuted} text-[10px] uppercase font-bold tracking-wider mb-1`}
                    >
                      Suspensión Trasera
                    </Text>
                    <Text className={`${colors.text} text-sm font-semibold`}>
                      {vehicle.rearSuspension || "No disponible"}
                    </Text>
                  </View>
                </View>
              </View>

              {/* Dashboard Subtitle */}
              <Text
                className={`${colors.textSec} font-bold text-xs uppercase tracking-widest mb-4`}
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
                    type={alert.triggerType}
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
                  className={`${colors.text} font-orbitron text-xl font-bold mt-2 text-center`}
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
                <View className="mb-4 relative">
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
                      className={`absolute top-[75px] left-0 right-0 border ${colors.border} rounded-xl max-h-52 overflow-hidden`}
                      style={{
                        backgroundColor:
                          theme === "light" ? "#FFFFFF" : "#121620",
                        zIndex: 50,
                        shadowColor: "#000",
                        shadowOffset: { width: 0, height: 10 },
                        shadowOpacity: theme === "light" ? 0.05 : 0.4,
                        shadowRadius: 15,
                        elevation: 8,
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
            className={`${colors.card} border-t ${colors.border} rounded-t-3xl p-6 h-[60%]`}
            style={{
              shadowColor: "#000",
              shadowOffset: { width: 0, height: -10 },
              shadowOpacity: theme === "light" ? 0.05 : 0.4,
              shadowRadius: 15,
              elevation: 8,
            }}
          >
            <View className="flex-row justify-between items-center mb-6">
              <Text
                className={`${colors.text} font-orbitron text-base font-bold uppercase tracking-wider`}
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
                  <TouchableOpacity
                    key={item.id}
                    onPress={() => handleSwitchVehicle(item.id)}
                    className={`p-4 rounded-xl border mb-3 flex-row justify-between items-center ${
                      isActive
                        ? `${colors.subCard} ${colors.borderAccent}`
                        : `${colors.card} ${colors.border}`
                    }`}
                  >
                    <View>
                      <Text className={`${colors.text} font-bold text-base`}>
                        {item.brand} {item.model}
                      </Text>
                      <Text className={`${colors.textSec} text-xs mt-0.5`}>
                        Año: {item.year} | Odómetro:{" "}
                        {item.currentMileage.toLocaleString()} km
                      </Text>
                    </View>
                    <View className="flex-row items-center">
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
                          className={`${colors.textMuted} text-xs font-semibold uppercase tracking-wider`}
                        >
                          Seleccionar
                        </Text>
                      )}
                    </View>
                  </TouchableOpacity>
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
    </SafeAreaView>
  );
}

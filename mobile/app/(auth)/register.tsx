import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Keyboard } from 'react-native';
import { useSignUp } from '@clerk/clerk-expo';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Eye, EyeOff } from 'lucide-react-native';
import { useAlert } from '../../utils/AlertContext';
import { useTheme } from '../../utils/ThemeContext';

export default function RegisterScreen() {
  const { signUp, setActive, isLoaded } = useSignUp();
  const router = useRouter();
  const { showAlert } = useAlert();
  const { colors } = useTheme();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pendingVerification, setPendingVerification] = useState(false);
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

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

  // Initial Sign Up Press
  const onSignUpPress = async () => {
    if (!isLoaded) return;
    if (!email || !password) {
      showAlert('Error', 'Por favor completa todos los campos');
      return;
    }

    setLoading(true);
    try {
      await signUp.create({
        emailAddress: email,
        password,
      });

      // Send the verification code to the user's email
      await signUp.prepareEmailAddressVerification({ strategy: 'email_code' });
      
      setPendingVerification(true);
    } catch (err: any) {
      console.error(JSON.stringify(err, null, 2));
      showAlert('Error de Registro', err.errors?.[0]?.message || 'Ocurrió un error al registrarse');
    } finally {
      setLoading(false);
    }
  };

  // Verify Email Code Press
  const onVerifyPress = async () => {
    if (!isLoaded) return;
    if (!code) {
      showAlert('Error', 'Por favor ingresa el código de verificación');
      return;
    }

    setLoading(true);
    try {
      const completeSignUp = await signUp.attemptEmailAddressVerification({
        code,
      });

      if (completeSignUp.status === 'complete') {
        await setActive({ session: completeSignUp.createdSessionId });
        console.log('User signed up and verified successfully!');
      } else {
        console.warn('Sign up verification status incomplete:', completeSignUp);
        showAlert('Error', 'No se pudo verificar el correo electrónico');
      }
    } catch (err: any) {
      console.error(JSON.stringify(err, null, 2));
      showAlert('Código Inválido', err.errors?.[0]?.message || 'Código incorrecto. Revisa tu correo.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView className={`flex-1 ${colors.bg}`}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1"
      >
        <ScrollView 
          contentContainerStyle={{ 
            flexGrow: 1, 
            justifyContent: keyboardVisible ? 'flex-start' : 'center', 
            padding: 24, 
            paddingTop: keyboardVisible ? (Platform.OS === 'ios' ? 20 : 10) : (Platform.OS === 'ios' ? 40 : 20), 
            paddingBottom: keyboardVisible ? 80 : 60 
          }} 
          className="flex-1"
          keyboardShouldPersistTaps="handled"
        >
          {/* Header */}
          <View className="items-center mb-8">
            <View 
              className="w-16 h-16 rounded-full items-center justify-center border-2 mb-4"
              style={{
                backgroundColor: colors.bmwBlue,
                borderColor: colors.isDark ? colors.bmwLightBlue : '#FFFFFF',
                shadowColor: colors.bmwBlue,
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.3,
                shadowRadius: 8,
                elevation: 5,
              }}
            >
              <Text className="text-white text-3xl font-bold tracking-tighter">M</Text>
            </View>
            <Text className={`${colors.text} font-orbitron text-2xl font-bold tracking-widest text-center`}>
              MOTO<Text style={{ color: colors.bmwBlue }}>PULSE</Text>
            </Text>
          </View>

          {/* Form Card */}
          <View 
            className={`${colors.card} border ${colors.border} rounded-2xl p-6`}
            style={{
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: colors.isDark ? 0.3 : 0.08,
              shadowRadius: 8,
              elevation: 4,
            }}
          >
            {!pendingVerification ? (
              // Sign Up Form
              <>
                <Text className={`${colors.text} text-lg font-bold mb-6 tracking-wide uppercase border-b ${colors.border} pb-2`}>
                  Crear Cuenta de Rider
                </Text>

                <View className="mb-4">
                  <Text className={`${colors.textSec} text-xs uppercase mb-1.5 font-medium tracking-wide`}>
                    Correo Electrónico
                  </Text>
                  <TextInput
                    autoCapitalize="none"
                    value={email}
                    placeholder="rider@motopulse.com"
                    placeholderTextColor={colors.isDark ? '#556070' : '#8E9FBC'}
                    onChangeText={(email) => setEmail(email)}
                    keyboardType="email-address"
                    className={`w-full ${colors.isDark ? 'bg-[#1A202C] text-white' : 'bg-[#F4F5F7] text-[#002C5B]'} border ${colors.border} rounded-xl px-4 py-3 text-sm`}
                  />
                </View>

                <View className="mb-6">
                  <Text className={`${colors.textSec} text-xs uppercase mb-1.5 font-medium tracking-wide`}>
                    Contraseña
                  </Text>
                  <View className="relative justify-center">
                    <TextInput
                      value={password}
                      placeholder="******** (Mínimo 8 caracteres)"
                      placeholderTextColor={colors.isDark ? '#556070' : '#8E9FBC'}
                      secureTextEntry={!showPassword}
                      onChangeText={(password) => setPassword(password)}
                      className={`w-full ${colors.isDark ? 'bg-[#1A202C] text-white' : 'bg-[#F4F5F7] text-[#002C5B]'} border ${colors.border} rounded-xl pl-4 pr-12 py-3 text-sm`}
                    />
                    <TouchableOpacity
                      onPress={() => setShowPassword(!showPassword)}
                      className="absolute right-4 p-1"
                    >
                      {showPassword ? (
                        <EyeOff size={18} color={colors.isDark ? '#8F9CAE' : '#4E5E72'} />
                      ) : (
                        <Eye size={18} color={colors.isDark ? '#8F9CAE' : '#4E5E72'} />
                      )}
                    </TouchableOpacity>
                  </View>
                </View>

                <TouchableOpacity
                  onPress={onSignUpPress}
                  disabled={loading}
                  className="w-full rounded-xl py-3.5 items-center justify-center border"
                  style={{
                    backgroundColor: colors.bmwBlue,
                    borderColor: colors.bmwBlue,
                    shadowColor: colors.bmwBlue,
                    shadowOffset: { width: 0, height: 4 },
                    shadowOpacity: 0.3,
                    shadowRadius: 8,
                    elevation: 4,
                  }}
                >
                  {loading ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <Text className="text-white font-bold text-sm uppercase tracking-widest">
                      REGISTRAR EQUIPO
                    </Text>
                  )}
                </TouchableOpacity>
              </>
            ) : (
              // Verification Code Form
              <>
                <Text className={`${colors.text} text-lg font-bold mb-3 tracking-wide uppercase border-b ${colors.border} pb-2`}>
                  Verificar Correo
                </Text>
                <Text className={`${colors.textSec} text-xs mb-6`}>
                  Hemos enviado un código de verificación a <Text className={`${colors.text} font-medium`}>{email}</Text>.
                </Text>

                <View className="mb-6">
                  <Text className={`${colors.textSec} text-xs uppercase mb-1.5 font-medium tracking-wide`}>
                    Código de 6 dígitos
                  </Text>
                  <TextInput
                    value={code}
                    placeholder="123456"
                    placeholderTextColor={colors.isDark ? '#556070' : '#8E9FBC'}
                    keyboardType="number-pad"
                    onChangeText={(code) => setCode(code)}
                    maxLength={6}
                    className={`w-full ${colors.isDark ? 'bg-[#1A202C] text-white' : 'bg-[#F4F5F7] text-[#002C5B]'} border ${colors.border} rounded-xl px-4 py-3 text-center text-lg font-orbitron tracking-[10px]`}
                  />
                </View>

                <TouchableOpacity
                  onPress={onVerifyPress}
                  disabled={loading}
                  className="w-full rounded-xl py-3.5 items-center justify-center border"
                  style={{
                    backgroundColor: colors.bmwBlue,
                    borderColor: colors.bmwBlue,
                    shadowColor: colors.bmwBlue,
                    shadowOffset: { width: 0, height: 4 },
                    shadowOpacity: 0.3,
                    shadowRadius: 8,
                    elevation: 4,
                  }}
                >
                  {loading ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <Text className="text-white font-bold text-sm uppercase tracking-widest">
                      CONFIRMAR CÓDIGO
                    </Text>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => setPendingVerification(false)}
                  className="mt-4 align-self-center py-2"
                >
                  <Text className={`${colors.textMuted} text-xs text-center uppercase tracking-wide`}>
                    ← Volver
                  </Text>
                </TouchableOpacity>
              </>
            )}
          </View>

          {/* Redirect to login */}
          <View className="flex-row justify-center mt-6 items-center">
            <Text className={`${colors.textSec} text-sm`}>¿Ya tienes cuenta?</Text>
            <TouchableOpacity onPress={() => router.push('/(auth)/login')} className="ml-2">
              <Text className="font-bold text-sm" style={{ color: colors.bmwBlue }}>Iniciar Sesión</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

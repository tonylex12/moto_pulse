import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView, Keyboard } from 'react-native';
import { useSignUp } from '@clerk/clerk-expo';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Eye, EyeOff } from 'lucide-react-native';

export default function RegisterScreen() {
  const { signUp, setActive, isLoaded } = useSignUp();
  const router = useRouter();

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
      Alert.alert('Error', 'Por favor completa todos los campos');
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
      Alert.alert('Error de Registro', err.errors?.[0]?.message || 'Ocurrió un error al registrarse');
    } finally {
      setLoading(false);
    }
  };

  // Verify Email Code Press
  const onVerifyPress = async () => {
    if (!isLoaded) return;
    if (!code) {
      Alert.alert('Error', 'Por favor ingresa el código de verificación');
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
        Alert.alert('Error', 'No se pudo verificar el correo electrónico');
      }
    } catch (err: any) {
      console.error(JSON.stringify(err, null, 2));
      Alert.alert('Código Inválido', err.errors?.[0]?.message || 'Código incorrecto. Revisa tu correo.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-carbon-matte">
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
            <View className="w-16 h-16 rounded-full bg-ktm-orange items-center justify-center border-2 border-speedo-cyan shadow-[0_0_15px_#00E5FF] mb-4">
              <Text className="text-white text-3xl font-bold tracking-tighter">M</Text>
            </View>
            <Text className="text-white font-orbitron text-2xl font-bold tracking-widest text-center">
              MOTO<Text className="text-speedo-cyan">PULSE</Text>
            </Text>
          </View>

          {/* Form Card */}
          <View className="bg-tarmac border border-tarmac-light rounded-2xl p-6 shadow-lg">
            {!pendingVerification ? (
              // Sign Up Form
              <>
                <Text className="text-white text-lg font-bold mb-6 tracking-wide uppercase border-b border-tarmac-light pb-2">
                  Crear Cuenta de Rider
                </Text>

                <View className="mb-4">
                  <Text className="text-neutral-400 text-xs uppercase mb-1.5 font-medium tracking-wide">
                    Correo Electrónico
                  </Text>
                  <TextInput
                    autoCapitalize="none"
                    value={email}
                    placeholder="rider@motopulse.com"
                    placeholderTextColor="#556070"
                    onChangeText={(email) => setEmail(email)}
                    keyboardType="email-address"
                    className="w-full bg-carbon-dark text-white border border-tarmac-light rounded-xl px-4 py-3 text-sm focus:border-speedo-cyan"
                  />
                </View>

                <View className="mb-6">
                  <Text className="text-neutral-400 text-xs uppercase mb-1.5 font-medium tracking-wide">
                    Contraseña
                  </Text>
                  <View className="relative justify-center">
                    <TextInput
                      value={password}
                      placeholder="******** (Mínimo 8 caracteres)"
                      placeholderTextColor="#556070"
                      secureTextEntry={!showPassword}
                      onChangeText={(password) => setPassword(password)}
                      className="w-full bg-carbon-dark text-white border border-tarmac-light rounded-xl pl-4 pr-12 py-3 text-sm focus:border-speedo-cyan"
                    />
                    <TouchableOpacity
                      onPress={() => setShowPassword(!showPassword)}
                      className="absolute right-4 p-1"
                    >
                      {showPassword ? (
                        <EyeOff size={18} color="#8F9CAE" />
                      ) : (
                        <Eye size={18} color="#8F9CAE" />
                      )}
                    </TouchableOpacity>
                  </View>
                </View>

                <TouchableOpacity
                  onPress={onSignUpPress}
                  disabled={loading}
                  className="w-full bg-ktm-orange rounded-xl py-3.5 items-center justify-center border border-ktm-orange shadow-[0_0_12px_rgba(255,107,0,0.4)]"
                >
                  {loading ? (
                    <ActivityIndicator color="#0B0D10" />
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
                <Text className="text-white text-lg font-bold mb-3 tracking-wide uppercase border-b border-tarmac-light pb-2">
                  Verificar Correo
                </Text>
                <Text className="text-neutral-400 text-xs mb-6">
                  Hemos enviado un código de verificación a <Text className="text-white font-medium">{email}</Text>.
                </Text>

                <View className="mb-6">
                  <Text className="text-neutral-400 text-xs uppercase mb-1.5 font-medium tracking-wide">
                    Código de 6 dígitos
                  </Text>
                  <TextInput
                    value={code}
                    placeholder="123456"
                    placeholderTextColor="#556070"
                    keyboardType="number-pad"
                    onChangeText={(code) => setCode(code)}
                    maxLength={6}
                    className="w-full bg-carbon-dark text-white border border-tarmac-light rounded-xl px-4 py-3 text-center text-lg font-orbitron tracking-[10px] focus:border-speedo-cyan"
                  />
                </View>

                <TouchableOpacity
                  onPress={onVerifyPress}
                  disabled={loading}
                  className="w-full bg-speedo-cyan rounded-xl py-3.5 items-center justify-center border border-speedo-cyan shadow-[0_0_12px_rgba(0,229,255,0.4)]"
                >
                  {loading ? (
                    <ActivityIndicator color="#0B0D10" />
                  ) : (
                    <Text className="text-carbon-matte font-bold text-sm uppercase tracking-widest">
                      CONFIRMAR CÓDIGO
                    </Text>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => setPendingVerification(false)}
                  className="mt-4 align-self-center py-2"
                >
                  <Text className="text-neutral-400 text-xs text-center uppercase tracking-wide">
                    ← Volver
                  </Text>
                </TouchableOpacity>
              </>
            )}
          </View>

          {/* Redirect to login */}
          <View className="flex-row justify-center mt-6 items-center">
            <Text className="text-neutral-400 text-sm">¿Ya tienes cuenta?</Text>
            <TouchableOpacity onPress={() => router.push('/(auth)/login')} className="ml-2">
              <Text className="text-speedo-cyan font-bold text-sm">Iniciar Sesión</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

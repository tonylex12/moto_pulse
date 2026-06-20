import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView, Keyboard } from 'react-native';
import { useSignIn } from '@clerk/clerk-expo';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Eye, EyeOff } from 'lucide-react-native';

export default function LoginScreen() {
  const { signIn, setActive, isLoaded } = useSignIn();
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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

  const onSignInPress = async () => {
    if (!isLoaded) return;
    if (!email || !password) {
      Alert.alert('Error', 'Por favor ingresa tu correo y contraseña');
      return;
    }

    setLoading(true);
    try {
      const result = await signIn.create({
        identifier: email,
        password,
      });

      if (result.status === 'complete') {
        await setActive({ session: result.createdSessionId });
        console.log('Successfully signed in!');
      } else {
        console.warn('Sign in status incomplete:', JSON.stringify(result, null, 2));
        Alert.alert('Error', 'El inicio de sesión no se pudo completar');
      }
    } catch (err: any) {
      console.error(JSON.stringify(err, null, 2));
      Alert.alert('Error de autenticación', err.errors?.[0]?.message || 'Ocurrió un error al iniciar sesión');
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
            paddingBottom: keyboardVisible ? 80 : 40 
          }} 
          className="flex-1"
          keyboardShouldPersistTaps="handled"
        >
          {/* Dashboard Header Logo */}
          <View className="items-center mb-8">
            <View className="w-16 h-16 rounded-full bg-ktm-orange items-center justify-center border-2 border-speedo-cyan shadow-[0_0_15px_#00E5FF] mb-4">
              <Text className="text-white text-3xl font-bold tracking-tighter">M</Text>
            </View>
            <Text className="text-white font-orbitron text-2xl font-bold tracking-widest text-center">
              MOTO<Text className="text-speedo-cyan">PULSE</Text>
            </Text>
            <Text className="text-neutral-400 text-xs mt-1 uppercase tracking-widest text-center">
              Tu Tablero de Control de Rutas y Mantenimiento
            </Text>
          </View>

          {/* Login Card */}
          <View className="bg-tarmac border border-tarmac-light rounded-2xl p-6 shadow-lg">
            <Text className="text-white text-lg font-bold mb-6 tracking-wide uppercase border-b border-tarmac-light pb-2">
              Iniciar Sesión
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
                  placeholder="********"
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
              onPress={onSignInPress}
              disabled={loading}
              className="w-full bg-speedo-cyan rounded-xl py-3.5 items-center justify-center border border-speedo-cyan shadow-[0_0_12px_rgba(0,229,255,0.4)]"
            >
              {loading ? (
                <ActivityIndicator color="#0B0D10" />
              ) : (
                <Text className="text-carbon-matte font-bold text-sm uppercase tracking-widest">
                  ENCENDER MOTOR
                </Text>
              )}
            </TouchableOpacity>
          </View>

          {/* Redirect to register */}
          <View className="flex-row justify-center mt-6 items-center">
            <Text className="text-neutral-400 text-sm">¿Eres un nuevo rider?</Text>
            <TouchableOpacity onPress={() => router.push('/(auth)/register')} className="ml-2">
              <Text className="text-ktm-orange font-bold text-sm">Registrarse</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

import React, { createContext, useContext, useState } from 'react';
import { Modal, View, Text, TouchableOpacity } from 'react-native';
import { useTheme } from './ThemeContext';
import { CheckCircle2, AlertTriangle, Info } from 'lucide-react-native';

export interface AlertButton {
  text: string;
  style?: 'cancel' | 'destructive' | 'default';
  onPress?: () => void;
}

interface AlertConfig {
  title: string;
  message: string;
  buttons?: AlertButton[];
  type?: 'success' | 'error' | 'warning' | 'info';
}

interface AlertContextProps {
  showAlert: (title: string, message: string, buttons?: AlertButton[], type?: 'success' | 'error' | 'warning' | 'info') => void;
}

const AlertContext = createContext<AlertContextProps | undefined>(undefined);

export const useAlert = () => {
  const context = useContext(AlertContext);
  if (!context) {
    throw new Error('useAlert must be used within an AlertProvider');
  }
  return context;
};

export const AlertProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [visible, setVisible] = useState(false);
  const [config, setConfig] = useState<AlertConfig>({ title: '', message: '' });
  const { colors } = useTheme();

  const showAlert = (title: string, message: string, buttons?: AlertButton[], type?: 'success' | 'error' | 'warning' | 'info') => {
    setConfig({ title, message, buttons, type });
    setVisible(true);
  };

  const handleButtonPress = (onPress?: () => void) => {
    setVisible(false);
    if (onPress) {
      onPress();
    }
  };

  return (
    <AlertContext.Provider value={{ showAlert }}>
      {children}
      <Modal
        visible={visible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setVisible(false)}
      >
        <View className="flex-1 bg-black/60 justify-center items-center p-6">
          <View 
            className={`border ${colors.border} rounded-3xl w-full max-w-sm overflow-hidden relative`}
            style={{
              backgroundColor: colors.isDark ? '#121620' : '#FFFFFF',
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 10 },
              shadowOpacity: colors.isDark ? 0.4 : 0.15,
              shadowRadius: 15,
              elevation: 8,
            }}
          >
            {/* Speedometer BMW Accent Bar */}
            <View 
              style={{
                height: 4,
                backgroundColor: colors.bmwBlue,
                shadowColor: colors.bmwBlue,
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 0.8,
                shadowRadius: 4,
                elevation: 3,
              }}
            />
            
            <View className="p-6">
              {/* Title with Icon */}
              {(() => {
                const alertType = config.type || (
                  /exito|exitoso|confirm|hecho|registrado|guardado|actualizado|creada|iniciada|encendido|check/i.test(config.title) ? 'success' :
                  /error|fallo|incorrecto|invalido/i.test(config.title) ? 'error' :
                  /advertencia|alerta|cuidado|aviso/i.test(config.title) ? 'warning' : 'info'
                );

                let iconComponent = null;
                if (alertType === 'success') {
                  iconComponent = <CheckCircle2 size={20} color={colors.statusGreen} />;
                } else if (alertType === 'error') {
                  iconComponent = <AlertTriangle size={20} color={colors.bmwRed} />;
                } else if (alertType === 'warning') {
                  iconComponent = <AlertTriangle size={20} color={colors.isDark ? '#FF6B00' : '#E65100'} />;
                } else if (alertType === 'info') {
                  iconComponent = <Info size={20} color={colors.bmwBlue} />;
                }

                return (
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
                    {iconComponent && (
                      <View style={{ marginRight: 8 }}>
                        {iconComponent}
                      </View>
                    )}
                    <Text className={`${colors.text} font-orbitron text-base font-bold tracking-wider uppercase flex-1`}>
                      {config.title}
                    </Text>
                  </View>
                );
              })()}
              
              {/* Message */}
              <Text className={`${colors.textSec} text-sm leading-relaxed mb-6 font-medium`}>
                {config.message}
              </Text>
              
              {/* Action Buttons */}
              <View className="flex-row justify-end flex-wrap gap-2">
                {config.buttons && config.buttons.length > 0 ? (
                  config.buttons.map((btn, index) => {
                    const isDestructive = btn.style === 'destructive';
                    const isCancel = btn.style === 'cancel';
                    
                    let btnBg = `${colors.isDark ? 'bg-[#1A202C]' : 'bg-[#EBF0F5]'} border ${colors.isDark ? 'border-[#242D3D]' : 'border-[#D8E0EB]'}`;
                    let textClass = `${colors.textSec}`;
                    let inlineStyle = {};
                    
                    if (isDestructive) {
                      btnBg = '';
                      inlineStyle = { backgroundColor: colors.bmwRed, borderColor: colors.bmwRed };
                      textClass = 'text-white font-bold';
                    } else if (!isCancel) {
                      // default/positive action button
                      btnBg = `${colors.bgAccent} ${colors.borderAccent}`;
                      textClass = `${colors.isDark ? 'text-[#0A0D12]' : 'text-white'} font-bold`;
                    }
                    
                    return (
                      <TouchableOpacity
                        key={index}
                        onPress={() => handleButtonPress(btn.onPress)}
                        className={`px-4 py-2.5 rounded-xl border ${btnBg}`}
                        style={inlineStyle}
                      >
                        <Text className={`text-xs uppercase tracking-wider ${textClass}`}>
                          {btn.text}
                        </Text>
                      </TouchableOpacity>
                    );
                  })
                ) : (
                  // Default OK button if no buttons specified
                  <TouchableOpacity
                    onPress={() => setVisible(false)}
                    className={`px-5 py-2.5 rounded-xl border ${colors.bgAccent} ${colors.borderAccent}`}
                  >
                    <Text className={`${colors.isDark ? 'text-[#0A0D12]' : 'text-white'} font-bold text-xs uppercase tracking-wider`}>
                      ACEPTAR
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </AlertContext.Provider>
  );
};

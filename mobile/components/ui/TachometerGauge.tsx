import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useTheme } from '../../utils/ThemeContext';
import { Wrench } from 'lucide-react-native';

interface TachometerGaugeProps {
  label: string;
  value: number; // current mileage / days
  target: number; // trigger mileage / days
  lastPerformedValue?: string | null;
  type: 'MILEAGE' | 'DATE';
  unit?: string;
  onPress?: () => void;
}

export const TachometerGauge: React.FC<TachometerGaugeProps> = ({
  label,
  value,
  target,
  lastPerformedValue,
  type,
  unit = 'km',
  onPress,
}) => {
  const { colors, theme } = useTheme();

  // Calculate percentage remaining
  let percentageRemaining = 100;
  let remaining = 0;

  if (type === 'MILEAGE') {
    remaining = Math.max(0, target - value);
    if (lastPerformedValue) {
      const lastVal = parseInt(lastPerformedValue);
      const interval = target - lastVal;
      if (interval > 0) {
        percentageRemaining = (remaining / interval) * 100;
      } else {
        percentageRemaining = target > 0 ? (remaining / target) * 100 : 0;
      }
    } else {
      percentageRemaining = target > 0 ? (remaining / target) * 100 : 0;
    }
  } else {
    // Date-based
    const today = new Date().getTime();
    const targetTime = new Date(target).getTime();
    remaining = Math.max(0, Math.ceil((targetTime - today) / (1000 * 60 * 60 * 24)));
    if (lastPerformedValue) {
      const lastTime = new Date(lastPerformedValue).getTime();
      const intervalDays = Math.ceil((targetTime - lastTime) / (1000 * 60 * 60 * 24));
      if (intervalDays > 0) {
        percentageRemaining = (remaining / intervalDays) * 100;
      } else {
        percentageRemaining = Math.min(100, (remaining / 365) * 100);
      }
    } else {
      // Assume max alert period is 365 days for percentage calculation
      percentageRemaining = Math.min(100, (remaining / 365) * 100);
    }
  }
  percentageRemaining = Math.max(0, Math.min(100, percentageRemaining));

  // Determine LED status colors
  let statusText = 'OK';
  let statusColor = colors.statusGreen;

  if (percentageRemaining <= 15) {
    statusText = 'CRÍTICO';
    statusColor = colors.bmwRed;
  } else if (percentageRemaining <= 40) {
    statusText = 'ADVERTENCIA';
    statusColor = colors.isDark ? '#FF6B00' : '#E65100';
  }

  // Draw 10 LED segments
  const segments = Array.from({ length: 10 });
  const filledSegments = Math.ceil((percentageRemaining / 100) * 10);

  return (
    <View 
      className={`${colors.card} rounded-xl p-4 mb-3`}
      style={{
        borderWidth: 1,
        borderColor: theme === 'light' ? '#D8E0EB' : '#242D3D',
      }}
    >
      <View className="flex-row justify-between items-center mb-2">
        <Text className={`font-rajdhani-bold text-base font-bold uppercase tracking-[1.5px] ${colors.text}`}>{label}</Text>
        <View className="flex-row items-center">
          <Text 
            className="font-rajdhani-bold text-xs uppercase tracking-[2px] font-bold"
            style={{ color: statusColor, marginRight: onPress ? 6 : 0 }}
          >
            {statusText}
          </Text>
          {onPress && (
            <TouchableOpacity 
              onPress={onPress}
              style={{
                backgroundColor: 'rgba(28, 105, 212, 0.08)',
                borderWidth: 1,
                borderColor: 'rgba(28, 105, 212, 0.25)',
                borderRadius: 6,
                paddingHorizontal: 10,
                paddingVertical: 5,
                flexDirection: 'row',
                alignItems: 'center',
              }}
            >
              <Wrench size={10} color="#1C69D4" style={{ marginRight: 4 }} />
              <Text className="font-rajdhani-bold text-[10px] text-[#1C69D4] font-bold uppercase tracking-wider">
                Registrar
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* LED Rev-counter segments */}
      <View 
        className={`flex-row justify-between h-4 w-full ${colors.isDark ? 'bg-[#0A0D12]' : 'bg-[#EBF0F5]'} rounded-md p-0.5 overflow-hidden mb-3 border ${colors.border}`}
      >
        {segments.map((_, index) => {
          const isFilled = index < filledSegments;
          
          const segmentBg = isFilled 
            ? (index < 6 
                ? colors.statusGreen 
                : (index < 9 ? (colors.isDark ? '#FF6B00' : '#E65100') : colors.bmwRed))
            : (colors.isDark ? '#2D3748' : '#D8E0EB');

          return (
            <View
              key={index}
              className={`flex-1 mx-0.5 rounded-sm ${
                isFilled && index === filledSegments - 1 ? 'opacity-90' : ''
              }`}
              style={{ backgroundColor: segmentBg }}
            />
          );
        })}
      </View>

      {/* Stats display */}
      <View className="flex-row justify-between items-baseline mb-1">
        <Text className={`font-barlow-condensed text-xs ${colors.textSec}`}>
          Restante:{' '}
          <Text className={`font-rajdhani-bold text-base font-bold ${colors.text}`}>
            {type === 'MILEAGE' 
              ? `${remaining.toLocaleString()} ${unit}` 
              : `${remaining} ${remaining === 1 ? 'día' : 'días'}`
            }
          </Text>
        </Text>
        <Text className={`font-barlow-condensed text-xs ${colors.textSec}`}>
          Límite:{' '}
          <Text className={`font-rajdhani-bold text-base font-bold ${colors.text}`}>
            {type === 'MILEAGE'
              ? `${target.toLocaleString()} ${unit}`
              : new Date(target).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })
            }
          </Text>
        </Text>
      </View>

      {/* Last performed sub-info */}
      {lastPerformedValue && (
        <View className="flex-row justify-between items-center border-t border-dashed pt-1.5 mt-1" style={{ borderColor: theme === 'light' ? '#E2E8F0' : '#2D3748' }}>
          <Text className={`font-barlow-condensed-bold text-[10px] uppercase tracking-wider ${colors.textMuted}`}>
            Último realizado:
          </Text>
          <Text className={`font-rajdhani-semibold text-sm font-semibold ${colors.textSec}`}>
            {type === 'MILEAGE'
              ? `${parseInt(lastPerformedValue).toLocaleString()} ${unit}`
              : new Date(lastPerformedValue).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })
            }
          </Text>
        </View>
      )}
    </View>
  );
};

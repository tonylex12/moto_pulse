import React from 'react';
import { View, Text } from 'react-native';
import { useTheme } from '../../utils/ThemeContext';

interface TachometerGaugeProps {
  label: string;
  value: number; // current mileage / days
  target: number; // trigger mileage / days
  type: 'MILEAGE' | 'DATE';
  unit?: string;
}

export const TachometerGauge: React.FC<TachometerGaugeProps> = ({
  label,
  value,
  target,
  type,
  unit = 'km',
}) => {
  const { colors, theme } = useTheme();

  // Calculate percentage remaining
  let percentageRemaining = 100;
  let remaining = 0;

  if (type === 'MILEAGE') {
    remaining = Math.max(0, target - value);
    percentageRemaining = target > 0 ? (remaining / target) * 100 : 0;
  } else {
    // Date-based
    const today = new Date().getTime();
    const targetTime = new Date(target).getTime();
    remaining = Math.max(0, Math.ceil((targetTime - today) / (1000 * 60 * 60 * 24)));
    // Assume max alert period is 365 days for percentage calculation
    percentageRemaining = Math.min(100, (remaining / 365) * 100);
  }

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
        <Text className={`font-medium text-base tracking-wide ${colors.text}`}>{label}</Text>
        <Text 
          className="text-xs uppercase tracking-widest font-bold"
          style={{ color: statusColor }}
        >
          {statusText}
        </Text>
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
      <View className="flex-row justify-between items-baseline">
        <Text className={`${colors.textSec} text-xs`}>
          Restante:{' '}
          <Text className={`font-orbitron font-semibold text-sm ${colors.text}`}>
            {type === 'MILEAGE' 
              ? `${remaining.toLocaleString()} ${unit}` 
              : `${remaining} ${remaining === 1 ? 'día' : 'días'}`
            }
          </Text>
        </Text>
        <Text className={`${colors.textSec} text-xs`}>
          Límite:{' '}
          <Text className={`font-orbitron text-sm ${colors.textSec}`}>
            {type === 'MILEAGE'
              ? `${target.toLocaleString()} ${unit}`
              : new Date(target).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })
            }
          </Text>
        </Text>
      </View>
    </View>
  );
};

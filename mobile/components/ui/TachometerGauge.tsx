import React from 'react';
import { View, Text } from 'react-native';

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
  let ledColorClass = 'bg-kawasaki-green shadow-[0_0_10px_#2CFF0A]';
  let statusText = 'OK';
  let textColorClass = 'text-kawasaki-green';

  if (percentageRemaining <= 15) {
    ledColorClass = 'bg-ducati-red animate-pulse shadow-[0_0_12px_#FF2A3B]';
    statusText = 'CRÍTICO';
    textColorClass = 'text-ducati-red font-bold';
  } else if (percentageRemaining <= 40) {
    ledColorClass = 'bg-ktm-orange shadow-[0_0_10px_#FF6B00]';
    statusText = 'ADVERTENCIA';
    textColorClass = 'text-ktm-orange';
  }

  // Draw 10 LED segments
  const segments = Array.from({ length: 10 });
  const filledSegments = Math.ceil((percentageRemaining / 100) * 10);

  return (
    <View className="bg-tarmac border border-tarmac-light rounded-xl p-4 mb-3">
      <View className="flex-row justify-between items-center mb-2">
        <Text className="text-white font-medium text-base tracking-wide">{label}</Text>
        <Text className={`text-xs uppercase tracking-widest font-semibold ${textColorClass}`}>
          {statusText}
        </Text>
      </View>

      {/* LED Rev-counter segments */}
      <View className="flex-row justify-between h-4 w-full bg-carbon-matte rounded-md p-0.5 overflow-hidden mb-3 border border-tarmac-light">
        {segments.map((_, index) => {
          const isFilled = index < filledSegments;
          let segmentColor = 'bg-neutral-800';

          if (isFilled) {
            if (index < 6) {
              segmentColor = 'bg-kawasaki-green';
            } else if (index < 9) {
              segmentColor = 'bg-ktm-orange';
            } else {
              segmentColor = 'bg-ducati-red';
            }
          }

          return (
            <View
              key={index}
              className={`flex-1 mx-0.5 rounded-sm ${segmentColor} ${
                isFilled && index === filledSegments - 1 ? 'opacity-90' : ''
              }`}
            />
          );
        })}
      </View>

      {/* Stats display in Speedometer mono font */}
      <View className="flex-row justify-between items-baseline">
        <Text className="text-neutral-400 text-xs">
          Restante: <Text className="font-orbitron text-white text-sm">
            {type === 'MILEAGE' 
              ? `${remaining.toLocaleString()} ${unit}` 
              : `${remaining} ${remaining === 1 ? 'día' : 'días'}`
            }
          </Text>
        </Text>
        <Text className="text-neutral-400 text-xs">
          Límite: <Text className="font-orbitron text-neutral-300 text-sm">
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

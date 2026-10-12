import React from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';
import { CloudOff, RefreshCw } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useOffline } from '../../features/offline/OfflineContext';

export function OfflineBanner() {
  const { isOnline, pendingCount, isSyncing, syncNow } = useOffline();
  const insets = useSafeAreaInsets();
  if (isOnline && pendingCount === 0 && !isSyncing) return null;

  return (
    <View
      pointerEvents="box-none"
      style={{ position: 'absolute', top: insets.top + 6, left: 16, right: 16, zIndex: 1000, alignItems: 'center' }}
    >
      <TouchableOpacity
        disabled={!isOnline || isSyncing}
        onPress={() => void syncNow()}
        style={{
          minHeight: 34, borderRadius: 18, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center',
          backgroundColor: '#121620EE', borderWidth: 1, borderColor: '#FF5A1F', gap: 8,
        }}
      >
        {isSyncing ? <ActivityIndicator size="small" color="#FF5A1F" /> : isOnline ? <RefreshCw size={14} color="#FF5A1F" /> : <CloudOff size={14} color="#FF5A1F" />}
        <Text style={{ color: '#FFFFFF', fontFamily: 'Barlow-SemiBold', fontSize: 11 }}>
          {isSyncing ? 'SINCRONIZANDO…' : !isOnline ? `MODO OFFLINE${pendingCount ? ` · ${pendingCount} PENDIENTE${pendingCount === 1 ? '' : 'S'}` : ''}` : `${pendingCount} CAMBIO${pendingCount === 1 ? '' : 'S'} POR SINCRONIZAR`}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

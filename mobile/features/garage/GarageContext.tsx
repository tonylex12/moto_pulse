import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { api } from '../../utils/api';
import type { Vehicle } from './types';

type GarageContextValue = {
  vehicles: Vehicle[];
  activeVehicle: Vehicle | null;
  loading: boolean;
  refreshGarage: () => Promise<Vehicle[]>;
  activateVehicle: (id: string) => Promise<void>;
  clearGarage: () => void;
};

const GarageContext = createContext<GarageContextValue | null>(null);

export function GarageProvider({ children }: { children: React.ReactNode }) {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(false);

  const refreshGarage = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.get<Vehicle[]>('/vehicles');
      const next = response.data ?? [];
      setVehicles(next);
      return next;
    } finally {
      setLoading(false);
    }
  }, []);

  const activateVehicle = useCallback(async (id: string) => {
    const previous = vehicles;
    setVehicles(current => current.map(v => ({ ...v, isActive: v.id === id })));
    try {
      await api.put(`/vehicles/${id}/active`);
      await refreshGarage();
    } catch (error) {
      setVehicles(previous);
      throw error;
    }
  }, [refreshGarage, vehicles]);

  const activeVehicle = useMemo(
    () => vehicles.find(vehicle => vehicle.isActive) ?? vehicles[0] ?? null,
    [vehicles],
  );

  const value = useMemo(() => ({ vehicles, activeVehicle, loading, refreshGarage, activateVehicle, clearGarage: () => setVehicles([]) }), [vehicles, activeVehicle, loading, refreshGarage, activateVehicle]);
  return <GarageContext.Provider value={value}>{children}</GarageContext.Provider>;
}

export function useGarage() {
  const context = useContext(GarageContext);
  if (!context) throw new Error('useGarage must be used within GarageProvider');
  return context;
}

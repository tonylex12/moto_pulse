export interface Vehicle {
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
  imageUrl?: string | null;
}

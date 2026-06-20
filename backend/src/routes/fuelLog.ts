import { Router, Response } from 'express';
import { prisma } from '../utils/db';
import { requireClerkAuth, AuthRequest } from '../middleware/auth';
import { checkAndTriggerAlerts } from './alert'; // Import alert checking helper
import { z } from 'zod';

const router = Router();

const fuelLogSchema = z.object({
  vehicleId: z.string().uuid(),
  odometer: z.number().int().nonnegative('Odometer must be non-negative'),
  liters: z.number().positive('Liters must be positive'),
  price: z.number().positive('Price must be positive'),
  notes: z.string().optional(),
  date: z.string().datetime({ precision: 3 }).optional().or(z.string()),
});

// GET fuel logs for a vehicle
router.get('/vehicle/:vehicleId', requireClerkAuth, async (req: AuthRequest, res: Response) => {
  try {
    const clerkId = req.auth?.userId;
    const { vehicleId } = req.params;
    if (!clerkId) return res.status(401).json({ error: 'Unauthorized' });

    // Validate ownership
    const vehicle = await prisma.vehicle.findUnique({ where: { id: vehicleId } });
    if (!vehicle) return res.status(404).json({ error: 'Vehicle not found' });
    if (vehicle.userId !== clerkId) return res.status(403).json({ error: 'Forbidden' });

    const logs = await prisma.fuelLog.findMany({
      where: { vehicleId },
      orderBy: { odometer: 'desc' },
    });

    return res.status(200).json(logs);
  } catch (error) {
    console.error('Error fetching fuel logs:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST create fuel log
router.post('/', requireClerkAuth, async (req: AuthRequest, res: Response) => {
  try {
    const clerkId = req.auth?.userId;
    if (!clerkId) return res.status(401).json({ error: 'Unauthorized' });

    const parsed = fuelLogSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.errors[0].message });
    }

    const { vehicleId, odometer, liters, price, notes, date } = parsed.data;

    // Validate vehicle ownership
    const vehicle = await prisma.vehicle.findUnique({ where: { id: vehicleId } });
    if (!vehicle) return res.status(404).json({ error: 'Vehicle not found' });
    if (vehicle.userId !== clerkId) return res.status(403).json({ error: 'Forbidden' });

    // Create the fuel log
    const log = await prisma.fuelLog.create({
      data: {
        vehicleId,
        odometer,
        liters,
        price,
        notes,
        date: date ? new Date(date) : new Date(),
      },
    });

    // If logged odometer is greater than current vehicle mileage, update it
    let updatedMileage = vehicle.currentMileage;
    if (odometer > vehicle.currentMileage) {
      const updatedVehicle = await prisma.vehicle.update({
        where: { id: vehicleId },
        data: { currentMileage: odometer },
      });
      updatedMileage = updatedVehicle.currentMileage;

      // Trigger background alert checker for mileage triggers
      try {
        await checkAndTriggerAlerts(vehicleId, updatedMileage);
      } catch (alertError) {
        console.error('Failed to trigger background alerts check:', alertError);
      }
    }

    return res.status(201).json({ log, updatedMileage });
  } catch (error) {
    console.error('Error creating fuel log:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE fuel log
router.delete('/:id', requireClerkAuth, async (req: AuthRequest, res: Response) => {
  try {
    const clerkId = req.auth?.userId;
    const { id } = req.params;
    if (!clerkId) return res.status(401).json({ error: 'Unauthorized' });

    const log = await prisma.fuelLog.findUnique({
      where: { id },
      include: { vehicle: true },
    });

    if (!log) return res.status(404).json({ error: 'Log not found' });
    if (log.vehicle.userId !== clerkId) return res.status(403).json({ error: 'Forbidden' });

    await prisma.fuelLog.delete({ where: { id } });
    return res.status(200).json({ success: true, message: 'Fuel log deleted' });
  } catch (error) {
    console.error('Error deleting fuel log:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET stats for vehicle
router.get('/stats/:vehicleId', requireClerkAuth, async (req: AuthRequest, res: Response) => {
  try {
    const clerkId = req.auth?.userId;
    const { vehicleId } = req.params;
    if (!clerkId) return res.status(401).json({ error: 'Unauthorized' });

    const vehicle = await prisma.vehicle.findUnique({ where: { id: vehicleId } });
    if (!vehicle) return res.status(404).json({ error: 'Vehicle not found' });
    if (vehicle.userId !== clerkId) return res.status(403).json({ error: 'Forbidden' });

    const logs = await prisma.fuelLog.findMany({
      where: { vehicleId },
      orderBy: { odometer: 'asc' }, // Ascending to process chronologically
    });

    if (logs.length === 0) {
      return res.status(200).json({
        totalLogs: 0,
        totalCost: 0,
        totalLiters: 0,
        totalDistance: 0,
        avgConsumption: 0, // km/L
        costPerKm: 0,
      });
    }

    const totalCost = logs.reduce((sum, log) => sum + log.price, 0);
    const totalLiters = logs.reduce((sum, log) => sum + log.liters, 0);

    let totalDistance = 0;
    let avgConsumption = 0;
    let costPerKm = 0;

    if (logs.length >= 2) {
      const minOdometer = logs[0].odometer;
      const maxOdometer = logs[logs.length - 1].odometer;
      totalDistance = maxOdometer - minOdometer;

      // Correct fuel consumption: sum of liters filled starting from second log
      // (since the first fill-up sets the baseline distance)
      const litersAfterFirst = logs.slice(1).reduce((sum, log) => sum + log.liters, 0);

      if (totalDistance > 0 && litersAfterFirst > 0) {
        avgConsumption = totalDistance / litersAfterFirst; // Kilometers per Liter
        costPerKm = totalCost / totalDistance; // Currency units per Kilometer
      }
    }

    return res.status(200).json({
      totalLogs: logs.length,
      totalCost,
      totalLiters,
      totalDistance,
      avgConsumption: parseFloat(avgConsumption.toFixed(2)),
      costPerKm: parseFloat(costPerKm.toFixed(2)),
    });
  } catch (error) {
    console.error('Error fetching fuel stats:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

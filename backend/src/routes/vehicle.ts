import { Router, Response } from 'express';
import { prisma } from '../utils/db';
import { requireClerkAuth, AuthRequest } from '../middleware/auth';
import { z } from 'zod';
import { fetchVehicleSpecs } from '../utils/gemini';

const router = Router();

const vehicleSchema = z.object({
  brand: z.string().min(1, 'Brand is required'),
  model: z.string().min(1, 'Model is required'),
  year: z.number().int().min(1900).max(new Date().getFullYear() + 2),
  currentMileage: z.number().int().nonnegative('Mileage must be non-negative'),
});

// GET all vehicles for user
router.get('/', requireClerkAuth, async (req: AuthRequest, res: Response) => {
  try {
    const clerkId = req.auth?.userId;
    if (!clerkId) return res.status(401).json({ error: 'Unauthorized' });

    let vehicles = await prisma.vehicle.findMany({
      where: { userId: clerkId },
      orderBy: { createdAt: 'desc' },
    });

    // Self-healing: if user has vehicles but none is active, make the first one active in DB
    if (vehicles.length > 0 && !vehicles.some(v => v.isActive)) {
      await prisma.vehicle.update({
        where: { id: vehicles[0].id },
        data: { isActive: true }
      });
      // Update local array object so the response reflects the state change
      vehicles[0].isActive = true;
    }

    return res.status(200).json(vehicles);
  } catch (error) {
    console.error('Error fetching vehicles:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET single vehicle
router.get('/:id', requireClerkAuth, async (req: AuthRequest, res: Response) => {
  try {
    const clerkId = req.auth?.userId;
    const { id } = req.params;
    if (!clerkId) return res.status(401).json({ error: 'Unauthorized' });

    const vehicle = await prisma.vehicle.findUnique({
      where: { id },
    });

    if (!vehicle) {
      return res.status(404).json({ error: 'Vehicle not found' });
    }

    if (vehicle.userId !== clerkId) {
      return res.status(403).json({ error: 'Forbidden: You do not own this vehicle' });
    }

    return res.status(200).json(vehicle);
  } catch (error) {
    console.error('Error fetching vehicle:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST create vehicle
router.post('/', requireClerkAuth, async (req: AuthRequest, res: Response) => {
  try {
    const clerkId = req.auth?.userId;
    if (!clerkId) return res.status(401).json({ error: 'Unauthorized' });

    const parsed = vehicleSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.errors[0].message });
    }

    const { brand, model, year, currentMileage } = parsed.data;

    // Ensure User exists in local DB before creating vehicle
    const userExists = await prisma.user.findUnique({ where: { clerkId } });
    if (!userExists) {
      // Auto-create local user profile as a fallback
      await prisma.user.create({
        data: { clerkId, email: 'user@clerk.temp' } // Will sync actual email on next call
      });
    }

    // Set all existing vehicles to inactive since the new one will become the active one
    await prisma.vehicle.updateMany({
      where: { userId: clerkId },
      data: { isActive: false },
    });

    // Call Gemini utility to search the web for bike specs (non-blocking fallback)
    let specsData = null;
    try {
      specsData = await fetchVehicleSpecs(brand, model, year);
    } catch (geminiErr) {
      console.error('Failed to fetch specs from Gemini (non-blocking):', geminiErr);
    }

    const vehicle = await prisma.vehicle.create({
      data: {
        brand,
        model,
        year,
        currentMileage,
        userId: clerkId,
        isActive: true, // This is the new active vehicle

        // Specifications
        tankSize: specsData?.tankSize || null,
        frontBrake: specsData?.frontBrake || null,
        rearBrake: specsData?.rearBrake || null,
        frontSuspension: specsData?.frontSuspension || null,
        rearSuspension: specsData?.rearSuspension || null,
        frontTire: specsData?.frontTire || null,
        rearTire: specsData?.rearTire || null,
        engineCc: specsData?.engineCc || null,
        power: specsData?.power || null,
        torque: specsData?.torque || null,
        transmission: specsData?.transmission || null,
        weight: specsData?.weight || null,
        seatHeight: specsData?.seatHeight || null,
        specSource: specsData ? 'Búsqueda Web' : null,
      },
    });

    return res.status(201).json(vehicle);
  } catch (error) {
    console.error('Error creating vehicle:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT update vehicle
router.put('/:id', requireClerkAuth, async (req: AuthRequest, res: Response) => {
  try {
    const clerkId = req.auth?.userId;
    const { id } = req.params;
    if (!clerkId) return res.status(401).json({ error: 'Unauthorized' });

    const updateSchema = vehicleSchema.partial();
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.errors[0].message });
    }

    const vehicle = await prisma.vehicle.findUnique({ where: { id } });
    if (!vehicle) {
      return res.status(404).json({ error: 'Vehicle not found' });
    }

    if (vehicle.userId !== clerkId) {
      return res.status(403).json({ error: 'Forbidden: You do not own this vehicle' });
    }

    const updatedVehicle = await prisma.vehicle.update({
      where: { id },
      data: parsed.data,
    });

    return res.status(200).json(updatedVehicle);
  } catch (error) {
    console.error('Error updating vehicle:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE vehicle
router.delete('/:id', requireClerkAuth, async (req: AuthRequest, res: Response) => {
  try {
    const clerkId = req.auth?.userId;
    const { id } = req.params;
    if (!clerkId) return res.status(401).json({ error: 'Unauthorized' });

    const vehicle = await prisma.vehicle.findUnique({ where: { id } });
    if (!vehicle) {
      return res.status(404).json({ error: 'Vehicle not found' });
    }

    if (vehicle.userId !== clerkId) {
      return res.status(403).json({ error: 'Forbidden: You do not own this vehicle' });
    }

    await prisma.vehicle.delete({ where: { id } });
    return res.status(200).json({ success: true, message: 'Vehicle deleted' });
  } catch (error) {
    console.error('Error deleting vehicle:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT set active vehicle
router.put('/:id/active', requireClerkAuth, async (req: AuthRequest, res: Response) => {
  try {
    const clerkId = req.auth?.userId;
    const { id } = req.params;
    if (!clerkId) return res.status(401).json({ error: 'Unauthorized' });

    // Validate vehicle ownership
    const vehicle = await prisma.vehicle.findUnique({ where: { id } });
    if (!vehicle) {
      return res.status(404).json({ error: 'Vehicle not found' });
    }

    if (vehicle.userId !== clerkId) {
      return res.status(403).json({ error: 'Forbidden: You do not own this vehicle' });
    }

    // Set all other user vehicles to inactive
    await prisma.vehicle.updateMany({
      where: { userId: clerkId },
      data: { isActive: false },
    });

    // Set this vehicle to active
    const updatedVehicle = await prisma.vehicle.update({
      where: { id },
      data: { isActive: true },
    });

    return res.status(200).json({ success: true, vehicle: updatedVehicle });
  } catch (error) {
    console.error('Error setting active vehicle:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST fetch specifications using Gemini for an existing vehicle
router.post('/:id/fetch-specs', requireClerkAuth, async (req: AuthRequest, res: Response) => {
  try {
    const clerkId = req.auth?.userId;
    const { id } = req.params;
    if (!clerkId) return res.status(401).json({ error: 'Unauthorized' });

    // Validate ownership
    const vehicle = await prisma.vehicle.findUnique({ where: { id } });
    if (!vehicle) {
      return res.status(404).json({ error: 'Vehicle not found' });
    }

    if (vehicle.userId !== clerkId) {
      return res.status(403).json({ error: 'Forbidden: You do not own this vehicle' });
    }

    console.log(`🤖 Triggering specs lookup for existing vehicle: ${vehicle.brand} ${vehicle.model} (${vehicle.year})`);

    const specsData = await fetchVehicleSpecs(vehicle.brand, vehicle.model, vehicle.year);
    if (!specsData) {
      return res.status(400).json({ error: 'No se pudieron extraer las especificaciones desde la web. Inténtalo de nuevo.' });
    }

    // Update vehicle with the fetched specs
    const updatedVehicle = await prisma.vehicle.update({
      where: { id },
      data: {
        tankSize: specsData.tankSize || null,
        frontBrake: specsData.frontBrake || null,
        rearBrake: specsData.rearBrake || null,
        frontSuspension: specsData.frontSuspension || null,
        rearSuspension: specsData.rearSuspension || null,
        frontTire: specsData.frontTire || null,
        rearTire: specsData.rearTire || null,
        engineCc: specsData.engineCc || null,
        power: specsData.power || null,
        torque: specsData.torque || null,
        transmission: specsData.transmission || null,
        weight: specsData.weight || null,
        seatHeight: specsData.seatHeight || null,
        specSource: 'Búsqueda Web',
      },
    });

    return res.status(200).json(updatedVehicle);
  } catch (error) {
    console.error('Error fetching specs for vehicle:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

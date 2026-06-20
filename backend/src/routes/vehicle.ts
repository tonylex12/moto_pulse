import { Router, Response } from 'express';
import { prisma } from '../utils/db';
import { requireClerkAuth, AuthRequest } from '../middleware/auth';
import { z } from 'zod';

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

    const vehicles = await prisma.vehicle.findMany({
      where: { userId: clerkId },
      orderBy: { createdAt: 'desc' },
    });

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

    const vehicle = await prisma.vehicle.create({
      data: {
        brand,
        model,
        year,
        currentMileage,
        userId: clerkId,
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

export default router;

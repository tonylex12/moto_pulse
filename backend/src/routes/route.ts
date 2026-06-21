import { Router, Response } from 'express';
import { prisma } from '../utils/db';
import { requireClerkAuth, AuthRequest } from '../middleware/auth';
import { z } from 'zod';

const router = Router();

const coordinateSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
});

const routeSchema = z.object({
  name: z.string().min(1, 'Route name is required'),
  coordinates: z.array(coordinateSchema).min(1, 'Coordinates list cannot be empty'),
  startPoint: z.string().optional().nullable(),
  endPoint: z.string().optional().nullable(),
  distance: z.number().nonnegative().optional().nullable(), // in km
  notes: z.string().optional().nullable(),
  maxSpeed: z.number().nonnegative().optional().nullable(),
  maxLeftLean: z.number().nonnegative().optional().nullable(),
  maxRightLean: z.number().nonnegative().optional().nullable(),
});

// GET all saved routes for user
router.get('/', requireClerkAuth, async (req: AuthRequest, res: Response) => {
  try {
    const clerkId = req.auth().userId;
    if (!clerkId) return res.status(401).json({ error: 'Unauthorized' });

    const routes = await prisma.savedRoute.findMany({
      where: { userId: clerkId },
      orderBy: { createdAt: 'desc' },
    });

    return res.status(200).json(routes);
  } catch (error) {
    console.error('Error fetching routes:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST save a route
router.post('/', requireClerkAuth, async (req: AuthRequest, res: Response) => {
  try {
    const clerkId = req.auth().userId;
    if (!clerkId) return res.status(401).json({ error: 'Unauthorized' });

    const parsed = routeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.errors[0].message });
    }

    const { name, coordinates, startPoint, endPoint, distance, notes, maxSpeed, maxLeftLean, maxRightLean } = parsed.data;

    // Convert coordinates to JSON format for Prisma
    const coordsJson = JSON.parse(JSON.stringify(coordinates));

    const savedRoute = await prisma.savedRoute.create({
      data: {
        name,
        coordinates: coordsJson,
        startPoint,
        endPoint,
        distance,
        notes,
        maxSpeed,
        maxLeftLean,
        maxRightLean,
        userId: clerkId,
      },
    });

    return res.status(201).json(savedRoute);
  } catch (error) {
    console.error('Error creating route:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE a saved route
router.delete('/:id', requireClerkAuth, async (req: AuthRequest, res: Response) => {
  try {
    const clerkId = req.auth().userId;
    const { id } = req.params;
    if (!clerkId) return res.status(401).json({ error: 'Unauthorized' });

    const route = await prisma.savedRoute.findUnique({ where: { id } });
    if (!route) {
      return res.status(404).json({ error: 'Route not found' });
    }

    if (route.userId !== clerkId) {
      return res.status(403).json({ error: 'Forbidden: You do not own this route' });
    }

    await prisma.savedRoute.delete({ where: { id } });
    return res.status(200).json({ success: true, message: 'Route deleted successfully' });
  } catch (error) {
    console.error('Error deleting route:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

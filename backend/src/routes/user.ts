import { Router, Response } from 'express';
import { prisma } from '../utils/db';
import { requireClerkAuth, AuthRequest } from '../middleware/auth';
import { z } from 'zod';

const router = Router();

// Sync user from Clerk to local PostgreSQL database
// POST /api/users/sync
router.post('/sync', requireClerkAuth, async (req: AuthRequest, res: Response) => {
  try {
    const clerkId = req.auth?.userId;
    if (!clerkId) {
      return res.status(401).json({ error: 'Clerk User ID missing from token' });
    }

    const bodySchema = z.object({
      email: z.string().email(),
    });

    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid email in request body' });
    }

    const { email } = parsed.data;

    // Upsert user in the database
    const user = await prisma.user.upsert({
      where: { clerkId },
      update: { email },
      create: { clerkId, email },
    });

    return res.status(200).json({ success: true, user });
  } catch (error: any) {
    console.error('Error syncing user:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Update Expo Push Token
// POST /api/users/push-token
router.post('/push-token', requireClerkAuth, async (req: AuthRequest, res: Response) => {
  try {
    const clerkId = req.auth?.userId;
    if (!clerkId) {
      return res.status(401).json({ error: 'Clerk User ID missing from token' });
    }

    const bodySchema = z.object({
      expoPushToken: z.string().min(1),
    });

    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid or missing expoPushToken' });
    }

    const { expoPushToken } = parsed.data;

    const user = await prisma.user.update({
      where: { clerkId },
      data: { expoPushToken },
    });

    return res.status(200).json({ success: true, message: 'Push token updated successfully', user });
  } catch (error: any) {
    console.error('Error updating push token:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

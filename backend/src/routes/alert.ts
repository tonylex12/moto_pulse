import { Router, Response, Request } from 'express';
import { prisma } from '../utils/db';
import { requireClerkAuth, AuthRequest } from '../middleware/auth';
import { Expo, ExpoPushMessage } from 'expo-server-sdk';
import { z } from 'zod';

const router = Router();
const expo = new Expo();

const alertSchema = z.object({
  vehicleId: z.string().uuid(),
  type: z.enum(['OIL_CHANGE', 'BRAKE_PADS', 'INSURANCE_RENEWAL', 'PREVENTIVE_MAINTENANCE', 'CUSTOM']),
  title: z.string().min(1, 'Title is required'),
  triggerType: z.enum(['MILEAGE', 'DATE']),
  triggerValue: z.string().min(1, 'Trigger value is required'),
  lastPerformedValue: z.string().nullable().optional(),
  isCompleted: z.boolean().optional(),
});

// GET alerts for a vehicle
router.get('/vehicle/:vehicleId', requireClerkAuth, async (req: AuthRequest, res: Response) => {
  try {
    const clerkId = req.auth().userId;
    const { vehicleId } = req.params;
    if (!clerkId) return res.status(401).json({ error: 'Unauthorized' });

    // Validate ownership
    const vehicle = await prisma.vehicle.findUnique({ where: { id: vehicleId } });
    if (!vehicle) return res.status(404).json({ error: 'Vehicle not found' });
    if (vehicle.userId !== clerkId) return res.status(403).json({ error: 'Forbidden' });

    const alerts = await prisma.maintenanceAlert.findMany({
      where: { vehicleId },
      orderBy: [
        { isCompleted: 'asc' },
        { createdAt: 'desc' }
      ],
    });

    return res.status(200).json(alerts);
  } catch (error) {
    console.error('Error fetching alerts:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST create alert
router.post('/', requireClerkAuth, async (req: AuthRequest, res: Response) => {
  try {
    const clerkId = req.auth().userId;
    if (!clerkId) return res.status(401).json({ error: 'Unauthorized' });

    const parsed = alertSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.errors[0].message });
    }

    const { vehicleId, type, title, triggerType, triggerValue, lastPerformedValue } = parsed.data;

    // Validate vehicle ownership
    const vehicle = await prisma.vehicle.findUnique({ where: { id: vehicleId } });
    if (!vehicle) return res.status(404).json({ error: 'Vehicle not found' });
    if (vehicle.userId !== clerkId) return res.status(403).json({ error: 'Forbidden' });

    // Validate trigger value formatting
    if (triggerType === 'MILEAGE') {
      const mileageNum = parseInt(triggerValue);
      if (isNaN(mileageNum) || mileageNum <= 0) {
        return res.status(400).json({ error: 'For MILEAGE triggers, triggerValue must be a positive number' });
      }
    } else {
      const dateVal = Date.parse(triggerValue);
      if (isNaN(dateVal)) {
        return res.status(400).json({ error: 'For DATE triggers, triggerValue must be a valid date' });
      }
    }

    const alert = await prisma.maintenanceAlert.create({
      data: {
        vehicleId,
        type,
        title,
        triggerType,
        triggerValue,
        lastPerformedValue: lastPerformedValue || null,
        isCompleted: false,
      },
    });

    return res.status(201).json(alert);
  } catch (error) {
    console.error('Error creating alert:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT update alert (e.g. mark as completed)
router.put('/:id', requireClerkAuth, async (req: AuthRequest, res: Response) => {
  try {
    const clerkId = req.auth().userId;
    const { id } = req.params;
    if (!clerkId) return res.status(401).json({ error: 'Unauthorized' });

    const updateSchema = alertSchema.partial();
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.errors[0].message });
    }

    const alert = await prisma.maintenanceAlert.findUnique({
      where: { id },
      include: { vehicle: true },
    });

    if (!alert) return res.status(404).json({ error: 'Alert not found' });
    if (alert.vehicle.userId !== clerkId) return res.status(403).json({ error: 'Forbidden' });

    const updatedAlert = await prisma.maintenanceAlert.update({
      where: { id },
      data: parsed.data,
    });

    return res.status(200).json(updatedAlert);
  } catch (error) {
    console.error('Error updating alert:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE alert
router.delete('/:id', requireClerkAuth, async (req: AuthRequest, res: Response) => {
  try {
    const clerkId = req.auth().userId;
    const { id } = req.params;
    if (!clerkId) return res.status(401).json({ error: 'Unauthorized' });

    const alert = await prisma.maintenanceAlert.findUnique({
      where: { id },
      include: { vehicle: true },
    });

    if (!alert) return res.status(404).json({ error: 'Alert not found' });
    if (alert.vehicle.userId !== clerkId) return res.status(403).json({ error: 'Forbidden' });

    await prisma.maintenanceAlert.delete({ where: { id } });
    return res.status(200).json({ success: true, message: 'Alert deleted' });
  } catch (error) {
    console.error('Error deleting alert:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Dispatch push notifications using Expo
 */
async function sendPushNotification(expoPushToken: string, title: string, body: string, data: Record<string, unknown> = {}) {
  if (!Expo.isExpoPushToken(expoPushToken)) {
    console.error(`Push token ${expoPushToken} is not a valid Expo push token`);
    return;
  }

  const messages: ExpoPushMessage[] = [{
    to: expoPushToken,
    sound: 'default',
    title,
    body,
    data,
  }];

  const chunks = expo.chunkPushNotifications(messages);
  for (const chunk of chunks) {
    try {
      const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
      console.log('Push tickets received:', ticketChunk);
    } catch (error) {
      console.error('Error sending push notification chunk:', error);
    }
  }
}

/**
 * Check and trigger mileage-based alerts when a vehicle's odometer updates.
 * Exposes a helper to be triggered internally.
 */
export async function checkAndTriggerAlerts(vehicleId: string, currentMileage: number) {
  try {
    // Find uncompleted mileage alerts for this vehicle
    const pendingAlerts = await prisma.maintenanceAlert.findMany({
      where: {
        vehicleId,
        triggerType: 'MILEAGE',
        isCompleted: false,
      },
      include: {
        vehicle: {
          include: {
            user: true,
          },
        },
      },
    });

    for (const alert of pendingAlerts) {
      const targetMileage = parseInt(alert.triggerValue);
      if (!isNaN(targetMileage) && currentMileage >= targetMileage) {
        // Threshold crossed!
        console.log(`Alert triggered: ${alert.title} for vehicle ${alert.vehicle.model}. Mileage: ${currentMileage}/${targetMileage}`);

        // Mark alert as triggered (completed/notified)
        // Wait: do we mark it completed? Let's just keep it pending but maybe update state, or mark completed
        // so the user knows they need to log a new oil change alert or dismiss this one.
        // Let's mark it as completed/notified or let the user mark it completed. 
        // For simple push notifications, we can keep it as is, or update its status. Let's mark it completed: true.
        await prisma.maintenanceAlert.update({
          where: { id: alert.id },
          data: { isCompleted: true },
        });

        // Send Push Notification
        const pushToken = alert.vehicle.user.expoPushToken;
        if (pushToken) {
          const bikeName = `${alert.vehicle.brand} ${alert.vehicle.model}`;
          const title = `Mantenimiento: ${alert.title} 🛠️`;
          const body = `Tu ${bikeName} ha alcanzado los ${currentMileage} km. Se requiere cambiar/revisar: ${alert.title.toLowerCase()}.`;
          await sendPushNotification(pushToken, title, body, { alertId: alert.id, vehicleId });
        }
      }
    }
  } catch (error) {
    console.error('Error checking mileage alerts:', error);
  }
}

/**
 * Check and trigger date-based alerts (e.g. insurance renewals)
 * Designed to be called by a scheduled job or cron worker.
 */
export async function checkDateAlerts() {
  try {
    const today = new Date();
    // Alerts trigger within a window, e.g., if target date is in the past or within 7 days, and is uncompleted
    const warningWindow = new Date();
    warningWindow.setDate(today.getDate() + 7); // 7 days warning

    const pendingAlerts = await prisma.maintenanceAlert.findMany({
      where: {
        triggerType: 'DATE',
        isCompleted: false,
      },
      include: {
        vehicle: {
          include: {
            user: true,
          },
        },
      },
    });

    for (const alert of pendingAlerts) {
      const targetDate = new Date(alert.triggerValue);
      if (!isNaN(targetDate.getTime()) && targetDate <= warningWindow) {
        console.log(`Date Alert triggered: ${alert.title} (Target: ${alert.triggerValue})`);

        // Send Push Notification
        const pushToken = alert.vehicle.user.expoPushToken;
        if (pushToken) {
          const daysLeft = Math.ceil((targetDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
          const bikeName = `${alert.vehicle.brand} ${alert.vehicle.model}`;
          
          let title = `Alerta de Seguro/Alerta 📋`;
          let body = `El seguro/alerta "${alert.title}" de tu ${bikeName} expira pronto.`;
          
          if (daysLeft < 0) {
            body = `¡ATENCIÓN! "${alert.title}" para tu ${bikeName} venció hace ${Math.abs(daysLeft)} días.`;
          } else if (daysLeft === 0) {
            body = `¡HOY vence "${alert.title}" de tu ${bikeName}!`;
          } else {
            body = `Quedan ${daysLeft} días para el vencimiento de "${alert.title}" en tu ${bikeName}.`;
          }

          await sendPushNotification(pushToken, title, body, { alertId: alert.id });
          
          // Mark completed once we alert them (or if they request, keep alerts recurrent)
          // To prevent daily duplicates, we mark completed after sending if it is overdue or exactly today,
          // or we can track notification history. For simplicity, mark completed once notified.
          await prisma.maintenanceAlert.update({
            where: { id: alert.id },
            data: { isCompleted: true },
          });
        }
      }
    }
  } catch (error) {
    console.error('Error checking date alerts:', error);
  }
}

export default router;

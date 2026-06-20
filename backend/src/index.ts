import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import userRouter from './routes/user';
import vehicleRouter from './routes/vehicle';
import fuelLogRouter from './routes/fuelLog';
import alertRouter, { checkDateAlerts } from './routes/alert';
import routeRouter from './routes/route';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS for Expo clients
app.use(cors({
  origin: '*', // In development, allow requests from any source (Expo Go devices)
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// Base health check
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', timestamp: new Date() });
});

// Register routers
app.use('/api/users', userRouter);
app.use('/api/vehicles', vehicleRouter);
app.use('/api/fuel-logs', fuelLogRouter);
app.use('/api/alerts', alertRouter);
app.use('/api/routes', routeRouter);

// Expose a public endpoint to trigger date-based cron checks (e.g. from an external server cron)
app.post('/api/cron/check-alerts', async (req, res) => {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers['authorization'];
  
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized cron trigger' });
  }

  try {
    console.log('Running scheduled date-based alerts check via HTTP POST...');
    await checkDateAlerts();
    return res.status(200).json({ success: true, message: 'Cron alerts checked successfully' });
  } catch (error) {
    console.error('Error running cron alerts check:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Also run an internal scheduler inside the Node process to check alerts every 12 hours
const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;
setInterval(async () => {
  console.log('Running automatic date-based alerts check (12-hour scheduler)...');
  try {
    await checkDateAlerts();
  } catch (error) {
    console.error('Error in automatic date alerts check:', error);
  }
}, TWELVE_HOURS_MS);

// Start the server
app.listen(PORT, () => {
  console.log(`🏍️ MotoPulse backend server running on http://localhost:${PORT}`);
  
  // Run an initial check on start to capture any missed alerts
  setTimeout(async () => {
    console.log('Running startup date-based alerts check...');
    try {
      await checkDateAlerts();
    } catch (e) {
      console.error('Startup alert check error:', e);
    }
  }, 5000);
});

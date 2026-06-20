import { Request, Response, NextFunction } from 'express';
import { requireAuth } from '@clerk/express';

// Define a custom interface for authenticated requests
export interface AuthRequest extends Request {
  auth?: {
    userId: string;
    sessionId?: string;
    actor?: any;
    claims?: any;
  };
}

// Wrapper middleware to require authentication via Clerk
export const requireClerkAuth = (req: Request, res: Response, next: NextFunction) => {
  // Clerk's requireAuth() middleware handles checking the JWT token.
  // It returns a middleware function. We run it directly here.
  requireAuth()(req, res, (err) => {
    if (err) {
      return res.status(401).json({ error: 'Unauthorized: Invalid or missing Clerk session token' });
    }
    next();
  });
};

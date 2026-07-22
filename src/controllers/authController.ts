import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

const loginSchema = z.object({
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
});

export class AuthController {
  public login = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { username, password } = loginSchema.parse(req.body);

      if (username === 'admin' && password === env.ADMIN_PASSWORD) {
        const token = jwt.sign({ username }, env.JWT_SECRET!, { expiresIn: '24h' });
        res.json({ token });
        return;
      }

      res.status(401).json({ error: 'Unauthorized', message: 'Invalid credentials' });
    } catch (err) {
      next(err);
    }
  };
}

export const authController = new AuthController();

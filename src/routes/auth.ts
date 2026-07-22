import { Router } from 'express';
import { authController } from '../controllers/authController.js';
import { loginLimiter } from '../middleware/rateLimiter.js';

const router = Router();

router.post('/api/auth/login', loginLimiter, authController.login);

export default router;

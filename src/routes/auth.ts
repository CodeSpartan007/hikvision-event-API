import { Router } from 'express';
import { authController } from '../controllers/authController.js';

const router = Router();

router.post('/api/auth/login', authController.login);

export default router;

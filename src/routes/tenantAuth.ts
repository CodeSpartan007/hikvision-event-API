import { Router } from 'express';
import { tenantAuthController } from '../controllers/tenantAuthController.js';
import { loginLimiter } from '../middleware/rateLimiter.js';
import { flexibleAuthMiddleware } from '../middleware/flexibleAuth.js';

const router = Router();

router.post('/api/tenant/register', loginLimiter, tenantAuthController.register);
router.post('/api/tenant/login', loginLimiter, tenantAuthController.login);
router.get('/api/tenant/me', flexibleAuthMiddleware, tenantAuthController.getProfile);

export default router;

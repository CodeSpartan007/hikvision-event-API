import { Router } from 'express';
import { tenantAuthController } from '../controllers/tenantAuthController.js';
import { loginLimiter } from '../middleware/rateLimiter.js';
import { flexibleAuthMiddleware } from '../middleware/flexibleAuth.js';

const router = Router();

router.post('/api/tenant/register', loginLimiter, tenantAuthController.register);
router.post('/api/tenant/login', loginLimiter, tenantAuthController.login);
router.post('/api/tenant/forgot-password', loginLimiter, tenantAuthController.forgotPassword);
router.post('/api/tenant/reset-password', loginLimiter, tenantAuthController.resetPassword);
router.get('/api/tenant/me', flexibleAuthMiddleware, tenantAuthController.getProfile);

export default router;

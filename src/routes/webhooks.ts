import { Router } from 'express';
import multer from 'multer';
import { webhookController } from '../controllers/webhookController.js';
import { webhookLimiter } from '../middleware/rateLimiter.js';

const router = Router();

const upload = multer({
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
});

router.post(
  '/api/webhooks/hikvision',
  webhookLimiter,
  upload.any(),
  webhookController.receiveHikvisionWebhook
);

router.post(
  '/api/webhooks/:source',
  webhookLimiter,
  upload.any(),
  webhookController.receiveWebhook
);

export default router;

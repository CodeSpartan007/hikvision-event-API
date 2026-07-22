import { Router } from 'express';
import { deviceController } from '../controllers/deviceController.js';

const router = Router();

router.get('/api/devices', deviceController.getDevices);
router.get('/api/devices/:id', deviceController.getDeviceById);
router.patch('/api/devices/:id', deviceController.updateDevice);

export default router;

import { Router } from 'express';
import { deviceController } from '../controllers/deviceController.js';

const router = Router();

router.get('/api/devices', deviceController.getDevices);
router.post('/api/devices', deviceController.createDevice);
router.get('/api/devices/:id', deviceController.getDeviceById);
router.patch('/api/devices/:id', deviceController.updateDevice);
router.delete('/api/devices/:id', deviceController.deleteDevice);

export default router;

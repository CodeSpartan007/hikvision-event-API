import { Router } from 'express';
import { eventController } from '../controllers/eventController.js';

const router = Router();

router.get('/api/events', eventController.getEvents);
router.get('/api/events/:id', eventController.getEventById);

export default router;

import { Router } from 'express';
import crypto from 'node:crypto';
import { prisma } from '../database/prisma.js';
import { validateSafeWebhookUrl } from '../utils/urlValidator.js';
import { adminOnlyMiddleware } from '../middleware/auth.js';

const router = Router();

const VALID_EVENT_TYPES = new Set([
  'CHECK_IN',
  'CHECK_OUT',
  'DOOR_OPEN',
  'DOOR_CLOSED',
  'DOOR_FORCED',
  'MOTION',
  'CAMERA_OFFLINE',
  'HEARTBEAT',
  'UNKNOWN',
  '*',
]);

router.post('/api/webhooks/subscriptions', adminOnlyMiddleware, async (req, res) => {
  const { url, eventTypes } = req.body;

  if (!url || typeof url !== 'string' || !Array.isArray(eventTypes) || eventTypes.length === 0) {
    res.status(400).json({
      error: 'Bad Request',
      message: 'URL (string) and a non-empty array of eventTypes are required',
    });
    return;
  }

  const normalizedEventTypes = eventTypes.map((type: unknown) => String(type).trim().toUpperCase());
  const invalidTypes = normalizedEventTypes.filter((type) => !VALID_EVENT_TYPES.has(type));
  if (invalidTypes.length > 0) {
    res.status(400).json({
      error: 'Bad Request',
      message: `Invalid event type(s) specified: ${invalidTypes.join(', ')}. Valid types are: ${Array.from(VALID_EVENT_TYPES).join(', ')}`,
    });
    return;
  }

  const validation = await validateSafeWebhookUrl(url);
  if (!validation.valid) {
    res.status(400).json({
      error: 'Bad Request',
      message: validation.reason || 'Invalid or unsafe webhook target URL provided',
    });
    return;
  }

  try {
    const webhookSecret = 'whsec_' + crypto.randomBytes(24).toString('hex');
    const tenantId = req.user?.role === 'SUPER_ADMIN' ? (req.body.tenantId || null) : (req.user?.tenantId || null);

    const subscription = await prisma.webhookSubscriptions.create({
      data: {
        tenantId,
        url,
        secret: webhookSecret,
        eventTypes: normalizedEventTypes,
      },
    });

    res.status(201).json({
      message: 'Webhook subscription registered successfully',
      subscriptionId: subscription.id,
      tenantId: subscription.tenantId,
      url: subscription.url,
      eventTypes: subscription.eventTypes,
      webhookSecret,
      createdAt: subscription.createdAt,
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error', message: 'Failed to register webhook subscription' });
  }
});

router.get('/api/webhooks/subscriptions', async (req, res) => {
  try {
    const where: any = {};
    if (req.user?.role !== 'SUPER_ADMIN') {
      where.tenantId = req.user?.tenantId || null;
    }

    const subscriptions = await prisma.webhookSubscriptions.findMany({
      where,
      select: {
        id: true,
        tenantId: true,
        url: true,
        eventTypes: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    res.status(200).json({ data: subscriptions });
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error', message: 'Failed to retrieve webhook subscriptions' });
  }
});

router.get('/api/webhooks/subscriptions/:id', async (req, res) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

  try {
    const where: any = { id };
    if (req.user?.role !== 'SUPER_ADMIN') {
      where.tenantId = req.user?.tenantId || null;
    }

    const subscription = await prisma.webhookSubscriptions.findFirst({
      where,
      select: {
        id: true,
        tenantId: true,
        url: true,
        eventTypes: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!subscription) {
      res.status(404).json({ error: 'Not Found', message: 'Webhook subscription not found' });
      return;
    }

    res.status(200).json(subscription);
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error', message: 'Failed to retrieve webhook subscription' });
  }
});

router.patch('/api/webhooks/subscriptions/:id', adminOnlyMiddleware, async (req, res) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const { url, eventTypes, isActive } = req.body;

  try {
    const where: any = { id };
    if (req.user?.role !== 'SUPER_ADMIN') {
      where.tenantId = req.user?.tenantId || null;
    }

    const existing = await prisma.webhookSubscriptions.findFirst({ where });
    if (!existing) {
      res.status(404).json({ error: 'Not Found', message: 'Webhook subscription not found' });
      return;
    }

    const updateData: any = {};

    if (typeof isActive === 'boolean') {
      updateData.isActive = isActive;
    }

    if (url !== undefined) {
      if (typeof url !== 'string' || !url.trim()) {
        res.status(400).json({ error: 'Bad Request', message: 'URL must be a non-empty string' });
        return;
      }
      const validation = await validateSafeWebhookUrl(url);
      if (!validation.valid) {
        res.status(400).json({ error: 'Bad Request', message: validation.reason || 'Invalid webhook URL' });
        return;
      }
      updateData.url = url;
    }

    if (eventTypes !== undefined) {
      if (!Array.isArray(eventTypes) || eventTypes.length === 0) {
        res.status(400).json({ error: 'Bad Request', message: 'eventTypes must be a non-empty array' });
        return;
      }
      const normalized = eventTypes.map((type: unknown) => String(type).trim().toUpperCase());
      const invalidTypes = normalized.filter((type) => !VALID_EVENT_TYPES.has(type));
      if (invalidTypes.length > 0) {
        res.status(400).json({
          error: 'Bad Request',
          message: `Invalid event type(s) specified: ${invalidTypes.join(', ')}`,
        });
        return;
      }
      updateData.eventTypes = normalized;
    }

    const updated = await prisma.webhookSubscriptions.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        tenantId: true,
        url: true,
        eventTypes: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    res.status(200).json(updated);
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error', message: 'Failed to update webhook subscription' });
  }
});

router.delete('/api/webhooks/subscriptions/:id', adminOnlyMiddleware, async (req, res) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

  try {
    const where: any = { id };
    if (req.user?.role !== 'SUPER_ADMIN') {
      where.tenantId = req.user?.tenantId || null;
    }

    const existing = await prisma.webhookSubscriptions.findFirst({ where });
    if (!existing) {
      res.status(404).json({ error: 'Not Found', message: 'Webhook subscription not found' });
      return;
    }

    await prisma.webhookSubscriptions.delete({
      where: { id },
    });

    res.status(200).json({ message: 'Subscription removed successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error', message: 'Failed to delete subscription' });
  }
});

export default router;

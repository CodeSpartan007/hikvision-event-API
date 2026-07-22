import { Router } from 'express';
import crypto from 'node:crypto';
import { prisma } from '../database/prisma.js';
import { flexibleAuthMiddleware } from '../middleware/flexibleAuth.js';
import { validateSafeWebhookUrl } from '../utils/urlValidator.js';

const router = Router();

router.post('/api/webhooks/subscriptions', flexibleAuthMiddleware, async (req, res) => {
  const { url, eventTypes } = req.body;

  if (!url || typeof url !== 'string' || !Array.isArray(eventTypes) || eventTypes.length === 0) {
    res.status(400).json({
      error: 'Bad Request',
      message: 'URL (string) and a non-empty array of eventTypes are required'
    });
    return;
  }

  const validation = await validateSafeWebhookUrl(url);
  if (!validation.valid) {
    res.status(400).json({
      error: 'Bad Request',
      message: validation.reason || 'Invalid or unsafe webhook target URL provided'
    });
    return;
  }

  try {
    const webhookSecret = 'whsec_' + crypto.randomBytes(24).toString('hex');

    const subscription = await prisma.webhookSubscriptions.create({
      data: {
        url,
        secret: webhookSecret,
        eventTypes,
      },
    });

    res.status(201).json({
      message: 'Webhook subscription registered successfully',
      subscriptionId: subscription.id,
      url: subscription.url,
      eventTypes: subscription.eventTypes,
      webhookSecret,
      createdAt: subscription.createdAt,
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error', message: 'Failed to register webhook subscription' });
  }
});

router.get('/api/webhooks/subscriptions', flexibleAuthMiddleware, async (req, res) => {
  try {
    const subscriptions = await prisma.webhookSubscriptions.findMany({
      select: {
        id: true,
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

router.delete('/api/webhooks/subscriptions/:id', flexibleAuthMiddleware, async (req, res) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

  try {
    const existing = await prisma.webhookSubscriptions.findUnique({ where: { id } });
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

import { Router } from 'express';
import crypto from 'node:crypto';
import { prisma } from '../database/prisma.js';
import { adminOnlyMiddleware } from '../middleware/auth.js';

const router = Router();

router.post('/api/api-keys', adminOnlyMiddleware, async (req, res) => {
  const { name, expiresAt } = req.body;

  if (!name || typeof name !== 'string') {
    res.status(400).json({ error: 'Bad Request', message: 'Name string is required for the API Key' });
    return;
  }

  let parsedExpiresAt: Date | null = null;
  if (expiresAt !== undefined && expiresAt !== null && expiresAt !== '') {
    parsedExpiresAt = new Date(expiresAt);
    if (isNaN(parsedExpiresAt.getTime())) {
      res.status(400).json({ error: 'Bad Request', message: 'Invalid expiresAt date format' });
      return;
    }
    if (parsedExpiresAt <= new Date()) {
      res.status(400).json({ error: 'Bad Request', message: 'expiresAt date must be in the future' });
      return;
    }
  }

  try {
    const rawApiKey = 'sep_live_' + crypto.randomBytes(24).toString('hex');
    const keyHash = crypto.createHash('sha256').update(rawApiKey).digest('hex');
    const tenantId = req.user?.role === 'SUPER_ADMIN' ? (req.body.tenantId || null) : (req.user?.tenantId || null);

    const apiKeyRecord = await prisma.apiKeys.create({
      data: {
        tenantId,
        name,
        keyHash,
        expiresAt: parsedExpiresAt,
      },
    });

    res.status(201).json({
      message: 'API Key created successfully. Store this key securely; it will not be shown again!',
      id: apiKeyRecord.id,
      tenantId: apiKeyRecord.tenantId,
      name: apiKeyRecord.name,
      apiKey: rawApiKey,
      createdAt: apiKeyRecord.createdAt,
      expiresAt: apiKeyRecord.expiresAt,
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error', message: 'Failed to create API Key' });
  }
});

router.get('/api/api-keys', async (req, res) => {
  try {
    const where: any = {};
    if (req.user?.role !== 'SUPER_ADMIN') {
      where.tenantId = req.user?.tenantId || null;
    }

    const keys = await prisma.apiKeys.findMany({
      where,
      select: {
        id: true,
        tenantId: true,
        name: true,
        isActive: true,
        createdAt: true,
        expiresAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    res.status(200).json({ data: keys });
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error', message: 'Failed to retrieve API Keys' });
  }
});

router.get('/api/api-keys/:id', async (req, res) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

  try {
    const where: any = { id };
    if (req.user?.role !== 'SUPER_ADMIN') {
      where.tenantId = req.user?.tenantId || null;
    }

    const apiKeyRecord = await prisma.apiKeys.findFirst({
      where,
      select: {
        id: true,
        tenantId: true,
        name: true,
        isActive: true,
        createdAt: true,
        expiresAt: true,
      },
    });

    if (!apiKeyRecord) {
      res.status(404).json({ error: 'Not Found', message: 'API Key not found' });
      return;
    }

    res.status(200).json(apiKeyRecord);
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error', message: 'Failed to retrieve API Key' });
  }
});

router.patch('/api/api-keys/:id', adminOnlyMiddleware, async (req, res) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const { name, isActive, expiresAt } = req.body;

  try {
    const where: any = { id };
    if (req.user?.role !== 'SUPER_ADMIN') {
      where.tenantId = req.user?.tenantId || null;
    }

    const existing = await prisma.apiKeys.findFirst({ where });
    if (!existing) {
      res.status(404).json({ error: 'Not Found', message: 'API Key not found' });
      return;
    }

    const updateData: any = {};

    if (name !== undefined) {
      if (typeof name !== 'string' || !name.trim()) {
        res.status(400).json({ error: 'Bad Request', message: 'Name must be a non-empty string' });
        return;
      }
      updateData.name = name.trim();
    }

    if (typeof isActive === 'boolean') {
      updateData.isActive = isActive;
    }

    if (expiresAt !== undefined) {
      if (expiresAt === null) {
        updateData.expiresAt = null;
      } else {
        const parsed = new Date(expiresAt);
        if (isNaN(parsed.getTime())) {
          res.status(400).json({ error: 'Bad Request', message: 'Invalid expiresAt date format' });
          return;
        }
        updateData.expiresAt = parsed;
      }
    }

    const updated = await prisma.apiKeys.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        tenantId: true,
        name: true,
        isActive: true,
        createdAt: true,
        expiresAt: true,
      },
    });

    res.status(200).json(updated);
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error', message: 'Failed to update API Key' });
  }
});

router.delete('/api/api-keys/:id', adminOnlyMiddleware, async (req, res) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

  try {
    const where: any = { id };
    if (req.user?.role !== 'SUPER_ADMIN') {
      where.tenantId = req.user?.tenantId || null;
    }

    const existing = await prisma.apiKeys.findFirst({ where });
    if (!existing) {
      res.status(404).json({ error: 'Not Found', message: 'API Key not found' });
      return;
    }

    await prisma.apiKeys.delete({
      where: { id },
    });

    res.status(200).json({ message: 'API Key deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error', message: 'Failed to delete API Key' });
  }
});

export default router;

import { Router } from 'express';
import { prisma } from '../database/prisma.js';

const router = Router();

router.get('/api/audit-logs', async (req, res) => {
  try {
    const action = req.query.action ? String(req.query.action) : undefined;
    const actorType = req.query.actorType ? String(req.query.actorType) : undefined;
    const limit = req.query.limit ? Math.min(Math.max(Number(req.query.limit) || 50, 1), 100) : 50;
    const offset = req.query.offset ? Math.max(Number(req.query.offset) || 0, 0) : 0;

    const where: any = {};
    if (action) where.action = action;
    if (actorType) where.actorType = actorType;

    const [logs, total] = await Promise.all([
      prisma.auditLogs.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.auditLogs.count({ where }),
    ]);

    res.status(200).json({
      data: logs,
      pagination: {
        total,
        limit,
        offset,
      },
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error', message: 'Failed to retrieve audit logs' });
  }
});

router.get('/api/audit-logs/:id', async (req, res) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

  try {
    const log = await prisma.auditLogs.findUnique({ where: { id } });
    if (!log) {
      res.status(404).json({ error: 'Not Found', message: 'Audit log entry not found' });
      return;
    }

    res.status(200).json(log);
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error', message: 'Failed to retrieve audit log entry' });
  }
});

export default router;

import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger.js';
import { webhookService } from '../services/webhookService.js';
import { getParser } from '../parsers/registry.js';

export class WebhookController {
  public receiveWebhook = (req: Request, res: Response, next: NextFunction): void => {
    try {
      const sourceParam = req.params.source;
      const source = (Array.isArray(sourceParam) ? sourceParam[0] : sourceParam) || 'hikvision';
      const parser = getParser(source);

      if (!parser) {
        logger.warn(
          { source, url: req.originalUrl || req.url },
          'Webhook request received for unregistered source/vendor'
        );
        res.status(404).json({
          error: 'Not Found',
          message: `No parser registered for webhook source: ${source}`,
          timestamp: new Date().toISOString(),
        });
        return;
      }

      const contentType = req.headers['content-type'] || 'unknown';
      const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
      const headers = req.headers;

      let payload: any = req.body;
      if (req.file) {
        payload = { ...payload, _file: req.file };
      } else if (req.files) {
        payload = { ...payload, _files: req.files };
      }

      logger.info(
        {
          source,
          clientIp,
          contentType,
          hasBody: !!req.body,
          hasFiles: !!(req.file || req.files),
          timestamp: new Date().toISOString(),
        },
        `Webhook receiver endpoint hit for source: ${source}`
      );

      const tenantId = req.tenant?.id;

      webhookService.handleWebhook(
        source,
        payload,
        contentType as string,
        {
          ip: clientIp as string,
          headers,
        },
        tenantId
      );

      res.status(200).json({
        status: 'received',
        message: 'Webhook payload accepted',
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      next(err);
    }
  };

  public receiveHikvisionWebhook = this.receiveWebhook;
}

export const webhookController = new WebhookController();

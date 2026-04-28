import { logger } from '../../config/logger.js';
import { NotificationEventsRepository } from '../notifications/notification-events.repository.js';
import { NotificationProcessorService } from '../notifications/notification-processor.service.js';

export type PollingRunStats = {
  fetched: number;
  claimed: number;
  processed: number;
  failed: number;
  skippedClaims: number;
};

export class PollingWorker {
  constructor(
    private readonly eventsRepository = new NotificationEventsRepository(),
    private readonly processor = new NotificationProcessorService()
  ) {}

  async runOnce(batchSize: number): Promise<PollingRunStats> {
    const events = await this.eventsRepository.getPendingEvents(batchSize);
    const stats: PollingRunStats = {
      fetched: events.length,
      claimed: 0,
      processed: 0,
      failed: 0,
      skippedClaims: 0
    };

    for (const event of events) {
      const claimed = await this.eventsRepository.claimEventForProcessing(event.id);
      if (!claimed) {
        stats.skippedClaims += 1;
        continue;
      }
      stats.claimed += 1;

      try {
        await this.processor.process(claimed);
        stats.processed += 1;
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'Unknown processor error';
        await this.eventsRepository.markEventFailedRetryable(
          claimed.id,
          reason,
          new Date(Date.now() + 5 * 60 * 1000).toISOString()
        );

        logger.error(
          {
            eventId: claimed.id,
            eventType: claimed.event_type,
            organizationId: claimed.organization_id,
            status: 'failed_retryable'
          },
          'Polling worker failed processing event'
        );
        stats.failed += 1;
      }
    }

    logger.info({ stats }, 'Polling worker tick finished');
    return stats;
  }
}

import { logger } from '../../config/logger.js';
import { NotificationEventsRepository } from '../notifications/notification-events.repository.js';
import { NotificationProcessorService } from '../notifications/notification-processor.service.js';
import { NotificationDeliveriesRepository } from '../notifications/notification-deliveries.repository.js';
import {
  ADMIN_DRIVER_EVENT_TYPES,
  URGENT_JOB_EVENT_TYPES,
  isAdminDriverEventType,
  isUrgentJobEventType
} from '../notifications/notification-shared.js';
import type { NotificationEvent } from '../notifications/notification.types.js';
import { processAdminDriverNotificationBatch } from '../notifications/handlers/process-admin-driver-notification-batch.js';

export type PollingRunStats = {
  fetched: number;
  claimed: number;
  processed: number;
  failed: number;
  skippedClaims: number;
  reclaimedStuck: number;
  /** True when this tick filled the batch — more work likely waiting. */
  morePendingLikely: boolean;
};

const STUCK_PROCESSING_MS = 10 * 60 * 1000;

export class PollingWorker {
  constructor(
    private readonly eventsRepository = new NotificationEventsRepository(),
    private readonly processor = new NotificationProcessorService(),
    private readonly deliveriesRepository = new NotificationDeliveriesRepository()
  ) {}

  async runOnce(batchSize: number): Promise<PollingRunStats> {
    const reclaimedStuck = await this.eventsRepository.reclaimStuckProcessing(STUCK_PROCESSING_MS);

    // Reserve capacity so a 100-recipient admin campaign cannot block Direct/job pushes.
    const urgentBudget = Math.max(1, Math.ceil(batchSize * 0.5));
    const otherBudget = Math.max(1, batchSize - urgentBudget);

    const urgentTypes = [...URGENT_JOB_EVENT_TYPES];
    const adminTypes = [...ADMIN_DRIVER_EVENT_TYPES];

    const [urgentEvents, adminEvents, otherEvents] = await Promise.all([
      this.eventsRepository.getPendingEventsFiltered({
        limit: urgentBudget,
        includeEventTypes: urgentTypes
      }),
      this.eventsRepository.getPendingEventsFiltered({
        limit: otherBudget,
        includeEventTypes: adminTypes
      }),
      this.eventsRepository.getPendingEventsFiltered({
        limit: otherBudget,
        excludeEventTypes: [...urgentTypes, ...adminTypes]
      })
    ]);

    // Prefer urgent first, then a slice of admin + email/other without exceeding batchSize.
    const remaining = Math.max(0, batchSize - urgentEvents.length);
    const adminSlice = adminEvents.slice(0, Math.ceil(remaining * 0.6));
    const otherSlice = otherEvents.slice(0, Math.max(0, remaining - adminSlice.length));
    const events = [...urgentEvents, ...adminSlice, ...otherSlice];

    const stats: PollingRunStats = {
      fetched: events.length,
      claimed: 0,
      processed: 0,
      failed: 0,
      skippedClaims: 0,
      reclaimedStuck,
      morePendingLikely: events.length >= batchSize
    };

    const claimedAdmin: NotificationEvent[] = [];
    const claimedOther: NotificationEvent[] = [];

    for (const event of events) {
      const claimed = await this.eventsRepository.claimEventForProcessing(event.id);
      if (!claimed) {
        stats.skippedClaims += 1;
        continue;
      }
      stats.claimed += 1;
      if (isAdminDriverEventType(claimed.event_type)) {
        claimedAdmin.push(claimed);
      } else {
        claimedOther.push(claimed);
      }
    }

    // Process urgent job events and email/other with limited concurrency, independently of admin bulk.
    const pushLike = claimedOther.filter((e) => isUrgentJobEventType(e.event_type));
    const emailLike = claimedOther.filter((e) => !isUrgentJobEventType(e.event_type));

    await Promise.all([
      this.processPool(pushLike, 4, stats),
      this.processPool(emailLike, 2, stats),
      this.processAdminBulk(claimedAdmin, stats)
    ]);

    logger.info({ stats }, 'Polling worker tick finished');
    return stats;
  }

  private async processAdminBulk(
    events: NotificationEvent[],
    stats: PollingRunStats
  ): Promise<void> {
    if (events.length === 0) {
      return;
    }
    try {
      await processAdminDriverNotificationBatch({
        events,
        eventsRepository: this.eventsRepository,
        deliveriesRepository: this.deliveriesRepository
      });
      stats.processed += events.length;
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Unknown admin batch error';
      for (const event of events) {
        await this.eventsRepository.markEventFailedRetryable(
          event.id,
          reason,
          new Date(Date.now() + 5 * 60 * 1000).toISOString()
        );
        stats.failed += 1;
      }
      logger.error({ reason, count: events.length }, 'Admin driver push batch failed');
    }
  }

  private async processPool(
    events: NotificationEvent[],
    concurrency: number,
    stats: PollingRunStats
  ): Promise<void> {
    if (events.length === 0) {
      return;
    }
    const limit = Math.max(1, concurrency);
    for (let offset = 0; offset < events.length; offset += limit) {
      const chunk = events.slice(offset, offset + limit);
      await Promise.all(
        chunk.map(async (event) => {
          try {
            await this.processor.process(event);
            stats.processed += 1;
          } catch (error) {
            const reason = error instanceof Error ? error.message : 'Unknown processor error';
            await this.eventsRepository.markEventFailedRetryable(
              event.id,
              reason,
              new Date(Date.now() + 5 * 60 * 1000).toISOString()
            );
            logger.error(
              {
                eventId: event.id,
                eventType: event.event_type,
                organizationId: event.organization_id,
                status: 'failed_retryable',
                reason
              },
              'Polling worker failed processing event'
            );
            stats.failed += 1;
          }
        })
      );
    }
  }
}

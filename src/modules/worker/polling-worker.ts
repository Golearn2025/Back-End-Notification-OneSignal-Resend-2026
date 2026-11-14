import { logger } from '../../config/logger.js';
import { NotificationEventsRepository } from '../notifications/notification-events.repository.js';
import { NotificationProcessorService } from '../notifications/notification-processor.service.js';
import { NotificationDeliveriesRepository } from '../notifications/notification-deliveries.repository.js';
import {
  ADMIN_DRIVER_EVENT_TYPES,
  URGENT_JOB_EVENT_TYPES,
  getAdminCampaignId,
  isUrgentJobEventType
} from '../notifications/notification-shared.js';
import type { NotificationEvent } from '../notifications/notification.types.js';
import { processAdminDriverNotificationBatch } from '../notifications/handlers/process-admin-driver-notification-batch.js';
import type { OneSignalProvider } from '../providers/onesignal.provider.js';

export type PollingRunStats = {
  fetched: number;
  claimed: number;
  processed: number;
  failed: number;
  skippedClaims: number;
  reclaimedStuck: number;
  /** True when this tick can start more claimable work immediately. */
  morePendingLikely: boolean;
  /** Per-category probe saw more due rows than the category budget. */
  backlog: {
    urgent: boolean;
    admin: boolean;
    email: boolean;
  };
  lanes: {
    urgentBusy: boolean;
    emailBusy: boolean;
    adminBusy: boolean;
  };
};

type LaneName = 'urgent' | 'email' | 'admin';

const STUCK_PROCESSING_MS = 10 * 60 * 1000;
/** One blocked campaign + one individual (or second campaign) concurrently. */
const MAX_ADMIN_IN_FLIGHT = 2;
const MAX_CAMPAIGN_AUDIENCE = 5000;

export class PollingWorker {
  private readonly laneBusy: Record<'urgent' | 'email', boolean> = {
    urgent: false,
    email: false
  };
  private adminInFlight = 0;
  private readonly adminCampaignsInFlight = new Set<string>();
  private readonly lanePromises: Partial<Record<LaneName, Promise<void>>> = {};
  private readonly adminPromises = new Set<Promise<void>>();

  constructor(
    private readonly eventsRepository = new NotificationEventsRepository(),
    private readonly processor = new NotificationProcessorService(),
    private readonly deliveriesRepository = new NotificationDeliveriesRepository(),
    private readonly adminBatchFn: typeof processAdminDriverNotificationBatch = processAdminDriverNotificationBatch,
    private readonly oneSignal?: OneSignalProvider
  ) {}

  /**
   * Starts free lanes and returns without waiting on them.
   * Urgent / email / admin are isolated so a blocked email or campaign cannot
   * prevent a later Direct (or individual admin) wake-up tick.
   */
  async runOnce(batchSize: number): Promise<PollingRunStats> {
    const reclaimedStuck = await this.eventsRepository.reclaimStuckProcessing(STUCK_PROCESSING_MS);

    const urgentBudget = Math.max(1, Math.ceil(batchSize * 0.5));
    const otherBudget = Math.max(1, batchSize - urgentBudget);

    const stats: PollingRunStats = {
      fetched: 0,
      claimed: 0,
      processed: 0,
      failed: 0,
      skippedClaims: 0,
      reclaimedStuck,
      morePendingLikely: false,
      backlog: { urgent: false, admin: false, email: false },
      lanes: {
        urgentBusy: this.laneBusy.urgent,
        emailBusy: this.laneBusy.email,
        adminBusy: this.adminInFlight > 0
      }
    };

    const urgentTypes = [...URGENT_JOB_EVENT_TYPES];
    const adminTypes = [...ADMIN_DRIVER_EVENT_TYPES];

    const [urgentProbe, adminProbe, otherProbe] = await Promise.all([
      this.eventsRepository.getPendingEventsFiltered({
        limit: urgentBudget + 1,
        includeEventTypes: urgentTypes
      }),
      this.eventsRepository.getPendingEventsFiltered({
        limit: otherBudget + 1,
        includeEventTypes: adminTypes
      }),
      this.eventsRepository.getPendingEventsFiltered({
        limit: otherBudget + 1,
        excludeEventTypes: [...urgentTypes, ...adminTypes]
      })
    ]);

    const urgentBacklog = urgentProbe.length > urgentBudget;
    const adminBacklog = adminProbe.length > otherBudget;
    const emailBacklog = otherProbe.length > otherBudget;

    const urgentEvents = urgentProbe.slice(0, urgentBudget);
    const emailEvents = otherProbe.slice(0, otherBudget);

    stats.backlog = {
      urgent: urgentBacklog,
      admin: adminBacklog,
      email: emailBacklog
    };

    // Fire-and-forget exclusive lanes — do NOT await email/urgent here.
    if (!this.laneBusy.urgent && urgentEvents.length > 0) {
      stats.fetched += urgentEvents.length;
      void this.startExclusiveLane('urgent', async () => {
        await this.claimAndProcessPool(urgentEvents, 4, stats);
      });
    }

    if (!this.laneBusy.email && emailEvents.length > 0) {
      stats.fetched += emailEvents.length;
      void this.startExclusiveLane('email', async () => {
        await this.claimAndProcessPool(emailEvents, 2, stats);
      });
    }

    if (this.adminInFlight < MAX_ADMIN_IN_FLIGHT) {
      const adminWork = await this.selectAdminWork(adminProbe, otherBudget, adminTypes);
      if (adminWork.events.length > 0) {
        stats.fetched += adminWork.events.length;
        const campaignId = adminWork.campaignId;
        void this.startAdminLane(campaignId, async () => {
          const claimed = await this.claimAll(adminWork.events, stats);
          if (claimed.length === 0) {
            return;
          }
          try {
            await this.adminBatchFn({
              events: claimed,
              eventsRepository: this.eventsRepository,
              deliveriesRepository: this.deliveriesRepository,
              ...(this.oneSignal ? { oneSignal: this.oneSignal } : {})
            });
            stats.processed += claimed.length;
          } catch (error) {
            const reason = error instanceof Error ? error.message : 'Unknown admin batch error';
            for (const event of claimed) {
              await this.eventsRepository.markEventFailedRetryable(
                event.id,
                reason,
                new Date(Date.now() + 5 * 60 * 1000).toISOString()
              );
              stats.failed += 1;
            }
            logger.error({ reason, count: claimed.length }, 'Admin driver push batch failed');
          }
        });
      }
    }

    stats.lanes = {
      urgentBusy: this.laneBusy.urgent,
      emailBusy: this.laneBusy.email,
      adminBusy: this.adminInFlight > 0
    };

    const canStartPrimaryAdmin = this.adminInFlight === 0 && (adminBacklog || adminProbe.length > 0);
    const canStartAdminInterrupt =
      this.adminInFlight > 0 && this.adminInFlight < MAX_ADMIN_IN_FLIGHT;

    stats.morePendingLikely =
      (urgentBacklog && !this.laneBusy.urgent) ||
      (emailBacklog && !this.laneBusy.email) ||
      canStartPrimaryAdmin ||
      canStartAdminInterrupt;

    logger.info({ stats }, 'Polling worker tick finished');
    return stats;
  }

  async waitForLane(lane: LaneName): Promise<void> {
    if (lane === 'admin') {
      await Promise.all([...this.adminPromises]);
      return;
    }
    const pending = this.lanePromises[lane];
    if (pending) {
      await pending;
    }
  }

  isLaneBusy(lane: LaneName): boolean {
    if (lane === 'admin') {
      return this.adminInFlight > 0;
    }
    return this.laneBusy[lane];
  }

  /**
   * Primary slot: expand explicit campaign to full audience, else take individuals.
   * Interrupt slot (admin already busy): only events that are NOT part of an
   * in-flight campaign — including priority=normal individuals from live enqueue.
   */
  private async selectAdminWork(
    adminProbe: NotificationEvent[],
    otherBudget: number,
    adminTypes: string[]
  ): Promise<{ events: NotificationEvent[]; campaignId: string | null }> {
    if (this.adminInFlight === 0) {
      const seed = adminProbe[0];
      if (!seed) {
        return { events: [], campaignId: null };
      }
      const campaignId = getAdminCampaignId(seed);
      if (campaignId) {
        const full = await this.eventsRepository.getPendingEventsByCampaignId(
          campaignId,
          MAX_CAMPAIGN_AUDIENCE
        );
        return {
          events: full.length > 0 ? full : adminProbe.filter((e) => getAdminCampaignId(e) === campaignId),
          campaignId
        };
      }
      // Individuals / legacy rows without campaign_id — small slice, each sent separately.
      return {
        events: adminProbe.filter((e) => getAdminCampaignId(e) == null).slice(0, otherBudget),
        campaignId: null
      };
    }

    // Interrupt: widen search so individuals are not hidden behind leftover campaign rows
    // in the narrow budget probe. Live enqueue uses priority=normal, no campaign_id.
    const wide = await this.eventsRepository.getPendingEventsFiltered({
      limit: Math.max(otherBudget * 10, 100),
      includeEventTypes: adminTypes
    });
    const interrupt = wide.filter((e) => getAdminCampaignId(e) == null).slice(0, 1);
    return { events: interrupt, campaignId: null };
  }

  private startExclusiveLane(lane: 'urgent' | 'email', work: () => Promise<void>): Promise<void> {
    this.laneBusy[lane] = true;
    const promise = (async () => {
      try {
        await work();
      } finally {
        this.laneBusy[lane] = false;
        delete this.lanePromises[lane];
      }
    })();
    this.lanePromises[lane] = promise;
    return promise;
  }

  private startAdminLane(campaignId: string | null, work: () => Promise<void>): Promise<void> {
    this.adminInFlight += 1;
    if (campaignId) {
      this.adminCampaignsInFlight.add(campaignId);
    }
    let promise!: Promise<void>;
    promise = (async () => {
      try {
        await work();
      } finally {
        this.adminInFlight -= 1;
        if (campaignId) {
          this.adminCampaignsInFlight.delete(campaignId);
        }
        this.adminPromises.delete(promise);
      }
    })();
    this.adminPromises.add(promise);
    this.lanePromises.admin = Promise.all([...this.adminPromises]).then(() => undefined);
    return promise;
  }

  private async claimAll(
    events: NotificationEvent[],
    stats: PollingRunStats
  ): Promise<NotificationEvent[]> {
    if (events.length === 0) {
      return [];
    }
    if (typeof this.eventsRepository.claimEventsForProcessing === 'function') {
      const claimed = await this.eventsRepository.claimEventsForProcessing(events.map((e) => e.id));
      stats.claimed += claimed.length;
      stats.skippedClaims += Math.max(0, events.length - claimed.length);
      return claimed;
    }
    const claimed: NotificationEvent[] = [];
    for (const event of events) {
      const row = await this.eventsRepository.claimEventForProcessing(event.id);
      if (!row) {
        stats.skippedClaims += 1;
        continue;
      }
      stats.claimed += 1;
      claimed.push(row);
    }
    return claimed;
  }

  private async claimAndProcessPool(
    events: NotificationEvent[],
    concurrency: number,
    stats: PollingRunStats
  ): Promise<void> {
    const claimed = await this.claimAll(events, stats);
    if (claimed.length === 0) {
      return;
    }
    const limit = Math.max(1, concurrency);
    for (let offset = 0; offset < claimed.length; offset += limit) {
      const chunk = claimed.slice(offset, limit + offset);
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

export function classifyEventLane(eventType: string): LaneName {
  if (isUrgentJobEventType(eventType)) {
    return 'urgent';
  }
  if (ADMIN_DRIVER_EVENT_TYPES.has(eventType)) {
    return 'admin';
  }
  return 'email';
}

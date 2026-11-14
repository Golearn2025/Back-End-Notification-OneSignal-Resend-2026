import { randomUUID } from 'node:crypto';
import type { NotificationEvent } from '../../src/modules/notifications/notification.types.js';

/**
 * Mirrors live `admin_enqueue_driver_notification` payload/priority rules
 * (priority=normal; inbox side-effect represented as payload.campaign_scope).
 */
export function fakeAdminEnqueueIndividual(input: {
  organizationId: string;
  driverId: string;
  title: string;
  body: string;
  type?: string;
  eventId?: string;
}): NotificationEvent {
  const inboxType = input.type ?? 'admin_message';
  const eventType =
    inboxType.startsWith('document_') ? 'admin_driver_documents' : 'admin_driver_system';
  return {
    id: input.eventId ?? randomUUID(),
    organization_id: input.organizationId,
    event_type: eventType,
    source_module: 'admin_communications',
    priority: 'normal',
    status: 'pending',
    customer_id: null,
    driver_id: input.driverId,
    payload: {
      event_type: eventType,
      category: eventType === 'admin_driver_documents' ? 'documents' : 'system',
      section: eventType === 'admin_driver_documents' ? 'documents' : 'updates',
      inbox_type: inboxType,
      push_title: input.title,
      push_body: input.body,
      message: input.body,
      channels: ['push', 'inbox'],
      campaign_scope: 'individual'
    }
  };
}

/**
 * Mirrors proposed `admin_enqueue_driver_notification_campaign`:
 * one campaign_id, N per-driver events, shared title/body, priority=normal.
 */
export function fakeAdminEnqueueCampaign(input: {
  organizationId: string;
  driverIds: string[];
  title: string;
  body: string;
  type?: string;
  campaignId?: string;
}): { campaignId: string; events: NotificationEvent[]; inboxCount: number } {
  const campaignId = input.campaignId ?? randomUUID();
  const events = input.driverIds.map((driverId, index) => {
    const base = fakeAdminEnqueueIndividual({
      organizationId: input.organizationId,
      driverId,
      title: input.title,
      body: input.body,
      ...(input.type ? { type: input.type } : {}),
      eventId: `camp-${campaignId}-${index}`
    });
    return {
      ...base,
      payload: {
        ...base.payload,
        campaign_id: campaignId,
        campaign_scope: 'bulk'
      }
    } as NotificationEvent;
  });
  return { campaignId, events, inboxCount: events.length };
}

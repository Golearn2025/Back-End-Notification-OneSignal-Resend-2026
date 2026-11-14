import { getEnv } from '../../config/env.js';

/**
 * Driver alert sound SSOT:
 * - Resource name: `message` (= android res/raw/message.mp3, ios message.caf)
 * - App channel: driver_alerts_v2 (DriverAlertChannels.kt sets Uri to raw/message)
 *
 * Prefer app channel (`existing_android_channel_id`) so Android plays the
 * channel's baked-in sound. Dashboard `android_channel_id` was delivering
 * with the OS default tone (badge ok, wrong sound).
 *
 * Optional: ONESIGNAL_ANDROID_CHANNEL_ID forces dashboard UUID instead.
 */
export const DRIVER_ALERT_IOS_SOUND = 'message.caf';
export const DRIVER_ALERT_ANDROID_SOUND = 'message';
export const DRIVER_ALERT_ANDROID_CHANNEL_ID = 'driver_alerts_v2';

export function driverAlertSoundPayload(): Record<string, string> {
  const dashboardChannelId = getEnv().ONESIGNAL_ANDROID_CHANNEL_ID?.trim();
  const preferDashboard = process.env.ONESIGNAL_PREFER_DASHBOARD_CHANNEL === '1';

  const body: Record<string, string> = {
    ios_sound: DRIVER_ALERT_IOS_SOUND,
    android_sound: DRIVER_ALERT_ANDROID_SOUND
  };

  if (preferDashboard && dashboardChannelId) {
    body.android_channel_id = dashboardChannelId;
  } else {
    // App-created channel with sound Uri → raw/message (see DriverAlertChannels.kt)
    body.existing_android_channel_id = DRIVER_ALERT_ANDROID_CHANNEL_ID;
  }

  return body;
}

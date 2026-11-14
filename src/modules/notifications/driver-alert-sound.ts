import { getEnv } from '../../config/env.js';

/**
 * Canonical driver push alert — matches Driver:
 * - iOS: message.caf
 * - Android resource name: `message` (= res/raw/message.mp3, no extension)
 * - Dashboard category UUID via ONESIGNAL_ANDROID_CHANNEL_ID
 *
 * Always send android_sound=message (the resource name). Without it, probes
 * fell back to the OS default tone even when android_channel_id was set.
 */
export const DRIVER_ALERT_IOS_SOUND = 'message.caf';
export const DRIVER_ALERT_ANDROID_SOUND = 'message';
export const DRIVER_ALERT_ANDROID_CHANNEL_ID = 'driver_alerts_v2';

export function driverAlertSoundPayload(): Record<string, string> {
  const dashboardChannelId = getEnv().ONESIGNAL_ANDROID_CHANNEL_ID?.trim();
  const body: Record<string, string> = {
    ios_sound: DRIVER_ALERT_IOS_SOUND,
    android_sound: DRIVER_ALERT_ANDROID_SOUND
  };

  if (dashboardChannelId) {
    body.android_channel_id = dashboardChannelId;
  } else {
    body.existing_android_channel_id = DRIVER_ALERT_ANDROID_CHANNEL_ID;
  }

  return body;
}

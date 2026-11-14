import { getEnv } from '../../config/env.js';

/**
 * Canonical driver push alert — must match Vantage-Lane-App-Driver
 * (`message.caf` / `res/raw/message` + channel name "Driver Alerts").
 *
 * Android 8+: OneSignal only reliably plays a custom sound when the payload
 * uses a **dashboard** category UUID as `android_channel_id`.
 * `existing_android_channel_id=driver_alerts_v2` (app-created) was verified
 * to fall back to the OS default tone in production probes.
 *
 * Set `ONESIGNAL_ANDROID_CHANNEL_ID` after creating the category in OneSignal
 * (sound = custom `message`, importance Urgent).
 */
export const DRIVER_ALERT_IOS_SOUND = 'message.caf';
export const DRIVER_ALERT_ANDROID_SOUND = 'message';
export const DRIVER_ALERT_ANDROID_CHANNEL_ID = 'driver_alerts_v2';

export function driverAlertSoundPayload(): Record<string, string> {
  const dashboardChannelId = getEnv().ONESIGNAL_ANDROID_CHANNEL_ID?.trim();
  const body: Record<string, string> = {
    ios_sound: DRIVER_ALERT_IOS_SOUND
  };

  if (dashboardChannelId) {
    // Dashboard category UUID — OneSignal creates OS_<uuid> on device with custom sound.
    body.android_channel_id = dashboardChannelId;
  } else {
    // Fallback (often ignored → system tone). Prefer setting ONESIGNAL_ANDROID_CHANNEL_ID.
    body.existing_android_channel_id = DRIVER_ALERT_ANDROID_CHANNEL_ID;
  }

  return body;
}

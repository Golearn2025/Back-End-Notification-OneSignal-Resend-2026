/**
 * Canonical driver push alert — must match Vantage-Lane-App-Driver
 * `src/features/notifications/constants/alert-sound.ts` and
 * `android/.../DriverAlertChannels.kt` (CHANNEL_ID = driver_alerts_v2,
 * display name "Driver Alerts").
 *
 * Sound files live in the app; backend only references them.
 *
 * Android: only `existing_android_channel_id` — the channel already has
 * res/raw/message. Do NOT also send `android_sound` (can stack with the
 * channel / default tone → two sounds). Dashboard `android_channel_id`
 * is a different UUID and 400s if the category was never created there.
 */
export const DRIVER_ALERT_IOS_SOUND = 'message.caf';
/** Resource name in app (documentation / probes); not sent in OneSignal body. */
export const DRIVER_ALERT_ANDROID_SOUND = 'message';
export const DRIVER_ALERT_ANDROID_CHANNEL_ID = 'driver_alerts_v2';

/** Fields merged into every driver OneSignal push body. */
export function driverAlertSoundPayload(): {
  ios_sound: string;
  existing_android_channel_id: string;
} {
  return {
    ios_sound: DRIVER_ALERT_IOS_SOUND,
    existing_android_channel_id: DRIVER_ALERT_ANDROID_CHANNEL_ID
  };
}

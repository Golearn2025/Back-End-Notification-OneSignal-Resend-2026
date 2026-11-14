/**
 * Canonical driver push alert — must match Vantage-Lane-App-Driver
 * `src/features/notifications/constants/alert-sound.ts` and
 * `android/.../DriverAlertChannels.kt` (CHANNEL_ID = driver_alerts_v2).
 *
 * Sound files live in the app; backend only references them in the OneSignal payload.
 *
 * Android: use `existing_android_channel_id` (app-created channel), NOT dashboard
 * `android_channel_id` — OneSignal 400s with "Could not find android_channel_id"
 * if the UUID/category was never created in the OneSignal dashboard.
 */
export const DRIVER_ALERT_IOS_SOUND = 'message.caf';
export const DRIVER_ALERT_ANDROID_SOUND = 'message';
export const DRIVER_ALERT_ANDROID_CHANNEL_ID = 'driver_alerts_v2';

/** Fields merged into every driver OneSignal push body. */
export function driverAlertSoundPayload(): {
  ios_sound: string;
  android_sound: string;
  existing_android_channel_id: string;
} {
  return {
    ios_sound: DRIVER_ALERT_IOS_SOUND,
    android_sound: DRIVER_ALERT_ANDROID_SOUND,
    existing_android_channel_id: DRIVER_ALERT_ANDROID_CHANNEL_ID
  };
}

import { getEnv } from '../../config/env.js';

/**
 * Driver alert sound + Android icons — must match Vantage-Lane-App-Driver:
 * - Sound: message.caf / res/raw/message + channel driver_alerts_v2
 * - Icons: ic_stat_onesignal_default (status bar), ic_onesignal_large_icon_default
 *
 * Icons and sound files live in the app binary; backend only references names.
 * Ships after a native Driver rebuild that includes those resources.
 */
export const DRIVER_ALERT_IOS_SOUND = 'message.caf';
export const DRIVER_ALERT_ANDROID_SOUND = 'message';
export const DRIVER_ALERT_ANDROID_CHANNEL_ID = 'driver_alerts_v2';
export const DRIVER_ALERT_ANDROID_SMALL_ICON = 'ic_stat_onesignal_default';
export const DRIVER_ALERT_ANDROID_LARGE_ICON = 'ic_onesignal_large_icon_default';

export function driverAlertSoundPayload(): Record<string, string> {
  const dashboardChannelId = getEnv().ONESIGNAL_ANDROID_CHANNEL_ID?.trim();
  const preferDashboard = process.env.ONESIGNAL_PREFER_DASHBOARD_CHANNEL === '1';

  const body: Record<string, string> = {
    ios_sound: DRIVER_ALERT_IOS_SOUND,
    android_sound: DRIVER_ALERT_ANDROID_SOUND,
    // Replaces OneSignal default bell when the drawable exists in the APK.
    small_icon: DRIVER_ALERT_ANDROID_SMALL_ICON,
    large_icon: DRIVER_ALERT_ANDROID_LARGE_ICON
  };

  if (preferDashboard && dashboardChannelId) {
    body.android_channel_id = dashboardChannelId;
  } else {
    body.existing_android_channel_id = DRIVER_ALERT_ANDROID_CHANNEL_ID;
  }

  return body;
}

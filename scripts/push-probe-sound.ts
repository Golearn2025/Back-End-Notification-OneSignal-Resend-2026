/**
 * Single real OneSignal push to your device — verifies Driver alert sound fields.
 *
 *   REAL_PUSH_PROBE=1 npx tsx scripts/push-probe-sound.ts
 */
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { driverAlertSoundPayload } from '../src/modules/notifications/driver-alert-sound.js';
import { OneSignalProvider } from '../src/modules/providers/onesignal.provider.js';

const YOU_EXTERNAL_ID =
  process.env.BENCH_YOU_AUTH_USER_ID ?? '6bccf7b2-4cef-40fe-8ba0-bd8a3f59d173';

async function main() {
  if (process.env.REAL_PUSH_PROBE !== '1') {
    console.error('Refusing: set REAL_PUSH_PROBE=1 to send one real push (sound probe).');
    process.exit(1);
  }

  const provider = new OneSignalProvider();
  const idempotencyKey = randomUUID();
  const started = performance.now();
  const result = await provider.sendPushToExternalUserIds({
    externalUserIds: [YOU_EXTERNAL_ID],
    title: 'Probe sunet VL #9',
    message: 'android_sound=message + canal dashboard. Testeaza cu app DESCHIS si in BACKGROUND.',
    data: { probe: 'driver_alert_sound', ts: String(Date.now()) },
    idempotencyKey
  });

  console.log(
    'PUSH_SOUND_PROBE_REPORT',
    JSON.stringify(
      {
        youExternalUserId: YOU_EXTERNAL_ID,
        providerRttMs: Number((performance.now() - started).toFixed(2)),
        providerMessageId: result.providerMessageId,
        soundPayload: driverAlertSoundPayload(),
        onesignalRecipients: result.responseMetadata.recipients ?? null
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

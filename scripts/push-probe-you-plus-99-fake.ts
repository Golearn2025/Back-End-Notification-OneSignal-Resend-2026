/**
 * One real OneSignal push shaped like a 100-recipient campaign:
 * your external_id + 99 fake UUIDs in a single request.
 * No DB enqueue, no email/Resend, no prod migration.
 *
 *   REAL_PUSH_PROBE=1 npx tsx scripts/push-probe-you-plus-99-fake.ts
 */
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { OneSignalProvider } from '../src/modules/providers/onesignal.provider.js';

const YOU_EXTERNAL_ID =
  process.env.BENCH_YOU_AUTH_USER_ID ?? '6bccf7b2-4cef-40fe-8ba0-bd8a3f59d173';

async function main() {
  if (process.env.REAL_PUSH_PROBE !== '1') {
    console.error('Refusing: set REAL_PUSH_PROBE=1 to send one real OneSignal push (you + 99 fake ids).');
    process.exit(1);
  }

  const fakeIds = Array.from({ length: 99 }, () => randomUUID());
  const audience = [YOU_EXTERNAL_ID, ...fakeIds];
  const idempotencyKey = randomUUID();
  const provider = new OneSignalProvider();

  const started = performance.now();
  const result = await provider.sendPushToExternalUserIds({
    externalUserIds: audience,
    title: 'Probe campanie 100',
    message: 'Push test: tu + 99 fake (o singură cerere OneSignal)',
    data: { probe: 'you_plus_99_fake', ts: String(Date.now()) },
    idempotencyKey
  });
  const providerRttMs = performance.now() - started;

  const report = {
    channel: 'onesignal_push',
    youExternalUserId: YOU_EXTERNAL_ID,
    audienceSize: audience.length,
    fakeRecipients: 99,
    providerRttMs: Number(providerRttMs.toFixed(2)),
    providerMessageId: result.providerMessageId,
    idempotencyKey: result.idempotencyKey,
    onesignalRecipients: result.responseMetadata.recipients ?? null,
    invalidExternalIds: result.responseMetadata.invalidExternalIds?.length ?? 0,
    expectedSound: {
      ios_sound: 'message.caf',
      android_sound: 'message',
      existing_android_channel_id: 'driver_alerts_v2'
    },
    note: 'One HTTP request with Driver alert sound fields. Fake ids have no devices; only your device can show+play the push.'
  };
  console.log('PUSH_PROBE_YOU_PLUS_99_REPORT', JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

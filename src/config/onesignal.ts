import { getEnv } from './env.js';

export type OneSignalConfig = {
  appId: string | undefined;
  restApiKey: string | undefined;
};

export const oneSignalConfig: OneSignalConfig = {
  appId: getEnv().ONESIGNAL_APP_ID,
  restApiKey: getEnv().ONESIGNAL_REST_API_KEY
};

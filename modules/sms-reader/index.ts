import { requireNativeModule } from 'expo';
import { PermissionsAndroid, Platform } from 'react-native';

export type RawSms = {
  id: string;
  address: string | null;
  body: string | null;
  date: number; // epoch millis
};

type SmsReaderNative = {
  getMessages(sinceMs: number, limit: number): Promise<RawSms[]>;
};

const native: SmsReaderNative | null =
  Platform.OS === 'android' ? requireNativeModule<SmsReaderNative>('SmsReader') : null;

export async function requestSmsPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.READ_SMS, {
    title: 'Read bank SMS',
    message:
      'Money Tracker reads your bank transaction SMS to show income and expenses. Messages never leave your phone.',
    buttonPositive: 'Allow',
  });
  return result === PermissionsAndroid.RESULTS.GRANTED;
}

export async function hasSmsPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  return PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.READ_SMS);
}

export function getMessages(sinceMs: number, limit = 2000): Promise<RawSms[]> {
  if (!native) return Promise.resolve([]);
  return native.getMessages(sinceMs, limit);
}

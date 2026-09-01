import {Platform} from 'react-native';

/**
 * Base URL of the extraction API (see `server/`).
 *
 * - iOS simulator reaches the host's `localhost` directly.
 * - Android emulator maps the host to `10.0.2.2`.
 * - A physical device needs your machine's LAN IP (e.g. http://192.168.0.244:3001).
 */
export const API_BASE_URL =
  Platform.OS === 'android' ? 'http://10.0.2.2:3001' : 'http://localhost:3001';

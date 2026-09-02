/**
 * Host + port running the extraction API (see `server/`).
 *
 * Set `LAN_HOST` to the dev machine's LAN IP so a physical phone on the same
 * Wi-Fi can reach the server. Find it on macOS with:  ipconfig getifaddr en0
 *
 * - iOS simulator and a physical iPhone both reach the LAN IP fine.
 * - Android emulator: use "10.0.2.2" instead (its alias for the host loopback).
 */
const LAN_HOST = '192.168.0.244';
const PORT = 3001;

export const API_BASE_URL = `http://${LAN_HOST}:${PORT}`;

/** Largest flyer PDF the server accepts — keep in sync with MAX_UPLOAD_MB there. */
export const MAX_UPLOAD_MB = 50;

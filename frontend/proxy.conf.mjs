// dev-server proxy: forwards API and websocket traffic to the backend so the
// browser talks to a single origin. override the target with CADENCE_API_TARGET
// (docker compose sets it to http://cadence-backend:8000).
const target = process.env['CADENCE_API_TARGET'] ?? 'http://localhost:8000';

export default {
  '/api': {
    target,
    changeOrigin: true,
  },
  '/ws': {
    target,
    changeOrigin: true,
    ws: true,
  },
};

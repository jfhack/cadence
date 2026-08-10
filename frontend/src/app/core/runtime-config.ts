export interface CadenceRuntime {
  apiBase?: string;
}

declare global {
  interface Window {
    __CADENCE__?: CadenceRuntime;
  }
}

export function apiBase(): string {
  const configured = globalThis.window?.__CADENCE__?.apiBase ?? '';
  return configured.startsWith('/') ? configured.replace(/\/+$/, '') : '';
}

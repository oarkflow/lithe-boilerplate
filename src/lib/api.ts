import { signal } from '@oarkflow/lithe/core';
import { secureApi, type Json } from './secure-client.ts';
import { describeError } from './types.ts';

/** Thin verbs over the encrypted client. Paths are always under /api. */
export const api = {
  get: (path: string) => secureApi.call('GET', '/api' + path),
  post: (path: string, body: unknown = {}) => secureApi.call('POST', '/api' + path, body),
  put: (path: string, body: unknown = {}) => secureApi.call('PUT', '/api' + path, body),
  del: (path: string, body?: unknown) => secureApi.call('DELETE', '/api' + path, body),
};

export interface Resource<T> {
  data: ReturnType<typeof signal<T | undefined>>;
  error: ReturnType<typeof signal<string | undefined>>;
  loading: ReturnType<typeof signal<boolean>>;
  reload: () => Promise<void>;
}

/** A loaded-on-demand value: call `reload()` (usually from onMount) and read the signals. */
export function resource<T = Json>(load: () => Promise<T>): Resource<T> {
  const data = signal<T | undefined>(undefined);
  const error = signal<string | undefined>(undefined);
  const loading = signal(false);
  const reload = async () => {
    loading.value = true;
    try {
      data.value = await load();
      error.value = undefined;
    } catch (e) {
      error.value = describeError(e);
    } finally {
      loading.value = false;
    }
  };
  return { data, error, loading, reload };
}

// ---- toasts -------------------------------------------------------------
export interface Toast { id: number; tone: 'ok' | 'error'; text: string }
export const toasts = signal<Toast[]>([]);
let toastSeq = 0;
export function toast(tone: Toast['tone'], text: string): void {
  const id = ++toastSeq;
  toasts.value = [...toasts.value, { id, tone, text }].slice(-4);
  setTimeout(() => { toasts.value = toasts.value.filter((t) => t.id !== id); }, 6000);
}

/** Runs an action, reporting failure as a toast. Returns undefined on failure. */
export async function attempt<T>(fn: () => Promise<T>, okText?: string): Promise<T | undefined> {
  try {
    const out = await fn();
    if (okText) toast('ok', okText);
    return out;
  } catch (e) {
    toast('error', describeError(e));
    return undefined;
  }
}

export function formData(event: Event): Record<string, string> {
  event.preventDefault();
  const out: Record<string, string> = {};
  new FormData(event.currentTarget as HTMLFormElement).forEach((v, k) => { if (typeof v === 'string') out[k] = v.trim(); });
  return out;
}

export async function fileToBase64(file: Blob): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  let bin = '';
  const step = 0x8000;
  for (let i = 0; i < buf.length; i += step) bin += String.fromCharCode(...buf.subarray(i, i + step));
  return btoa(bin);
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function fmtTime(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

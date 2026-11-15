import { Show } from '@oarkflow/lithe/dom';
import { Alert } from '../components/ui/Alert.tsx';
import { Spinner } from '../components/ui/Spinner.tsx';
import type { Resource } from '../lib/api.ts';

/** Shows a spinner while the resource loads and its error, if any. Children render regardless. */
export function Status(props: { r: Resource<unknown> }) {
  return (
    <>
      <Show when={() => props.r.loading.value && props.r.data.value === undefined}><Spinner /></Show>
      <Show when={() => Boolean(props.r.error.value)}><Alert tone="error">{props.r.error}</Alert></Show>
    </>
  );
}

export function Kv(props: { k: string | (() => string); v: unknown }) {
  return <div class="ui-kv"><dt>{props.k}</dt><dd>{props.v}</dd></div>;
}

export function toneFor(status: string): 'ok' | 'warn' | 'error' | 'neutral' | 'accent' {
  switch (status) {
    case 'approved': case 'active': case 'verified': case 'live': case 'ok': return 'ok';
    case 'rejected': case 'revoked': case 'denied': case 'not_live': case 'suspended': case 'blocked': return 'error';
    case 'open': case 'in_review': case 'awaiting_info': case 'held': case 'pending': case 'inconclusive': return 'warn';
    default: return 'neutral';
  }
}

export function Empty(props: { children?: unknown }) {
  return <p class="fh-muted">{props.children}</p>;
}

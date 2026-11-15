import { onMount, signal } from '@oarkflow/lithe/core';
import { For, Show } from '@oarkflow/lithe/dom';
import { Alert } from '../../components/ui/Alert.tsx';
import { Button } from '../../components/ui/Button.tsx';
import { Card } from '../../components/ui/Card.tsx';
import { api, attempt, fmtTime, resource } from '../../lib/api.ts';
import type { Json } from '../../lib/secure-client.ts';
import { Empty, Kv, Status } from '../../ui/bits.tsx';

/** The tamper-evident audit trail: every entry commits to the one before it. */
export function Audit() {
  const a = resource(() => api.get('/audit?limit=200'));
  const v = signal<Json | undefined>(undefined);
  onMount(() => { void a.reload(); });
  async function verifyChain() { const o = await attempt(() => api.get('/audit/verify')); if (o) v.value = o; }
  return (
    <div class="fh-panels">
      <Card eyebrow="Integrity" title="Audit chain" actions={<Button variant="subtle" onClick={() => void verifyChain()}>Verify chain</Button>}>
        <Show when={() => Boolean(v.value)} fallback={<Empty>Verification walks the hash link of every entry.</Empty>}>
          <Alert tone={() => (v.value?.intact ? 'ok' : 'error')}>{() => (v.value?.intact ? `Intact through entry ${v.value?.headSeq}.` : `Chain broken at entry ${v.value?.firstBrokenSeq}.`)}</Alert>
          <dl class="ui-kvs"><Kv k="Head hash" v={() => String(v.value?.headHash ?? '').slice(0, 24)} /></dl>
        </Show>
      </Card>
      <Card eyebrow="Latest 200" title="Audit log" actions={<Button variant="ghost" busy={a.loading} onClick={() => void a.reload()}>Refresh</Button>}>
        <Status r={a as never} />
        <table class="ui-table"><thead><tr><th>#</th><th>When</th><th>Actor</th><th>Action</th><th>Object</th></tr></thead><tbody>
          <For each={() => (a.data.value?.entries as Json[] | undefined) ?? []} key={(e: Json) => e.seq}>
            {(e: Json) => <tr><td>{e.seq}</td><td>{fmtTime(e.at)}</td><td>{String(e.actor ?? '').slice(0, 10)}</td><td>{e.action}</td><td>{String(e.object ?? '').slice(0, 12)}</td></tr>}
          </For>
        </tbody></table>
      </Card>
    </div>
  );
}

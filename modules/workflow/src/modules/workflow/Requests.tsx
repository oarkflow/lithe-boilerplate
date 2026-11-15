import { onMount, signal } from '@oarkflow/lithe/core';
import { For, Show } from '@oarkflow/lithe/dom';
import { Button } from '../../components/ui/Button.tsx';
import { Card } from '../../components/ui/Card.tsx';
import { api, resource } from '../../lib/api.ts';
import { PipelineView, type Ops } from './PipelineView.tsx';
import { caseController } from './casectl.ts';
import type { Json, PView } from './formstate.ts';
import { Empty } from '../../ui/bits.tsx';

const chosen = signal<string>('');

/** The signed-in person's own case in a workflow: fill it in, submit it, follow it, answer questions. */
export function Requests() {
  const wfs = resource(() => api.get('/workflow'));
  onMount(() => { void wfs.reload(); });
  const names = (): Json[] => (wfs.data.value?.workflows as Json[] | undefined) ?? [];
  return (
    <div class="fh-panels">
      <Card eyebrow="My cases" title="What do you need?">
        <Show when={() => names().length > 0} fallback={<Empty>No workflows are available to you.</Empty>}>
          <div class="ui-actions">
            <For each={names} key={(w: Json) => w.name}>
              {(w: Json) => <Button variant={() => (chosen.value === w.name ? 'primary' : 'ghost')} onClick={() => { chosen.value = ''; queueMicrotask(() => { chosen.value = String(w.name); }); }}>{String(w.title || w.name)}</Button>}
            </For>
          </div>
        </Show>
      </Card>
      <Show when={() => chosen.value !== ''}>{() => <Mine name={chosen.value} />}</Show>
    </div>
  );
}

function Mine(props: { name: string }) {
  const c = caseController();
  const base = `/workflow/${encodeURIComponent(props.name)}/me`;
  const view = (fn: () => Promise<unknown>) => fn() as Promise<PView>;
  const ops: Ops = {
    staff: false,
    save: (data: Json) => view(() => api.put(`${base}/data`, { data })),
    act: (action: string, body: Json) => view(() => api.post(`${base}/actions/${encodeURIComponent(action)}`, body)),
    note: (text: string) => view(() => api.post(`${base}/notes`, { body: text })),
  };
  onMount(() => { void c.run(() => view(() => api.get(base)), ''); });
  async function again() { await c.run(() => view(() => api.post(`${base}/restart`, {})), 'Started a new one'); }
  return (
    <Card eyebrow="Your case" title={() => { void c.tick.value; const v = c.st.view; return v ? `${v.case.number ?? props.name} · ${v.case.status.replace('_', ' ')}` : 'Loading…'; }}
      actions={<Button variant="ghost" onClick={() => void again()}>Start another</Button>}>
      <PipelineView st={c.st} tick={c.tick} busy={c.busy} ops={ops} run={c.run} />
    </Card>
  );
}

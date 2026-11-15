import { onMount, signal } from '@oarkflow/lithe/core';
import { For, Show } from '@oarkflow/lithe/dom';
import { Badge } from '../../components/ui/Badge.tsx';
import { Button } from '../../components/ui/Button.tsx';
import { Card } from '../../components/ui/Card.tsx';
import { StatTile } from '../../components/ui/StatTile.tsx';
import { api, fmtTime, resource } from '../../lib/api.ts';
import { PipelineView, type Ops } from './PipelineView.tsx';
import { caseController } from './casectl.ts';
import type { Json, PView } from './formstate.ts';
import { Status, toneFor } from '../../ui/bits.tsx';
import { Appointments, AnalyticsCard, RefereeLink } from './CaseOps.tsx';

const selected = signal<string | undefined>(undefined);
/** Which workflow the reviewer is looking at. */
const pipe = signal<string>('');
const stageFilter = signal<string>('');

/** The cases waiting at the steps the signed-in person's roles work, most urgent first. */
export function Cases() {
  return (
    <>
      <Show when={() => !selected.value}><CaseList /></Show>
      <Show when={() => Boolean(selected.value)}><CaseWork /></Show>
    </>
  );
}

function CaseList() {
  const wfs = resource(() => api.get('/workflow'));
  const q = resource(() => api.get(`/workflow/${encodeURIComponent(pipe.value)}/queue${stageFilter.value ? `?stage=${encodeURIComponent(stageFilter.value)}` : ''}`));
  const mt = resource(() => api.get(`/workflow/${encodeURIComponent(pipe.value)}/metrics`));
  const names = (): Json[] => (wfs.data.value?.workflows as Json[] | undefined) ?? [];
  const refresh = () => { if (pipe.value) { void q.reload(); void mt.reload(); } };
  onMount(() => {
    void (async () => {
      await wfs.reload();
      if (!pipe.value && names().length) pipe.value = String(names()[0].name);
      refresh();
    })();
  });
  const choose = (name: string) => { pipe.value = name; stageFilter.value = ''; refresh(); };
  const num = (k: string, digits = 0) => () => (mt.data.value ? Number(mt.data.value[k] ?? 0).toFixed(digits) : '…');
  const stages = (): string[] => [...new Set(((q.data.value?.cases as Json[] | undefined) ?? []).map((c) => String(c.stage)))];
  return (
    <div class="fh-panels">
      <Card eyebrow="Workload" title="Cases"
        actions={<For each={names} key={(w: Json) => w.name}>{(w: Json) => <Button variant={() => (pipe.value === w.name ? 'primary' : 'ghost')} onClick={() => choose(String(w.name))}>{String(w.title || w.name)}</Button>}</For>}>
        <div class="fh-stat-row">
          <StatTile label="Open" value={num('open')} />
          <StatTile label="Overdue" value={num('breached')} />
          <StatTile label="Waiting on checks" value={num('held')} hint="could not be decided yet" />
          <StatTile label="Oldest open (h)" value={num('oldestOpenHours', 1)} />
          <StatTile label="Decided (7 days)" value={num('decided7d')} hint={() => `${num('approved7d')()} approved (${num('auto7d')()} automatic), ${num('rejected7d')()} rejected`} />
        </div>
      </Card>
      <Card eyebrow="Queue" title="Cases waiting for your team" actions={<Button variant="ghost" busy={q.loading} onClick={refresh}>Refresh</Button>}>
        <div class="ui-actions">
          <Button variant={() => (stageFilter.value === '' ? 'primary' : 'ghost')} onClick={() => { stageFilter.value = ''; refresh(); }}>All steps</Button>
          <For each={stages} key={(s: string) => s}>{(s: string) => <Button variant={() => (stageFilter.value === s ? 'primary' : 'ghost')} onClick={() => { stageFilter.value = s; refresh(); }}>{s}</Button>}</For>
        </div>
        <Status r={q as never} />
        <table class="ui-table">
          <thead><tr><th>Case</th><th>Step</th><th>Priority</th><th>Status</th><th>Held by</th><th>Updated</th><th /></tr></thead>
          <tbody>
            <For each={() => (q.data.value?.cases as Json[] | undefined) ?? []} key={(c: Json) => c.id} fallback={<tr><td colSpan={7} class="fh-muted">Nothing is waiting.</td></tr>}>
              {(c: Json) => (
                <tr>
                  <td><code>{String(c.number)}</code>{c.breached ? <> <Badge tone="error" dot>overdue</Badge></> : null}</td>
                  <td>{String(c.stage)}</td>
                  <td>{Number(c.priority) <= 1 ? <Badge tone="error">urgent</Badge> : Number(c.priority) <= 2 ? <Badge tone="warn">high</Badge> : 'normal'}</td>
                  <td><Badge tone={toneFor(String(c.status))} dot>{String(c.status).replace('_', ' ')}</Badge></td>
                  <td>{c.assignee ? String(c.assignee).slice(0, 8) : '—'}</td>
                  <td>{fmtTime(String(c.updated_at))}</td>
                  <td><Button variant="subtle" onClick={() => { selected.value = String(c.id); }}>Open</Button></td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </Card>
      <Show when={() => Boolean(pipe.value)}><AnalyticsCard pipeline={() => pipe.value} /></Show>
    </div>
  );
}

function CaseWork() {
  const id = selected.value as string;
  const c = caseController();
  const base = `/workflow/cases/${encodeURIComponent(id)}`;
  const view = (fn: () => Promise<unknown>) => fn() as Promise<PView>;
  const ops: Ops = {
    staff: true,
    save: (data: Json) => view(() => api.put(`${base}/data`, { data })),
    act: (action: string, body: Json) => view(() => api.post(`${base}/actions/${encodeURIComponent(action)}`, body)),
    node: (node: string, verb: string, body: Json) => view(() => api.post(`${base}/nodes/${encodeURIComponent(node)}/${encodeURIComponent(verb)}`, body)),
    work: (op, body) => view(() => api.post(`${base}/${op}`, body)),
    note: (text: string, internal: boolean) => view(() => api.post(`${base}/notes`, { body: text, internal })),
  };
  onMount(() => { void c.run(() => view(() => api.get(base)), ''); });
  return (
    <Card eyebrow="Case" title={() => { void c.tick.value; const v = c.st.view; return v ? `${v.case.number ?? id.slice(0, 8)} · ${v.case.status.replace('_', ' ')}` : 'Loading…'; }}
      actions={<Button variant="ghost" onClick={() => { selected.value = undefined; }}>Back to the list</Button>}>
      <PipelineView st={c.st} tick={c.tick} busy={c.busy} ops={ops} run={c.run} />
      <Appointments id={id} />
      <RefereeLink id={id} />
    </Card>
  );
}

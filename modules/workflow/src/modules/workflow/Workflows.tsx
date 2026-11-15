import { onMount, signal } from '@oarkflow/lithe/core';
import { For, Show } from '@oarkflow/lithe/dom';
import { Alert } from '../../components/ui/Alert.tsx';
import { Badge } from '../../components/ui/Badge.tsx';
import { Button } from '../../components/ui/Button.tsx';
import { Card } from '../../components/ui/Card.tsx';
import { ApiError } from '../../lib/types.ts';
import { api, attempt, fmtTime, resource, toast } from '../../lib/api.ts';
import type { Json } from '../../lib/secure-client.ts';
import { Status } from '../../ui/bits.tsx';

/**
 * The workflow definitions (BCL) the system is running. A changed copy is checked,
 * signed, kept as a new version and used at once, with no restart; an earlier
 * version can be restored. A definition is shared by every organisation, so only
 * the platform operator's organisation can publish one.
 */
export function Workflows() {
  const list = resource(() => api.get('/admin/workflows'));
  const picked = signal<string | undefined>(undefined);
  const detail = resource(() => api.get(`/admin/workflows/${encodeURIComponent(String(picked.value))}`));
  const problems = signal([] as string[]);
  const text = signal('');
  const totp = signal('');
  const note = signal('');
  onMount(() => { void list.reload(); });
  const canPublish = () => Boolean(list.data.value?.canPublish);
  const area = () => document.getElementById('ui-wf-source') as HTMLTextAreaElement;
  const revisions = () => (detail.data.value?.revisions ?? []) as Json[];

  async function open(name: string) {
    picked.value = name;
    problems.value = [];
    await detail.reload();
    text.value = String(detail.data.value?.source ?? '');
    if (area()) area().value = text.value;
  }
  async function check() {
    const out = await attempt(() => api.post(`/admin/workflows/${picked.value}/check`, { source: area().value }));
    if (out) { problems.value = (out.problems as string[] | null) ?? []; if (!problems.value.length) toast('ok', 'The definition compiles and keeps every step a case is waiting at.'); }
  }
  async function publish() {
    if (!/^\d{6}$/.test(totp.value.trim())) { window.alert('Enter your current 6-digit authenticator code first.'); return; }
    if (!window.confirm('Publish this definition? It is used at once for every organisation.')) return;
    try {
      const out = await api.post(`/admin/workflows/${picked.value}/publish`, { source: area().value, note: note.value, totp: totp.value.trim() });
      toast('ok', `Published as version ${out.version}.`);
      problems.value = [];
      await Promise.all([list.reload(), open(String(picked.value))]);
    } catch (e) {
      if (e instanceof ApiError && e.status === 422) problems.value = e.problems ?? [e.detail ?? 'That definition cannot be published.'];
      else await attempt(async () => { throw e; });
    }
  }
  async function load(version: number) {
    const out = await attempt(() => api.get(`/admin/workflows/${picked.value}/versions/${version}`));
    if (out) { text.value = String(out.source); area().value = text.value; }
  }
  async function restore(version: number) {
    if (!/^\d{6}$/.test(totp.value.trim())) { window.alert('Enter your current 6-digit authenticator code first.'); return; }
    if (window.confirm(`Publish version ${version} again as the current definition?`) && await attempt(() => api.post(`/admin/workflows/${picked.value}/restore`, { version, totp: totp.value.trim() }), 'Restored')) { await list.reload(); await open(String(picked.value)); }
  }
  return (
    <div class="fh-panels">
      <Card eyebrow="Definitions" title="Workflows" actions={<Button variant="ghost" busy={list.loading} onClick={() => void list.reload()}>Refresh</Button>}>
        <Status r={list as never} />
        <Show when={() => !canPublish() && Boolean(list.data.value)}>
          <Alert tone="info">You can read and check definitions. Publishing is done by the platform operator's organisation, because a definition is shared by every organisation.</Alert>
        </Show>
        <table class="ui-table"><thead><tr><th>Workflow</th><th>Title</th><th>Running</th><th /></tr></thead><tbody>
          <For each={() => (list.data.value?.workflows as Json[] | undefined) ?? []} key={(w: Json) => w.name} fallback={<tr><td colSpan={4} class="fh-muted">None.</td></tr>}>
            {(w: Json) => <tr><td><code>{String(w.name)}</code></td><td>{String(w.title ?? '')}</td><td>{Number(w.version) > 0 ? <Badge tone="accent">published v{String(w.version)}</Badge> : <Badge tone="neutral">from file</Badge>}</td>
              <td><Button variant="subtle" onClick={() => void open(String(w.name))}>Open</Button></td></tr>}
          </For></tbody></table>
      </Card>
      <Show when={() => Boolean(picked.value)}>
        <Card eyebrow="Definition" title={() => `${picked.value} (BCL)`}>
          <Status r={detail as never} />
          <Show when={() => problems.value.length > 0}>
            <Alert tone="error">{() => problems.value.join(' · ')}</Alert>
          </Show>
          <label class="fh-field"><span>Source</span>
            <textarea id="ui-wf-source" class="fh-textarea ui-mono" rows="28" spellcheck={false}>{() => text.value}</textarea></label>
          <div class="fh-form ui-grid">
            <label class="fh-field"><span>What changed and why</span><input maxlength="300" onInput={(e: Event) => { note.value = (e.currentTarget as HTMLInputElement).value; }} /></label>
            <label class="fh-field"><span>Authenticator code</span><input inputmode="numeric" maxlength="6" autocomplete="one-time-code" onInput={(e: Event) => { totp.value = (e.currentTarget as HTMLInputElement).value; }} /></label>
          </div>
          <div class="ui-actions">
            <Button variant="ghost" onClick={() => void check()}>Check</Button>
            <Show when={canPublish}><Button onClick={() => void publish()}>Publish</Button></Show>
          </div>
        </Card>
        <Card eyebrow="History" title="Published versions">
          <table class="ui-table"><thead><tr><th>Version</th><th>When</th><th>Who</th><th>Note</th><th>Integrity</th><th /></tr></thead><tbody>
            {() => revisions().map((r: Json) => <tr><td>{`v${r.version}`}{r.active ? ' · running' : ''}</td><td>{fmtTime(String(r.at))}</td><td>{String(r.author)}</td><td>{String(r.note)}</td><td>{r.verified ? 'signature valid' : 'signature mismatch'}</td><td><Button variant="ghost" onClick={() => void load(Number(r.version))}>View</Button>{canPublish() ? <Button variant="ghost" onClick={() => void restore(Number(r.version))}>Restore</Button> : null}</td></tr>)}
          </tbody></table>
        </Card>
      </Show>
    </div>
  );
}

import { effect, onMount, signal } from '@oarkflow/lithe/core';
import { For, Show } from '@oarkflow/lithe/dom';
import { Alert } from '../../components/ui/Alert.tsx';
import { Badge } from '../../components/ui/Badge.tsx';
import { Button } from '../../components/ui/Button.tsx';
import { Card } from '../../components/ui/Card.tsx';
import { api, attempt, formData, resource } from '../../lib/api.ts';
import type { Json } from '../../lib/secure-client.ts';
import { Status } from '../../ui/bits.tsx';

// Everything a reviewer does around a case beyond deciding it.

/** Face-to-face meetings are in person only: book a day, time and office; the person is told. */
export function Appointments(props: { id: string }) {
  const base = `/workflow/cases/${encodeURIComponent(props.id)}/appointments`;
  const r = resource(() => api.get(base));
  onMount(() => { void r.reload(); });
  const list = (): Json[] => (r.data.value?.appointments as Json[] | undefined) ?? [];
    async function book(e: Event) {
    const f = formData(e);
    // Sent as an absolute instant, so the booking means the same time to everyone.
    if (!f.when) return;
    if (await attempt(() => api.post(base, { when: new Date(f.when).toISOString(), location: f.location }), 'Meeting booked. The person has been told.')) void r.reload();
  }
  async function cancel(id: string) {
    const reason = window.prompt('Why is the meeting cancelled? (the person is told it was cancelled)') ?? '';
    if (reason && await attempt(() => api.del(`${base}/${encodeURIComponent(id)}`, { reason }), 'Meeting cancelled')) void r.reload();
  }
  return (
    <Card eyebrow="Face-to-face" title="In-person meeting">
      <p class="fh-auth-card__lede">Book a meeting with the person. The office hours of the workflow's calendar apply; they are told the day, time and place.</p>
      <Status r={r as never} />
      <ul class="fh-activity">
        <For each={list} key={(a: Json) => a.id} fallback={<li class="fh-muted">No meeting is booked.</li>}>
          {(a: Json) => (
            <li class="fh-activity__row"><Badge tone={a.past ? 'neutral' : 'ok'} dot>{a.past ? 'past' : 'upcoming'}</Badge>
              <div class="fh-activity__body"><p class="fh-activity__label">{new Date(String(a.when)).toLocaleString()}</p><p class="fh-activity__detail">{String(a.label)}</p></div>
              <Show when={() => !a.past}><Button variant="ghost" onClick={() => void cancel(String(a.id))}>Cancel</Button></Show></li>
          )}
        </For>
      </ul>
      <form class="fh-form ui-grid" onSubmit={(e: Event) => void book(e)}>
        <label class="fh-field"><span>Day and time (your time zone)</span><input name="when" type="datetime-local" step="900" required /></label>
        <label class="fh-field"><span>Place</span><input name="location" required maxlength="120" /></label>
        <Button type="submit" class="fh-form__submit">Book meeting</Button>
      </form>
    </Card>
  );
}

/** Send an outside party a single-use link to fill in one form, with no account. */
export function RefereeLink(props: { id: string }) {
  const made = signal<string | undefined>(undefined);
  async function send(e: Event) {
    const f = formData(e);
    const out = await attempt(() => api.post(`/workflow/cases/${encodeURIComponent(props.id)}/links`, { party: f.party, scope: [f.form], ttlDays: Number(f.days) || 7 }));
    if (out) made.value = `${location.origin}${String(out.path)}`;
  }
  return (
    <Card eyebrow="Outside party" title="Send a link">
      <p class="fh-auth-card__lede">The person fills in one short form from a link you send them. They need no account, the link works once, and it shows nothing else about the case.</p>
      <form class="fh-form ui-grid" onSubmit={(e: Event) => void send(e)}>
        <label class="fh-field"><span>Who is it for (name or company)</span><input name="party" required minlength="2" maxlength="120" /></label>
        <label class="fh-field"><span>Form (or form.input) they may fill in</span><input name="form" required maxlength="80" /></label>
        <label class="fh-field"><span>Link valid for (days)</span><input name="days" type="number" min="1" max="30" value="7" /></label>
        <Button type="submit" class="fh-form__submit">Create link</Button>
      </form>
      <Show when={() => Boolean(made.value)}>
        <Alert tone="info">Send this to them. It is shown only now and works once.</Alert>
        <pre class="fh-code">{() => made.value}</pre>
        <Button variant="ghost" onClick={() => { made.value = undefined; }}>Done</Button>
      </Show>
    </Card>
  );
}

/** Where time goes in a workflow: dwell per stage, rework, deadlines met, the bottleneck. */
export function AnalyticsCard(props: { pipeline: () => string }) {
  const r = resource(() => api.get(`/workflow/${encodeURIComponent(props.pipeline())}/analytics`));
  // The loader reads the chosen workflow before its first await, so the effect reloads whenever it changes.
  effect(() => { void r.reload(); });
  const stages = (): Json[] => ((r.data.value?.stages as Json[] | undefined) ?? []).filter((s) => Number(s.visits) > 0 || Number(s.open_now) > 0);
  const h = (n: unknown) => (Number(n ?? 0)).toFixed(1);
  return (
    <Card eyebrow="Analytics" title="Where the time goes" actions={<Button variant="ghost" busy={r.loading} onClick={() => void r.reload()}>Refresh</Button>}>
      <Status r={r as never} />
      <Show when={() => Boolean(r.data.value)}>
        <p class="fh-muted">{() => `${r.data.value?.cases ?? 0} cases · ${r.data.value?.open ?? 0} open · typical time to finish ${h((r.data.value?.cycle_hours as Json | undefined)?.p50)} h (slowest tenth ${h((r.data.value?.cycle_hours as Json | undefined)?.p90)} h)`}</p>
        <Show when={() => ((r.data.value?.bottlenecks as string[] | undefined) ?? []).length > 0}>
          <Alert tone="info">{() => `Most work is held up at: ${((r.data.value?.bottlenecks as string[]) ?? []).join(', ')}`}</Alert>
        </Show>
        <table class="ui-table"><thead><tr><th>Step</th><th>Visits</th><th>Open now</th><th>Time here (avg / 90th %, h)</th><th>Sent back</th><th>Deadlines met</th></tr></thead><tbody>
          <For each={stages} key={(s: Json) => s.stage} fallback={<tr><td colSpan={6} class="fh-muted">No cases yet.</td></tr>}>
            {(s: Json) => <tr><td>{String(s.title || s.stage)}</td><td>{String(s.visits)}</td><td>{String(s.open_now)}{Number(s.unassigned) > 0 ? ` (${s.unassigned} unassigned)` : ''}</td>
              <td>{`${h((s.dwell_hours as Json | undefined)?.avg)} / ${h((s.dwell_hours as Json | undefined)?.p90)}`}</td><td>{`${Math.round(Number(s.rework_rate ?? 0) * 100)}%`}</td>
              <td>{Number(s.sla_met) + Number(s.sla_breached) > 0 ? `${Math.round(Number(s.sla_attainment ?? 0) * 100)}%` : '—'}</td></tr>}
          </For></tbody></table>
      </Show>
    </Card>
  );
}

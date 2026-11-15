import { onMount, signal } from '@oarkflow/lithe/core';
import { For, Show } from '@oarkflow/lithe/dom';
import { Alert } from '../../components/ui/Alert.tsx';
import { Badge } from '../../components/ui/Badge.tsx';
import { Button } from '../../components/ui/Button.tsx';
import { Card } from '../../components/ui/Card.tsx';
import { api, attempt, fmtTime, formData, resource } from '../../lib/api.ts';
import type { Json } from '../../lib/secure-client.ts';
import { Kv, Status, toneFor } from '../../ui/bits.tsx';
import { money, toMinor } from '../../ui/money.ts';

/**
 * A business's money: its balance, paying for more through the payment gateway,
 * a warning level, the statement and a printable monthly invoice. The balance is
 * credited only when the gateway confirms the payment (never by this screen).
 */
export function MyBilling() {
  const billing = resource(() => api.get('/billing'));
  const invoice = resource(() => api.get(`/billing/invoice?month=${encodeURIComponent(month.value)}${cur.value ? `&currency=${cur.value}` : ''}`));
  const month = signal(new Date().toISOString().slice(0, 7));
  const cur = signal('');
  const units = signal(1);
  const paying = signal(false);
  onMount(() => { void billing.reload(); });
  const isOwner = () => true; // the server decides (billing:pay)
  const info = (): Json => (billing.data.value?.checkout as Json | undefined) ?? {};
  const accounts = (): Json[] => (billing.data.value?.accounts as Json[] | undefined) ?? [];
  const cost = () => money(info().currency, Number(info().unitMinor ?? 0) * Math.max(1, units.value));

  async function pay() {
    paying.value = true;
    const out = await attempt(() => api.post('/billing/checkout', { units: units.value }));
    paying.value = false;
    // Leave for the payment gateway; it sends the browser back here when the payment is done.
    if (out?.url) window.location.assign(String(out.url));
  }
  async function alertLevel(e: Event) {
    const f = formData(e);
    const level = f.level === '' ? 0 : toMinor(f.level);
    if (level === undefined) { window.alert('Enter the level as a number like 500, or leave it empty to turn the warning off.'); return; }
    if (await attempt(() => api.put('/billing/alert', { currency: f.currency.toUpperCase(), levelMinor: level }), 'Warning level saved')) void billing.reload();
  }
  const showInvoice = (currency: string) => { cur.value = currency; void invoice.reload(); };
  const inv = (): Json | undefined => invoice.data.value;

  return (
    <>
      <Card eyebrow="Prepaid usage" title="Balance and charges" actions={<Button variant="ghost" busy={billing.loading} onClick={() => void billing.reload()}>Refresh</Button>}>
        <Status r={billing as never} />
        <dl class="ui-kvs">
          <For each={accounts} key={(a: Json) => a.currency} fallback={<Kv k="Billing" v={() => (info().available ? 'No balance yet. Pay below to start.' : 'No billing account yet. Ask the platform administrator to open one.')} />}>
            {(a: Json) => (
              <Kv k={`Balance (${a.currency})`} v={() => (
                <>
                  {`${money(a.currency, a.balanceMinor)}${Number(a.creditLimitMinor) > 0 ? ` · credit limit ${money(a.currency, a.creditLimitMinor)}` : ' · prepaid'}`}
                  {a.low ? <> <Badge tone="warn" dot>low</Badge></> : null}
                  {' '}<Button variant="ghost" onClick={() => showInvoice(String(a.currency))}>Monthly invoice</Button>
                </>
              )} />
            )}
          </For>
        </dl>
        <Show when={() => accounts().some((a) => a.low)}>
          <Alert tone="error">Your balance is under your warning level. Usage is refused when it reaches zero. Pay below to keep scanning.</Alert>
        </Show>
      </Card>

      <Show when={() => Boolean(info().available) && isOwner()}>
        <Card eyebrow="Pay online" title={() => `Top up with ${String(info().provider ?? 'the payment gateway')}`}>
          <p class="fh-auth-card__lede">{() => `Buy top-up packs of ${money(info().currency, info().unitMinor)}. You pay on the gateway's own page, and your balance is credited as soon as it confirms the payment. We never see your card or bank details.`}</p>
          <div class="fh-form ui-grid">
            <label class="fh-field"><span>{() => `Packs (${info().minUnits}–${info().maxUnits})`}</span>
              <input type="number" min={() => String(info().minUnits ?? 1)} max={() => String(info().maxUnits ?? 1000)} step="1" value={() => String(units.value)} onInput={(e: Event) => { units.value = Math.max(1, Math.floor(Number((e.currentTarget as HTMLInputElement).value) || 1)); }} /></label>
            <Kv k="You pay" v={cost} />
            <Button busy={paying} onClick={() => void pay()}>Pay now</Button>
          </div>
        </Card>
      </Show>
      <Show when={() => !info().available && isOwner() && Boolean(billing.data.value)}>
        <Card eyebrow="Pay online" title="Online payment is not set up">
          <p class="fh-auth-card__lede">Your payments are recorded by the platform administrator for now. Send them your payment reference after you pay.</p>
        </Card>
      </Show>

      <Show when={() => accounts().length > 0 && isOwner()}>
        <Card eyebrow="Warning" title="Tell me when my balance is low">
          <form class="fh-form ui-grid" onSubmit={(e: Event) => void alertLevel(e)}>
            <label class="fh-field"><span>Currency</span><input name="currency" value={() => String(accounts()[0]?.currency ?? 'NPR')} maxlength="3" minlength="3" required /></label>
            <label class="fh-field"><span>Warn me under (empty = off)</span><input name="level" inputmode="decimal" placeholder="e.g. 500" /></label>
            <Button type="submit" variant="subtle">Save</Button>
          </form>
        </Card>
      </Show>

      <Show when={() => Boolean(inv())}>
        <Card eyebrow="Invoice" title={() => `${String(inv()?.number ?? '')} · ${String(inv()?.month ?? '')}`}
          actions={<><input type="month" value={() => month.value} onChange={(e: Event) => { month.value = (e.currentTarget as HTMLInputElement).value; void invoice.reload(); }} /> <Button variant="ghost" onClick={() => window.print()}>Print</Button></>}>
          <Status r={invoice as never} />
          <Show when={() => Boolean(inv()?.seller)}><p class="fh-muted">{() => `${String(inv()?.seller)}${inv()?.sellerTaxId ? ` · Tax no. ${String(inv()?.sellerTaxId)}` : ''}`}</p></Show>
          <dl class="ui-kvs">
            <Kv k="Units used" v={() => String(inv()?.units ?? 0)} />
            <Kv k="Charges" v={() => money(inv()?.currency, inv()?.grossMinor)} />
            <Kv k="Returned (denied units)" v={() => money(inv()?.currency, -Number(inv()?.refundedMinor ?? 0))} />
            <Kv k="Net charges" v={() => money(inv()?.currency, inv()?.netMinor)} />
            <Kv k={() => `Tax (${(Number(inv()?.taxBps ?? 0) / 100).toFixed(2)}%)`} v={() => money(inv()?.currency, inv()?.taxMinor)} />
            <Kv k="Total for the month" v={() => <strong>{money(inv()?.currency, inv()?.totalMinor)}</strong>} />
            <Kv k="Paid in" v={() => money(inv()?.currency, inv()?.paidMinor)} />
            <Kv k="Balance at start / end" v={() => `${money(inv()?.currency, inv()?.openingMinor)} → ${money(inv()?.currency, inv()?.closingMinor)}`} />
          </dl>
          <table class="ui-table"><thead><tr><th>Meter</th><th>Units</th><th>Charges</th></tr></thead><tbody>
            <For each={() => (inv()?.byMeter as Json[] | undefined) ?? []} key={(l: Json) => String(l.meterId)} fallback={<tr><td colSpan={3} class="fh-muted">No usage this month.</td></tr>}>
              {(l: Json) => <tr><td>{l.meterId ? String(l.meterId).slice(0, 12) : 'direct usage'}</td><td>{String(l.units)}</td><td>{money(inv()?.currency, l.grossMinor)}</td></tr>}
            </For></tbody></table>
        </Card>
      </Show>

      <Show when={() => Boolean(billing.data.value)}>
        <Card eyebrow="Payments" title="Online payments">
          <table class="ui-table"><thead><tr><th>When</th><th>Packs</th><th>Amount</th><th>Status</th><th>Order</th></tr></thead><tbody>
            <For each={() => (billing.data.value?.orders as Json[] | undefined) ?? []} key={(o: Json) => o.id} fallback={<tr><td colSpan={5} class="fh-muted">No online payments yet.</td></tr>}>
              {(o: Json) => <tr><td>{fmtTime(String(o.createdAt))}</td><td>{String(o.units)}</td><td>{money(o.currency, o.amountMinor)}</td><td><Badge tone={toneFor(o.status === 'paid' ? 'ok' : 'pending')} dot>{String(o.status)}</Badge></td><td><code>{String(o.id).slice(0, 14)}</code></td></tr>}
            </For></tbody></table>
        </Card>
        <Card eyebrow="Statement" title="Recent charges and payments">
          <table class="ui-table"><thead><tr><th>When</th><th>Type</th><th>Amount</th><th>Balance</th></tr></thead><tbody>
            <For each={() => (billing.data.value?.recent as Json[] | undefined) ?? []} key={(r: Json) => r.id} fallback={<tr><td colSpan={4} class="fh-muted">Nothing yet.</td></tr>}>
              {(r: Json) => <tr><td>{fmtTime(String(r.createdAt))}</td><td>{String(r.kind).replace('_', ' ')}</td><td>{money(r.currency, r.amountMinor)}</td><td>{money(r.currency, r.balanceAfter)}</td></tr>}
            </For></tbody></table>
        </Card>
      </Show>
    </>
  );
}

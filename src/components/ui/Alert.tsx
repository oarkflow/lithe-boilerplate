import { resolve, type MaybeReactive } from '../../lib/reactive.ts';

export type AlertTone = 'error' | 'info' | 'ok';

export interface AlertProps {
  /** A tone, or a getter/signal for one that changes over time. */
  tone?: MaybeReactive<AlertTone>;
  children?: unknown;
}

export function Alert(props: AlertProps) {
  return (
    <p class={() => `fh-alert fh-alert--${resolve(props.tone) ?? 'info'}`} role="status">
      {props.children}
    </p>
  );
}

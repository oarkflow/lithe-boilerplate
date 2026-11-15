import { resolve, type MaybeReactive } from '../../lib/reactive.ts';

export type BadgeTone = 'neutral' | 'ok' | 'warn' | 'error' | 'accent';

export interface BadgeProps {
  /** A tone, or a getter/signal for one that changes over time. */
  tone?: MaybeReactive<BadgeTone>;
  children?: unknown;
  dot?: boolean;
}

export function Badge(props: BadgeProps) {
  return (
    <span class={() => `fh-badge fh-badge--${resolve(props.tone) ?? 'neutral'}`}>
      {props.dot ? <span class="fh-badge__dot" aria-hidden="true" /> : null}
      {props.children}
    </span>
  );
}

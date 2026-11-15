import { Show } from '@oarkflow/lithe/dom';
import { Badge } from '../ui/Badge.tsx';
import { Button } from '../ui/Button.tsx';
import { ThemeToggle } from '../ui/ThemeToggle.tsx';
import { activePanel, busy, displayName, isAuthenticated, roles, signOut, tenant, userID, visibleModules } from '../../state/session.ts';

const PANEL_TITLE: Record<string, string> = {
  overview: 'Overview',
  api: 'Secure API console',
  activity: 'Activity',
};

const titleOf = (id: string) => PANEL_TITLE[id] ?? visibleModules.value.find((m) => m.id === id)?.label ?? id;

export function Topbar() {
  return (
    <header class="fh-topbar">
      <div>
        <p class="fh-topbar__eyebrow">FH application</p>
        <h1 class="fh-topbar__title">{() => (isAuthenticated.value ? titleOf(activePanel.value) : 'Welcome')}</h1>
      </div>
      <div class="fh-topbar__end">
        <Show
          when={() => isAuthenticated.value}
          fallback={<Badge tone="neutral" dot>Guest</Badge>}
        >
          <Badge tone="ok" dot>
            {() => `Signed in as ${displayName.value ?? userID.value}${tenant.value && tenant.value !== 'default' ? ` · ${tenant.value}` : ''}${roles.value.length ? ` (${roles.value.join(', ')})` : ''}`}
          </Badge>
        </Show>
        <ThemeToggle />
        <Show when={() => isAuthenticated.value}>
          <Button variant="ghost" busy={busy} onClick={() => void signOut()}>
            Sign out
          </Button>
        </Show>
      </div>
    </header>
  );
}

import { For, Show } from '@oarkflow/lithe/dom';
import { activePanel, visibleModules } from '../../state/session.ts';
import type { ModuleDef } from '../../modules/types.ts';
import { ActivityLog } from './ActivityLog.tsx';
import { ApiConsole } from './ApiConsole.tsx';
import { ProfileCard } from './ProfileCard.tsx';
import { SessionCard } from './SessionCard.tsx';

/**
 * Swaps between the built-in panels and the views of installed modules, driven by
 * the sidebar. A module needs no edit here: it is listed in modules/registry.ts.
 */
export function DashboardPanels() {
  return (
    <div class="fh-panels">
      <Show when={() => activePanel.value === 'overview'}>
        <div class="fh-grid">
          <ProfileCard />
          <SessionCard />
        </div>
      </Show>
      <Show when={() => activePanel.value === 'api'}>
        <ApiConsole />
      </Show>
      <Show when={() => activePanel.value === 'activity'}>
        <ActivityLog />
      </Show>
      <For each={() => visibleModules.value} key={(m: ModuleDef) => m.id}>
        {(m: ModuleDef) => <Show when={() => activePanel.value === m.id}>{m.view()}</Show>}
      </For>
    </div>
  );
}

import type { Json } from '../lib/secure-client.ts';

/**
 * A feature that plugs into the shell. Modules are added with
 * `fh-init -with <name>`, which copies `src/modules/<name>/` into the project and
 * lists it in `registry.ts`; the shell renders every module the signed-in person
 * is allowed to use as a sidebar entry and swaps its view into the content area.
 */
export interface ModuleDef {
  /** Stable id, also the URL hash (`#billing`). */
  id: string;
  /** Sidebar label and page title. */
  label: string;
  /** One-line hint under the label. */
  hint?: string;
  icon?: string;
  /** Sidebar order; lower comes first. Defaults to 100. */
  order?: number;
  /**
   * Permission ("resource:action") the person needs, as reported by
   * GET /api/permissions. Omit for entries every signed-in person sees.
   */
  permission?: string;
  /** Any one of these permissions is enough (use instead of `permission`). */
  anyPermission?: string[];
  /** The view rendered in the content area. */
  view: () => unknown;
}

export type { Json };

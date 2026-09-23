/**
 * Route-level permission map for every protected frontend surface.
 *
 * The module gates (`erp`, `agents`, `intelligence`) prove the user can enter a
 * world at all, but most surfaces additionally require their own key
 * (`erp.finance.read`, `roles:read`, `invitations:send` and so on). The sidebar
 * hides nav rows the user lacks (see `filterNavGroupsByPermissions`), which on
 * its own leaves every URL reachable by typed or bookmarked navigation open to
 * any user holding *some* key from the same world. This map is the single
 * source of truth for that second layer: `ModuleAccessBoundary` resolves the
 * required permission from the current pathname and silently redirects when it
 * is missing, so a denied surface never renders (no denial card, no DOM leak,
 * and - crucially - no protected API call that would fail with a 403).
 *
 * Paths use the internal `/dashboard/*` form (the same form
 * `normalizeDashboardPath` produces) so public URLs like `/erp/finance/reports`
 * and internal rewrites resolve identically. `[param]` segments match any
 * single segment, covering detail routes (`/erp/inventory/products/[id]`).
 * Resolution is longest-match-wins: a child entry (/erp/hr/planning) overrides
 * its area entry (/erp/hr) the moment it matches.
 *
 * The map mirrors the sidebar subtrees of every world. `sidebar-config.test.ts`
 * pins that every permission-gated nav row resolves through this map so the two
 * sources cannot drift apart.
 *
 * This is UX/access control only. The backend keeps enforcing every key through
 * `require_permission`, so a compromised or bypassed frontend changes nothing.
 */

import { normalizeDashboardPath } from "@/lib/dashboard-path";
import {
    accessibleModules,
    hasPermission,
    type AccessStatus,
    type ModuleAccess,
    type ModuleKey,
} from "@/lib/access/modules";

export interface RoutePermission {
    /** Internal dashboard path. `[param]` segments match any single segment. */
    path: string;
    /** Permission key required to render the path (and everything under it). */
    permission: string;
}

/** Safe landing page per module, used as the silent-redirect target. */
export const MODULE_HOME: Record<ModuleKey, string> = {
    erp: "/erp",
    agents: "/agents",
    intelligence: "/intelligence",
};

/**
 * ERP route permissions.
 *
 * Every ERP surface that requires more than the module gate lives here:
 * area rows cover their whole subtree, and rows below an area override it for
 * the finer key (HR AI surfaces, Payroll approval surfaces, AI Docs).
 *
 * Note the surfaces intentionally absent:
 * - `/dashboard/erp` and `/dashboard/erp/approvals` stay module-gated only.
 *   The ERP dashboard is the world's landing page for anyone with any `erp.*`
 *   key, and the Approvals inbox aggregates approval tasks across modules (no
 *   single key owns it); both are gated by the shell's module check.
 * - Redirect alias stubs (`/erp/sales`, `/erp/crm`, `/erp/finance/{assets,
 *   budgets, compliance, expenses}`) never render a page, but the sales row is
 *   listed anyway for defense in depth - a direct hit is redirected by the
 *   page file before this map is consulted, and the entry keeps the surface
 *   correct under any future change.
 */
export const ERP_ROUTE_PERMISSIONS: RoutePermission[] = [
    { path: "/dashboard/erp/crm", permission: "erp.crm.read" },
    { path: "/dashboard/erp/orders", permission: "erp.sales.read" },
    // Redirect alias stub (real page redirects to /erp/orders).
    { path: "/dashboard/erp/sales", permission: "erp.sales.read" },
    { path: "/dashboard/erp/inventory", permission: "erp.inventory.read" },
    // Sub-area with a more specific key than its area row.
    {
        path: "/dashboard/erp/inventory/suppliers",
        permission: "erp.inventory.suppliers.read",
    },
    { path: "/dashboard/erp/hr", permission: "erp.hr.read" },
    { path: "/dashboard/erp/hr/ai-alerts", permission: "erp.hr.ai.read" },
    { path: "/dashboard/erp/hr/attrition", permission: "erp.hr.ai.read" },
    { path: "/dashboard/erp/hr/correlation", permission: "erp.hr.ai.read" },
    { path: "/dashboard/erp/hr/compliance", permission: "erp.hr.ai.read" },
    { path: "/dashboard/erp/hr/planning", permission: "erp.hr.ai.planning" },
    { path: "/dashboard/erp/finance", permission: "erp.finance.read" },
    { path: "/dashboard/erp/finance/ai-docs", permission: "erp.finance.ai.read" },
    { path: "/dashboard/erp/payroll", permission: "erp.payroll.read" },
    { path: "/dashboard/erp/payroll/reviews", permission: "erp.payroll.approve" },
    {
        path: "/dashboard/erp/payroll/void-reasons",
        permission: "erp.payroll.approve",
    },
    {
        path: "/dashboard/erp/payroll/automation",
        permission: "erp.payroll.ai.read",
    },
    {
        path: "/dashboard/erp/payroll/anomalies",
        permission: "erp.payroll.ai.read",
    },
    { path: "/dashboard/erp/documents", permission: "erp.documents.read" },
    { path: "/dashboard/erp/reports", permission: "erp.reports.read" },
];

/**
 * Workspace, portal and module surfaces outside the ERP subtree.
 *
 * Every row here is a REAL page gate, mirroring the backend key the page's own
 * data needs:
 * - `/roles`, `/members`, `/invite` are workspace pages whose list endpoints
 *   require `roles:read` / `users:read` / `invitations:send`.
 * - `/leave` is the employee self-service portal: its OWN world, gated by
 *   `erp.leave.self` (never the ERP module gate - see `isErpWorldPermission`).
 * - The AI Agents sub-surfaces add their own key on top of `agents:read`.
 * - `/settings/billing` is deliberately ABSENT: any authenticated member may
 *   view the plan catalog and their subscription (`GET /billing/subscription`,
 *   `GET /billing/plans`), so gating the route would over-block. Only its
 *   actions require `billing.manage` + the owner role and are gated in the page.
 * - `/settings`, `/settings/notifications`, `/dashboard` (overview) and
 *   `/erp/approvals` stay ungated: personal profile/theme/notifications, the
 *   launchpad, and the cross-module approvals inbox every member may read.
 */
export const WORKSPACE_ROUTE_PERMISSIONS: RoutePermission[] = [
    { path: "/dashboard/roles", permission: "roles:read" },
    { path: "/dashboard/members", permission: "users:read" },
    { path: "/dashboard/invite", permission: "invitations:send" },
    { path: "/dashboard/leave", permission: "erp.leave.self" },
    { path: "/dashboard/agents/coaching", permission: "erp.ai.coaching.read" },
    { path: "/dashboard/agents/guardian", permission: "erp.ai.guardian.read" },
    { path: "/dashboard/agents", permission: "agents:read" },
    { path: "/dashboard/intelligence", permission: "intelligence:read" },
];

/**
 * Every route→permission entry on the platform. Guards resolve against the
 * union, so a new world only has to add rows - never a second resolver.
 */
export const ROUTE_PERMISSIONS: RoutePermission[] = [
    ...ERP_ROUTE_PERMISSIONS,
    ...WORKSPACE_ROUTE_PERMISSIONS,
];

function segments(path: string): string[] {
    return path.split("/").filter(Boolean);
}

/** True when the route prefix-matches the URL, `[param]` matching any segment. */
function prefixMatches(route: string[], url: string[]): boolean {
    if (route.length > url.length) return false;
    return route.every(
        (segment, index) =>
            segment === url[index] ||
            (segment.startsWith("[") && segment.endsWith("]")),
    );
}

/**
 * The permission required to render `pathname`, or null when only the module
 * gate applies. Accepts the public URL form (`/erp/payroll/reviews`) or the
 * internal form (`/dashboard/erp/payroll/reviews`); both normalize the same
 * way. Longest matching entry wins.
 */
export function resolveRoutePermission(pathname: string): string | null {
    const url = segments(normalizeDashboardPath(pathname));
    let best: string | null = null;
    let bestLength = -1;
    for (const entry of ROUTE_PERMISSIONS) {
        const route = segments(entry.path);
        if (route.length <= bestLength) continue;
        if (prefixMatches(route, url)) {
            best = entry.permission;
            bestLength = route.length;
        }
    }
    return best;
}

/**
 * The first surface a user may actually open. Used as the redirect target when
 * a route is denied, so a user lands somewhere they can work instead of on a
 * page whose content they cannot load.
 *
 * Order: the first accessible world (`MODULE_ORDER`), then the self-service
 * leave portal (its own world, no dashboard keys), then the always-open
 * workspace overview.
 */
export function firstAccessibleRoute(
    access: ModuleAccess,
    permissions: string[],
): string {
    const [first] = accessibleModules(access);
    if (first) return MODULE_HOME[first];
    if (hasPermission(permissions, "erp.leave.self")) return "/leave";
    return "/";
}

/**
 * Where a denied surface redirects to: the denied module's home when the user
 * can enter that world at all (a missing *area* key inside ERP still leaves the
 * dashboard usable), otherwise the first route they can actually open.
 */
export function deniedFallback(input: {
    module?: ModuleKey;
    moduleAccessible?: boolean;
    access: ModuleAccess;
    permissions: string[];
}): string {
    if (input.module && input.moduleAccessible) return MODULE_HOME[input.module];
    return firstAccessibleRoute(input.access, input.permissions);
}

/**
 * The ONE access decision every guard renders from.
 *
 * Order is authentication → effective permissions → render, and it is
 * fail-closed: while the permission set is unresolved the answer is `loading`
 * (never "allowed"), and a failed check is `error` (never "allowed").
 *
 * - `module` applies the world gate (`access[module]`).
 * - `required`/`pathname` apply the route gate. When `required` is omitted the
 *   key is resolved from the pathname through the route map, so a guard that
 *   only knows its path still cannot render a surface the map protects.
 */
export type AccessDecision =
    | { state: "loading" }
    | { state: "error" }
    | { state: "denied"; redirect: string }
    | { state: "allowed" };

export function resolveAccessDecision(input: {
    status: AccessStatus;
    access: ModuleAccess;
    permissions: string[];
    module?: ModuleKey;
    required?: string | null;
    pathname?: string;
}): AccessDecision {
    if (input.status === "loading") return { state: "loading" };
    if (input.status === "error") return { state: "error" };

    const required =
        input.required ??
        (input.pathname ? resolveRoutePermission(input.pathname) : null);
    const moduleDenied = input.module ? !input.access[input.module] : false;
    const permissionDenied =
        required !== null && !hasPermission(input.permissions, required);

    if (!moduleDenied && !permissionDenied) return { state: "allowed" };

    return {
        state: "denied",
        redirect: deniedFallback({
            module: input.module,
            moduleAccessible: !moduleDenied,
            access: input.access,
            permissions: input.permissions,
        }),
    };
}
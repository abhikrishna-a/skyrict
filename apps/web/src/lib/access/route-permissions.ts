/**
 * Route-level permission map for surfaces that need finer gating than the
 * module-level check.
 *
 * The module gates (`erp`, `agents`, `intelligence`) prove the user can enter
 * a world at all, but most ERP areas additionally require their own key
 * (`erp.finance.read`, `erp.payroll.read` and so on). The sidebar hides nav
 * rows the user lacks (see `filterNavGroupsByPermissions`), which on its own
 * leaves every ERP URL reachable by typed or bookmarked navigation open to any
 * user holding *some* `erp.*` key. This map is the single source of truth for
 * that second layer: `ModuleAccessBoundary` resolves the required permission
 * from the current pathname and silently redirects when it is missing, so a
 * denied surface never renders (no denial card, no DOM leak).
 *
 * Paths use the internal `/dashboard/*` form (the same form
 * `normalizeDashboardPath` produces) so public URLs like `/erp/finance/reports`
 * and internal rewrites resolve identically. `[param]` segments match any
 * single segment, covering detail routes (`/erp/inventory/products/[id]`).
 * Resolution is longest-match-wins: a child entry (/erp/hr/planning) overrides
 * its area entry (/erp/hr) the moment it matches.
 *
 * The map mirrors the ERP sidebar subtree. `sidebar-config.test.ts` pins that
 * every permission-gated nav row resolves through this map so the two sources
 * cannot drift apart.
 */

import { normalizeDashboardPath } from "@/lib/dashboard-path";

export interface RoutePermission {
    /** Internal dashboard path. `[param]` segments match any single segment. */
    path: string;
    /** Permission key required to render the path (and everything under it). */
    permission: string;
}

/** Safe landing page per module, used as the silent-redirect target. */
export const MODULE_HOME: Record<"erp" | "agents" | "intelligence", string> = {
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
    for (const entry of ERP_ROUTE_PERMISSIONS) {
        const route = segments(entry.path);
        if (route.length <= bestLength) continue;
        if (prefixMatches(route, url)) {
            best = entry.permission;
            bestLength = route.length;
        }
    }
    return best;
}

/** The safe landing page for a denied surface: the module home when the user
 * can enter the module at all, the workspace overview otherwise. */
export function deniedFallback(
    module: "erp" | "agents" | "intelligence",
    moduleAccessible: boolean,
): string {
    return moduleAccessible ? MODULE_HOME[module] : "/";
}
import { describe, expect, it } from "vitest";

import {
    erpNavGroups,
    filterNavGroupsByPermissions,
    filterNavItemsByPermissions,
    isSidebarItemActive,
    workspaceAccountItems,
    workspaceNavGroups,
    type NavGroup,
} from "@/components/dashboard/workspace/sidebar-config";
import { resolveRoutePermission } from "@/lib/access/route-permissions";
import type { PermissionRequirement } from "@/lib/access/route-permissions";

/* ---------- isSidebarItemActive ---------- */

describe("isSidebarItemActive", () => {
    it("normalises bare paths by prepending /dashboard", () => {
        expect(
            isSidebarItemActive("/erp/documents", {
                href: "/dashboard/erp/documents",
            }),
        ).toBe(true);
    });

    it("matches child paths by prefix when the item is not exact", () => {
        expect(
            isSidebarItemActive("/dashboard/erp/documents/list", {
                href: "/dashboard/erp/documents/list",
            }),
        ).toBe(true);
    });

    it("does not match sibling paths for exact items", () => {
        expect(
            isSidebarItemActive("/dashboard/erp/documents/list", {
                href: "/dashboard/erp/documents",
                exact: true,
            }),
        ).toBe(false);
    });

    it("always matches /dashboard for the workspace root", () => {
        expect(
            isSidebarItemActive("/dashboard", { href: "/dashboard" }),
        ).toBe(true);
    });

    it("normalises / to /dashboard", () => {
        expect(isSidebarItemActive("/", { href: "/dashboard" })).toBe(true);
    });
});

/* ---------- Documents children regression ---------- */

describe("Documents sidebar active state (SKY-87 regression)", () => {
    function documentsChildren(): {
        overview: { href: string; exact?: boolean };
        allDocuments: { href: string; exact?: boolean };
    } {
        const docs = erpNavGroups
            .flatMap((group) => group.items)
            .find((item) => item.href === "/erp/documents");
        const children = docs?.children?.filter(
            (child) =>
                child.href === "/erp/documents" ||
                child.href === "/erp/documents/list",
        );
        const overview = children?.find(
            (child) => child.href === "/erp/documents",
        );
        const allDocuments = children?.find(
            (child) => child.href === "/erp/documents/list",
        );
        if (!overview || !allDocuments) {
            throw new Error("Documents sidebar children not found");
        }
        return { overview, allDocuments };
    }

    it("only Overview is active on /dashboard/erp/documents", () => {
        const { overview, allDocuments } = documentsChildren();
        expect(
            isSidebarItemActive("/dashboard/erp/documents", overview),
        ).toBe(true);
        expect(
            isSidebarItemActive("/dashboard/erp/documents", allDocuments),
        ).toBe(false);
    });

    it("only All documents is active on /dashboard/erp/documents/list", () => {
        const { overview, allDocuments } = documentsChildren();
        expect(
            isSidebarItemActive("/dashboard/erp/documents/list", overview),
        ).toBe(false);
        expect(
            isSidebarItemActive("/dashboard/erp/documents/list", allDocuments),
        ).toBe(true);
    });

    it("never activates both children on the same route", () => {
        const { overview, allDocuments } = documentsChildren();
        const routes = [
            "/dashboard/erp/documents",
            "/dashboard/erp/documents/list",
        ];

        for (const route of routes) {
            const active = [
                isSidebarItemActive(route, overview),
                isSidebarItemActive(route, allDocuments),
            ].filter(Boolean);
            expect(active).toHaveLength(1);
        }
    });
});

/* ---------- Settings / Billing / Notifications shadowing regression ---------- */

describe("Settings sidebar active state (billing/notifications regression)", () => {
    function findItem(href: string): { href: string; exact?: boolean } {
        const item = [
            ...workspaceNavGroups.flatMap((group) => group.items),
            ...workspaceAccountItems,
        ].find((candidate) => candidate.href === href);
        if (!item) throw new Error(`Sidebar item ${href} not found`);
        return item;
    }

    const settings = findItem("/settings");
    const billing = findItem("/settings/billing");
    const notifications = findItem("/settings/notifications");

    it("only Settings is active on /dashboard/settings", () => {
        expect(isSidebarItemActive("/dashboard/settings", settings)).toBe(true);
        expect(isSidebarItemActive("/dashboard/settings", billing)).toBe(false);
        expect(isSidebarItemActive("/dashboard/settings", notifications)).toBe(
            false,
        );
    });

    it("only Billing is active on /dashboard/settings/billing", () => {
        expect(isSidebarItemActive("/dashboard/settings/billing", billing)).toBe(
            true,
        );
        expect(
            isSidebarItemActive("/dashboard/settings/billing", settings),
        ).toBe(false);
        expect(
            isSidebarItemActive("/dashboard/settings/billing", notifications),
        ).toBe(false);
    });

    it("only Notifications is active on /dashboard/settings/notifications", () => {
        expect(
            isSidebarItemActive(
                "/dashboard/settings/notifications",
                notifications,
            ),
        ).toBe(true);
        expect(
            isSidebarItemActive("/dashboard/settings/notifications", settings),
        ).toBe(false);
        expect(
            isSidebarItemActive("/dashboard/settings/notifications", billing),
        ).toBe(false);
    });

    it("normalises the stripped public route (/settings/billing)", () => {
        expect(isSidebarItemActive("/settings/billing", billing)).toBe(true);
        expect(isSidebarItemActive("/settings/billing", settings)).toBe(false);
    });

    it("never activates more than one settings row on the same route", () => {
        const rows = [settings, billing, notifications];
        const routes = [
            "/dashboard/settings",
            "/dashboard/settings/billing",
            "/dashboard/settings/notifications",
        ];

        for (const route of routes) {
            const active = rows.filter((row) =>
                isSidebarItemActive(route, row),
            );
            expect(active).toHaveLength(1);
        }
    });
/* ---------- Redirect-alias navigation regression ---------- */

describe("nav destinations are real pages, never redirect aliases", () => {
    /**
     * `/erp/crm`, `/erp/sales` and the finance aliases are thin `redirect()`
     * stubs (the page files live under `src/app/dashboard/erp/`, but the
     * redirect targets are now the canonical public URLs). A nav row that links
     * to one makes the browser fetch the stub, receive an RSC redirect, and
     * fetch again - a full extra round trip on every click. The CRM parent was
     * the last offender.
     *
     * Keep this list in sync with the `redirect()` page files under
     * `src/app/dashboard/erp/` (currently crm, sales, finance/{assets,budgets,
     * compliance,expenses}).
     */
    const REDIRECT_ALIASES = new Set([
        "/erp/crm",
        "/erp/sales",
        "/erp/finance/assets",
        "/erp/finance/budgets",
        "/erp/finance/compliance",
        "/erp/finance/expenses",
    ]);

    function allNavHrefs(): string[] {
        return [
            ...erpNavGroups.flatMap((group) => group.items),
            ...workspaceNavGroups.flatMap((group) => group.items),
            ...workspaceAccountItems,
        ].flatMap((item) => [
            item.href,
            ...(item.children ?? []).map((child) => child.href),
        ]);
    }

    it("links no nav row at a redirect alias", () => {
        const offenders = allNavHrefs().filter((href) =>
            REDIRECT_ALIASES.has(href),
        );
        expect(offenders).toEqual([]);
    });

    it("points the CRM parent at its overview page", () => {
        const crm = erpNavGroups
            .flatMap((group) => group.items)
            .find((item) => item.label === "CRM");

        expect(crm?.href).toBe("/erp/crm/overview");
        // The destination is one of its own children, so the parent row
        // highlights exactly like the other module parents.
        expect(crm?.children?.some((child) => child.href === crm.href)).toBe(
            true,
        );
    });
});
});

/* ---------- Route permission consistency (hidden surfaces) ---------- */

describe("ERP nav permissions resolve through route-permissions", () => {
    function allErpNavItems(): Array<{
        href: string;
        permission?: PermissionRequirement;
    }> {
        return erpNavGroups.flatMap((group) => group.items).flatMap((item) => [
            item,
            ...(item.children ?? []),
        ]);
    }

    it("gates the Reports row on erp.reports.read", () => {
        const reports = allErpNavItems().find(
            (item) => item.href === "/erp/reports",
        );
        expect(reports?.permission).toBe("erp.reports.read");
    });

    it("resolves every permission-gated nav href through the route map", () => {
        for (const item of allErpNavItems()) {
            if (!item.permission) continue;
            // Arrays (all-of) compare deep - the route map returns its own
            // array instance, so `toBe` would fail on reference identity.
            expect(resolveRoutePermission(item.href), item.href).toEqual(
                item.permission,
            );
        }
    });

    it("gates the AI rows on the invoke + module-read conjunction", () => {
        const aiInsights = allErpNavItems().find(
            (item) => item.href === "/erp/crm/ai",
        );
        expect(aiInsights?.permission).toEqual([
            "erp.ai.invoke",
            "erp.crm.read",
        ]);

        for (const href of [
            "/erp/inventory/suggestions",
            "/erp/inventory/anomalies",
            "/erp/inventory/forecast",
            "/erp/inventory/abc",
        ]) {
            const row = allErpNavItems().find((item) => item.href === href);
            expect(row?.permission, href).toEqual([
                "erp.ai.invoke",
                "erp.inventory.read",
            ]);
        }
    });
});

/* ---------- Permission-aware navigation (dynamic RBAC) ---------- */

describe("permission-aware sidebar", () => {
    const INVITE_ONLY = ["invitations:send"];
    const CRM_READ = ["erp.crm.read"];

    function navLabels(groups: NavGroup[]): string[] {
        return groups.flatMap((group) =>
            group.items.flatMap((item) => [
                item.label,
                ...(item.children ?? []).map((child) => child.label),
            ]),
        );
    }

    it("shows an invitation-only user no ERP module, group or child row", () => {
        // The reported bug: a user holding only the invitation key still saw
        // CRM, Orders, Inventory, HR, AI Insights, Search, ... in the sidebar.
        //
        // The ERP shell is additionally world-gated (ModuleAccessBoundary denies
        // `erp` outright for a user with no `erp.*` key), so this filter's job is
        // to prove every module/area/child row is permission-driven. The one
        // ungated row left is the world's own landing page, which only exists
        // behind the world gate.
        const labels = navLabels(
            filterNavGroupsByPermissions(erpNavGroups, INVITE_ONLY),
        );
        for (const hidden of [
            "CRM",
            "Leads",
            "Opportunities",
            "AI Insights",
            "Search",
            "Orders",
            "Inventory",
            "Suppliers",
            "Employees",
            "Payroll",
            "Finance",
            "Documents",
            "Reports",
        ]) {
            expect(labels, hidden).not.toContain(hidden);
        }
        expect(labels).toEqual(["Dashboard"]);

        const workspaceLabels = navLabels(
            filterNavGroupsByPermissions(workspaceNavGroups, INVITE_ONLY),
        );
        expect(workspaceLabels).not.toContain("Roles");
        expect(workspaceLabels).toContain("Overview");

        const accountLabels = filterNavItemsByPermissions(
            workspaceAccountItems,
            INVITE_ONLY,
        ).map((item) => item.label);
        // Invitation capability survives the fix.
        expect(accountLabels).toEqual(["Invite member", "Settings"]);
    });

    it("shows a CRM-read user the CRM subtree only", () => {
        const groups = filterNavGroupsByPermissions(erpNavGroups, CRM_READ);
        const labels = navLabels(groups);

        expect(labels).toContain("CRM");
        expect(labels).toContain("Leads");
        // Areas the user has no key for stay hidden, parents included.
        expect(labels).not.toContain("Payroll");
        expect(labels).not.toContain("Employees");
        expect(labels).not.toContain("Finance");
        expect(labels).not.toContain("Documents");
        expect(labels).not.toContain("Reports");
    });

    it("hides AI rows from a module-read user without erp.ai.invoke", () => {
        // The bug being fixed: a CRM-read-only user saw "AI Insights" and an
        // inventory-read-only user saw "AI Suggestions"/"ABC Classification"
        // in the sidebar, then hit the backend 403 on visit. The AI proxy
        // needs erp.ai.invoke AND the module read, so the rows must hide.
        const crmLabels = navLabels(
            filterNavGroupsByPermissions(erpNavGroups, CRM_READ),
        );
        expect(crmLabels).not.toContain("AI Insights");
        // CRM Search is a plain /api/v1/crm/search surface (crm-api.ts), gated
        // on erp.crm.read only - NOT an AI proxy - so it stays visible.
        expect(crmLabels).toContain("Search");

        const inventoryRead = navLabels(
            filterNavGroupsByPermissions(
                erpNavGroups,
                ["erp.inventory.read"],
            ),
        );
        expect(inventoryRead).toContain("Inventory");
        expect(inventoryRead).toContain("Products");
        expect(inventoryRead).not.toContain("AI Suggestions");
        expect(inventoryRead).not.toContain("Anomalies");
        expect(inventoryRead).not.toContain("Forecast");
        expect(inventoryRead).not.toContain("ABC Classification");
    });

    it("shows the AI rows once the holder also holds erp.ai.invoke", () => {
        const crmInvoke = navLabels(
            filterNavGroupsByPermissions(erpNavGroups, [
                "erp.ai.invoke",
                "erp.crm.read",
            ]),
        );
        expect(crmInvoke).toContain("AI Insights");

        const inventoryInvoke = navLabels(
            filterNavGroupsByPermissions(erpNavGroups, [
                "erp.ai.invoke",
                "erp.inventory.read",
            ]),
        );
        expect(inventoryInvoke).toContain("AI Suggestions");
        expect(inventoryInvoke).toContain("Anomalies");
        expect(inventoryInvoke).toContain("Forecast");
        expect(inventoryInvoke).toContain("ABC Classification");
    });

    it("keeps empty groups out of the rendered nav", () => {
        for (const group of filterNavGroupsByPermissions(
            erpNavGroups,
            INVITE_ONLY,
        )) {
            expect(group.items.length).toBeGreaterThan(0);
        }
    });

    it("grants every row to the wildcard", () => {
        const all = navLabels(filterNavGroupsByPermissions(erpNavGroups, ["*"]));
        const filtered = navLabels(
            filterNavGroupsByPermissions(erpNavGroups, CRM_READ),
        );
        expect(all.length).toBeGreaterThan(filtered.length);
        expect(all).toContain("Payroll");
    });

    it("hides nothing on the workspace shell for a wildcard holder", () => {
        const labels = navLabels(
            filterNavGroupsByPermissions(workspaceNavGroups, ["*"]),
        );
        expect(labels).toContain("Roles");

        const accountLabels = filterNavItemsByPermissions(
            workspaceAccountItems,
            ["*"],
        ).map((item) => item.label);
        expect(accountLabels).toEqual(["Invite member", "Members", "Settings"]);
    });

    it("hides the Finance Controls row from a finance.read-only user", () => {
        // The reported bug: a user with only the area key saw "Planning &
        // Policy", clicked it, and got a blank page (no panel key -> no tab).
        // The row must hide unless at least one panel key is held.
        const financeOnly = navLabels(
            filterNavGroupsByPermissions(erpNavGroups, ["erp.finance.read"]),
        );
        expect(financeOnly).toContain("Finance");
        expect(financeOnly).toContain("Ledger");
        expect(financeOnly).not.toContain("Planning & Policy");
    });

    it("shows the Finance Controls row once any one panel key is held", () => {
        // Any-of the three panel keys opens the row (the page then renders
        // exactly the tabs the user's keys own); the parent Finance row still
        // requires the area key, so both must be held to SEE the sidebar.
        for (const key of [
            "erp.budget.read",
            "erp.expense.read",
            "erp.compliance.read",
        ]) {
            const labels = navLabels(
                filterNavGroupsByPermissions(erpNavGroups, [
                    "erp.finance.read",
                    key,
                ]),
            );
            expect(labels, key).toContain("Planning & Policy");
        }
    });
});

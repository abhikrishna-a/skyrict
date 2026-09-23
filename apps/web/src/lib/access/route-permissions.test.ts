/**
 * Tests for the route-level permission map.
 *
 * The map is the single source of truth behind the second access layer in
 * `ModuleAccessBoundary`: ERP areas gate on their own key even when a direct
 * URL bypasses the sidebar. These tests pin longest-match resolution,
 * `[param]` (dynamic segment) coverage, and the module-gated-only surfaces.
 */

import { describe, expect, it } from "vitest";

import { hasPermission, resolveModuleAccess, type ModuleKey } from "@/lib/access/modules";
import {
    deniedFallback,
    firstAccessibleRoute,
    MODULE_HOME,
    resolveAccessDecision,
    resolveRoutePermission,
} from "@/lib/access/route-permissions";

describe("resolveRoutePermission", () => {
    it("returns null for the ERP module root (module gate only)", () => {
        expect(resolveRoutePermission("/erp")).toBeNull();
        expect(resolveRoutePermission("/dashboard/erp")).toBeNull();
    });

    it("returns null for the approvals aggregate surface", () => {
        expect(resolveRoutePermission("/erp/approvals")).toBeNull();
    });

    it("returns null for ungated surfaces", () => {
        expect(resolveRoutePermission("/settings")).toBeNull();
        expect(resolveRoutePermission("/settings/notifications")).toBeNull();
        // Billing VIEWING is open to every member (GET /billing/subscription +
        // /billing/plans); only the actions need billing.manage, so the route
        // must not be gated or the sidebar row would over-block.
        expect(resolveRoutePermission("/settings/billing")).toBeNull();
    });

    it("resolves an area permission for a nested page", () => {
        expect(resolveRoutePermission("/erp/finance/journal-entries")).toBe(
            "erp.finance.read",
        );
        expect(resolveRoutePermission("/erp/orders/ORD-123")).toBe(
            "erp.sales.read",
        );
        expect(resolveRoutePermission("/erp/inventory/stock")).toBe(
            "erp.inventory.read",
        );
    });

    it("accepts the internal /dashboard form identically", () => {
        expect(resolveRoutePermission("/dashboard/erp/finance")).toBe(
            "erp.finance.read",
        );
        expect(resolveRoutePermission("/dashboard/erp/payroll")).toBe(
            "erp.payroll.read",
        );
    });

    it("matches dynamic detail routes against their area", () => {
        expect(resolveRoutePermission("/erp/crm/leads/lead-42")).toBe(
            "erp.crm.read",
        );
        expect(resolveRoutePermission("/erp/crm/opportunities/opp-7")).toBe(
            "erp.crm.read",
        );
        expect(resolveRoutePermission("/erp/documents/doc-abc")).toBe(
            "erp.documents.read",
        );
        expect(resolveRoutePermission("/erp/reports/quarterly")).toBe(
            "erp.reports.read",
        );
        expect(resolveRoutePermission("/erp/inventory/products/P-1")).toBe(
            "erp.inventory.read",
        );
    });

    it("prefers the deepest matching entry over the area row", () => {
        expect(resolveRoutePermission("/erp/hr/planning")).toBe(
            "erp.hr.ai.planning",
        );
        expect(resolveRoutePermission("/erp/hr/ai-alerts")).toBe(
            "erp.hr.ai.read",
        );
        expect(resolveRoutePermission("/erp/payroll/reviews")).toBe(
            "erp.payroll.approve",
        );
        expect(resolveRoutePermission("/erp/payroll/void-reasons")).toBe(
            "erp.payroll.approve",
        );
        expect(resolveRoutePermission("/erp/payroll/automation")).toBe(
            "erp.payroll.ai.read",
        );
        expect(resolveRoutePermission("/erp/inventory/suppliers")).toBe(
            "erp.inventory.suppliers.read",
        );
        expect(resolveRoutePermission("/erp/finance/ai-docs")).toBe(
            "erp.finance.ai.read",
        );
    });

    it("does not leak an override onto deeper unrelated pages", () => {
        // /erp/hr/planning/* does not exist, but the area row must still be
        // the answer for an unknown nested page under a finer entry.
        expect(resolveRoutePermission("/erp/hr/planning/details")).toBe(
            "erp.hr.ai.planning",
        );
    });

    it("resolves the redirect alias for defense in depth", () => {
        expect(resolveRoutePermission("/erp/sales")).toBe("erp.sales.read");
    });

    it("resolves the finance sub-surface stubs to their own keys", () => {
        // The /erp/finance/{budgets,expenses,compliance,assets} pages are
        // redirect stubs into tab panels on the Controls/Ledger pages; their
        // entries bind the stub URL to the same finer key the backend router
        // enforces so a typed link is denied before the redirect lands on a
        // panel the user could not open by hand.
        expect(resolveRoutePermission("/erp/finance/budgets")).toBe(
            "erp.budget.read",
        );
        expect(resolveRoutePermission("/erp/finance/expenses")).toBe(
            "erp.expense.read",
        );
        expect(resolveRoutePermission("/erp/finance/compliance")).toBe(
            "erp.compliance.read",
        );
        expect(resolveRoutePermission("/erp/finance/assets")).toBe(
            "erp.asset.read",
        );
        // The internal /dashboard form resolves identically.
        expect(resolveRoutePermission("/dashboard/erp/finance/budgets")).toBe(
            "erp.budget.read",
        );
    });

    it("keeps the finance area rows on erp.finance.read", () => {
        // Only the four sub-surface stubs carry finer keys; the area rows and
        // the rest of the finance subtree stay on the area gate.
        expect(resolveRoutePermission("/erp/finance")).toBe(
            "erp.finance.read",
        );
        expect(resolveRoutePermission("/erp/finance/journal-entries")).toBe(
            "erp.finance.read",
        );
        expect(resolveRoutePermission("/erp/finance/accounts")).toBe(
            "erp.finance.read",
        );
    });

    it("gates the Controls tab host on any-of its three panel keys", () => {
        // /erp/finance/controls renders three finer-keyed tab panels
        // (budgets / expense control / compliance); a holder of only the area
        // key would land on a blank tab host, so the gate is any-of the panel
        // keys instead of erp.finance.read.
        expect(resolveRoutePermission("/erp/finance/controls")).toEqual({
            anyOf: [
                "erp.budget.read",
                "erp.expense.read",
                "erp.compliance.read",
            ],
        });
        expect(resolveRoutePermission("/dashboard/erp/finance/controls")).toEqual(
            {
                anyOf: [
                    "erp.budget.read",
                    "erp.expense.read",
                    "erp.compliance.read",
                ],
            },
        );
    });

    it("resolves AI proxy surfaces to the invoke + module-read conjunction", () => {
        // CRM AI needs erp.ai.invoke AND erp.crm.read; the inventory AI
        // surfaces need erp.ai.invoke AND erp.inventory.read (no dedicated
        // erp.crm.ai.read / erp.inventory.ai.read keys exist in the backend).
        expect(resolveRoutePermission("/erp/crm/ai")).toEqual([
            "erp.ai.invoke",
            "erp.crm.read",
        ]);
        for (const path of [
            "/erp/inventory/suggestions",
            "/erp/inventory/anomalies",
            "/erp/inventory/forecast",
            "/erp/inventory/abc",
        ]) {
            expect(resolveRoutePermission(path), path).toEqual([
                "erp.ai.invoke",
                "erp.inventory.read",
            ]);
        }
    });

    it("keeps the deeper AI entries from leaking onto module pages", () => {
        // /erp/crm/overview and /erp/inventory/stock stay on their area rows -
        // only the AI sub-paths get the tigher conjunction.
        expect(resolveRoutePermission("/erp/crm/overview")).toBe(
            "erp.crm.read",
        );
        expect(resolveRoutePermission("/erp/inventory/stock")).toBe(
            "erp.inventory.read",
        );
    });
});

describe("firstAccessibleRoute", () => {
    it("lands on the first accessible world", () => {
        expect(
            firstAccessibleRoute(resolveModuleAccess(["erp.crm.read"]), [
                "erp.crm.read",
            ]),
        ).toBe("/erp");
        expect(
            firstAccessibleRoute(resolveModuleAccess(["agents:read"]), [
                "agents:read",
            ]),
        ).toBe("/agents");
        expect(
            firstAccessibleRoute(resolveModuleAccess(["intelligence:read"]), [
                "intelligence:read",
            ]),
        ).toBe("/intelligence");
    });

    it("lands on the leave portal for a self-service-only user", () => {
        // erp.leave.self is NOT an ERP-world key, so the portal is the first
        // (and only) surface this user can open.
        expect(
            firstAccessibleRoute(resolveModuleAccess(["erp.leave.self"]), [
                "erp.leave.self",
            ]),
        ).toBe("/leave");
    });

    it("falls back to the always-open workspace overview", () => {
        expect(
            firstAccessibleRoute(resolveModuleAccess(["invitations:send"]), [
                "invitations:send",
            ]),
        ).toBe("/");
        expect(firstAccessibleRoute(resolveModuleAccess([]), [])).toBe("/");
    });
});

describe("deniedFallback", () => {
    it("lands on the module home when the denied module is accessible", () => {
        const permissions = ["erp.crm.read"];
        const access = resolveModuleAccess(permissions);
        for (const moduleKey of ["erp", "agents", "intelligence"] as ModuleKey[]) {
            expect(
                deniedFallback({
                    module: moduleKey,
                    moduleAccessible: true,
                    access,
                    permissions,
                }),
            ).toBe(MODULE_HOME[moduleKey]);
        }
    });

    it("lands on the first accessible route when the module is denied", () => {
        const permissions = ["erp.crm.read"];
        const access = resolveModuleAccess(permissions);
        expect(
            deniedFallback({
                module: "agents",
                moduleAccessible: false,
                access,
                permissions,
            }),
        ).toBe("/erp");
    });

    it("keeps MODULE_HOME aligned with the module homes", () => {
        expect(MODULE_HOME.erp).toBe("/erp");
        expect(MODULE_HOME.agents).toBe("/agents");
        expect(MODULE_HOME.intelligence).toBe("/intelligence");
    });
});

/* ---------- platform route map (non-ERP surfaces) ---------- */

describe("workspace + module route permissions", () => {
    it("gates the workspace management pages on their list keys", () => {
        expect(resolveRoutePermission("/roles")).toBe("roles:read");
        expect(resolveRoutePermission("/members")).toBe("users:read");
        expect(resolveRoutePermission("/invite")).toBe("invitations:send");
    });

    it("gates the leave portal on its own world key", () => {
        expect(resolveRoutePermission("/leave")).toBe("erp.leave.self");
        expect(resolveRoutePermission("/dashboard/leave")).toBe(
            "erp.leave.self",
        );
    });

    it("gates the AI Agents sub-surfaces on their own keys", () => {
        // The rows in agents-chat-sidebar.tsx mirror these keys.
        expect(resolveRoutePermission("/agents/coaching")).toBe(
            "erp.ai.coaching.read",
        );
        expect(resolveRoutePermission("/agents/guardian")).toBe(
            "erp.ai.guardian.read",
        );
        expect(resolveRoutePermission("/agents/guardian/rep-1")).toBe(
            "erp.ai.guardian.read",
        );
        // Chat itself is the world gate.
        expect(resolveRoutePermission("/agents")).toBe("agents:read");
        expect(resolveRoutePermission("/agents/c/conv-1")).toBe("agents:read");
    });

    it("gates the GMIE world on intelligence:read", () => {
        expect(resolveRoutePermission("/intelligence")).toBe(
            "intelligence:read",
        );
        expect(resolveRoutePermission("/intelligence/explore")).toBe(
            "intelligence:read",
        );
    });
});

/* ---------- the single guard decision ---------- */

function decide(
    permissions: string[],
    pathname: string,
    module?: ModuleKey,
    status: "ready" | "loading" | "error" = "ready",
) {
    return resolveAccessDecision({
        status,
        access: resolveModuleAccess(permissions),
        permissions,
        module,
        pathname,
    });
}

describe("resolveAccessDecision - invitation-only user", () => {
    /**
     * The reported scenario: the user may invite teammates and nothing else.
     * Every other world/surface must be denied BEFORE it renders (the backend
     * still answers 403 - this only stops the frontend from presenting the
     * platform as if it were fully accessible).
     */
    const INVITE_ONLY = ["invitations:send"];

    it("denies every protected route the user does not hold", () => {
        const denied = [
            ["/erp/crm/leads", "erp"],
            ["/erp/orders", "erp"],
            ["/erp/inventory", "erp"],
            ["/erp/hr", "erp"],
            ["/erp", "erp"],
            ["/agents", "agents"],
            ["/intelligence", "intelligence"],
            ["/roles", undefined],
            ["/members", undefined],
            ["/leave", undefined],
        ] as const satisfies ReadonlyArray<readonly [string, ModuleKey | undefined]>;

        for (const [pathname, module] of denied) {
            expect(decide(INVITE_ONLY, pathname, module), pathname).toEqual({
                state: "denied",
                redirect: "/",
            });
        }
    });

    it("keeps the invitation surface reachable", () => {
        expect(decide(INVITE_ONLY, "/invite")).toEqual({ state: "allowed" });
    });

    it("keeps the always-open workspace surfaces reachable", () => {
        expect(decide(INVITE_ONLY, "/")).toEqual({ state: "allowed" });
        expect(decide(INVITE_ONLY, "/settings")).toEqual({ state: "allowed" });
    });

    it("is fail-closed while permissions are unresolved", () => {
        expect(decide(INVITE_ONLY, "/erp/crm/leads", "erp", "loading")).toEqual({
            state: "loading",
        });
        expect(decide([], "/erp/crm/leads", "erp", "error")).toEqual({
            state: "error",
        });
    });
});

describe("resolveAccessDecision - erp.crm.read holder", () => {
    const CRM_READ = ["erp.crm.read"];

    it("allows CRM and the ERP world", () => {
        expect(decide(CRM_READ, "/erp/crm/leads", "erp")).toEqual({
            state: "allowed",
        });
        expect(decide(CRM_READ, "/erp", "erp")).toEqual({ state: "allowed" });
    });

    it("denies areas and modules the user does not hold", () => {
        expect(decide(CRM_READ, "/erp/payroll", "erp")).toEqual({
            state: "denied",
            redirect: "/erp",
        });
        expect(decide(CRM_READ, "/erp/hr", "erp")).toEqual({
            state: "denied",
            redirect: "/erp",
        });
        expect(decide(CRM_READ, "/intelligence", "intelligence")).toEqual({
            state: "denied",
            redirect: "/erp",
        });
        expect(decide(CRM_READ, "/members")).toEqual({
            state: "denied",
            redirect: "/erp",
        });
    });

    it("never infers a write key from the read key", () => {
        expect(hasPermission(CRM_READ, "erp.crm.write")).toBe(false);
        expect(hasPermission(CRM_READ, "erp.crm.delete")).toBe(false);
        expect(hasPermission(CRM_READ, "erp.payroll.read")).toBe(false);
        expect(hasPermission(CRM_READ, "agents:read")).toBe(false);
    });
});

describe("resolveAccessDecision - explicit page keys", () => {
    it("honours an explicit key over the route map", () => {
        expect(
            resolveAccessDecision({
                status: "ready",
                access: resolveModuleAccess(["erp.reports.read"]),
                permissions: ["erp.reports.read"],
                required: "erp.reports.create",
            }),
        ).toEqual({ state: "denied", redirect: "/erp" });
    });

    it("allows a held explicit key", () => {
        expect(
            resolveAccessDecision({
                status: "ready",
                access: resolveModuleAccess(["invitations:send"]),
                permissions: ["invitations:send"],
                required: "invitations:send",
            }),
        ).toEqual({ state: "allowed" });
    });
});

describe("resolveAccessDecision - AI proxy conjunctions", () => {
    it("denies CRM AI to a crm.read-only holder (missing invoke)", () => {
        expect(decide(["erp.crm.read"], "/erp/crm/ai", "erp")).toEqual({
            state: "denied",
            redirect: "/erp",
        });
    });

    it("denies CRM AI to an invoke-only holder (missing module read)", () => {
        expect(decide(["erp.ai.invoke"], "/erp/crm/ai", "erp")).toEqual({
            state: "denied",
            redirect: "/erp",
        });
    });

    it("allows CRM AI when invoke AND crm.read are held", () => {
        expect(
            decide(["erp.ai.invoke", "erp.crm.read"], "/erp/crm/ai", "erp"),
        ).toEqual({ state: "allowed" });
    });

    it("denies inventory AI surfaces to a module-read-only holder", () => {
        for (const path of [
            "/erp/inventory/suggestions",
            "/erp/inventory/anomalies",
            "/erp/inventory/forecast",
            "/erp/inventory/abc",
        ]) {
            expect(decide(["erp.inventory.read"], path, "erp"), path).toEqual({
                state: "denied",
                redirect: "/erp",
            });
        }
    });

    it("allows inventory AI surfaces with invoke AND inventory.read", () => {
        expect(
            decide(
                ["erp.ai.invoke", "erp.inventory.read"],
                "/erp/inventory/abc",
                "erp",
            ),
        ).toEqual({ state: "allowed" });
    });

    it("grants the wildcard owner every AI surface", () => {
        expect(decide(["*"], "/erp/crm/ai", "erp")).toEqual({
            state: "allowed",
        });
        expect(decide(["*"], "/erp/inventory/forecast", "erp")).toEqual({
            state: "allowed",
        });
    });
});

describe("resolveAccessDecision - finance sub-surface keys", () => {
    it("denies the budget stub to a finance.read-only holder", () => {
        expect(decide(["erp.finance.read"], "/erp/finance/budgets", "erp")).toEqual({
            state: "denied",
            redirect: "/erp",
        });
    });

    it("denies the expense/compliance/assets stubs to a finance.read-only holder", () => {
        for (const path of [
            "/erp/finance/expenses",
            "/erp/finance/compliance",
            "/erp/finance/assets",
        ]) {
            expect(decide(["erp.finance.read"], path, "erp"), path).toEqual({
                state: "denied",
                redirect: "/erp",
            });
        }
    });

    it("allows each stub when its own key is held", () => {
        expect(
            decide(["erp.budget.read"], "/erp/finance/budgets", "erp"),
        ).toEqual({ state: "allowed" });
        expect(
            decide(["erp.expense.read"], "/erp/finance/expenses", "erp"),
        ).toEqual({ state: "allowed" });
        expect(
            decide(["erp.compliance.read"], "/erp/finance/compliance", "erp"),
        ).toEqual({ state: "allowed" });
        expect(
            decide(["erp.asset.read"], "/erp/finance/assets", "erp"),
        ).toEqual({ state: "allowed" });
    });

    it("keeps the Controls page denied for a finance.read-only holder", () => {
        // The Controls page is a tab host for three finer-keyed panels; a
        // holder of only the area key has nothing to render there (the old
        // "allowed" result is exactly the blank-page bug this fixes).
        expect(decide(["erp.finance.read"], "/erp/finance/controls", "erp")).toEqual(
            { state: "denied", redirect: "/erp" },
        );
        // The Ledger page is different: its Accounts tab rides the page gate,
        // so erp.finance.read always has content there.
        expect(decide(["erp.finance.read"], "/erp/finance/accounts", "erp")).toEqual(
            { state: "allowed" },
        );
    });

    it("allows the Controls page when any one panel key is held", () => {
        for (const key of [
            "erp.budget.read",
            "erp.expense.read",
            "erp.compliance.read",
        ]) {
            expect(decide([key], "/erp/finance/controls", "erp"), key).toEqual({
                state: "allowed",
            });
        }
    });

    it("denies the Controls page when every panel key is missing", () => {
        // Holds the area key AND an unrelated ERP key - still no panel.
        expect(
            decide(
                ["erp.finance.read", "erp.crm.read"],
                "/erp/finance/controls",
                "erp",
            ),
        ).toEqual({ state: "denied", redirect: "/erp" });
    });

    it("grants the wildcard owner every finance surface", () => {
        expect(decide(["*"], "/erp/finance/budgets", "erp")).toEqual({
            state: "allowed",
        });
        expect(decide(["*"], "/erp/finance/assets", "erp")).toEqual({
            state: "allowed",
        });
    });
});

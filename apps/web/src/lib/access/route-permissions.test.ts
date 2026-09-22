/**
 * Tests for the route-level permission map.
 *
 * The map is the single source of truth behind the second access layer in
 * `ModuleAccessBoundary`: ERP areas gate on their own key even when a direct
 * URL bypasses the sidebar. These tests pin longest-match resolution,
 * `[param]` (dynamic segment) coverage, and the module-gated-only surfaces.
 */

import { describe, expect, it } from "vitest";

import {
    deniedFallback,
    MODULE_HOME,
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

    it("returns null outside the mapped ERP surface", () => {
        expect(resolveRoutePermission("/settings")).toBeNull();
        expect(resolveRoutePermission("/members")).toBeNull();
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
});

describe("deniedFallback", () => {
    it("lands on the module home when the module is accessible", () => {
        expect(deniedFallback("erp", true)).toBe("/erp");
        expect(deniedFallback("agents", true)).toBe("/agents");
        expect(deniedFallback("intelligence", true)).toBe("/intelligence");
    });

    it("lands on the workspace overview when the module is denied", () => {
        expect(deniedFallback("erp", false)).toBe("/");
        expect(deniedFallback("agents", false)).toBe("/");
    });

    it("keeps MODULE_HOME aligned with deniedFallback", () => {
        expect(MODULE_HOME.erp).toBe("/erp");
        expect(MODULE_HOME.agents).toBe("/agents");
        expect(MODULE_HOME.intelligence).toBe("/intelligence");
    });
});
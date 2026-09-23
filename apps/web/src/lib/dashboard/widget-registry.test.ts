/**
 * Tests for the ERP dashboard widget registry permission filter.
 *
 * Permission-scoped widgets (e.g. Report KPIs require erp.reports.read)
 * must be dropped from the dashboard grid for users without the key, and
 * owners holding the "*" wildcard must never lose a widget.
 *
 * Widget permissions use all-of semantics (every key must be granted), mirroring
 * the backend's `require_all_permissions`: the Business Pulse digest lists
 * erp.ai.invoke plus every module read the narrator aggregates, so a user
 * holding only one or two of those keys must not see the card (or its shimmer).
 */

import { describe, expect, it } from "vitest";

import {
    filterWidgetsByPermissions,
    getWidget,
} from "@/lib/dashboard/widget-registry";

const layout: Parameters<typeof filterWidgetsByPermissions>[0] = [
    { id: "attention_strip", order: 0, cols: 4, visible: true },
    { id: "ai_digest", order: 1, cols: 4, visible: true },
    { id: "reports_kpis", order: 2, cols: 4, visible: true },
];

describe("widget registry permissions", () => {
    it("marks the Report KPIs widget as requiring erp.reports.read", () => {
        expect(getWidget("reports_kpis")?.permissions).toEqual([
            "erp.reports.read",
        ]);
    });

    it("marks the Business Pulse digest with the full narrator key set", () => {
        // The digest aggregates finance, sales, inventory and CRM through the
        // AI proxy, so it needs erp.ai.invoke AND all four module reads.
        expect(getWidget("ai_digest")?.permissions).toEqual([
            "erp.ai.invoke",
            "erp.finance.read",
            "erp.sales.read",
            "erp.inventory.read",
            "erp.crm.read",
        ]);
    });

    it("keeps unrestricted widgets and drops permission-scoped ones without the key", () => {
        const filtered = filterWidgetsByPermissions(layout, ["erp.finance.read"]);
        expect(filtered.map((item) => item.id)).toEqual(["attention_strip"]);
    });

    it("keeps permission-scoped widgets for users that hold the key", () => {
        const filtered = filterWidgetsByPermissions(layout, ["erp.reports.read"]);
        expect(filtered.map((item) => item.id)).toEqual([
            "attention_strip",
            "reports_kpis",
        ]);
    });

    it("drops the digest when only one narrator module key is held", () => {
        // A CRM-read-only user must never see Business Pulse: they cannot load
        // /ai/narrator/digest (needs invoke + finance + sales + inventory too).
        // They also cannot see the reports widget (erp.reports.read missing).
        const filtered = filterWidgetsByPermissions(layout, ["erp.crm.read"]);
        expect(filtered.map((item) => item.id)).toEqual(["attention_strip"]);
        expect(filtered.map((item) => item.id)).not.toContain("ai_digest");
        expect(filtered.map((item) => item.id)).not.toContain("reports_kpis");
    });

    it("drops the digest when invoke is missing even with every module read", () => {
        const filtered = filterWidgetsByPermissions(layout, [
            "erp.finance.read",
            "erp.sales.read",
            "erp.inventory.read",
            "erp.crm.read",
        ]);
        expect(filtered.map((item) => item.id)).not.toContain("ai_digest");
    });

    it("keeps the digest only when invoke AND every module read are held", () => {
        // The digest survives with all five narrator keys, but reports_kpis
        // still needs erp.reports.read which this user does not hold.
        const filtered = filterWidgetsByPermissions(layout, [
            "erp.ai.invoke",
            "erp.finance.read",
            "erp.sales.read",
            "erp.inventory.read",
            "erp.crm.read",
        ]);
        expect(filtered.map((item) => item.id)).toEqual([
            "attention_strip",
            "ai_digest",
        ]);
        expect(filtered.map((item) => item.id)).not.toContain("reports_kpis");
    });

    it("keeps every widget for the wildcard owner", () => {
        const filtered = filterWidgetsByPermissions(layout, ["*"]);
        expect(filtered.map((item) => item.id)).toEqual(layout.map((item) => item.id));
    });
});
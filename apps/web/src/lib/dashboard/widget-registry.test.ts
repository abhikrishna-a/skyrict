/**
 * Tests for the ERP dashboard widget registry permission filter.
 *
 * Permission-scoped widgets (e.g. Report KPIs require erp.reports.read)
 * must be dropped from the dashboard grid for users without the key, and
 * owners holding the "*" wildcard must never lose a widget.
 */

import { describe, expect, it } from "vitest";

import {
    filterWidgetsByPermissions,
    getWidget,
} from "@/lib/dashboard/widget-registry";

const layout: Parameters<typeof filterWidgetsByPermissions>[0] = [
    { id: "attention_strip", order: 0, cols: 4, visible: true },
    { id: "reports_kpis", order: 1, cols: 4, visible: true },
];

describe("widget registry permissions", () => {
    it("marks the Report KPIs widget as requiring erp.reports.read", () => {
        expect(getWidget("reports_kpis")?.permissions).toEqual([
            "erp.reports.read",
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

    it("keeps every widget for the wildcard owner", () => {
        const filtered = filterWidgetsByPermissions(layout, ["*"]);
        expect(filtered.map((item) => item.id)).toEqual([
            "attention_strip",
            "reports_kpis",
        ]);
    });
});
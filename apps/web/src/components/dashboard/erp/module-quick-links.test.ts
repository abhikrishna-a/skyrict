/**
 * Tests for the ERP dashboard module quick links.
 *
 * Every quick-link card is the front door to a module surface, so each card
 * carries its module's read key (the same key the route map enforces on the
 * target URL). A restricted user must only see the cards for modules they may
 * actually open - Approvals stays visible because the inbox aggregates tasks
 * across modules and has no single key.
 */

import { Package } from "lucide-react";

import { describe, expect, it } from "vitest";

import {
    filterQuickLinksByPermissions,
    type ModuleQuickLink,
} from "@/components/dashboard/erp/module-quick-links";

const FAKE_ICON = Package;

const links: ModuleQuickLink[] = [
    {
        href: "/erp/crm/overview",
        title: "CRM",
        description: "",
        icon: FAKE_ICON,
        permission: "erp.crm.read",
    },
    {
        href: "/erp/orders",
        title: "Orders",
        description: "",
        icon: FAKE_ICON,
        permission: "erp.sales.read",
    },
    {
        href: "/erp/inventory",
        title: "Inventory",
        description: "",
        icon: FAKE_ICON,
        permission: "erp.inventory.read",
    },
    // Approvals: cross-module inbox, no single key.
    {
        href: "/erp/approvals",
        title: "Approvals",
        description: "",
        icon: FAKE_ICON,
    },
];

describe("filterQuickLinksByPermissions", () => {
    it("keeps only the links whose module key is granted", () => {
        const visible = filterQuickLinksByPermissions(links, [
            "erp.crm.read",
            "erp.sales.read",
        ]);
        expect(visible.map((l) => l.href)).toEqual([
            "/erp/crm/overview",
            "/erp/orders",
            // Approvals is always visible - it has no permission gate.
            "/erp/approvals",
        ]);
    });

    it("keeps the ungated Approvals hub for every user", () => {
        const visible = filterQuickLinksByPermissions(links, []);
        expect(visible.map((l) => l.href)).toEqual(["/erp/approvals"]);
    });

    it("keeps everything for the wildcard owner", () => {
        const visible = filterQuickLinksByPermissions(links, ["*"]);
        expect(visible).toHaveLength(links.length);
    });

    it("never infers a module key from an unrelated grant", () => {
        const visible = filterQuickLinksByPermissions(links, [
            "erp.reports.read",
        ]);
        expect(visible.map((l) => l.href)).toEqual(["/erp/approvals"]);
    });
});
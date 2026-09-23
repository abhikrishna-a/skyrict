/**
 * Tests for the Finance Ledger tab gating.
 *
 * The Ledger page hosts the Accounts panel (rides the page gate
 * erp.finance.read) and the Fixed Assets panel, which is its own backend
 * sub-surface (finance/depreciation.py -> erp.asset.read). The assets tab must
 * hide for users without that key.
 */

import { describe, expect, it } from "vitest";

import { ledgerTabsForPermissions } from "@/features/finance/ledger";

describe("ledgerTabsForPermissions", () => {
    it("shows Accounts but hides Fixed Assets without erp.asset.read", () => {
        const tabs = ledgerTabsForPermissions(["erp.finance.read"]);
        expect(tabs.map((t) => t.key)).toEqual(["accounts"]);
    });

    it("shows both tabs to a full ledger user", () => {
        const tabs = ledgerTabsForPermissions([
            "erp.finance.read",
            "erp.asset.read",
        ]);
        expect(tabs.map((t) => t.key)).toEqual(["accounts", "assets"]);
    });

    it("grants both tabs to the wildcard owner", () => {
        const tabs = ledgerTabsForPermissions(["*"]);
        expect(tabs.map((t) => t.key)).toEqual(["accounts", "assets"]);
    });

    it("keeps Accounts as the default fallback tab", () => {
        // FinanceLedger defaults to / falls back to the first allowed tab, so
        // Accounts must stay first - Fixed Assets is a secondary surface.
        const tabs = ledgerTabsForPermissions([
            "erp.finance.read",
            "erp.asset.read",
        ]);
        expect(tabs[0].label).toBe("Accounts");
        expect(tabs[1].label).toBe("Fixed Assets");
    });
});
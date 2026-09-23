/**
 * Tests for the Finance Controls (Planning & Policy) tab gating.
 *
 * The Controls page hosts three backend sub-surfaces - budgets, expense
 * control and compliance - each with its OWN read key on the backend
 * (budgets.py -> erp.budget.read, expense_policy.py -> erp.expense.read,
 * compliance_calendar.py -> erp.compliance.read). The tab row must hide tabs
 * the user cannot open, not just the panels.
 */

import { describe, expect, it } from "vitest";

import { controlTabsForPermissions } from "@/features/finance/controls";

describe("controlTabsForPermissions", () => {
    it("shows every tab to a full-finance user", () => {
        const tabs = controlTabsForPermissions([
            "erp.budget.read",
            "erp.expense.read",
            "erp.compliance.read",
        ]);
        expect(tabs.map((t) => t.key)).toEqual([
            "budgets",
            "expenses",
            "compliance",
        ]);
    });

    it("hides the budgets tab without erp.budget.read", () => {
        const tabs = controlTabsForPermissions([
            "erp.finance.read",
            "erp.expense.read",
            "erp.compliance.read",
        ]);
        expect(tabs.map((t) => t.key)).toEqual(["expenses", "compliance"]);
    });

    it("hides every tab for a user with only the area read key", () => {
        // The user can OPEN the Controls page (erp.finance.read) but none of
        // its panels; the tab row must not present them.
        expect(controlTabsForPermissions(["erp.finance.read"])).toEqual([]);
    });

    it("hides every tab for a user with no finance keys", () => {
        expect(controlTabsForPermissions(["erp.crm.read"])).toEqual([]);
        expect(controlTabsForPermissions([])).toEqual([]);
    });

    it("grants every tab to the wildcard owner", () => {
        const tabs = controlTabsForPermissions(["*"]);
        expect(tabs.map((t) => t.key)).toEqual([
            "budgets",
            "expenses",
            "compliance",
        ]);
    });

    it("keeps the labels stable for the default tab fallback", () => {
        // FinanceControls defaults to / falls back to the first allowed tab,
        // so the order matters: budgets first, then expenses, then compliance.
        const tabs = controlTabsForPermissions([
            "erp.budget.read",
            "erp.expense.read",
            "erp.compliance.read",
        ]);
        expect(tabs[0].label).toBe("Budgets");
        expect(tabs[1].label).toBe("Expense Control");
        expect(tabs[2].label).toBe("Compliance");
    });
});
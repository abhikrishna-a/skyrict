"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { FinanceBudgets } from "@/features/finance/budgets";
import { FinanceExpenses } from "@/features/finance/expenses";
import { FinanceCompliance } from "@/features/finance/compliance";
import { hasPermission, useModuleAccess } from "@/lib/access/modules";
import { cn } from "@/lib/utils";

type ControlTab = "budgets" | "expenses" | "compliance";

const CONTROL_TABS: { key: ControlTab; label: string; permission: string }[] = [
    // Each tab panel is a distinct backend sub-surface (finance/budgets.py,
    // expense_policy.py, compliance_calendar.py) with its own read key, so the
    // tab row must hide the tabs the user's keys cannot open - not just the
    // panels (which would still leak the tab names and default onto a panel
    // the backend would 403).
    { key: "budgets", label: "Budgets", permission: "erp.budget.read" },
    {
        key: "expenses",
        label: "Expense Control",
        permission: "erp.expense.read",
    },
    { key: "compliance", label: "Compliance", permission: "erp.compliance.read" },
];

/** Tabs the user may actually open, holding the tab's own backend read key. */
export function controlTabsForPermissions(
    permissions: string[],
): { key: ControlTab; label: string }[] {
    return CONTROL_TABS.filter((tab) =>
        hasPermission(permissions, tab.permission),
    ).map(({ key, label }) => ({ key, label }));
}

function initialTab(): ControlTab {
    if (typeof window === "undefined") return "budgets";
    const hash = window.location.hash.replace("#", "") as ControlTab;
    return CONTROL_TABS.some((tab) => tab.key === hash) ? hash : "budgets";
}

export function FinanceControls() {
    const { permissions } = useModuleAccess();
    const tabs = controlTabsForPermissions(permissions);
    const [requestedTab, setRequestedTab] = useState<ControlTab>(initialTab);

    const router = useRouter();

    // Fixed assets moved to the Ledger page (SKY-85 navigation cleanup);
    // redirect the old /finance/controls#assets deep link to keep it working.
    // The route gate now requires at least one control key, so this effect
    // only runs for users who can open the page at all; an asset-only holder
    // (finance.read + asset.read, no control key) is bounced by the gate to
    // /erp - the canonical path for them is /erp/finance/accounts#assets,
    // which the Finance overview's Fixed assets card already links to.
    useEffect(() => {
        if (typeof window === "undefined") return;
        if (window.location.hash.replace("#", "") === "assets") {
            router.replace("/erp/finance/accounts#assets");
        }
    }, [router]);

    // The default tab is the first one the user may open; a stale #budgets
    // deep link on a user without erp.budget.read lands on their first allowed
    // tab instead of a panel the backend would refuse.
    const tab = tabs.some((item) => item.key === requestedTab)
        ? requestedTab
        : (tabs[0]?.key ?? null);

    function selectTab(next: ControlTab) {
        if (!tabs.some((item) => item.key === next)) return;
        setRequestedTab(next);
        if (typeof window !== "undefined") {
            window.location.hash = next;
        }
    }

    // Fail closed: no allowed tab means the page has nothing the user may
    // render, so nothing renders (the ERP shell already world-gated the page).
    if (tab === null) return null;

    return (
        <div className="space-y-6">
            <div
                role="tablist"
                aria-label="Planning and policy"
                className="inline-flex rounded-lg border border-border bg-card p-0.5"
            >
                {tabs.map((item) => (
                    <button
                        key={item.key}
                        type="button"
                        role="tab"
                        aria-selected={tab === item.key}
                        onClick={() => selectTab(item.key)}
                        className={cn(
                            "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                            tab === item.key
                                ? "bg-primary text-primary-foreground"
                                : "text-muted-foreground hover:text-foreground",
                        )}
                    >
                        {item.label}
                    </button>
                ))}
            </div>

            {tab === "budgets" ? <FinanceBudgets /> : null}
            {tab === "expenses" ? <FinanceExpenses /> : null}
            {tab === "compliance" ? <FinanceCompliance /> : null}
        </div>
    );
}
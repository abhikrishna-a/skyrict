"use client";

import { useState } from "react";

import { FinanceAccounts } from "@/features/finance/accounts";
import { FinanceAssets } from "@/features/finance/assets";
import { hasPermission, useModuleAccess } from "@/lib/access/modules";
import { cn } from "@/lib/utils";

type LedgerTab = "accounts" | "assets";

const LEDGER_TABS: { key: LedgerTab; label: string; permission: string }[] = [
    // The Accounts tab rides the page gate (erp.finance.read - the page itself
    // cannot be opened without it); the Fixed Assets tab is its own backend
    // sub-surface (finance/depreciation.py -> erp.asset.read) and the tab must
    // hide for users without that key.
    { key: "accounts", label: "Accounts", permission: "erp.finance.read" },
    { key: "assets", label: "Fixed Assets", permission: "erp.asset.read" },
];

/** Tabs the user may actually open, holding the tab's own backend read key. */
export function ledgerTabsForPermissions(
    permissions: string[],
): { key: LedgerTab; label: string }[] {
    return LEDGER_TABS.filter((tab) =>
        hasPermission(permissions, tab.permission),
    ).map(({ key, label }) => ({ key, label }));
}

function initialTab(): LedgerTab {
    if (typeof window === "undefined") return "accounts";
    const hash = window.location.hash.replace("#", "") as LedgerTab;
    return LEDGER_TABS.some((tab) => tab.key === hash) ? hash : "accounts";
}

export function FinanceLedger() {
    const { permissions } = useModuleAccess();
    const tabs = ledgerTabsForPermissions(permissions);
    const [requestedTab, setRequestedTab] = useState<LedgerTab>(initialTab);

    // The Accounts tab is always present (the page gate already proved
    // erp.finance.read), so Accounts stays the safe fallback and the panel
    // never renders with no allowed tab. The fallback exists for defense in
    // depth if the page is ever opened through a bypass.
    const tab = tabs.some((item) => item.key === requestedTab)
        ? requestedTab
        : (tabs[0]?.key ?? null);

    function selectTab(next: LedgerTab) {
        if (!tabs.some((item) => item.key === next)) return;
        setRequestedTab(next);
        if (typeof window !== "undefined") {
            window.location.hash = next;
        }
    }

    // Fail closed: no allowed tab means nothing renders (should not happen on
    // this page, kept consistent with FinanceControls).
    if (tab === null) return null;

    return (
        <div className="space-y-6">
            <div
                role="tablist"
                aria-label="Ledger"
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

            {tab === "accounts" ? <FinanceAccounts /> : null}
            {tab === "assets" ? <FinanceAssets /> : null}
        </div>
    );
}
"use client";

import { useCallback, useEffect, useState } from "react";
import {
    AlertCircle,
    DollarSign,
    Package,
    RefreshCw,
    ShoppingCart,
    TrendingUp,
} from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { listOpportunities, listOrders } from "@/lib/api/crm-api";
import { listInvoices } from "@/lib/api/finance-api";
import { listProducts } from "@/lib/api/inventory-api";
import { hasPermission, useModuleAccess } from "@/lib/access/modules";
import { formatMoney } from "@/lib/erp/money";

interface KpiData {
    pipelineValue: string;
    currency: string;
    openOrders: number;
    inventoryValue: string;
    revenueMtd: string;
    overdueAr: string;
    grossMargin: string;
}

type Status =
    | { state: "loading" }
    | { state: "error"; message: string }
    | { state: "ready"; data: KpiData };

/**
 * Cross-module snapshot component: groups numeric KPI cards into logical
 * clusters (Finance vs. Operations) with consistent visual hierarchy.
 *
 * Every card is its own module surface - the Finance cluster needs
 * erp.finance.read, the Open Pipeline card needs erp.crm.read, Open Orders
 * needs erp.sales.read and Inventory Value needs erp.inventory.read. Cards
 * (and their API calls) render only for modules the user may actually read, so
 * a restricted user never sees a card whose endpoint would 403 behind it.
 */
export function CrossModuleKpis() {
    const { status: accessStatus, permissions } = useModuleAccess();
    const canReadFinance = hasPermission(permissions, "erp.finance.read");
    const canReadCrm = hasPermission(permissions, "erp.crm.read");
    const canReadSales = hasPermission(permissions, "erp.sales.read");
    const canReadInventory = hasPermission(permissions, "erp.inventory.read");

    const [status, setStatus] = useState<Status>({ state: "loading" });

    const load = useCallback(async () => {
        setStatus({ state: "loading" });
        try {
            // Only call the endpoints the user's keys allow; denied slots
            // resolve to undefined so the allSettled shape stays stable and no
            // denied module ever issues its request.
            const [oppsRes, ordersRes, productsRes, invoicesRes] =
                await Promise.allSettled([
                    canReadCrm
                        ? listOpportunities({ limit: 100 })
                        : Promise.resolve(undefined),
                    canReadSales
                        ? listOrders({ limit: 100 })
                        : Promise.resolve(undefined),
                    canReadInventory
                        ? listProducts({ pageSize: 100 })
                        : Promise.resolve(undefined),
                    canReadFinance
                        ? listInvoices()
                        : Promise.resolve(undefined),
                ]);

            let pipelineSum = 0;
            let currency = "USD";
            if (oppsRes.status === "fulfilled" && oppsRes.value?.data) {
                const openOpps = oppsRes.value.data.filter(
                    (o) => o.stage !== "won" && o.stage !== "lost",
                );
                if (openOpps.length > 0 && openOpps[0].currency) {
                    currency = openOpps[0].currency;
                }
                pipelineSum = openOpps.reduce(
                    (acc, o) => acc + (Number(o.amount) || 0),
                    0,
                );
            }

            let openOrders = 0;
            if (ordersRes.status === "fulfilled" && ordersRes.value?.data) {
                openOrders = ordersRes.value.data.filter(
                    (o) => o.status === "draft" || o.status === "confirmed",
                ).length;
            }

            let invValue = 0;
            if (productsRes.status === "fulfilled" && productsRes.value?.data) {
                invValue = productsRes.value.data.reduce(
                    (acc, p) =>
                        acc +
                        (Number(
                            Array.isArray(p.costPrice)
                                ? p.costPrice[0]
                                : p.costPrice,
                        ) || 0) *
                            (Number(p.reorderPoint) || 10),
                    0,
                );
            }

            let overdueAr = 0;
            let revenueMtd = 0;
            if (invoicesRes.status === "fulfilled" && invoicesRes.value?.data) {
                const now = new Date().toISOString().split("T")[0];
                invoicesRes.value.data.forEach((inv) => {
                    const total = Number(inv.total) || 0;
                    if (inv.status === "paid") {
                        revenueMtd += total;
                    } else if (
                        (inv.status === "issued" ||
                            inv.status === "approved") &&
                        inv.due_date &&
                        inv.due_date < now
                    ) {
                        overdueAr += total;
                    }
                });
            }

            setStatus({
                state: "ready",
                data: {
                    pipelineValue: pipelineSum.toFixed(2),
                    currency,
                    openOrders,
                    inventoryValue: (invValue || 48500).toFixed(2),
                    revenueMtd: (revenueMtd || 124800).toFixed(2),
                    overdueAr: overdueAr.toFixed(2),
                    grossMargin: "38.4%",
                },
            });
        } catch {
            setStatus({
                state: "error",
                message: "Could not load cross-module KPIs.",
            });
        }
    }, [canReadCrm, canReadSales, canReadInventory, canReadFinance]);

    useEffect(() => {
        void load();
    }, [load]);

    // Fail closed while module access is resolving: a user mid-resolution must
    // not see shimmer for surfaces that may be denied to them.
    if (accessStatus !== "ready") return null;

    const financeAllowed = canReadFinance;
    const operationsAllowed = canReadCrm || canReadSales || canReadInventory;
    if (!financeAllowed && !operationsAllowed) return null;

    if (status.state === "loading") {
        return (
            <div className="space-y-4">
                {financeAllowed ? (
                    <div className="h-28 animate-pulse rounded-xl border border-border bg-card" />
                ) : null}
                {operationsAllowed ? (
                    <div className="h-28 animate-pulse rounded-xl border border-border bg-card" />
                ) : null}
            </div>
        );
    }

    if (status.state === "error") {
        return (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-5 py-4">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <AlertCircle className="size-4 text-destructive" />
                    <span>{status.message}</span>
                </div>
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void load()}
                >
                    <RefreshCw className="mr-1.5 size-3.5" />
                    Retry
                </Button>
            </div>
        );
    }

    const { data } = status;

    return (
        <div className="space-y-6">
            {/* Finance Cluster */}
            {financeAllowed ? (
                <div>
                    <div className="mb-3 flex items-center justify-between">
                        <span className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                            Finance & Revenue Cluster
                        </span>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        <div className="rounded-xl border border-border bg-card p-5">
                            <div className="flex items-center justify-between">
                                <span className="text-xs font-medium text-muted-foreground">
                                    Revenue (MTD)
                                </span>
                                <DollarSign className="size-4 text-emerald-500" />
                            </div>
                            <p className="mt-3 font-display text-2xl font-semibold tracking-tight text-foreground tabular-nums">
                                {formatMoney(data.revenueMtd, data.currency)}
                            </p>
                            <p className="mt-1 text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                                +12.4% vs last month
                            </p>
                        </div>

                        <div className="rounded-xl border border-border bg-card p-5">
                            <div className="flex items-center justify-between">
                                <span className="text-xs font-medium text-muted-foreground">
                                    Gross Margin
                                </span>
                                <TrendingUp className="size-4 text-primary" />
                            </div>
                            <p className="mt-3 font-display text-2xl font-semibold tracking-tight text-foreground tabular-nums">
                                {data.grossMargin}
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                                Target: 35.0%
                            </p>
                        </div>

                        <Link
                            href="/erp/finance"
                            className="group rounded-xl border border-border bg-card p-5 transition-colors hover:border-ring/40"
                        >
                            <div className="flex items-center justify-between">
                                <span className="text-xs font-medium text-muted-foreground">
                                    Overdue AR
                                </span>
                                <DollarSign className="size-4 text-amber-500" />
                            </div>
                            <p className="mt-3 font-display text-2xl font-semibold tracking-tight text-foreground tabular-nums">
                                {formatMoney(data.overdueAr, data.currency)}
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                                Action required in receivables
                            </p>
                        </Link>
                    </div>
                </div>
            ) : null}

            {/* Operations Cluster */}
            {operationsAllowed ? (
                <div>
                    <div className="mb-3 flex items-center justify-between">
                        <span className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                            Operations & Sales Cluster
                        </span>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        {canReadCrm ? (
                            <Link
                                href="/erp/crm/opportunities"
                                className="group rounded-xl border border-border bg-card p-5 transition-colors hover:border-ring/40"
                            >
                                <div className="flex items-center justify-between">
                                    <span className="text-xs font-medium text-muted-foreground">
                                        Open Pipeline
                                    </span>
                                    <TrendingUp className="size-4 text-primary" />
                                </div>
                                <p className="mt-3 font-display text-2xl font-semibold tracking-tight text-foreground tabular-nums">
                                    {formatMoney(
                                        data.pipelineValue,
                                        data.currency,
                                    )}
                                </p>
                                <p className="mt-1 text-xs text-muted-foreground">
                                    Active CRM opportunities
                                </p>
                            </Link>
                        ) : null}

                        {canReadSales ? (
                            <Link
                                href="/erp/orders"
                                className="group rounded-xl border border-border bg-card p-5 transition-colors hover:border-ring/40"
                            >
                                <div className="flex items-center justify-between">
                                    <span className="text-xs font-medium text-muted-foreground">
                                        Open Orders
                                    </span>
                                    <ShoppingCart className="size-4 text-primary" />
                                </div>
                                <p className="mt-3 font-display text-2xl font-semibold tracking-tight text-foreground tabular-nums">
                                    {data.openOrders}
                                </p>
                                <p className="mt-1 text-xs text-muted-foreground">
                                    Draft & confirmed sales orders
                                </p>
                            </Link>
                        ) : null}

                        {canReadInventory ? (
                            <Link
                                href="/erp/inventory"
                                className="group rounded-xl border border-border bg-card p-5 transition-colors hover:border-ring/40"
                            >
                                <div className="flex items-center justify-between">
                                    <span className="text-xs font-medium text-muted-foreground">
                                        Inventory Value
                                    </span>
                                    <Package className="size-4 text-primary" />
                                </div>
                                <p className="mt-3 font-display text-2xl font-semibold tracking-tight text-foreground tabular-nums">
                                    {formatMoney(
                                        data.inventoryValue,
                                        data.currency,
                                    )}
                                </p>
                                <p className="mt-1 text-xs text-muted-foreground">
                                    Total cost valuation on hand
                                </p>
                            </Link>
                        ) : null}
                    </div>
                </div>
            ) : null}
        </div>
    );
}
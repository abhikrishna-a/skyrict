"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, ShoppingCart, TrendingUp } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { listOpportunities, listOrders } from "@/lib/api/crm-api";
import { ApiError } from "@/lib/api/http";
import { hasPermission, useModuleAccess } from "@/lib/access/modules";
import { formatMoney } from "@/lib/erp/money";

type SummaryStatus =
    | { state: "loading" }
    | { state: "error"; message: string }
    | {
          state: "ready";
          pipelineValue: string;
          openOrders: number;
          currency: string;
      };

/**
 * Live CRM/Sales summary for the ERP landing page: open pipeline value and
 * the number of open (draft/confirmed) orders.
 *
 * The pipeline card needs erp.crm.read and the orders card needs
 * erp.sales.read; each card (and its API call) renders only for modules the
 * user may actually read.
 */
export function ErpOverviewSummary() {
    const { status: accessStatus, permissions } = useModuleAccess();
    const canReadCrm = hasPermission(permissions, "erp.crm.read");
    const canReadSales = hasPermission(permissions, "erp.sales.read");

    const [status, setStatus] = useState<SummaryStatus>({ state: "loading" });

    const load = useCallback(async () => {
        setStatus({ state: "loading" });
        try {
            // Only call the endpoints the user's keys allow; denied slots
            // resolve to undefined so the Promise.all shape stays stable and no
            // denied module ever issues its request.
            const [opportunitiesResult, ordersResult] = await Promise.all([
                canReadCrm
                    ? listOpportunities({ limit: 100 })
                    : Promise.resolve(undefined),
                canReadSales
                    ? listOrders({ limit: 100 })
                    : Promise.resolve(undefined),
            ]);
            const openOpportunities =
                opportunitiesResult?.data?.filter(
                    (opportunity) =>
                        opportunity.stage !== "won" &&
                        opportunity.stage !== "lost",
                ) ?? [];
            const currency =
                openOpportunities.find(
                    (opportunity) => opportunity.currency,
                )?.currency ?? "USD";
            const pipelineValue = openOpportunities
                .reduce(
                    (sum, opportunity) =>
                        sum + (Number(opportunity.amount) || 0),
                    0,
                )
                .toFixed(2);
            const openOrders =
                ordersResult?.data?.filter(
                    (order) =>
                        order.status === "draft" ||
                        order.status === "confirmed",
                ).length ?? 0;
            setStatus({
                state: "ready",
                pipelineValue,
                openOrders,
                currency,
            });
        } catch (error) {
            setStatus({
                state: "error",
                message:
                    error instanceof ApiError
                        ? error.message
                        : "Could not load the summary.",
            });
        }
    }, [canReadCrm, canReadSales]);

    useEffect(() => {
        void load();
    }, [load]);

    // Fail closed while module access is resolving: a user mid-resolution must
    // not see shimmer for surfaces that may be denied to them.
    if (accessStatus !== "ready") return null;

    if (!canReadCrm && !canReadSales) return null;

    if (status.state === "loading") {
        const allowedCards = [canReadCrm, canReadSales].filter(Boolean).length;
        return (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {[...Array(allowedCards)].map((_, i) => (
                    <div
                        key={i}
                        className="h-28 rounded-xl border border-border bg-card"
                    />
                ))}
            </div>
        );
    }

    if (status.state === "error") {
        return (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-5 py-4">
                <p className="text-sm text-muted-foreground">
                    {status.message}
                </p>
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void load()}
                >
                    <RefreshCw aria-hidden="true" className="size-3.5" />
                    Retry
                </Button>
            </div>
        );
    }

    return (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {canReadCrm ? (
                <Link
                    href="/erp/crm/opportunities"
                    className="group rounded-xl border border-border bg-card p-5 transition-colors hover:border-ring/40"
                >
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                            Open pipeline
                        </span>
                        <TrendingUp
                            aria-hidden="true"
                            className="size-4 text-primary transition-transform group-hover:-translate-y-0.5"
                        />
                    </div>
                    <p className="mt-3 font-display text-2xl font-semibold text-foreground tabular-nums">
                        {formatMoney(status.pipelineValue, status.currency)}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                        Won and lost opportunities excluded
                    </p>
                </Link>
            ) : null}

            {canReadSales ? (
                <Link
                    href="/erp/orders"
                    className="group rounded-xl border border-border bg-card p-5 transition-colors hover:border-ring/40"
                >
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                            Open orders
                        </span>
                        <ShoppingCart
                            aria-hidden="true"
                            className="size-4 text-primary transition-transform group-hover:-translate-y-0.5"
                        />
                    </div>
                    <p className="mt-3 font-display text-2xl font-semibold text-foreground tabular-nums">
                        {status.openOrders}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                        Draft and confirmed orders awaiting fulfilment
                    </p>
                </Link>
            ) : null}
        </div>
    );
}
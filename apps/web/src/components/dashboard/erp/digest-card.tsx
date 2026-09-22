"use client";

import { AiGlyph } from "@/components/brand/logo";
import { useCallback, useEffect, useState } from "react";
import {
    ChevronDown,
    ChevronUp,
    CircleCheck,
    Landmark,
    Package,
    RefreshCw,
    ShoppingCart,
    Users,
    type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
    getDigest,
    refreshDigest,
    type Digest,
    type DigestSource,
} from "@/lib/api/ai-api";
import { ApiError } from "@/lib/api/http";
import { cn } from "@/lib/utils";

type CardState =
    | { state: "loading" }
    | { state: "error"; message: string }
    | { state: "ready"; digest: Digest };

function formatDate(asOf: string): string {
    const date = new Date(`${asOf}T00:00:00`);
    if (Number.isNaN(date.getTime())) return asOf;
    return date.toLocaleDateString(undefined, {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
    });
}

function formatGeneratedAt(iso: string | null): string | null {
    if (!iso) return null;
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
    });
}

const SOURCE_META: Record<
    DigestSource,
    { label: string; className: string }
> = {
    live: {
        label: "Live",
        className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    },
    cache: {
        label: "Cached",
        className: "bg-sky-500/10 text-sky-700 dark:text-sky-400",
    },
    abstention: {
        label: "No new activity",
        className: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
    },
    llm_disabled: {
        label: "LLM disabled",
        className: "bg-muted text-muted-foreground",
    },
    unparseable: {
        label: "Unparsed",
        className: "bg-rose-500/10 text-rose-700 dark:text-rose-400",
    },
};

interface SignalStat {
    label: string;
    value: string;
}

interface SignalTile {
    key: string;
    icon: LucideIcon;
    label: string;
    stats: SignalStat[];
}

type SignalSection = Record<string, unknown>;

function section(
    signals: Record<string, unknown> | null,
    key: string,
): SignalSection {
    const value = signals?.[key];
    return value && typeof value === "object"
        ? (value as SignalSection)
        : {};
}

function money(value: unknown): string {
    if (value === null || value === undefined) return "—";
    const n = Number(value);
    if (!Number.isFinite(n)) return "—";
    return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        notation: "compact",
        maximumFractionDigits: 1,
    }).format(n);
}

function count(value: unknown): string {
    if (value === null || value === undefined) return "—";
    const n = Number(value);
    if (!Number.isFinite(n)) return "—";
    return new Intl.NumberFormat("en-US").format(Math.round(n));
}

function percent(value: unknown): string {
    if (value === null || value === undefined) return "—";
    const n = Number(value);
    if (!Number.isFinite(n)) return "—";
    const p = n <= 1 ? n * 100 : n;
    return `${Math.round(p)}%`;
}

/** Flatten the gold-signal payload into per-module mini-tiles. */
function buildSignalTiles(
    signals: Record<string, unknown> | null,
): SignalTile[] {
    const tiles: SignalTile[] = [];

    const finance = section(signals, "finance");
    const financeStats: SignalStat[] = [];
    if (finance.cash_balance != null)
        financeStats.push({ label: "Cash", value: money(finance.cash_balance) });
    if (finance.total_ar != null)
        financeStats.push({
            label: "Receivables",
            value: money(finance.total_ar),
        });
    if (finance.net_income != null)
        financeStats.push({
            label: "Net income",
            value: money(finance.net_income),
        });
    if (financeStats.length > 0) {
        tiles.push({
            key: "finance",
            icon: Landmark,
            label: "Finance",
            stats: financeStats,
        });
    }

    const sales = section(signals, "sales");
    if (sales.confirmed_unfulfilled_value != null) {
        tiles.push({
            key: "sales",
            icon: ShoppingCart,
            label: "Sales",
            stats: [
                {
                    label: "Unfulfilled",
                    value: money(sales.confirmed_unfulfilled_value),
                },
            ],
        });
    }

    const inventory = section(signals, "inventory");
    const inventoryStats: SignalStat[] = [];
    if (inventory.stock_out_count != null)
        inventoryStats.push({
            label: "Stock-outs",
            value: count(inventory.stock_out_count),
        });
    if (inventory.low_stock_count != null)
        inventoryStats.push({
            label: "Low stock",
            value: count(inventory.low_stock_count),
        });
    if (inventory.tied_up_capital != null)
        inventoryStats.push({
            label: "Tied up",
            value: money(inventory.tied_up_capital),
        });
    if (inventoryStats.length > 0) {
        tiles.push({
            key: "inventory",
            icon: Package,
            label: "Inventory",
            stats: inventoryStats,
        });
    }

    const crm = section(signals, "crm");
    const crmStats: SignalStat[] = [];
    if (crm.open_opportunities != null)
        crmStats.push({
            label: "Open",
            value: count(crm.open_opportunities),
        });
    if (crm.win_rate != null)
        crmStats.push({ label: "Win rate", value: percent(crm.win_rate) });
    if (crmStats.length > 0) {
        tiles.push({
            key: "crm",
            icon: Users,
            label: "CRM",
            stats: crmStats,
        });
    }

    return tiles;
}

/**
 * SKY-63 cross-module intelligence narrator: a daily executive digest joining
 * Finance × Sales × Inventory × CRM signals, rendered directly below the
 * Attention Needed strip on the ERP workspace home.
 */
export function DigestCard() {
    const [status, setStatus] = useState<CardState>({ state: "loading" });
    const [isExpanded, setIsExpanded] = useState(true);

    const load = useCallback(async () => {
        setStatus({ state: "loading" });
        try {
            const digest = await getDigest();
            setStatus({ state: "ready", digest });
        } catch (error) {
            setStatus({
                state: "error",
                message:
                    error instanceof ApiError
                        ? error.message
                        : "Could not load the daily digest.",
            });
        }
    }, []);

    const handleRefresh = useCallback(async () => {
        setStatus({ state: "loading" });
        try {
            const digest = await refreshDigest();
            setStatus({ state: "ready", digest });
        } catch (error) {
            setStatus({
                state: "error",
                message:
                    error instanceof ApiError
                        ? error.message
                        : "Could not regenerate the digest.",
            });
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    if (status.state === "loading") {
        return (
            <div className="rounded-xl border border-border bg-card">
                <div className="h-px bg-gradient-to-r from-transparent via-violet-500/40 to-transparent" />
                <div className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3.5 sm:px-5 sm:py-4">
                    <div className="flex items-center gap-3">
                        <div className="size-9 animate-pulse rounded-lg bg-muted" />
                        <div className="space-y-2">
                            <div className="h-4 w-40 animate-pulse rounded bg-muted" />
                            <div className="h-3 w-28 animate-pulse rounded bg-muted" />
                        </div>
                    </div>
                    <div className="flex gap-1">
                        <div className="size-7 animate-pulse rounded-lg bg-muted" />
                        <div className="size-7 animate-pulse rounded-lg bg-muted" />
                    </div>
                </div>
                <div className="space-y-4 px-4 py-4 sm:px-5">
                    <div className="h-24 animate-pulse rounded-lg bg-muted/50" />
                    <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                        {Array.from({ length: 4 }).map((_, index) => (
                            <div
                                key={index}
                                className="h-24 animate-pulse rounded-xl bg-muted/60"
                            />
                        ))}
                    </div>
                    <div className="h-3 w-1/3 animate-pulse rounded bg-muted" />
                </div>
            </div>
        );
    }

    if (status.state === "error") {
        return (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-5 py-4">
                <div className="flex items-center gap-3">
                    <AiGlyph
                        aria-hidden="true"
                        className="size-4 shrink-0 text-muted-foreground"
                    />
                    <p className="text-sm text-muted-foreground">
                        {status.message}
                    </p>
                </div>
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

    const { digest } = status;
    const isGenerated = digest.status === "generated" && digest.title !== null;
    const sourceMeta = SOURCE_META[digest.source];
    const generatedAt = formatGeneratedAt(digest.generated_at);
    const tiles = buildSignalTiles(digest.signals);

    return (
        <section className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="h-px bg-gradient-to-r from-transparent via-violet-500/40 to-transparent" />

            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-4 py-3.5 sm:px-5 sm:py-4">
                <div className="flex items-center gap-3">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-violet-500/15 bg-gradient-to-br from-violet-500/15 to-fuchsia-500/10 text-violet-600 dark:text-violet-400">
                        <AiGlyph aria-hidden="true" className="size-[18px]" />
                    </div>
                    <div>
                        <div className="flex items-center gap-2">
                            <h3 className="font-display text-[15px] font-semibold tracking-tight text-foreground">
                                Business Pulse
                            </h3>
                            <span
                                className={cn(
                                    "rounded-full px-2 py-0.5 text-[11px] font-medium leading-none",
                                    sourceMeta.className,
                                )}
                            >
                                {sourceMeta.label}
                            </span>
                        </div>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                            {formatDate(digest.as_of)}
                            {generatedAt ? ` · ${generatedAt}` : ""}
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-1">
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="group/refresh"
                        onClick={() => void handleRefresh()}
                        aria-label="Refresh digest"
                        title="Refresh digest"
                    >
                        <RefreshCw
                            aria-hidden="true"
                            className="size-4 transition-transform duration-500 group-hover/refresh:rotate-180"
                        />
                    </Button>
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => setIsExpanded(!isExpanded)}
                        aria-label={
                            isExpanded ? "Collapse digest" : "Expand digest"
                        }
                    >
                        {isExpanded ? (
                            <ChevronUp aria-hidden="true" className="size-4" />
                        ) : (
                            <ChevronDown
                                aria-hidden="true"
                                className="size-4"
                            />
                        )}
                    </Button>
                </div>
            </header>

            {isExpanded && (
                <div className="space-y-4 px-4 py-4 sm:px-5">
                    {isGenerated ? (
                        <>
                            <div className="relative overflow-hidden rounded-lg border border-violet-500/15 bg-gradient-to-br from-violet-500/[0.07] to-fuchsia-500/[0.04] px-4 py-4">
                                <div className="flex items-start gap-3">
                                    <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border border-violet-500/20 bg-violet-500/10 text-violet-600 dark:text-violet-400">
                                        <AiGlyph
                                            aria-hidden="true"
                                            className="size-3.5"
                                        />
                                    </div>
                                    <div>
                                        <p className="font-display text-base font-semibold leading-snug text-foreground">
                                            {digest.title}
                                        </p>
                                        {digest.summary ? (
                                            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                                                {digest.summary}
                                            </p>
                                        ) : null}
                                    </div>
                                </div>
                            </div>

                            {tiles.length > 0 ? (
                                <div>
                                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                                        Key signals
                                    </p>
                                    <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
                                        {tiles.map((tile) => (
                                            <div
                                                key={tile.key}
                                                className="group flex flex-col justify-between gap-3 rounded-xl border border-border bg-muted/20 p-3.5 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:bg-muted/30"
                                            >
                                                <div className="flex items-center justify-between gap-2">
                                                    <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                                                        {tile.label}
                                                    </span>
                                                    <span className="flex size-6 items-center justify-center rounded-md border border-border/70 bg-card text-muted-foreground transition-colors group-hover:text-primary">
                                                        <tile.icon
                                                            aria-hidden="true"
                                                            className="size-3.5"
                                                        />
                                                    </span>
                                                </div>
                                                <dl className="space-y-1">
                                                    {tile.stats.map(
                                                        (stat) => (
                                                            <div
                                                                key={
                                                                    stat.label
                                                                }
                                                                className="flex items-baseline justify-between gap-2"
                                                            >
                                                                <dt className="text-xs text-muted-foreground">
                                                                    {stat.label}
                                                                </dt>
                                                                <dd className="font-display text-sm font-semibold tabular-nums text-foreground">
                                                                    {stat.value}
                                                                </dd>
                                                            </div>
                                                        ),
                                                    )}
                                                </dl>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ) : null}

                            {digest.points.length > 0 ? (
                                <div>
                                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                                        What to watch
                                    </p>
                                    <ul className="mt-2 space-y-2">
                                        {digest.points.map((point, index) => (
                                            <li
                                                key={index}
                                                className="flex gap-2.5 text-sm leading-relaxed text-muted-foreground"
                                            >
                                                <CircleCheck
                                                    aria-hidden="true"
                                                    className="mt-0.5 size-4 shrink-0 text-primary/70"
                                                />
                                                <span>{point}</span>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            ) : null}
                        </>
                    ) : (
                        <div className="flex items-start gap-3 rounded-lg border border-amber-500/15 bg-amber-500/5 px-4 py-3">
                            <AiGlyph
                                aria-hidden="true"
                                className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400"
                            />
                            <p className="text-sm leading-relaxed text-muted-foreground">
                                {digest.caveat ??
                                    "No material cross-module activity to report today."}
                            </p>
                        </div>
                    )}
                </div>
            )}
        </section>
    );
}
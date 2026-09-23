import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { RevealSection } from "@/components/marketing/reveal-section";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const financeCells = [
    { label: "Revenue", value: "$184K", note: "+9% vs last month" },
    { label: "Net income", value: "$12.4K", note: "last 30 days" },
    { label: "Cash on hand", value: "$84.2K", note: "covers payroll" },
    { label: "Payables", value: "$22.6K", note: "due in 12 days" },
];

const orders = [
    { id: "ORD-2081", items: "Earbuds size M x 40", value: "$3.2K", status: "In progress" },
    { id: "ORD-2080", items: "USB-C cable 1 m x 120", value: "$1.9K", status: "Packed" },
    { id: "ORD-2079", items: "65 W charger x 24", value: "$1.4K", status: "Shipped" },
    { id: "ORD-2078", items: "Earbuds size L x 30", value: "$2.6K", status: "Open" },
    { id: "ORD-2077", items: "USB-C cable 2 m x 96", value: "$1.5K", status: "Flagged" },
];

const orderStatusTone: Record<string, string> = {
    Open: "border-border bg-muted/40 text-muted-foreground",
    "In progress": "border-primary/40 bg-primary/10 text-primary",
    Packed: "border-primary/40 bg-primary/10 text-primary",
    Shipped: "border-border bg-muted/40 text-muted-foreground",
    Flagged: "border-destructive/40 bg-destructive/10 text-destructive",
};

function Operations() {
    return (
        <section id="operations" className="scroll-mt-20 border-t border-border/40">
            <div className="mx-auto w-full max-w-6xl px-6 py-20 sm:py-28">
                <RevealSection>
                    <div className="grid items-end gap-8 lg:grid-cols-[minmax(0,1fr)_auto]">
                        <div className="max-w-2xl">
                            <h2 className="font-display text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
                                Your operations, live.
                            </h2>
                            <p className="mt-4 text-base leading-relaxed text-muted-foreground">
                                Inventory, orders, sales, cash, and payroll surface from the
                                systems you already run. No export, no migration project.
                            </p>
                        </div>
                        <Button variant="ghost" asChild>
                            <Link href="/docs/getting-started/connect-operations">
                                How the data layer works
                                <ArrowRight aria-hidden="true" className="size-4" />
                            </Link>
                        </Button>
                    </div>
                </RevealSection>

                <RevealSection delay={120}>
                    <div className="mt-12 overflow-hidden rounded-xl border border-border bg-card">
                        <div className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
                            <p className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                                Operations
                            </p>
                            <span className="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[11px] text-muted-foreground">
                                Connected: Inventory, Orders, Finance, Payroll
                            </span>
                        </div>
                        <dl className="grid grid-cols-2 gap-px border-b border-border/60 bg-border/60 sm:grid-cols-4">
                            {financeCells.map((cell) => (
                                <div key={cell.label} className="bg-card px-4 py-3.5">
                                    <dt className="text-[11px] font-medium text-muted-foreground">
                                        {cell.label}
                                    </dt>
                                    <dd className="mt-1 font-display text-xl font-semibold tabular-nums tracking-tight text-foreground">
                                        {cell.value}
                                    </dd>
                                    <p className="mt-0.5 text-[10px] text-muted-foreground">
                                        {cell.note}
                                    </p>
                                </div>
                            ))}
                        </dl>
                        <div className="overflow-x-auto">
                            <table className="w-full text-left">
                                <thead>
                                    <tr className="border-b border-border/60 text-[10px] uppercase tracking-wider text-muted-foreground">
                                        <th className="px-4 py-2 font-medium">Order</th>
                                        <th className="px-4 py-2 font-medium">Items</th>
                                        <th className="px-4 py-2 text-right font-medium">Value</th>
                                        <th className="px-4 py-2 text-right font-medium">Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {orders.map((order) => (
                                        <tr
                                            key={order.id}
                                            className="border-b border-border/40 last:border-0"
                                        >
                                            <td className="px-4 py-2.5 font-mono text-[11px] tabular-nums text-foreground">
                                                {order.id}
                                            </td>
                                            <td className="px-4 py-2.5 text-xs text-muted-foreground">
                                                {order.items}
                                            </td>
                                            <td className="px-4 py-2.5 text-right font-mono text-[11px] tabular-nums text-foreground">
                                                {order.value}
                                            </td>
                                            <td className="px-4 py-2.5 text-right">
                                                <span
                                                    className={cn(
                                                        "inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-medium",
                                                        orderStatusTone[order.status],
                                                    )}
                                                >
                                                    {order.status}
                                                </span>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </RevealSection>
            </div>
        </section>
    );
}

export { Operations };
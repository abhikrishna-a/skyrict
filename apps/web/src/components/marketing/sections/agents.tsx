import { ArrowRight, Boxes, HandCoins, TrendingUp, type LucideIcon } from "lucide-react";
import Link from "next/link";

import { AiGlyph } from "@/components/brand/logo";
import { RevealSection } from "@/components/marketing/reveal-section";
import { Button } from "@/components/ui/button";

const reasoningRows: {
    icon: LucideIcon;
    text: string;
    detail: string;
}[] = [
    { icon: TrendingUp, text: "Demand climbed a third week", detail: "+18% w/w" },
    { icon: Boxes, text: "Cover 2 days, reorder point 5", detail: "Low stock" },
    { icon: HandCoins, text: "Restock PO of $9.4K fits cash", detail: "Approved" },
];

function Agents() {
    return (
        <section id="agents" className="scroll-mt-20 border-t border-border/40">
            <div className="mx-auto w-full max-w-6xl px-6 py-20 sm:py-28">
                <RevealSection>
                    <div className="grid items-center gap-12 lg:grid-cols-[1fr_1.15fr] lg:gap-16">
                        <div>
                            <h2 className="font-display text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
                                Agents that explain themselves.
                            </h2>
                            <p className="mt-4 text-base leading-relaxed text-muted-foreground">
                                Every recommendation carries the evidence: what moved in the
                                market, what it means for your live data, and why this action
                                holds.
                            </p>
                            <div className="mt-6">
                                <Button variant="ghost" asChild>
                                    <Link href="/docs/agents/guardian">
                                        The Guardian agent
                                        <ArrowRight aria-hidden="true" className="size-4" />
                                    </Link>
                                </Button>
                            </div>
                        </div>
                        <div className="overflow-hidden rounded-xl border border-border bg-card">
                            <div className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
                                <div className="flex items-center gap-2">
                                    <span className="flex size-6 items-center justify-center rounded-md border border-primary/25 bg-primary/10 text-primary">
                                        <AiGlyph aria-hidden="true" className="size-3.5" />
                                    </span>
                                    <p className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                                        Guardian, recommendation
                                    </p>
                                </div>
                                <span className="rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                                    High confidence
                                </span>
                            </div>
                            <div className="space-y-4 p-4">
                                <div className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3">
                                    <p className="font-display text-sm font-semibold text-foreground">
                                        Restock size M, 600 units
                                    </p>
                                    <p className="mt-0.5 text-xs text-muted-foreground">
                                        Vendor lead 5 days, delivery next Friday
                                    </p>
                                </div>
                                <div>
                                    <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                                        Why this holds
                                    </p>
                                    <ul className="mt-2 divide-y divide-border/60 border-y border-border/60">
                                        {reasoningRows.map(({ icon: Icon, text, detail }) => (
                                            <li
                                                key={text}
                                                className="flex items-center gap-3 py-2.5"
                                            >
                                                <Icon
                                                    aria-hidden="true"
                                                    className="size-3.5 shrink-0 text-primary"
                                                />
                                                <span className="min-w-0 flex-1 truncate text-xs text-foreground">
                                                    {text}
                                                </span>
                                                <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
                                                    {detail}
                                                </span>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                                <div className="flex items-center justify-between">
                                    <span className="rounded-md bg-primary px-2.5 py-1 text-[11px] font-semibold text-primary-foreground">
                                        Approve
                                    </span>
                                    <span className="text-[11px] font-medium text-primary">
                                        View full reasoning
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>
                </RevealSection>
            </div>
        </section>
    );
}

export { Agents };
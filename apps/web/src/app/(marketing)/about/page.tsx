import {
    Boxes,
    Globe,
    MessageSquareText,
    ShieldCheck,
    Unplug,
    type LucideIcon,
} from "lucide-react";
import type { Metadata } from "next";

import { RevealSection } from "@/components/marketing/reveal-section";
import { Cta } from "@/components/marketing/sections/cta";

export const metadata: Metadata = {
    title: "About",
    description:
        "Why Skyrict exists: operational truth inside your business and market context outside it, connected into decisions you can verify and act on.",
    alternates: {
        canonical: "/about",
    },
};

const philosophy: {
    icon: LucideIcon;
    title: string;
    body: string;
}[] = [
    {
        icon: Boxes,
        title: "Deliberately scoped",
        body: "Skyrict reads the operations that drive the rest instead of pretending to be a 400-module ERP. A live slice beats a stale copy.",
    },
    {
        icon: Unplug,
        title: "Connected by design",
        body: "Operations and market data live in one system, not bolted-on tabs. The connection is the product.",
    },
    {
        icon: MessageSquareText,
        title: "Agents explain themselves",
        body: "Every recommended action carries the reasoning. You should be able to check the logic before you approve it.",
    },
    {
        icon: ShieldCheck,
        title: "Open and boringly secure",
        body: "The source is public and the security defaults are standard, tested, and applied consistently.",
    },
];

export default function AboutPage() {
    return (
        <>
            <section className="mx-auto w-full max-w-6xl px-6 pb-20 pt-16 sm:pt-24">
                <RevealSection>
                    <div className="mx-auto max-w-3xl space-y-6 text-center">
                        <p className="font-mono text-xs uppercase tracking-[0.2em] text-primary">
                            About Skyrict
                        </p>
                        <h1 className="font-display text-4xl font-semibold leading-tight tracking-tight text-foreground sm:text-5xl">
                            Ground every decision in both your business and the
                            market.
                        </h1>
                        <p className="text-base leading-relaxed text-muted-foreground sm:text-lg">
                            Skyrict exists because companies make operational
                            calls on half the picture. The part inside their
                            own walls and the part moving in the market almost
                            never meet in the same room.
                        </p>
                    </div>
                </RevealSection>
            </section>

            <section className="border-y border-border/60 bg-card/60">
                <div className="mx-auto w-full max-w-6xl px-6 py-16 sm:py-24">
                    <RevealSection>
                        <div className="mx-auto max-w-2xl text-center">
                            <p className="font-mono text-xs uppercase tracking-[0.2em] text-primary">
                                The problem
                            </p>
                            <h2 className="mt-4 font-display text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
                                Two truths, rarely in the same room.
                            </h2>
                        </div>
                    </RevealSection>
                    <div className="mt-12 grid gap-6 md:grid-cols-2">
                        <RevealSection>
                            <div className="h-full rounded-2xl border border-border bg-card p-7">
                                <span className="flex size-10 items-center justify-center rounded-lg border border-primary/25 bg-primary/10 text-primary">
                                    <Boxes aria-hidden="true" className="size-5" />
                                </span>
                                <h3 className="mt-5 font-display text-xl font-semibold text-foreground">
                                    Inside the business
                                </h3>
                                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                                    Inventory, orders, sales, cash, payroll, HR,
                                    and CRM hold your operational truth. It
                                    changes daily, lives in separate systems,
                                    and too often reaches decisions as stale
                                    exports.
                                </p>
                            </div>
                        </RevealSection>
                        <RevealSection delay={120}>
                            <div className="h-full rounded-2xl border border-border bg-card p-7">
                                <span className="flex size-10 items-center justify-center rounded-lg border border-primary/25 bg-primary/10 text-primary">
                                    <Globe aria-hidden="true" className="size-5" />
                                </span>
                                <h3 className="mt-5 font-display text-xl font-semibold text-foreground">
                                    Outside, in the market
                                </h3>
                                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                                    Demand trends, news, community signals, and
                                    competitor moves shift demand weeks before
                                    you feel it. That context rarely makes it
                                    into the same document as your stock levels.
                                </p>
                            </div>
                        </RevealSection>
                    </div>
                    <RevealSection delay={160}>
                        <p className="mx-auto mt-12 max-w-2xl text-center text-base leading-relaxed text-foreground">
                            When the two stay apart, decisions arrive late or
                            lean on guesses. Skyrict puts them next to each
                            other, on purpose.
                        </p>
                    </RevealSection>
                </div>
            </section>

            <section className="mx-auto w-full max-w-6xl px-6 py-16 sm:py-24">
                <RevealSection>
                    <div className="mx-auto max-w-2xl text-center">
                        <p className="font-mono text-xs uppercase tracking-[0.2em] text-primary">
                            Product philosophy
                        </p>
                        <h2 className="mt-4 font-display text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
                            Principles written into the product.
                        </h2>
                    </div>
                </RevealSection>
                <div className="mt-12 grid gap-6 sm:grid-cols-2">
                    {philosophy.map(({ icon: Icon, title, body }, index) => (
                        <RevealSection key={title} delay={index * 100}>
                            <div className="h-full rounded-2xl border border-border bg-card p-7">
                                <div className="flex items-center gap-3">
                                    <span className="flex size-9 items-center justify-center rounded-lg border border-primary/25 bg-primary/10 text-primary">
                                        <Icon aria-hidden="true" className="size-4.5" />
                                    </span>
                                    <h3 className="font-display text-lg font-semibold text-foreground">
                                        {title}
                                    </h3>
                                </div>
                                <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                                    {body}
                                </p>
                            </div>
                        </RevealSection>
                    ))}
                </div>
            </section>

            <section className="border-t border-border/60 bg-card/60">
                <div className="mx-auto w-full max-w-6xl px-6 py-16 sm:py-24">
                    <RevealSection>
                        <div className="mx-auto max-w-3xl text-center">
                            <p className="font-mono text-xs uppercase tracking-[0.2em] text-primary">
                                The mission
                            </p>
                            <h2 className="mt-4 font-display text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
                                More grounded, timely, and explainable decisions.
                            </h2>
                            <p className="mt-6 text-base leading-relaxed text-muted-foreground sm:text-lg">
                                Grounded, because the evidence comes from your
                                live operations and the actual market. Timely,
                                because the signal surfaces the week it moves.
                                Explainable, because every call carries the
                                reasoning that supports it.
                            </p>
                        </div>
                    </RevealSection>
                </div>
            </section>

            <Cta
                eyebrow="See it for yourself"
                title="Put your operations next to the market."
                description="Create an account and Skyrict will start reading your business and the signals around it."
            />
        </>
    );
}
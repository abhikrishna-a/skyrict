"use client";

import Link from "next/link";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";

const SUPPORT_URL = "https://github.com/nkswalih/skyrict/issues";

function Feedback() {
    const [state, setState] = useState<"idle" | "yes" | "no">("idle");

    return (
        <section
            aria-label="Was this guide helpful?"
            className="mt-12 rounded-xl border border-border bg-card px-5 py-5"
        >
            {state === "idle" ? (
                <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
                    <p className="text-sm font-medium text-foreground">
                        Was this helpful?
                    </p>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={() => setState("yes")}
                            className={cn(
                                "inline-flex h-7 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-xs font-medium text-muted-foreground outline-none transition-colors",
                                "hover:border-primary/40 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
                            )}
                        >
                            <ThumbsUp aria-hidden="true" className="size-3.5" />
                            Yes
                        </button>
                        <button
                            type="button"
                            onClick={() => setState("no")}
                            className={cn(
                                "inline-flex h-7 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-xs font-medium text-muted-foreground outline-none transition-colors",
                                "hover:border-primary/40 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
                            )}
                        >
                            <ThumbsDown aria-hidden="true" className="size-3.5" />
                            No
                        </button>
                        <Link
                            href={SUPPORT_URL}
                            target="_blank"
                            rel="noreferrer"
                            className="ml-1 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                        >
                            Contact support
                        </Link>
                    </div>
                </div>
            ) : (
                <p aria-live="polite" className="text-sm text-muted-foreground">
                    Thanks for the feedback. Something unclear?{" "}
                    <Link
                        href={SUPPORT_URL}
                        target="_blank"
                        rel="noreferrer"
                        className="font-medium text-foreground underline-offset-4 hover:underline"
                    >
                        Contact support
                    </Link>
                    .
                </p>
            )}
        </section>
    );
}

export { Feedback };
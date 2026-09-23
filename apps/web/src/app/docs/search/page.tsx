import type { Metadata } from "next";
import { Suspense } from "react";

import { DocsSearch } from "@/components/docs/search";

export const metadata: Metadata = {
    title: "Search",
    robots: {
        index: false,
        follow: true,
    },
};

function SearchSkeleton() {
    return (
        <div className="mt-6 h-10 w-full animate-pulse rounded-lg border border-border bg-card" />
    );
}

export default function DocsSearchPage() {
    return (
        <div className="mx-auto w-full max-w-3xl px-6 py-10 lg:py-12">
            <h1 className="font-display text-xl font-semibold tracking-tight text-foreground">
                Search documentation
            </h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
                Search across every guide, including full article text.
            </p>
            <Suspense fallback={<SearchSkeleton />}>
                <DocsSearch />
            </Suspense>
        </div>
    );
}
"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";
import { useMemo, useState } from "react";

import {
    pathFor,
    popularArticles,
    searchDocs,
    type DocsSearchHit,
} from "@/content/docs";
import { cn } from "@/lib/utils";

function ResultList({ hits }: { hits: DocsSearchHit[] }) {
    if (hits.length === 0) return null;
    return (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
            {hits.map((hit) => (
                <li key={hit.href}>
                    <Link
                        href={hit.href}
                        className={cn(
                            "group block px-4 py-3.5 outline-none transition-colors",
                            "hover:bg-muted/50 focus-visible:bg-muted/50",
                        )}
                    >
                        <span className="block font-mono text-[11px] uppercase tracking-[0.14em] text-primary/80">
                            {hit.category}
                        </span>
                        <span className="mt-1 block text-sm font-medium text-foreground">
                            {hit.title}
                        </span>
                        <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                            {hit.description}
                        </span>
                        {hit.snippet ? (
                            <span className="mt-1.5 block text-xs leading-relaxed text-foreground/60">
                                {hit.snippet}
                            </span>
                        ) : null}
                    </Link>
                </li>
            ))}
        </ul>
    );
}

function DocsSearch() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [query, setQuery] = useState(searchParams.get("q") ?? "");

    const results = useMemo(() => searchDocs(query), [query]);

    function updateQuery(next: string) {
        setQuery(next);
        const params = new URLSearchParams(searchParams.toString());
        if (next.trim()) {
            params.set("q", next);
        } else {
            params.delete("q");
        }
        const qs = params.toString();
        router.replace(qs ? `/docs/search?${qs}` : "/docs/search", {
            scroll: false,
        });
    }

    const trimmed = query.trim();
    const idle = trimmed.length === 0;

    return (
        <div className="mt-6">
            <div className="relative">
                <Search
                    aria-hidden="true"
                    className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                />
                <label htmlFor="docs-search-input" className="sr-only">
                    Search documentation
                </label>
                <input
                    id="docs-search-input"
                    type="search"
                    autoFocus
                    value={query}
                    onChange={(event) => updateQuery(event.target.value)}
                    onKeyDown={(event) => {
                        if (event.key === "Escape") {
                            event.currentTarget.blur();
                            updateQuery("");
                        }
                    }}
                    placeholder="Search guides and articles"
                    className="h-10 w-full rounded-lg border border-border bg-card pl-9 pr-9 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                />
                {query ? (
                    <button
                        type="button"
                        aria-label="Clear search"
                        onClick={() => updateQuery("")}
                        className="absolute right-2 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                    >
                        <X aria-hidden="true" className="size-3.5" />
                    </button>
                ) : null}
            </div>

            <p
                aria-live="polite"
                className="mt-3 text-xs text-muted-foreground"
            >
                {idle
                    ? "Type to search titles, descriptions, and article text."
                    : `${results.length} guide${results.length === 1 ? "" : "s"} match${results.length === 1 ? "es" : ""}.`}
            </p>

            {idle ? (
                <div className="mt-8">
                    <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                        Popular
                    </p>
                    <ul className="mt-3 divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
                        {popularArticles.map((article) => (
                            <li key={`${article.categoryId}/${article.slug}`}>
                                <Link
                                    href={pathFor(
                                        article.categoryId,
                                        article.slug,
                                    )}
                                    className="block px-4 py-3 text-sm font-medium text-foreground transition-colors outline-none hover:bg-muted/50 focus-visible:bg-muted/50"
                                >
                                    {article.title}
                                </Link>
                            </li>
                        ))}
                    </ul>
                </div>
            ) : results.length === 0 ? (
                <div className="mt-8 rounded-xl border border-border bg-card px-5 py-8 text-center">
                    <p className="text-sm font-medium text-foreground">
                        No guides match &quot;{trimmed}&quot;
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                        Try a broader term, like inventory, sales, or security.
                    </p>
                    <button
                        type="button"
                        onClick={() => updateQuery("")}
                        className="mt-3 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors outline-none hover:border-primary/40 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                        Clear search
                    </button>
                </div>
            ) : (
                <div className="mt-4">
                    <ResultList hits={results} />
                </div>
            )}
        </div>
    );
}

export { DocsSearch };
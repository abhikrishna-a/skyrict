"use client";

import { Check, Link2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function CopyPageLink({
    href,
    className,
}: {
    href: string;
    className?: string;
}) {
    const [copied, setCopied] = useState(false);
    const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(
        () => () => {
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
        },
        [],
    );

    async function copy() {
        const url = `${window.location.origin}${href}`;
        try {
            await navigator.clipboard.writeText(url);
            setCopied(true);
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
            timeoutRef.current = setTimeout(() => setCopied(false), 2000);
        } catch {
            // Clipboard unavailable. Leave the control quiet instead of
            // interrupting the read with an error.
        }
    }

    return (
        <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={copy}
            aria-live="polite"
            className={cn("shrink-0", className)}
        >
            {copied ? (
                <Check
                    aria-hidden="true"
                    className="size-3.5 text-emerald-600"
                />
            ) : (
                <Link2 aria-hidden="true" className="size-3.5" />
            )}
            {copied ? "Copied" : "Copy link"}
        </Button>
    );
}

export { CopyPageLink };
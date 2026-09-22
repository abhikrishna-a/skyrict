"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
    hasPermission,
    useModuleAccess,
    type ModuleKey,
} from "@/lib/access/modules";
import {
    deniedFallback,
    resolveRoutePermission,
} from "@/lib/access/route-permissions";

/** Minimal loading indicator while permissions resolve or a redirect runs. */
export function ModuleLoading() {
    return (
        <div className="flex min-h-dvh items-center justify-center bg-background">
            <Spinner className="size-5 text-muted-foreground" />
        </div>
    );
}

export function ModuleAccessError() {
    return (
        <div className="flex min-h-dvh items-center justify-center bg-background px-6">
            <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
                <div className="mx-auto flex size-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                    <ShieldAlert aria-hidden="true" className="size-5" />
                </div>
                <h1 className="mt-5 font-display text-xl font-semibold tracking-tight text-foreground">
                    Access check unavailable
                </h1>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    Your permissions could not be loaded for this space. Check
                    your connection and try again.
                </p>
                <div className="mt-6">
                    <Button asChild variant="outline">
                        <Link href="/">Back to overview</Link>
                    </Button>
                </div>
            </div>
        </div>
    );
}

/**
 * Wraps a module world with the access check. Renders the loading state while
 * permissions resolve, then either the module's chrome or a silent redirect.
 *
 * Two gates apply:
 * - Module gate: the user must be able to enter the world (`access[module]`).
 * - Permission gate: when `permission` is passed, that exact key is required;
 *   otherwise the required key is resolved from the current pathname via
 *   `resolveRoutePermission` and the module gate is the only check when the
 *   route lists no key.
 *
 * Denial is handled with a silent client-side redirect to the module home
 * (or the workspace overview when the whole module is denied). A denied surface
 * never renders and never shows a denial notice, so its existence is not
 * revealed to the user. The error card is reserved for a failed access check,
 * which discloses nothing about the surface.
 */
export function ModuleAccessBoundary({
    module,
    permission,
    children,
}: {
    module: ModuleKey;
    permission?: string;
    children: React.ReactNode;
}) {
    const { status, access, permissions } = useModuleAccess();
    const pathname = usePathname();
    const router = useRouter();

    const ready = status === "ready";
    const required = permission ?? resolveRoutePermission(pathname);
    const moduleDenied = ready && !access[module];
    const permissionDenied =
        ready && !!required && !hasPermission(permissions, required);
    const denied = moduleDenied || permissionDenied;
    const fallback = deniedFallback(module, ready && !moduleDenied);

    useEffect(() => {
        if (denied) void router.replace(fallback);
    }, [denied, fallback, router]);

    if (status === "loading") return <ModuleLoading />;
    if (status === "error") return <ModuleAccessError />;
    if (denied) return <ModuleLoading />;
    return <>{children}</>;
}
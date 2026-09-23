"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useModuleAccess, type ModuleKey } from "@/lib/access/modules";
import {
    resolveAccessDecision,
    type PermissionRequirement,
} from "@/lib/access/route-permissions";

/**
 * No loading UI - intentionally renders nothing.
 *
 * The gate's only job is to stop a denied surface from mounting (and firing
 * its protected API call). While permissions resolve the content slot stays
 * empty; the page's OWN existing loading state - the route's skeleton or
 * spinner - is the sole loading UI, and it appears the moment access is
 * granted. A fallback here would paint a second, generic loading layer on top
 * of the route's own (and two loading UIs back to back on every hard reload).
 */
export function ModuleLoading() {
    return null;
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
 * Wraps a protected surface with the access check. Renders the loading state
 * while permissions resolve, then either the content or a silent redirect.
 *
 * Two gates apply, both resolved by the ONE decision helper:
 * - Module gate (when `module` is passed): the user must be able to enter the
 *   world (`access[module]`). Workspace routes pass no module.
 * - Permission gate: when `permission` is passed that exact key is required;
 *   otherwise the required key is resolved from the current pathname via
 *   `resolveRoutePermission`, and only the module gate applies when the route
 *   lists no key.
 *
 * Authentication is checked before permissions: the boundary renders nothing
 * (a neutral spinner) until the effective permission set is resolved, so a page
 * never mounts, fetches its data and then surfaces a backend 403.
 *
 * Denial is handled with a silent client-side redirect to the first route the
 * user can actually open (the module home, the leave portal, or the workspace
 * overview). A denied surface never renders and never shows a denial notice, so
 * its existence is not revealed to the user. The error card is reserved for a
 * failed access check, which discloses nothing about the surface.
 */
export function ModuleAccessBoundary({
    module,
    permission,
    children,
}: {
    /** World gate. Omit for workspace/portal routes (route gate only). */
    module?: ModuleKey;
    /**
     * Explicit permission requirement (single key, all-of array, or
     * `{ anyOf }`). Omit to resolve it from the current pathname via
     * `resolveRoutePermission` instead.
     */
    permission?: PermissionRequirement;
    children: React.ReactNode;
}) {
    const { status, access, permissions } = useModuleAccess();
    const pathname = usePathname();
    const router = useRouter();

    const decision = resolveAccessDecision({
        status,
        access,
        permissions,
        module,
        required: permission,
        pathname,
    });
    const redirect = decision.state === "denied" ? decision.redirect : null;

    useEffect(() => {
        if (redirect) void router.replace(redirect);
    }, [redirect, router]);

    if (decision.state === "loading") return <ModuleLoading />;
    if (decision.state === "error") return <ModuleAccessError />;
    if (decision.state === "denied") {
        // Denied surfaces never render their own content shape: show the
        // neutral workspace skeleton while the silent redirect runs, so the
        // map-out reveals nothing about the surface being denied.
        return <ModuleLoading />;
    }
    return <>{children}</>;
}

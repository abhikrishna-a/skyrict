"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { useModuleAccess } from "@/lib/access/modules";
import {
    resolveAccessDecision,
    type PermissionRequirement,
} from "@/lib/access/route-permissions";
import { ListPageSkeleton } from "@/components/ui/page-skeletons";

/**
 * Fail-closed route guard for a page that owns a single explicit permission.
 * While permissions load it renders a neutral skeleton (never page content); if
 * the user lacks the required permission - or access cannot be verified - the
 * protected content never mounts and the user is redirected to the first route
 * they can actually open, so a restricted page is never revealed and its data
 * is never fetched (no backend 403 as the page's primary UI).
 *
 * The decision comes from the shared access layer
 * (`resolveAccessDecision`/`firstAccessibleRoute`), the same mechanism behind
 * `ModuleAccessBoundary`; this component only differs in accepting an explicit
 * key instead of resolving one from the route map.
 */
export function RequirePermission({
    permission,
    children,
}: {
    /**
     * Permission requirement (single key, all-of key set mirroring the
     * backend's `require_all_permissions`, or `{ anyOf }` for at least one of
     * a set) required to render the children. Used by the AI proxy pages whose
     * data needs `erp.ai.invoke` AND a module read key.
     */
    permission: PermissionRequirement;
    children: React.ReactNode;
}) {
    const { status, access, permissions } = useModuleAccess();
    const router = useRouter();

    const decision = resolveAccessDecision({
        status,
        access,
        permissions,
        required: permission,
    });
    // A failed access check keeps the previous fail-closed behaviour: never
    // render protected content, and bounce to the workspace overview.
    const redirect =
        decision.state === "denied"
            ? decision.redirect
            : decision.state === "error"
              ? "/"
              : null;

    useEffect(() => {
        if (redirect) router.replace(redirect);
    }, [redirect, router]);

    if (status === "loading") return <ListPageSkeleton />;
    if (redirect) return null;
    return <>{children}</>;
}

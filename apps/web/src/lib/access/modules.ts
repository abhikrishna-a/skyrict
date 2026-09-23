"use client";

import { useEffect, useState } from "react";

import { getMyRoles } from "@/lib/api/identity-api";
import { getTenantSlug } from "@/lib/auth/session-store";

export type ModuleKey = "erp" | "agents" | "intelligence";

export interface ModuleAccess {
    erp: boolean;
    agents: boolean;
    intelligence: boolean;
}

export type AccessStatus = "loading" | "ready" | "error";

export interface ModuleAccessState {
    status: AccessStatus;
    access: ModuleAccess;
    roles: string[];
    permissions: string[];
}

const WILDCARD = "*";
const AGENTS_READ = "agents:read";
const INTELLIGENCE_READ = "intelligence:read";

/**
 * `erp.*` namespaces that gate a surface OUTSIDE the ERP operations world.
 *
 * The ERP world gate is namespace-based ("holds any `erp.*` key"), which is
 * exactly why the employee self-service portal has to be excluded:
 * `erp.leave.self` is its own world (`/leave`) and deliberately carries zero
 * dashboard keys (identity `core/constants.py`). Counting it as an ERP key
 * would open the whole operations app - nav, dashboard, approvals - to a
 * leave-only user and answer every load with a 403 instead of their portal.
 */
const NON_WORLD_ERP_PREFIXES = ["erp.leave."];

/**
 * True when the key belongs to the ERP operations world. The single definition
 * of "erp.*" membership, shared by the world gate and the route map.
 */
export function isErpWorldPermission(permission: string): boolean {
    return (
        permission.startsWith("erp.") &&
        !NON_WORLD_ERP_PREFIXES.some((prefix) => permission.startsWith(prefix))
    );
}

export const MODULE_ORDER: ModuleKey[] = ["agents", "erp", "intelligence"];

const NO_ACCESS: ModuleAccess = {
    erp: false,
    agents: false,
    intelligence: false,
};

/**
 * Derive module access from a user's effective permission set. The wildcard
 * grants every module; otherwise each module requires its own key/prefix.
 */
export function resolveModuleAccess(permissions: string[]): ModuleAccess {
    const set = new Set(permissions);
    const all = set.has(WILDCARD);
    return {
        erp: all || permissions.some(isErpWorldPermission),
        agents: all || set.has(AGENTS_READ),
        intelligence: all || set.has(INTELLIGENCE_READ),
    };
}

export function accessibleModules(access: ModuleAccess): ModuleKey[] {
    return MODULE_ORDER.filter((key) => access[key]);
}

/** True when the user holds the exact permission or the `*` wildcard. */
export function hasPermission(permissions: string[], key: string): boolean {
    return permissions.includes(WILDCARD) || permissions.includes(key);
}

const INITIAL_STATE: ModuleAccessState = {
    status: "loading",
    access: NO_ACCESS,
    roles: [],
    permissions: [],
};

/**
 * How long a resolved permission set is trusted before it is re-validated.
 *
 * The cache exists because `/roles/me` is read by the shell gate, the route
 * guard, and every permission-aware card on a page - without it a single
 * navigation issued one identical request per consumer. A short TTL keeps a
 * role change (or revocation) picked up within a few minutes while a full page
 * load always starts clean.
 */
const ACCESS_CACHE_TTL_MS = 5 * 60 * 1000;

let inFlight: Promise<ModuleAccessState> | null = null;
let cachedState: ModuleAccessState | null = null;
let cachedAt = 0;
/**
 * The tenant slug the cached set was resolved for. Effective permissions are
 * tenant-scoped (identity resolves roles per tenant), so an answer fetched in
 * workspace A must never answer for workspace B.
 */
let cachedTenant: string | null = null;

/**
 * Single-flight, short-lived-cached resolver so the shell, route guard, and
 * every permission-aware card share ONE `/roles/me` request instead of issuing
 * one each. Concurrent callers coalesce onto the in-flight promise; callers
 * after it settles are answered from the cache until the TTL lapses.
 *
 * Failures are deliberately NOT cached: a transient network blip must not lock
 * the user out of a module (or bounce them off a page) for the whole TTL - the
 * next mount retries.
 */
function fetchAccessState(): Promise<ModuleAccessState> {
    if (inFlight) return inFlight;
    // Capture the tenant this request is FOR before it leaves: a workspace
    // switch mid-flight must not stamp the previous tenant's answer as current.
    const tenant = getTenantSlug();
    inFlight = getMyRoles()
        .then((data) => {
            const next: ModuleAccessState = {
                status: "ready",
                access: resolveModuleAccess(data.permissions),
                roles: data.roles,
                permissions: data.permissions,
            };
            cachedState = next;
            cachedAt = Date.now();
            cachedTenant = tenant;
            return next;
        })
        .catch(() => {
            return {
                status: "error",
                access: NO_ACCESS,
                roles: [],
                permissions: [],
            } satisfies ModuleAccessState;
        })
        .finally(() => {
            inFlight = null;
        });
    return inFlight;
}

/**
 * The cached permission set, regardless of age. Used to seed the first render
 * of a hook so a navigation never falls back to the loading state while a
 * revalidation is in flight.
 *
 * Returns null while server-rendering on purpose. A Next server process serves
 * every tenant, so a process-wide cache could seed one tenant's permissions
 * into another tenant's HTML. The cache is only ever *populated* by the
 * client-side callers (the hook's effect), but the guard makes that invariant
 * structural instead of accidental.
 */
/**
 * The cached set, but only while it still belongs to the current tenant.
 *
 * Effective permissions are tenant-scoped (identity resolves roles per tenant),
 * so an answer fetched in workspace A must never answer for workspace B: a
 * workspace switch inside one client session drops the previous set instead of
 * rendering tenant A's navigation in tenant B.
 */
function currentCache(): { state: ModuleAccessState; at: number } | null {
    if (!cachedState) return null;
    if (cachedTenant !== getTenantSlug()) {
        clearModuleAccess();
        return null;
    }
    return { state: cachedState, at: cachedAt };
}

function peekAccessState(): ModuleAccessState | null {
    if (typeof window === "undefined") return null;
    return currentCache()?.state ?? null;
}

/**
 * Resolve module access, revalidating at most once per TTL.
 *
 * A stale-but-present cache is returned to the caller immediately and the
 * refresh is kicked off in the background (stale-while-revalidate): the
 * previous answer keeps the chrome stable instead of flashing a skeleton.
 */
export async function getModuleAccess(): Promise<ModuleAccessState> {
    const cached = currentCache();
    if (cached && Date.now() - cached.at < ACCESS_CACHE_TTL_MS) {
        return cached.state;
    }
    if (cached) {
        // Stale-while-revalidate: hand back the previous answer and refresh in
        // the background so the caller never falls back to a loading state.
        void fetchAccessState();
        return cached.state;
    }
    return fetchAccessState();
}

/**
 * Force a revalidation, bypassing the TTL, and resolve with the fresh state.
 *
 * Use after an event that can change the effective permissions (a role edit,
 * a workspace switch) when the caller needs the new answer rather than the
 * cached one. Concurrent callers coalesce onto the same request.
 */
export async function refreshModuleAccess(): Promise<ModuleAccessState> {
    return fetchAccessState();
}

/**
 * Drop the cached permission set. Call on sign-out (or any event that can
 * change the effective roles) so the next read reflects the new identity
 * instead of serving the previous user's access.
 */
export function clearModuleAccess(): void {
    cachedState = null;
    cachedAt = 0;
    cachedTenant = null;
}

/**
 * How stale a resolved answer may be before regaining focus revalidates it.
 *
 * Dynamic RBAC: permissions can change without the role NAME changing (a role
 * edit, a new grant, a workspace move), and there is no push channel. A short
 * window keeps a change from being stuck for the whole 5-minute TTL while still
 * coalescing ordinary tab switching onto the existing answer.
 */
const ACCESS_FOCUS_REVALIDATE_MS = 60 * 1000;

/**
 * Revalidate only when the cached answer has aged past `maxAgeMs`.
 *
 * Used by the focus/visibility revalidation path, where a perfectly fresh
 * answer must not cost a request. Concurrent callers coalesce onto the same
 * in-flight request.
 */
export async function revalidateModuleAccessIfStale(
    maxAgeMs: number = ACCESS_FOCUS_REVALIDATE_MS,
): Promise<ModuleAccessState> {
    const cached = currentCache();
    if (cached && Date.now() - cached.at < maxAgeMs) return cached.state;
    return fetchAccessState();
}

/**
 * Subscribe to module access. The first render is seeded from the cache, and
 * the effect only reaches the network when the cache is stale or empty - so
 * repeat navigations inside a session resolve synchronously.
 */
export function useModuleAccess(): ModuleAccessState {
    const [state, setState] = useState<ModuleAccessState>(
        peekAccessState() ?? INITIAL_STATE,
    );

    useEffect(() => {
        let cancelled = false;
        void getModuleAccess().then((next) => {
            if (!cancelled) setState(next);
        });
        return () => {
            cancelled = true;
        };
    }, []);

    // Dynamic RBAC: re-resolve when the tab regains focus and the answer has
    // aged past the revalidate window, so nav + route guards pick up a role
    // edit / grant / revocation instead of serving a stale set for the whole
    // session.
    //
    // A FAILED refresh never replaces a working answer: a transient blip must
    // not strip a user's navigation or bounce them off a page they may
    // legitimately use. The initial load is still fail-closed (it has no
    // previous answer to keep).
    useEffect(() => {
        let cancelled = false;
        function revalidate() {
            if (document.visibilityState === "hidden") return;
            void revalidateModuleAccessIfStale().then((next) => {
                if (!cancelled && next.status === "ready") setState(next);
            });
        }
        window.addEventListener("focus", revalidate);
        document.addEventListener("visibilitychange", revalidate);
        return () => {
            cancelled = true;
            window.removeEventListener("focus", revalidate);
            document.removeEventListener("visibilitychange", revalidate);
        };
    }, []);

    return state;
}

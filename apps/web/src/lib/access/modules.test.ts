/**
 * Tests for the module-access resolver and its request cache.
 *
 * The cache is what keeps a page from issuing one identical `/roles/me`
 * request per permission-aware consumer (shell gate + route guard + every
 * card). These tests pin the contract:
 *  - concurrent callers coalesce onto a single request;
 *  - a resolved answer is reused inside the TTL;
 *  - a stale answer is served immediately and revalidated in the background;
 *  - a FAILURE is never cached (a blip must not lock the user out);
 *  - `clearModuleAccess()` (sign-out) forces the next read back to the network;
 *  - an answer resolved for another TENANT is never served (dynamic RBAC is
 *    tenant-scoped), and the focus-revalidation window is respected.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
    accessibleModules,
    clearModuleAccess,
    getModuleAccess,
    hasPermission,
    isErpWorldPermission,
    refreshModuleAccess,
    resolveModuleAccess,
    revalidateModuleAccessIfStale,
} from "@/lib/access/modules";

const getMyRoles = vi.fn();

vi.mock("@/lib/api/identity-api", () => ({
    getMyRoles: () => getMyRoles(),
}));

/** Mutable tenant slug so a workspace switch can be simulated. */
const tenant = { slug: "default" };

vi.mock("@/lib/auth/session-store", () => ({
    getTenantSlug: () => tenant.slug,
    getAccessToken: () => null,
    setAccessToken: () => {},
}));

const ADMIN = { roles: ["owner"], permissions: ["*"] };
const VIEWER = { roles: ["viewer"], permissions: ["erp.crm.read"] };

/* ---------- permission derivation (pure) ---------- */

describe("resolveModuleAccess", () => {
    it("grants every module to the wildcard", () => {
        expect(resolveModuleAccess(["*"])).toEqual({
            erp: true,
            agents: true,
            intelligence: true,
        });
    });

    it("grants erp on any erp.* permission", () => {
        const access = resolveModuleAccess(["erp.crm.read"]);
        expect(access.erp).toBe(true);
        expect(access.agents).toBe(false);
        expect(access.intelligence).toBe(false);
    });

    it("requires the module-specific key for agents and intelligence", () => {
        expect(resolveModuleAccess(["agents:read"]).agents).toBe(true);
        expect(resolveModuleAccess(["intelligence:read"]).intelligence).toBe(
            true,
        );
        // `erp.`-prefixed keys never leak into the other modules.
        expect(resolveModuleAccess(["erp.agents.read"]).agents).toBe(false);
    });

    it("denies everything to a permission-less user", () => {
        expect(resolveModuleAccess([])).toEqual({
            erp: false,
            agents: false,
            intelligence: false,
        });
    });

    it("never opens the ERP world for the self-service leave key", () => {
        // `erp.leave.self` is its own world (/leave): counting it as an ERP key
        // handed a leave-only user the whole operations app - nav, dashboard,
        // approvals - where every load then answered 403 instead of their
        // portal.
        expect(resolveModuleAccess(["erp.leave.self"])).toEqual({
            erp: false,
            agents: false,
            intelligence: false,
        });
        expect(isErpWorldPermission("erp.leave.self")).toBe(false);
        expect(isErpWorldPermission("erp.leave.request")).toBe(false);
        // Every other erp.* key still opens the world.
        expect(isErpWorldPermission("erp.hr.read")).toBe(true);
        expect(resolveModuleAccess(["erp.leave.self", "erp.hr.read"]).erp).toBe(
            true,
        );
    });
});

describe("accessibleModules", () => {
    it("returns the accessible modules in display order", () => {
        expect(accessibleModules(resolveModuleAccess(["*"]))).toEqual([
            "agents",
            "erp",
            "intelligence",
        ]);
        expect(accessibleModules(resolveModuleAccess(["erp.hr.read"]))).toEqual(
            ["erp"],
        );
    });
});

describe("hasPermission", () => {
    it("accepts the exact key or the wildcard", () => {
        expect(hasPermission(["erp.crm.read"], "erp.crm.read")).toBe(true);
        expect(hasPermission(["*"], "erp.crm.read")).toBe(true);
    });

    it("rejects an unrelated key", () => {
        expect(hasPermission(["erp.crm.read"], "erp.crm.write")).toBe(false);
    });

    it("keeps every capability distinct - no capability is inferred", () => {
        const crmRead = ["erp.crm.read"];
        expect(hasPermission(crmRead, "erp.crm.create")).toBe(false);
        expect(hasPermission(crmRead, "erp.crm.update")).toBe(false);
        expect(hasPermission(crmRead, "erp.crm.delete")).toBe(false);
        expect(hasPermission(["invitations:send"], "erp.crm.read")).toBe(false);
    });
});

/* ---------- request cache ---------- */

describe("module access cache", () => {
    beforeEach(() => {
        getMyRoles.mockReset();
        clearModuleAccess();
        tenant.slug = "default";
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
        clearModuleAccess();
        tenant.slug = "default";
    });

    it("coalesces concurrent callers into one request", async () => {
        getMyRoles.mockResolvedValue(ADMIN);

        const [first, second, third] = await Promise.all([
            getModuleAccess(),
            getModuleAccess(),
            getModuleAccess(),
        ]);

        expect(getMyRoles).toHaveBeenCalledTimes(1);
        expect(second).toBe(first);
        expect(third).toBe(first);
        expect(first.permissions).toEqual(["*"]);
    });

    it("reuses the resolved answer inside the TTL", async () => {
        getMyRoles.mockResolvedValue(ADMIN);

        await getModuleAccess();
        await getModuleAccess();
        vi.advanceTimersByTime(60 * 1000);
        await getModuleAccess();

        expect(getMyRoles).toHaveBeenCalledTimes(1);
    });

    it("serves the stale answer immediately and revalidates in the background", async () => {
        getMyRoles.mockResolvedValue(ADMIN);
        await getModuleAccess();
        expect(getMyRoles).toHaveBeenCalledTimes(1);

        // Past the TTL the cached answer is still handed to the caller (the
        // chrome must not fall back to a skeleton) while a refresh runs.
        vi.advanceTimersByTime(6 * 60 * 1000);
        getMyRoles.mockResolvedValue(VIEWER);

        const stale = await getModuleAccess();
        expect(stale.permissions).toEqual(["*"]);

        // The background refresh already coalesced the next request.
        const fresh = await refreshModuleAccess();
        expect(fresh.permissions).toEqual(["erp.crm.read"]);
        expect(getMyRoles).toHaveBeenCalledTimes(2);
    });

    it("never caches a failure so the next mount can retry", async () => {
        getMyRoles.mockRejectedValueOnce(new Error("offline"));

        const failed = await getModuleAccess();
        expect(failed.status).toBe("error");
        expect(failed.permissions).toEqual([]);

        // Immediately retried - not locked out of the module for the TTL.
        getMyRoles.mockResolvedValue(ADMIN);
        const retried = await getModuleAccess();
        expect(retried.status).toBe("ready");
        expect(getMyRoles).toHaveBeenCalledTimes(2);
    });

    it("revalidates on demand via refreshModuleAccess", async () => {
        getMyRoles.mockResolvedValue(ADMIN);
        await getModuleAccess();
        expect(getMyRoles).toHaveBeenCalledTimes(1);

        getMyRoles.mockResolvedValue(VIEWER);
        const refreshed = await refreshModuleAccess();

        expect(refreshed.permissions).toEqual(["erp.crm.read"]);
        expect(getMyRoles).toHaveBeenCalledTimes(2);
        // The refreshed answer is now the cached one.
        expect((await getModuleAccess()).permissions).toEqual(["erp.crm.read"]);
        expect(getMyRoles).toHaveBeenCalledTimes(2);
    });

    it("drops the cache on clearModuleAccess (sign-out)", async () => {
        getMyRoles.mockResolvedValue(ADMIN);
        await getModuleAccess();
        await getModuleAccess();
        expect(getMyRoles).toHaveBeenCalledTimes(1);

        clearModuleAccess();
        getMyRoles.mockResolvedValue(VIEWER);
        const next = await getModuleAccess();

        expect(getMyRoles).toHaveBeenCalledTimes(2);
        expect(next.permissions).toEqual(["erp.crm.read"]);
    });

    it("never serves an answer resolved for another tenant", async () => {
        tenant.slug = "acme";
        getMyRoles.mockResolvedValue({
            roles: ["finance_viewer"],
            permissions: ["erp.finance.read"],
        });
        const first = await getModuleAccess();
        expect(first.permissions).toEqual(["erp.finance.read"]);

        // Same client session, different workspace: tenant A's permissions must
        // not render tenant B's nav or pass its guards.
        tenant.slug = "olympus";
        getMyRoles.mockResolvedValue({
            roles: ["invite_viewer"],
            permissions: ["invitations:send"],
        });
        const second = await getModuleAccess();

        expect(second.permissions).toEqual(["invitations:send"]);
        expect(second.access.erp).toBe(false);
        expect(getMyRoles).toHaveBeenCalledTimes(2);
    });

    it("revalidates on focus only once the answer has aged", async () => {
        getMyRoles.mockResolvedValue(ADMIN);
        await getModuleAccess();
        expect(getMyRoles).toHaveBeenCalledTimes(1);

        // Fresh: a focus event must not cost a request.
        getMyRoles.mockResolvedValue(VIEWER);
        const fresh = await revalidateModuleAccessIfStale(60_000);
        expect(fresh.permissions).toEqual(["*"]);
        expect(getMyRoles).toHaveBeenCalledTimes(1);

        // Aged past the window: the role change is picked up.
        vi.advanceTimersByTime(90_000);
        const aged = await revalidateModuleAccessIfStale(60_000);
        expect(aged.permissions).toEqual(["erp.crm.read"]);
        expect(getMyRoles).toHaveBeenCalledTimes(2);
    });

    it("refetches when a workspace switch leaves no usable answer", async () => {
        tenant.slug = "acme";
        getMyRoles.mockResolvedValue(VIEWER);
        await getModuleAccess();

        tenant.slug = "olympus";
        const switched = await revalidateModuleAccessIfStale(60 * 60 * 1000);
        expect(getMyRoles).toHaveBeenCalledTimes(2);
        expect(switched.status).toBe("ready");
    });
});

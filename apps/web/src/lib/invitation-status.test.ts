import { describe, expect, it } from "vitest";

import type { InvitationSummary } from "@/lib/api/identity-api";
import { invitationState } from "@/lib/invitation-status";

function makeInvitation(
    overrides: Partial<InvitationSummary> = {},
): InvitationSummary {
    return {
        id: "inv-1",
        email: "teammate@example.com",
        roleName: "standard_user",
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        usedAt: null,
        usedByUserId: null,
        createdAt: new Date(Date.now() - 86_400_000).toISOString(),
        ...overrides,
    };
}

describe("invitationState", () => {
    it("reports used only when an account was created through the link", () => {
        expect(
            invitationState(
                makeInvitation({
                    usedAt: new Date().toISOString(),
                    usedByUserId: "user-1",
                }),
            ),
        ).toBe("used");
    });

    it("reports an admin-expired invite as expired, not joined", () => {
        // The reported bug: `expire` sets used_at with no user, so the row
        // previously lit up the green "Joined" badge.
        expect(
            invitationState(
                makeInvitation({ usedAt: new Date().toISOString() }),
            ),
        ).toBe("expired");
    });

    it("reports a time-expired invite as expired", () => {
        expect(
            invitationState(
                makeInvitation({
                    expiresAt: new Date(Date.now() - 60_000).toISOString(),
                }),
            ),
        ).toBe("expired");
    });

    it("reports a live invite as pending", () => {
        expect(invitationState(makeInvitation())).toBe("pending");
    });

    it("still reports a joined invite as joined once the token lapsed", () => {
        expect(
            invitationState(
                makeInvitation({
                    expiresAt: new Date(Date.now() - 60_000).toISOString(),
                    usedAt: new Date(Date.now() - 3600_000).toISOString(),
                    usedByUserId: "user-1",
                }),
            ),
        ).toBe("used");
    });
});
/**
 * Invitation list-status helpers.
 *
 * The backend records two very different things through `used_at`:
 * - a real acceptance (account created via the invite link) also sets
 *   `used_by_user_id`;
 * - an admin "expire" reuses `mark_used(..., None)`, so `used_at` is set
 *   with `used_by_user_id` null.
 *
 * The list must not read an expired invite as "Joined" - only an acceptance
 * (user id present) is `used`; everything else past its state is `expired`.
 */
import type { InvitationSummary } from "@/lib/api/identity-api";

export type InvitationStatus = "used" | "expired" | "pending";

export function invitationState(item: InvitationSummary): InvitationStatus {
    if (item.usedAt && item.usedByUserId) return "used";
    if (
        item.usedAt ||
        (item.expiresAt && new Date(item.expiresAt).getTime() < Date.now())
    ) {
        return "expired";
    }
    return "pending";
}
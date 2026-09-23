/*
 * RBAC journey (SKY-104 auth platform journeys).
 *
 * Proves the seeded finance_viewer account can reach surfaces its
 * permissions allow (finance journal entries) and is silently redirected
 * away from surfaces it lacks (payroll, documents) - with zero denied
 * surface content in the DOM and no denial card rendered.
 *
 * The finance_viewer user has no MFA on first login so the spec drives the
 * real mandatory-MFA enrollment before navigating to the module surfaces; a
 * retry that already enrolled completes the TOTP challenge instead (a
 * finance-specific secret is persisted for that path). Every context is
 * worker-scoped (see fixtures/auth.ts header).
 */

import { writeFileSync } from "node:fs";

import { expect, test } from "@playwright/test";

import {
    completeMfaChallenge,
    enrollMfaAndFinish,
    installMfaSecretCapture,
    readEnrolledSecret,
    signInWithPassword,
    waitForWorkspaceSettled,
    whichMfaPath,
} from "../helpers/auth-flow";
import { signinUrl, workspaceUrl } from "../support/urls";

test.setTimeout(120_000);

const SLUG = process.env.E2E_TENANT_SLUG ?? "default";
const FINANCE_EMAIL = process.env.E2E_FINANCE_EMAIL ?? "finance@skyrict.io";
const FINANCE_PASSWORD = process.env.E2E_FINANCE_PASSWORD ?? "Finance123!";
// The finance viewer has its own TOTP secret, distinct from the admin's
// (helpers/auth-flow.ts TOTP_SECRET_FILE). Persist it so a retry that finds the
// user already enrolled can still complete the TOTP challenge.
const FINANCE_SECRET_FILE = "e2e/.auth/totp-secret-finance";

test("finance viewer can reach finance surfaces but is denied payroll access", async ({
    page,
}) => {
    // Sign in as the seeded finance_viewer. A fresh account takes the MFA
    // enrollment path; a retry that already enrolled hits the TOTP challenge.
    await page.goto(`${signinUrl(SLUG)}/signin`);

    const getMfaSecret = installMfaSecretCapture(page);
    await signInWithPassword(page, FINANCE_EMAIL, FINANCE_PASSWORD);

    const mfaPath = await whichMfaPath(page);
    if (mfaPath === "challenge") {
        const enrolledSecret = readEnrolledSecret(FINANCE_SECRET_FILE);
        expect(
            enrolledSecret,
            "E2E_TOTP_SECRET must be set when the finance viewer already has MFA enrolled.",
        ).toBeTruthy();
        await completeMfaChallenge(page, enrolledSecret);
    } else {
        await enrollMfaAndFinish(page, {
            secretGetter: getMfaSecret,
            onWritten: (secret) =>
                writeFileSync(FINANCE_SECRET_FILE, secret, "utf8"),
        });
    }
    await waitForWorkspaceSettled(page, FINANCE_EMAIL);

    /* ── positive: finance journal entries ─────────────────────────── */
    await page.goto(
        `${workspaceUrl(SLUG)}/dashboard/erp/finance/journal-entries`,
    );

    // The real finance surface renders its heading — not a denial notice.
    // Exact match: the breadcrumb h1 is "Business Operations · Finance ·
    // Journal Entries" and must not trip strict mode alongside the page h1.
    await expect(
        page.getByRole("heading", {
            name: "Journal Entries",
            exact: true,
        }),
    ).toBeVisible({ timeout: 15_000 });

    /* ── negative: payroll is silently redirected, never denied ─────── */
    await page.goto(`${workspaceUrl(SLUG)}/dashboard/erp/payroll`);

    // Denial is a silent client-side redirect to the ERP module home: no
    // denial card is ever rendered, the payroll surface never mounts, and its
    // existence is not revealed to the user (module-access-boundary.tsx).
    await expect(page).toHaveURL(`${workspaceUrl(SLUG)}/erp`, {
        timeout: 15_000,
    });

    // The redirect lands on a real surface, not a loading screen.
    await expect(
        page.getByRole("heading", {
            name: "Business Operations",
            exact: true,
        }),
    ).toBeVisible({ timeout: 15_000 });

    // No "No access" denial card, and no payroll values, employee names, or
    // salary numbers leak into the DOM.
    await expect(
        page.getByRole("heading", { name: "No access to Payroll" }),
    ).toHaveCount(0);

    const pageText = (await page.locator("body").textContent()) ?? "";
    const lowerText = pageText.toLowerCase();

    expect(lowerText).not.toContain("salary");
    expect(lowerText).not.toContain("gross pay");
    expect(lowerText).not.toContain("net pay");
    expect(lowerText).not.toContain("payslip");

    /* ── negative: documents are silently redirected too ─────────────── */
    await page.goto(`${workspaceUrl(SLUG)}/dashboard/erp/documents`);

    // The finance viewer has no erp.documents.read (the seed grants only the
    // standard-user read set plus erp.reports.read), so the documents surface
    // resolves through route-permissions and bounces back to the ERP home.
    await expect(page).toHaveURL(`${workspaceUrl(SLUG)}/erp`, {
        timeout: 15_000,
    });

    await expect(
        page.getByRole("heading", {
            name: "Business Operations",
            exact: true,
        }),
    ).toBeVisible({ timeout: 15_000 });

    const afterDocuments = (await page.locator("body").textContent()) ?? "";
    expect(afterDocuments.toLowerCase()).not.toContain("all documents");

    /* ── positive: reports stay reachable for the finance viewer ──────── */
    // finance_viewer holds erp.reports.read (the seed grants the standard
    // read set plus erp.reports.read), so the reports page gate must not
    // over-block: the Reports heading renders instead of a denial or a
    // permission error.
    await page.goto(`${workspaceUrl(SLUG)}/dashboard/erp/reports`);

    await expect(
        page.getByRole("heading", { name: "Reports", exact: true }),
    ).toBeVisible({ timeout: 15_000 });
});

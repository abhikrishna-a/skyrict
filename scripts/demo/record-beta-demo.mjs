#!/usr/bin/env node
/*
 * Beta demo walkthrough recorder (REL-GATE-001).
 *
 * Records a video of the four beta surfaces - auth, ERP, AI, analytics -
 * against the local seeded stack (this is the documented stand-in for the
 * Azure beta, which currently deploys APIs only: apps.bicep has no web app).
 * The same codebase/migrations the Azure beta runs, served by the same nginx
 * stack the E2E suite drives.
 *
 * Usage (from repo root, after `pnpm --filter @skyrict/web install`):
 *   node scripts/demo/record-beta-demo.mjs
 *
 * Output: scripts/demo/out/beta-demo.webm + per-surface screenshots.
 * Configure via env: E2E_BASE_URL, E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD.
 */

import { createRequire } from "node:module";
import { readFileSync, mkdirSync, existsSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const require = createRequire(import.meta.url);

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, "..", "..");
const OUT = join(__dirname, "out");
mkdirSync(OUT, { recursive: true });

// Node cannot resolve *.localhost on Windows; reuse the e2e helper.
require("../../apps/web/e2e/localhost-dns.cjs");

// `@playwright/test` is a direct dep under apps/web's node_modules and
// re-exports the full `playwright` API (chromium et al.), so we don't have to
// reach into pnpm's .pnpm store for the transitive `playwright` package.
const PLAYWRIGHT = require(require.resolve("@playwright/test", {
  paths: [join(REPO, "apps", "web", "node_modules")],
}));
const { chromium } = PLAYWRIGHT;

const BASE_URL = process.env.E2E_BASE_URL ?? "http://default.localhost:3000";
const apex = new URL(BASE_URL).hostname.split(".").slice(1).join(".");
const SIGNIN_URL = `http://default.signin.${apex}:${new URL(BASE_URL).port || "3000"}/signin`;
const WORKSPACE = BASE_URL;

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@skyrict.io";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "Admin123!";
const DEBUG = process.env.DEMO_DEBUG === "1";

// ---------------------------------------------------------------------------
// Minimal TOTP (RFC 6238, SHA-1, 30s window, 6 digits) - no dependency.
// ---------------------------------------------------------------------------
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function base32decode(s) {
  s = s.toUpperCase().replace(/[^A-Z2-7]/g, "");
  const bits = [];
  for (const c of s) {
    const v = B32.indexOf(c);
    for (let i = 4; i >= 0; i--) bits.push((v >> i) & 1);
  }
  const bytes = [];
  for (let i = 0; i + 7 < bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
    bytes.push(b);
  }
  return Buffer.from(bytes);
}
function totp(secret, offset = 0) {
  const counter = BigInt(Math.floor(Date.now() / 1000) + offset * 30) / 30n;
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(counter);
  const h = crypto.createHmac("sha1", base32decode(secret)).update(buf).digest();
  const o = h[h.length - 1] & 0x0f;
  const code = ((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).toString();
  return code.padStart(6, "0");
}

const TOTP_SECRET_FILE = join(REPO, "apps", "web", "e2e", ".auth", "totp-secret");
const persistedSecret = existsSync(TOTP_SECRET_FILE)
  ? readFileSync(TOTP_SECRET_FILE, "utf8").trim()
  : "";

// ---------------------------------------------------------------------------
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  recordVideo: { dir: OUT, size: { width: 1440, height: 900 } },
});
const page = await context.newPage();

if (DEBUG) {
  page.on("console", (m) => {
    if (["error", "warning"].includes(m.type())) console.log(`[console.${m.type()}] ${m.text().slice(0, 300)}`);
  });
  page.on("framenavigated", (f) => {
    if (f === page.mainFrame()) console.log(`[nav] ${f.url()}`);
  });
  page.on("response", (r) => {
    if (r.url().includes("/api/auth/")) console.log(`[api] ${r.status()} ${r.url().replace("http://", "")}`);
  });
  page.on("request", (r) => {
    if (r.method() !== "GET" && r.url().includes("/api/")) console.log(`[req] ${r.method()} ${r.url().replace("http://", "")}`);
  });
  page.on("pageerror", (e) => console.log(`[pageerror] ${String(e).slice(0, 300)}`));
}

let mfaSecret = persistedSecret || null;
page.on("response", async (response) => {
  if (!response.url().includes("/api/auth/mfa/setup")) return;
  const body = await response.json().catch(() => ({}));
  if (typeof body.secret === "string") mfaSecret = body.secret;
});

async function fillOtp(label, code) {
  const digits = page.locator(`input[aria-label^="${label} digit "]`);
  await digits.first().waitFor({ timeout: 30_000 });
  const count = code.length;
  await digits.nth(count - 1).waitFor({ timeout: 30_000 });
  for (let i = 0; i < count; i++) {
    await page.locator(`input[aria-label="${label} digit ${i + 1}"]`).fill(code[i]);
  }
}

async function settleWorkspace() {
  await page.getByRole("link", { name: "Skyrict dashboard", exact: true }).waitFor({ timeout: 30_000 });
  await page.getByText(ADMIN_EMAIL, { exact: true }).first().waitFor({ timeout: 30_000 });
}

console.log(`Signing in as ${ADMIN_EMAIL} -> ${SIGNIN_URL}`);
await page.goto(SIGNIN_URL, { waitUntil: "domcontentloaded" });
await page.getByLabel("Email").fill(ADMIN_EMAIL);
await page.getByLabel("Password").fill(ADMIN_PASSWORD);
await page.getByRole("button", { name: "Sign in" }).click();

// MFA: converge on whichever surface the flow actually lands on. Transient
// pushes to /setup-mfa, re-renders, and cold compiles can satisfy a URL/heading
// wait early, so poll the two *settled* surfaces (heading + OTP inputs) until
// exactly one is present.
const protectHeading = page.getByRole("heading", { name: "Protect your account" });
const challengeHeading = page.getByRole("heading", { name: "Two-factor check" });
const challengeInput = page.locator('input[aria-label="Two-factor code digit 1"]');
const surfaceDeadline = Date.now() + 90_000;
let enrollSurface = null;
while (Date.now() < surfaceDeadline) {
  if (await protectHeading.isVisible().catch(() => false)) {
    enrollSurface = "enroll";
    break;
  }
  if (
    (await challengeHeading.isVisible().catch(() => false)) &&
    (await challengeInput.isVisible().catch(() => false))
  ) {
    enrollSurface = "challenge";
    break;
  }
  await page.waitForTimeout(1500);
}
if (!enrollSurface) {
  throw new Error(
    `Neither MFA surface settled within 90s; current URL: ${page.url()}`,
  );
}

if (enrollSurface === "enroll") {
  console.log("MFA enrollment path");
  if (DEBUG) {
    const headings = await page.locator("h1, h2").allTextContents();
    console.log(`[url] ${page.url()} [headings] ${JSON.stringify(headings)}`);
  }
  // wait for the setup API response to land (cold-compile on dev restart can
  // delay the first hit well past the interactive paint)
  for (let i = 0; i < 120 && !mfaSecret; i++) await page.waitForTimeout(500);
  if (!mfaSecret) throw new Error("No MFA secret captured from /api/auth/mfa/setup");
  // Verify across the current, previous, and next 30s TOTP windows to dodge
  // clock boundaries (same loop as the e2e auth-flow helper).
  let verified = false;
  for (const offset of [0, -1, 1]) {
    await fillOtp("Authenticator code", totp(mfaSecret, offset));
    await page.getByRole("button", { name: "Verify and continue" }).click();
    const success = page
      .getByText("Authenticator verified")
      .waitFor({ timeout: 6_000 })
      .then(() => true)
      .catch(() => false);
    const failure = page
      .getByText("That code doesn't match")
      .waitFor({ timeout: 6_000 })
      .then(() => false)
      .catch(() => false);
    if (await Promise.race([success, failure])) {
      verified = true;
      break;
    }
  }
  if (!verified) throw new Error("TOTP enrollment failed across all windows");
  await page
    .getByRole("button", { name: "I've saved my recovery codes somewhere safe." })
    .click();
  await page.getByRole("button", { name: "Finish setup" }).click();
  // Persist the freshly enrolled secret so a re-run takes the (valid)
  // challenge path instead of re-enrolling a second credential.
  writeFileSync(TOTP_SECRET_FILE, `${mfaSecret}\n`, "utf8");
  console.log("MFA enrolled; secret persisted to e2e/.auth/totp-secret");
} else {
  console.log("MFA challenge path");
  if (DEBUG) {
    console.log(`[url] ${page.url()}`);
    const formText = await page.locator("form").first().innerText().catch(() => "");
    console.log(`[form text] ${formText.slice(0, 400)}`);
    await page.screenshot({ path: join(OUT, "debug-challenge.png") });
  }
  if (!mfaSecret) {
    throw new Error(
      "Admin is already MFA-enrolled but no TOTP secret was found. Set E2E_TOTP_SECRET or run once with a fresh .auth/totp-secret.",
    );
  }
  for (const offset of [0, -1, 1]) {
    await fillOtp("Two-factor code", totp(mfaSecret, offset));
    const done = page
      .waitForURL((url) => !url.hostname.includes(".signin."), { timeout: 12_000 })
      .then(() => true)
      .catch(() => false);
    const rejected = page
      .getByText("That code didn't match")
      .waitFor({ timeout: 12_000 })
      .then(() => false)
      .catch(() => false);
    if (await Promise.race([done, rejected])) break;
  }
}
await settleWorkspace();
console.log("Workspace reached");

// The four beta surfaces: analytics, ERP, AI, analytics(report).
// Each stop: navigate, let the shell hydrate, hold for the camera.
const stops = [
  { name: "analytics-dashboard", url: "/dashboard", holdMs: 3500 },
  { name: "erp-payroll", url: "/dashboard/erp/payroll", holdMs: 3000 },
  { name: "erp-reports", url: "/dashboard/erp/reports", holdMs: 3000 },
  { name: "ai-agents-chat", url: "/dashboard/agents", holdMs: 3500 },
];

for (const stop of stops) {
  console.log(`Recording ${stop.name} -> ${stop.url}`);
  await page.goto(`${WORKSPACE}${stop.url}`, { waitUntil: "domcontentloaded" });
  // Tolerant settle: the sidebar logo exists on dashboard pages, but some
  // routes (AI chat) cold-compile slowly on the dev server - fall back to the
  // page's main content region rather than failing the whole recording.
  const logo = page.getByRole("link", { name: "Skyrict dashboard", exact: true });
  const main = page.locator("main");
  await Promise.race([
    logo.waitFor({ timeout: 60_000 }).then(() => true),
    main.waitFor({ timeout: 60_000 }).then(() => true),
  ]);
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(stop.holdMs);
  await page.screenshot({ path: join(OUT, `${stop.name}.png`), fullPage: false });
}

await page.waitForTimeout(1000);
await context.close();
// context.close() finalizes and renames the recording into OUT.
const webm = readdirSync(OUT).find((f) => f.endsWith(".webm"));
if (!webm) throw new Error("No .webm was produced");
const final = join(OUT, "beta-demo.webm");
renameSync(join(OUT, webm), final);
console.log(`Demo walk recorded -> ${final}`);
await browser.close();
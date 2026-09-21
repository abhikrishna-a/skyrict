// Lighthouse CI performance audit for the authenticated ERP surfaces
// (PERF-WEB-001, Commit 4).
//
// Boots a real logged-in session (the app's own signin + mandatory-MFA flow,
// mirroring e2e/auth.setup.ts) and runs Lighthouse 3x per URL with mobile
// emulation + simulated throttling. Asserts median LCP / CLS / TBT against the
// budgets below (CI-measured baselines with headroom, see BUDGET); PERF_RELAX=1
// downgrades a failure to a warning so the gate can be bypassed deliberately
// and visibly.
//
// Usage:
//   PERF_RELAX=1 node scripts/perf/lighthouse-audit.mjs
//   LIGHTHOUSE_URLS="http://default.localhost:3100/dashboard" node scripts/perf/lighthouse-audit.mjs
//   E2E_BASE_URL=http://default.localhost:3000 LIGHTHOUSE_RUNS=3 node scripts/perf/lighthouse-audit.mjs
//
// Env:
//   E2E_BASE_URL       workspace origin (default http://default.localhost:3000)
//   E2E_ADMIN_EMAIL    seeded admin email (default admin@skyrict.io)
//   E2E_ADMIN_PASSWORD seeded admin password (default Admin123!)
//   E2E_TOTP_SECRET    base32 TOTP secret for the challenge MFA arm
//   E2E_LOGIN_TIMEOUT_MS  budget for the whole login/MFA flow (default 60000)
//   LIGHTHOUSE_URLS    comma-separated URL overrides
//   LIGHTHOUSE_RUNS    audits per URL (default 3)
//   PERF_RELAX         1 = warn instead of fail on budget breach
//
// Login/MFA reliability: the flow mirrors e2e/helpers/auth-flow.ts (the
// hardened, suite-proven variant) - full OTP form wait, landed-vs-rejected
// race per TOTP window, budgeted re-attempts across windows, and this-run
// secret precedence so a stale E2E_TOTP_SECRET can never break the challenge
// arm. When a settle wait fails, a screenshot + HTML snapshot are written to
// results/debug/ for a self-explanatory CI artifact.

import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { createHmac } from "node:crypto";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";
import lighthouse, { generateReport } from "lighthouse";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = path.join(__dirname, "lighthouse-results");
// Debug artifacts (screenshots + HTML snapshots) land here on login/MFA
// failures so a clean-runner flake leaves an inspectable trace in the
// lighthouse-results CI artifact instead of a bare locator timeout.
const DEBUG_DIR = path.join(RESULTS_DIR, "debug");
const TOTP_SECRET_FILE = path.join(__dirname, "..", "e2e", ".auth", "totp-secret");

const BASE = process.env.E2E_BASE_URL ?? "http://default.localhost:3000";
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@skyrict.io";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "Admin123!";
const RUNS = Number(process.env.LIGHTHOUSE_RUNS ?? 3);
const RELAX = process.env.PERF_RELAX === "1";
const SESSION_COOKIE = "skyrict_session";
// Whole-login budget (TOTP challenge re-attempts + workspace settle). Login is
// harness setup, never measured by Lighthouse, so the budget is deliberately
// generous and overridable: 20s is too tight for a cold, loaded runner.
const LOGIN_TIMEOUT_MS = Number(process.env.E2E_LOGIN_TIMEOUT_MS) || 60_000;
// TOTP secret enrolled by THIS process (fresh stacks enroll on the first URL;
// later challenge arms must reuse it - see login()). Overrides any stale
// E2E_TOTP_SECRET env value from a previous run's enrollment.
let thisRunSecret = null;

const URLS = (
  process.env.LIGHTHOUSE_URLS ??
  [
    `${BASE}/dashboard`,
    `${BASE}/dashboard/erp/reports`,
    `${BASE}/dashboard/erp/payroll`,
    `${BASE}/dashboard/erp/inventory`,
  ].join(",")
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// Performance budgets are CI-measured BASELINES with headroom, not
// aspirational targets. On GitHub runner hardware under mobile-emulated
// throttling (4x CPU, 1.5 Mbps, 150 ms RTT) the current tree measures median
// LCP 4.9-5.3 s, TBT 350-470 ms, CLS 0.000-0.055. The baseline keeps the
// same strict-monotonic convention as the bundle gate: a regression beyond
// it fails the gate. The original aspirational targets (LCP <= 2.5 s,
// TBT < 200 ms) are the shared-first-load follow-up goal, documented in
// build-size-report.md.
const BUDGET = { lcpMs: 5600, cls: 0.1, tbtMs: 560 };

// ---------------------------------------------------------------------------
// RFC 6238 TOTP (SHA-1, 30s, 6 digits) — same algorithm as
// e2e/helpers/totp.ts; inlined so the audit script runs with plain `node`.
// ---------------------------------------------------------------------------
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Decode(secret) {
  const cleaned = secret.toUpperCase().replace(/[^A-Z2-7]/g, "");
  const bits = [];
  for (const ch of cleaned) {
    const val = BASE32.indexOf(ch);
    if (val < 0) continue;
    for (let shift = 4; shift >= 0; shift -= 1) {
      bits.push((val >>> shift) & 1);
    }
  }
  const bytes = [];
  for (let i = 0; i + 7 < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j += 1) byte = (byte << 1) | (bits[i + j] ?? 0);
    bytes.push(byte);
  }
  return Buffer.from(bytes);
}

function totp(secret, offset = 0) {
  const counter = Math.floor(Date.now() / 1000 / 30) + offset;
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac("sha1", base32Decode(secret)).update(buf).digest();
  const idx = mac[mac.length - 1] & 0x0f;
  const code =
    ((mac[idx] & 0x7f) << 24) |
    ((mac[idx + 1] & 0xff) << 16) |
    ((mac[idx + 2] & 0xff) << 8) |
    (mac[idx + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, "0");
}

// ---------------------------------------------------------------------------
// Signin + mandatory-MFA login (real UI flow, mirrors e2e/helpers/auth-flow.ts)
// ---------------------------------------------------------------------------
async function waitForOtpForm(page, label, count, timeoutMs = 10_000) {
  // Under parallel load the OTP form can mount AFTER the challenge heading
  // resolves; a blind sequential fill then waits on digit 1 while the rest of
  // the form is still rendering. Wait for the full digit form before filling
  // so every fill targets a settled, complete form (mirrors auth-flow.ts).
  const locator = page.locator(`input[aria-label^="${label} digit "]`);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await locator.count()) === count) return;
    await page.waitForTimeout(100);
  }
  throw new Error(
    `OTP form "${label}" did not mount ${count} digit inputs within ${timeoutMs}ms.`,
  );
}

async function fillOtp(page, label, code) {
  await waitForOtpForm(page, label, code.length);
  for (let i = 0; i < code.length; i += 1) {
    await page.locator(`input[aria-label="${label} digit ${i + 1}"]`).fill(code[i]);
  }
}

function whichMfaPath(page, timeoutMs = 15_000) {
  return new Promise((resolve, reject) => {
    // Fail loudly (with the URL) instead of hanging when neither arm resolves
    // - e.g. the handoff bounced back with ?error=... (mirrors auth-flow.ts).
    const timer = setTimeout(
      () =>
        reject(
          new Error(
            `MFA path not detected within ${timeoutMs}ms; current URL: ${page.url()}`,
          ),
        ),
      timeoutMs + 500,
    );
    page
      .waitForURL("**/setup-mfa", { timeout: timeoutMs })
      .then(() => {
        clearTimeout(timer);
        resolve("enrollment");
      })
      .catch(() => {});
    page
      .getByRole("heading", { name: "Two-factor check" })
      .waitFor({ timeout: timeoutMs })
      .then(() => {
        clearTimeout(timer);
        resolve("challenge");
      })
      .catch(() => {});
  });
}

/**
 * Complete the TOTP challenge on the login form and wait for the handoff to
 * the workspace host. The OTP form submits itself as soon as the last digit is
 * filled, so no click is needed (mirrors auth-flow.ts).
 *
 * Both the current/previous/next 30s windows AND time are budgeted: when all
 * three windows reject or time out, wait out the current TOTP window and retry
 * until LOGIN_TIMEOUT_MS is spent. A single pass is exactly what used to make
 * the job flaky - a code consumed earlier in the same window (or one failing
 * on a cold runner's clock) rejected inline and the flow fell through to a
 * 20s settle wait that could not render the workspace.
 *
 * Returns true once the signin host is left, false when the budget is spent.
 */
async function completeMfaChallenge(page, secret) {
  const deadline = Date.now() + LOGIN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    for (const offset of [0, -1, 1]) {
      await fillOtp(page, "Two-factor code", totp(secret, offset));
      const landed = page
        .waitForURL((url) => !url.hostname.includes(".signin."), { timeout: 10_000 })
        .then(() => true)
        .catch(() => false);
      const rejected = page
        .getByText("That code didn't match")
        .waitFor({ timeout: 10_000 })
        .then(() => false)
        .catch(() => false);
      // Race resolves true when the handoff leaves the signin host, false when
      // the inline rejection beats it. A false winner means "try the next
      // window"; a true winner means the challenge was accepted.
      if (await Promise.race([landed, rejected])) return true;
      if (Date.now() >= deadline) return false;
    }
    // All three windows rejected or timed out: the codes only change every 30
    // seconds, so wait out the current window before retrying fresh codes.
    await page.waitForTimeout(1_000);
  }
  return false;
}

/**
 * Persist a screenshot + HTML snapshot so a clean-runner failure leaves an
 * inspectable trace in the lighthouse-results artifact. Returns the artifact
 * base name for embedding in the thrown error.
 */
async function captureDiagnostics(page, tag) {
  fs.mkdirSync(DEBUG_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const base = path.join(DEBUG_DIR, `${tag}-${stamp}`);
  await page.screenshot({ path: `${base}.png`, fullPage: true }).catch(() => {});
  const html = await page.content().catch(() => "");
  fs.writeFileSync(`${base}.html`, html);
  return `${tag}-${stamp}`;
}

async function waitForWorkspaceSettled(page) {
  try {
    await page.getByRole("link", { name: "Skyrict dashboard", exact: true })
      .waitFor({ timeout: LOGIN_TIMEOUT_MS });
  } catch (err) {
    const stamp = await captureDiagnostics(page, "workspace-link-timeout");
    throw new Error(
      `Workspace dashboard link did not render within ${LOGIN_TIMEOUT_MS}ms ` +
        `(debug artifacts: ${stamp}). URL: ${page.url()}`,
      { cause: err },
    );
  }
  try {
    // The sidebar user menu renders the signed-in email only after the BFF
    // session restore completes AND its Set-Cookie hit the jar - the real
    // "settled" signal (see auth-flow.ts). Resolution order matters and this
    // is the honest gate for the Lighthouse cookie harvest.
    await page.getByText(ADMIN_EMAIL, { exact: true }).first()
      .waitFor({ timeout: LOGIN_TIMEOUT_MS });
  } catch (err) {
    const stamp = await captureDiagnostics(page, "workspace-email-timeout");
    throw new Error(
      `Sidebar user menu did not render the signed-in email within ${LOGIN_TIMEOUT_MS}ms ` +
        `(debug artifacts: ${stamp}). URL: ${page.url()}`,
      { cause: err },
    );
  }
}

async function login(page) {
  let mfaSecret = null;
  page.on("response", async (response) => {
    if (!response.url().includes("/api/auth/mfa/setup")) return;
    const body = await response.json().catch(() => ({}));
    if (typeof body.secret === "string") mfaSecret = body.secret;
  });

  await page.goto(`${BASE}/signin`);
  await page.getByLabel("Email").fill(ADMIN_EMAIL);
  await page.getByLabel("Password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();

  const mfaPath = await whichMfaPath(page);
  if (mfaPath === "challenge") {
    // Secret precedence: the TOTP secret THIS process enrolled (fresh-stack
    // runs enroll on the first URL and must reuse that exact secret for every
    // later URL - the server stores it) > E2E_TOTP_SECRET env (persistent
    // stacks auditing an already-enrolled admin) > the persisted file. A stale
    // env secret used to win over a fresh this-run enrollment, so every URL
    // after the first rejected TOTP codes and the settle wait timed out.
    const fileSecret = (() => {
      try {
        return fs.readFileSync(TOTP_SECRET_FILE, "utf8").trim();
      } catch {
        return "";
      }
    })();
    const secret =
      thisRunSecret ?? ((process.env.E2E_TOTP_SECRET ?? "").trim() || fileSecret);
    if (!secret) {
      throw new Error(
        "MFA challenge requires a TOTP secret - found neither a this-run " +
          "enrollment, E2E_TOTP_SECRET, nor a persisted secret.",
      );
    }
    const accepted = await completeMfaChallenge(page, secret);
    if (!accepted) {
      const stamp = await captureDiagnostics(page, "mfa-challenge-timeout");
      throw new Error(
        `MFA challenge TOTP codes were not accepted within ${LOGIN_TIMEOUT_MS}ms ` +
          `(debug artifacts: ${stamp}). URL: ${page.url()}`,
      );
    }
    await waitForWorkspaceSettled(page);
    return;
  }

  // Enrollment: poll for the server-generated secret, verify a TOTP code
  // across window offsets to dodge clock boundaries, then finish setup.
  const deadline = Date.now() + 10_000;
  while (!mfaSecret && Date.now() < deadline) {
    await page.waitForTimeout(250);
  }
  if (!mfaSecret) throw new Error("MFA setup response did not include a TOTP secret.");

  fs.mkdirSync(path.dirname(TOTP_SECRET_FILE), { recursive: true });
  fs.writeFileSync(TOTP_SECRET_FILE, mfaSecret, "utf8");
  // This run's enrollment is authoritative for every later challenge arm in
  // the same process, regardless of any stale E2E_TOTP_SECRET env value.
  thisRunSecret = mfaSecret;

  let verified = false;
  for (const offset of [0, -1, 1]) {
    await fillOtp(page, "Authenticator code", totp(mfaSecret, offset));
    await page.getByRole("button", { name: "Verify and continue" }).click();
    const [success] = await Promise.all([
      page.getByText("Authenticator verified").waitFor({ timeout: 4_000 }).then(() => true).catch(() => false),
      page.getByText("That code doesn't match").waitFor({ timeout: 4_000 }).then(() => false).catch(() => false),
    ]);
    if (success) {
      verified = true;
      break;
    }
  }
  if (!verified) throw new Error("TOTP enrollment failed across all clock windows.");

  await page
    .getByRole("button", { name: "I've saved my recovery codes somewhere safe." })
    .click();
  await page.getByRole("button", { name: "Finish setup" }).click();
  await waitForWorkspaceSettled(page);
}

async function harvestCookieHeader() {
  const page = await browser.newPage({ locale: "en-US" });
  const start = Date.now();
  try {
    await login(page);
    const state = await browser.storageState();
    const cookies = state.cookies
      .filter((c) => c.name === SESSION_COOKIE)
      .map((c) => `${c.name}=${c.value}`);
    if (cookies.length === 0) {
      const names = state.cookies.map((c) => c.name).join(", ") || "(no cookies)";
      throw new Error(
        `Authenticated session cookie "${SESSION_COOKIE}" was not present after login. ` +
          `Cookies found: ${names}. Inspect ${DEBUG_DIR} artifacts if the login failed.`,
      );
    }
    console.log(`  session cookie harvested (${Date.now() - start}ms)`);
    return cookies.join("; ");
  } finally {
    await page.close();
  }
}

// ---------------------------------------------------------------------------
// Lighthouse
// ---------------------------------------------------------------------------
function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

async function runAudit(url) {
  const flags = {
    port: chromePort,
    logLevel: "error",
    onlyCategories: ["performance"],
    formFactor: "mobile",
    throttlingMethod: "simulate",
    screenEmulation: {
      mobile: true,
      width: 412,
      height: 823,
      deviceScaleFactor: 2.625,
      disabled: false,
    },
    throttling: {
      rttMs: 150,
      throughputKbps: 1638.4,
      cpuSlowdownMultiplier: 4,
      downloadThroughputKbps: 1638.4,
      uploadThroughputKbps: 675.84,
    },
    maxWaitForFcp: 30_000,
    maxWaitForLoad: 120_000,
  };
  const { lhr } = await lighthouse(url, flags, undefined);
  const numeric = (id) => lhr.audits[id]?.numericValue ?? null;
  return {
    lcp: numeric("largest-contentful-paint"),
    cls: numeric("cumulative-layout-shift"),
    tbt: numeric("total-blocking-time"),
    fcp: numeric("first-contentful-paint"),
    score: lhr.categories.performance?.score ?? null,
    lhr,
  };
}

const median = (arr) => arr.sort((a, b) => a - b)[Math.floor(arr.length / 2)];

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
fs.mkdirSync(RESULTS_DIR, { recursive: true });

// Chromium is launched as a PERSISTENT CONTEXT so the profile's default
// (non-incognito) browser context - which is where Lighthouse creates its
// targets when connecting over the debug port - shares the cookie jar with
// the Playwright login flow. Passing the session to Lighthouse via
// `extraHeaders` alone does NOT work: Lighthouse's `Network.setExtraHTTPHeaders`
// never reaches this app (the /dashboard layout sees no session cookie and
// redirects to sign-in), so the authenticated route is what must be measured.
// Each harvest() signs in fresh on the shared context and rotates the cookie.
let chromePort = await findFreePort();
const PROFILE_DIR = path.join(RESULTS_DIR, ".chrome-profile");
const browser = await chromium.launchPersistentContext(PROFILE_DIR, {
  chromiumSandbox: false,
  headless: true,
  locale: "en-US",
  args: [
    `--remote-debugging-port=${chromePort}`,
    "--remote-debugging-address=127.0.0.1",
    "--disable-dev-shm-usage",
  ],
});

const summary = { generatedAt: new Date().toISOString(), base: BASE, budget: BUDGET, urls: [] };
let failures = 0;

try {
  for (const url of URLS) {
    await harvestCookieHeader();
    const runs = [];
    for (let i = 0; i < RUNS; i += 1) {
      const run = await runAudit(url);
      runs.push(run);
      const slug = url.replace(/^https?:\/\//, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "");
      fs.writeFileSync(path.join(RESULTS_DIR, `${slug}-run${i + 1}.json`), JSON.stringify(run.lhr));
      fs.writeFileSync(
        path.join(RESULTS_DIR, `${slug}-run${i + 1}.html`),
        generateReport(run.lhr, "html"),
      );
      console.log(
        `  ${url} run ${i + 1}/${RUNS}: LCP ${run.lcp?.toFixed(0)}ms CLS ${run.cls?.toFixed(3)} TBT ${run.tbt?.toFixed(0)}ms`,
      );
    }

    const verdict = {
      url,
      median: {
        lcpMs: median(runs.map((r) => r.lcp)),
        cls: median(runs.map((r) => r.cls)),
        tbtMs: median(runs.map((r) => r.tbt)),
        fcpMs: median(runs.map((r) => r.fcp)),
        score: median(runs.map((r) => r.score)),
      },
      runs: runs.map((r) => ({ lcpMs: r.lcp, cls: r.cls, tbtMs: r.tbt, fcpMs: r.fcp })),
    };
    const miss = [];
    if (verdict.median.lcpMs > BUDGET.lcpMs) miss.push(`LCP ${verdict.median.lcpMs.toFixed(0)}ms > ${BUDGET.lcpMs}ms`);
    if (verdict.median.cls > BUDGET.cls) miss.push(`CLS ${verdict.median.cls.toFixed(3)} > ${BUDGET.cls}`);
    if (verdict.median.tbtMs >= BUDGET.tbtMs) miss.push(`TBT ${verdict.median.tbtMs.toFixed(0)}ms >= ${BUDGET.tbtMs}ms`);
    verdict.passed = miss.length === 0;
    verdict.misses = miss;
    if (!verdict.passed) failures += 1;
    summary.urls.push(verdict);
    console.log(`  ${url}: PASS ${verdict.passed}${miss.length ? " — " + miss.join(", ") : ""}`);
  }
} finally {
  await browser.close();
}

fs.writeFileSync(path.join(RESULTS_DIR, "summary.json"), JSON.stringify(summary, null, 2));

if (failures > 0) {
  const msg = `Lighthouse budget FAILED on ${failures}/${summary.urls.length} URL(s). See ${RESULTS_DIR}/summary.json`;
  if (RELAX) {
    console.warn(`[relaxed] ${msg}`);
  } else {
    console.error(msg);
    process.exit(1);
  }
} else {
  console.log(`Lighthouse budget OK (${summary.urls.length}/${summary.urls.length} URLs within budget).`);
}
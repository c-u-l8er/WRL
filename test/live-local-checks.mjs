#!/usr/bin/env node
/**
 * Focused automated checks for the live-local conformance pipeline.
 *
 * Tests:
 *   1. Certificate verifier accepts the retained certificate (green path)
 *   2. Tamper rejection: altered fixture bytes → verifier rejects
 *   3. Tamper rejection: altered result record → verifier rejects
 *   4. Tamper rejection: duplicate implementation → verifier rejects
 *   5. Tamper rejection: vacuous (empty results) → verifier rejects
 *   6. Missing-implementation failure: verifier rejects when a required impl is absent
 *   7. Separate-process requirement: verifier rejects when PID == orchestrator PID
 *   8. Copied-bundle portability: bundle copied to tmpdir verifies without repo files
 *   9. run-on-host --check exits 0 when implementations are available
 *
 * Exit 0 if all pass, 1 if any fail.
 */
import { execSync, execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const BUNDLE = join(ROOT, "forge-probe", "live-local-bundle");
const VERIFY = join(BUNDLE, "verify.mjs");
const CERT_PATH = join(BUNDLE, "certificates", "certificate.json");
const CONTRACT_PATH = join(BUNDLE, "contract.json");
const FIXTURE_PATH = join(BUNDLE, "fixture.json");

let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    fn();
    console.log("  ok   %s", name);
    passed++;
  } catch (e) {
    console.log("  FAIL %s -- %s", name, e.message);
    failed++;
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || "assertion failed");
}

/**
 * Run verify.mjs against a bundle directory, return { code, stdout, stderr }.
 */
function runVerifier(bundleDir) {
  try {
    const out = execFileSync(process.execPath, [VERIFY, bundleDir], {
      encoding: "utf8",
      timeout: 15000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { code: 0, stdout: out, stderr: "" };
  } catch (e) {
    return { code: e.status, stdout: e.stdout || "", stderr: e.stderr || "" };
  }
}

/**
 * Create a temporary bundle clone with a modified certificate.
 * Returns the tmpdir path. Caller should clean up.
 */
function cloneBundleWithCert(certOverride) {
  const tmp = mkdtempSync(join(tmpdir(), "wrl-live-local-check-"));
  cpSync(BUNDLE, tmp, { recursive: true });
  const certDir = join(tmp, "certificates");
  mkdirSync(certDir, { recursive: true });
  writeFileSync(join(certDir, "certificate.json"), JSON.stringify(certOverride, null, 2) + "\n");
  return tmp;
}

// Load the real certificate and contract for mutation tests
const certificate = JSON.parse(readFileSync(CERT_PATH, "utf8"));
const contract = JSON.parse(readFileSync(CONTRACT_PATH, "utf8"));

console.log("live-local conformance checks\n");

// ── 1. Green path: verifier accepts the retained certificate ──

check("verifier-accepts-retained-certificate", () => {
  const r = runVerifier(BUNDLE);
  assert(r.code === 0, `verifier exited ${r.code}:\n${r.stdout}\n${r.stderr}`);
  assert(r.stdout.includes("CERTIFICATE VALID"), "expected CERTIFICATE VALID in output");
});

// ── 2. Tamper: altered fixture bytes ──

check("tamper-reject-altered-fixture", () => {
  const tmp = mkdtempSync(join(tmpdir(), "wrl-tamper-fixture-"));
  cpSync(BUNDLE, tmp, { recursive: true });
  // Corrupt the fixture
  const fx = readFileSync(join(tmp, "fixture.json"), "utf8");
  writeFileSync(join(tmp, "fixture.json"), fx.replace(/"name"/, '"xame"'));
  // Run verifier against the tampered bundle (use the copy's own verify.mjs)
  const r = runVerifier(tmp);
  rmSync(tmp, { recursive: true, force: true });
  assert(r.code !== 0, "verifier should reject altered fixture");
  assert(r.stdout.includes("FAIL") || r.stderr.includes("FAIL"), "expected FAIL in output");
});

// ── 3. Tamper: altered result record ──

check("tamper-reject-altered-result", () => {
  const bad = JSON.parse(JSON.stringify(certificate));
  bad.results[0].computed_semantic_artifact_id = "sem-0000000000000000000000000000000000000000000000000000000000000000";
  const tmp = cloneBundleWithCert(bad);
  const r = runVerifier(tmp);
  rmSync(tmp, { recursive: true, force: true });
  assert(r.code !== 0, "verifier should reject altered result");
});

// ── 4. Tamper: duplicate implementation name ──

check("tamper-reject-duplicate-implementation", () => {
  const bad = JSON.parse(JSON.stringify(certificate));
  bad.results.push({ ...bad.results[0] });
  // Recompute results_digest to avoid triggering that check first
  // (We want the duplicate check to fire, not the digest check)
  // Actually, let the digest also mismatch — the verifier should catch duplicates
  const tmp = cloneBundleWithCert(bad);
  const r = runVerifier(tmp);
  rmSync(tmp, { recursive: true, force: true });
  assert(r.code !== 0, "verifier should reject duplicate implementations");
  assert(r.stdout.includes("duplicate"), "expected 'duplicate' in output");
});

// ── 5. Tamper: vacuous (empty results) ──

check("tamper-reject-vacuous-empty-results", () => {
  const bad = JSON.parse(JSON.stringify(certificate));
  bad.results = [];
  bad.results_digest_sha256 = "0000000000000000000000000000000000000000000000000000000000000000";
  const tmp = cloneBundleWithCert(bad);
  const r = runVerifier(tmp);
  rmSync(tmp, { recursive: true, force: true });
  assert(r.code !== 0, "verifier should reject empty results");
  assert(r.stdout.includes("vacuous") || r.stdout.includes("empty"), "expected vacuous/empty in output");
});

// ── 6. Missing required implementation ──

check("reject-missing-required-implementation", () => {
  const bad = JSON.parse(JSON.stringify(certificate));
  // Remove one of the two required implementations
  bad.results = bad.results.filter((r) => r.implementation_name !== "forge-python-spine");
  const tmp = cloneBundleWithCert(bad);
  const r = runVerifier(tmp);
  rmSync(tmp, { recursive: true, force: true });
  assert(r.code !== 0, "verifier should reject missing required implementation");
  assert(r.stdout.includes("forge-python-spine"), "expected missing impl name in output");
});

// ── 7. Separate-process requirement ──

check("reject-same-pid-as-orchestrator", () => {
  const bad = JSON.parse(JSON.stringify(certificate));
  // Set a result's PID to match the orchestrator PID
  bad.results[0].process_id = bad.orchestrator_pid;
  const tmp = cloneBundleWithCert(bad);
  const r = runVerifier(tmp);
  rmSync(tmp, { recursive: true, force: true });
  assert(r.code !== 0, "verifier should reject result with orchestrator PID");
  assert(r.stdout.includes("separate-process") || r.stdout.includes("orchestrator"),
    "expected separate-process/orchestrator in output");
});

// ── 8. Copied-bundle portability ──

check("copied-bundle-verifies-outside-repo", () => {
  const tmp = mkdtempSync(join(tmpdir(), "wrl-portable-"));
  const dest = join(tmp, "bundle");
  cpSync(BUNDLE, dest, { recursive: true });
  // Run verify.mjs from the copy, pointing at the copy — no repo access
  try {
    const out = execFileSync(process.execPath, [join(dest, "verify.mjs"), dest], {
      encoding: "utf8",
      timeout: 15000,
      cwd: tmp, // ensure cwd is outside the repo
      stdio: ["pipe", "pipe", "pipe"],
    });
    assert(out.includes("CERTIFICATE VALID"), "expected CERTIFICATE VALID in portable run");
  } catch (e) {
    throw new Error(`portable verify failed (code ${e.status}):\n${e.stdout}\n${e.stderr}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ── 9. run-on-host --check ──

check("run-on-host-check-exits-zero", () => {
  try {
    execFileSync(process.execPath, [join(BUNDLE, "run-on-host.mjs"), "--check"], {
      encoding: "utf8",
      timeout: 15000,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (e) {
    // If it exits nonzero, that means implementations aren't found — which is
    // acceptable on CI but not on the dev machine. Report it clearly.
    throw new Error(`run-on-host --check exited ${e.status}:\n${e.stdout}\n${e.stderr}`);
  }
});

// ── Summary ──

console.log("\n%d checks, %d passed, %d failed", passed + failed, passed, failed);
if (failed > 0) {
  console.error("\nFAILED");
  process.exit(1);
} else {
  console.log("\nALL PASSED");
}

#!/usr/bin/env node
/**
 * Minimal regression checks proving the conformance entry point and its
 * components exit nonzero on:
 *   1. Missing inputs (fixture or contract absent)
 *   2. Identifier disagreement (computed sem- id != expected)
 *   3. Certificate verification failure (tampered certificate)
 *
 * These are the three failure modes the packaged entry point must reject.
 * Exit 0 if all pass, 1 if any fail.
 */
import { execFileSync } from "node:child_process";
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync,
  cpSync, rmSync, unlinkSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const BUNDLE = join(ROOT, "forge-probe", "live-local-bundle");
const VERIFY = join(BUNDLE, "verify.mjs");
const RUN_ON_HOST = join(BUNDLE, "run-on-host.mjs");
const CERT_PATH = join(BUNDLE, "certificates", "certificate.json");
const CONTRACT_PATH = join(BUNDLE, "contract.json");

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

/** Run a node script, return { code, stdout, stderr }. */
function run(script, args, opts = {}) {
  try {
    const out = execFileSync(process.execPath, [script, ...args], {
      encoding: "utf8",
      timeout: 15000,
      stdio: ["pipe", "pipe", "pipe"],
      ...opts,
    });
    return { code: 0, stdout: out, stderr: "" };
  } catch (e) {
    return { code: e.status, stdout: e.stdout || "", stderr: e.stderr || "" };
  }
}

/** Clone the bundle to a tmpdir, return the path. Caller cleans up. */
function cloneBundle() {
  const tmp = mkdtempSync(join(tmpdir(), "wrl-regression-"));
  cpSync(BUNDLE, tmp, { recursive: true });
  return tmp;
}

/** Write a modified certificate into a cloned bundle. */
function cloneBundleWithCert(certOverride) {
  const tmp = cloneBundle();
  const certDir = join(tmp, "certificates");
  mkdirSync(certDir, { recursive: true });
  writeFileSync(
    join(certDir, "certificate.json"),
    JSON.stringify(certOverride, null, 2) + "\n"
  );
  return tmp;
}

const certificate = JSON.parse(readFileSync(CERT_PATH, "utf8"));

console.log("entry-point regression checks\n");

// ── 1. Missing inputs: fixture absent → run-on-host exits nonzero ──

check("missing-fixture-causes-nonzero-exit", () => {
  const tmp = cloneBundle();
  unlinkSync(join(tmp, "fixture.json"));
  // run-on-host uses __dirname to find its files, so invoke the cloned copy
  const r = run(join(tmp, "run-on-host.mjs"), []);
  rmSync(tmp, { recursive: true, force: true });
  assert(r.code !== 0, `expected nonzero exit, got ${r.code}`);
});

// ── 2. Missing inputs: contract absent → run-on-host exits nonzero ──

check("missing-contract-causes-nonzero-exit", () => {
  const tmp = cloneBundle();
  unlinkSync(join(tmp, "contract.json"));
  const r = run(join(tmp, "run-on-host.mjs"), []);
  rmSync(tmp, { recursive: true, force: true });
  assert(r.code !== 0, `expected nonzero exit, got ${r.code}`);
});

// ── 3. Identifier disagreement → verify exits nonzero ──

check("identifier-disagreement-causes-nonzero-exit", () => {
  const bad = JSON.parse(JSON.stringify(certificate));
  // Change computed id to a different value so it disagrees with expected
  bad.results[0].computed_semantic_artifact_id =
    "sem-0000000000000000000000000000000000000000000000000000000000000000";
  bad.results[0].identifier_discrepancy = "injected disagreement";
  const tmp = cloneBundleWithCert(bad);
  const r = run(VERIFY, [tmp]);
  rmSync(tmp, { recursive: true, force: true });
  assert(r.code !== 0, `expected nonzero exit, got ${r.code}`);
  assert(
    r.stdout.includes("FAIL") || r.stdout.includes("CERTIFICATE INVALID"),
    "expected failure indication in output"
  );
});

// ── 4. Certificate verification failure → verify exits nonzero ──

check("verification-failure-causes-nonzero-exit", () => {
  const bad = JSON.parse(JSON.stringify(certificate));
  // Set verification_result to "fail" to simulate a failed run
  bad.results[0].verification_result = "fail";
  const tmp = cloneBundleWithCert(bad);
  const r = run(VERIFY, [tmp]);
  rmSync(tmp, { recursive: true, force: true });
  assert(r.code !== 0, `expected nonzero exit, got ${r.code}`);
});

// ── 5. Missing certificate file → verify exits nonzero ──

check("missing-certificate-causes-nonzero-exit", () => {
  const tmp = cloneBundle();
  unlinkSync(join(tmp, "certificates", "certificate.json"));
  const r = run(VERIFY, [tmp]);
  rmSync(tmp, { recursive: true, force: true });
  assert(r.code !== 0, `expected nonzero exit, got ${r.code}`);
});

// ── Summary ──

console.log("\n%d checks, %d passed, %d failed", passed + failed, passed, failed);
if (failed > 0) {
  console.error("\nFAILED");
  process.exit(1);
} else {
  console.log("\nALL PASSED");
}

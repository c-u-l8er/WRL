#!/usr/bin/env node
/**
 * verify.mjs -- Self-contained certificate verifier.
 *
 * Checks that a certificate bundle is internally consistent, that the fixture
 * bytes are authentic, and that every required implementation passed.
 *
 * Rejects:
 *   - omitted required fields (in certificate or result records)
 *   - altered fixture bytes (digest mismatch between embedded and on-disk)
 *   - altered records (results_digest mismatch)
 *   - duplicate implementation names
 *   - vacuous success (zero results, or no required implementation passed)
 *
 * Usage:  node verify.mjs <bundle-dir>
 *
 * The bundle directory must contain:
 *   contract.json, fixture.json, certificates/certificate.json
 *
 * Exit 0 on valid certificate, 1 on any failure.
 * This file reads ONLY from the bundle directory -- no repository files.
 */
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, join } from "node:path";

const bundleDir = process.argv[2];
if (!bundleDir) {
  console.error("usage: node verify.mjs <bundle-dir>");
  process.exit(2);
}

const dir = resolve(bundleDir);
let failures = 0;
let checks = 0;

function check(name, cond, detail) {
  checks++;
  if (cond) {
    console.log("  ok   %s", name);
  } else {
    failures++;
    console.log("  FAIL %s  -- %s", name, detail || "");
  }
}

function requireFile(rel) {
  const p = join(dir, rel);
  if (!existsSync(p)) {
    console.error("FATAL: %s not found in bundle", rel);
    process.exit(1);
  }
  return p;
}

/**
 * Compute the deterministic digest of the results array.
 * Uses JSON.stringify with sorted keys on each result, then hashes the
 * concatenated canonical forms.
 */
function computeResultsDigest(results) {
  const canonical = JSON.stringify(results, Object.keys(results.reduce((acc, r) => {
    for (const k of Object.keys(r)) acc[k] = 1;
    // Include nested host_fingerprint keys
    if (r.host_fingerprint) for (const k of Object.keys(r.host_fingerprint)) acc["hf." + k] = 1;
    return acc;
  }, {})).sort());
  return createHash("sha256").update(canonical).digest("hex");
}

// Load bundle files
const contractPath = requireFile("contract.json");
const fixturePath = requireFile("fixture.json");
const certPath = requireFile("certificates/certificate.json");

const contract = JSON.parse(readFileSync(contractPath, "utf8"));
const fixtureBytes = readFileSync(fixturePath, "utf8");
const certificate = JSON.parse(readFileSync(certPath, "utf8"));

console.log("Verifying certificate bundle at %s\n", dir);

// ── Structure checks ──

// Certificate must have all top-level required fields
const REQUIRED_CERT_FIELDS = [
  "contract_version", "fixture_digest_sha256", "fixture_bytes_sha256",
  "host_fingerprint", "timestamp_utc", "orchestrator_pid", "results",
  "results_digest_sha256"
];
for (const field of REQUIRED_CERT_FIELDS) {
  check(`certificate/has-${field}`,
    certificate[field] !== undefined && certificate[field] !== null,
    `missing required field "${field}"`);
}

// ── Vacuous success: reject empty results ──

check("non-vacuous/results-is-array",
  Array.isArray(certificate.results),
  "results is not an array");

check("non-vacuous/results-not-empty",
  Array.isArray(certificate.results) && certificate.results.length > 0,
  "certificate has zero results -- vacuous success");

// At least 2 results (one per required implementation)
const requiredNames = contract.implementations
  .filter((i) => i.required)
  .map((i) => i.name);

check("non-vacuous/minimum-result-count",
  Array.isArray(certificate.results) && certificate.results.length >= requiredNames.length,
  `got ${certificate.results ? certificate.results.length : 0} results, need >= ${requiredNames.length}`);

// ── Duplicate implementation check ──

if (Array.isArray(certificate.results)) {
  const nameCount = {};
  for (const r of certificate.results) {
    const n = r.implementation_name;
    nameCount[n] = (nameCount[n] || 0) + 1;
  }
  const dups = Object.entries(nameCount).filter(([, c]) => c > 1);
  check("no-duplicate-implementations",
    dups.length === 0,
    `duplicate implementation(s): ${dups.map(([n, c]) => `${n} (${c}x)`).join(", ")}`);
}

// ── Fixture integrity ──

// 1. On-disk fixture digest matches contract
const fixtureDigest = createHash("sha256").update(fixtureBytes).digest("hex");
check("fixture-digest-matches-contract",
  fixtureDigest === contract.fixture.source_digest_sha256,
  `got ${fixtureDigest}, want ${contract.fixture.source_digest_sha256}`);

// 2. Certificate's fixture_digest_sha256 matches contract
check("certificate-fixture-digest",
  certificate.fixture_digest_sha256 === contract.fixture.source_digest_sha256,
  `got ${certificate.fixture_digest_sha256}, want ${contract.fixture.source_digest_sha256}`);

// 3. Embedded fixture_bytes_sha256 matches on-disk fixture
check("embedded-bytes-match-fixture",
  certificate.fixture_bytes_sha256 === fixtureDigest,
  `embedded fixture_bytes_sha256 ${certificate.fixture_bytes_sha256} != on-disk ${fixtureDigest}`);

// 4. Embedded matches contract (cross-check: all three digests agree)
check("all-digests-agree",
  certificate.fixture_digest_sha256 === certificate.fixture_bytes_sha256,
  `fixture_digest_sha256 (${certificate.fixture_digest_sha256}) != fixture_bytes_sha256 (${certificate.fixture_bytes_sha256})`);

// ── Contract version ──

check("contract-version",
  certificate.contract_version === contract.contract_version,
  `got ${certificate.contract_version}, want ${contract.contract_version}`);

// ── Expected semantic artifact id in fixture ──

const fixture = JSON.parse(fixtureBytes);
const wireObj = JSON.parse(fixture.wire);
check("fixture-contains-expected-id",
  wireObj.semantic_world_id === contract.fixture.expected_semantic_artifact_id,
  `got ${wireObj.semantic_world_id}`);

// ── Results integrity (altered records) ──

if (certificate.results_digest_sha256) {
  const recomputedDigest = computeResultsDigest(certificate.results);
  check("results-integrity",
    certificate.results_digest_sha256 === recomputedDigest,
    `results_digest_sha256 mismatch: recorded ${certificate.results_digest_sha256}, recomputed ${recomputedDigest}`);
}

// ── Every required implementation has a result ──

const resultNames = new Set(
  Array.isArray(certificate.results)
    ? certificate.results.map((r) => r.implementation_name)
    : []
);

for (const name of requiredNames) {
  check(`required-impl-present/${name}`, resultNames.has(name),
    `no result for required implementation "${name}"`);
}

// ── Per-result checks ──

const REQUIRED_RESULT_FIELDS = [
  "implementation_name", "repository_revision", "impl_file_digest_sha256",
  "host_fingerprint", "process_id", "computed_semantic_artifact_id",
  "verification_result", "expected_identifier", "identifier_discrepancy"
];

if (Array.isArray(certificate.results)) {
  for (const r of certificate.results) {
    const prefix = r.implementation_name || "(unnamed)";

    // Required fields present and non-undefined
    for (const field of REQUIRED_RESULT_FIELDS) {
      // identifier_discrepancy may be null (that's valid), but must be present
      const present = field in r;
      // For fields other than identifier_discrepancy, also reject undefined
      const valid = field === "identifier_discrepancy"
        ? present
        : present && r[field] !== undefined && r[field] !== "";
      check(`${prefix}/has-${field}`, valid, `missing or empty field "${field}"`);
    }

    // Field types
    check(`${prefix}/process_id-is-integer`,
      Number.isInteger(r.process_id),
      `process_id ${r.process_id} is not an integer`);

    check(`${prefix}/verification_result-is-enum`,
      ["pass", "fail", "error"].includes(r.verification_result),
      `verification_result "${r.verification_result}" not in [pass, fail, error]`);

    // Process ID must differ from orchestrator
    check(`${prefix}/separate-process`,
      r.process_id !== certificate.orchestrator_pid,
      `PID ${r.process_id} == orchestrator PID ${certificate.orchestrator_pid}`);

    // Verification result
    check(`${prefix}/verification-pass`,
      r.verification_result === "pass",
      `result: ${r.verification_result}`);

    // Expected identifier matches contract
    check(`${prefix}/expected-id-matches-contract`,
      r.expected_identifier === contract.fixture.expected_semantic_artifact_id,
      `got ${r.expected_identifier}`);

    // Computed id matches expected
    check(`${prefix}/computed-matches-expected`,
      r.computed_semantic_artifact_id === r.expected_identifier,
      `computed ${r.computed_semantic_artifact_id}, expected ${r.expected_identifier}`);

    // Discrepancy field consistency: null iff identifiers agree
    const idsAgree = r.computed_semantic_artifact_id === r.expected_identifier;
    check(`${prefix}/discrepancy-null-iff-agree`,
      (idsAgree && r.identifier_discrepancy === null) ||
      (!idsAgree && typeof r.identifier_discrepancy === "string" && r.identifier_discrepancy.length > 0),
      `ids agree: ${idsAgree}, discrepancy: ${JSON.stringify(r.identifier_discrepancy)}`);

    // Host fingerprint has required fields
    check(`${prefix}/has-host_fingerprint-object`,
      r.host_fingerprint && typeof r.host_fingerprint === "object",
      "host_fingerprint missing or not an object");
    if (r.host_fingerprint && typeof r.host_fingerprint === "object") {
      for (const hf of ["hostname", "platform", "arch"]) {
        check(`${prefix}/fingerprint-has-${hf}`,
          typeof r.host_fingerprint[hf] === "string" && r.host_fingerprint[hf].length > 0,
          `missing or empty ${hf}`);
      }
    }
  }
}

// ── Certificate-level host fingerprint ──

check("certificate-has-host-fingerprint",
  certificate.host_fingerprint &&
  typeof certificate.host_fingerprint === "object" &&
  typeof certificate.host_fingerprint.hostname === "string" &&
  certificate.host_fingerprint.hostname.length > 0,
  "missing or empty host fingerprint");

if (certificate.host_fingerprint && typeof certificate.host_fingerprint === "object") {
  for (const field of ["hostname", "platform", "arch", "node_version"]) {
    check(`certificate/fingerprint-has-${field}`,
      typeof certificate.host_fingerprint[field] === "string",
      `missing or non-string ${field}`);
  }
}

// ── Timestamp ──

check("certificate-has-timestamp",
  typeof certificate.timestamp_utc === "string" && !isNaN(Date.parse(certificate.timestamp_utc)),
  `invalid or missing timestamp: ${certificate.timestamp_utc}`);

// ── Summary ──

console.log("\n%d checks, %d failures", checks, failures);

if (failures > 0) {
  console.error("\nCERTIFICATE INVALID");
  process.exit(1);
} else {
  console.log("\nCERTIFICATE VALID");
  process.exit(0);
}

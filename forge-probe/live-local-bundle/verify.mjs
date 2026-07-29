#!/usr/bin/env node
/**
 * verify.mjs -- Self-contained certificate verifier.
 *
 * Checks that a certificate bundle is internally consistent, that the fixture
 * bytes are authentic, and that every required implementation passed.
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

function check(name, cond, detail) {
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

// Load bundle files
const contractPath = requireFile("contract.json");
const fixturePath = requireFile("fixture.json");
const certPath = requireFile("certificates/certificate.json");

const contract = JSON.parse(readFileSync(contractPath, "utf8"));
const fixtureBytes = readFileSync(fixturePath, "utf8");
const certificate = JSON.parse(readFileSync(certPath, "utf8"));

console.log("Verifying certificate bundle at %s\n", dir);

// 1. Fixture digest matches contract
const fixtureDigest = createHash("sha256").update(fixtureBytes).digest("hex");
check("fixture-digest-matches-contract",
  fixtureDigest === contract.fixture.source_digest_sha256,
  `got ${fixtureDigest}, want ${contract.fixture.source_digest_sha256}`);

// 2. Certificate's fixture digest matches
check("certificate-fixture-digest",
  certificate.fixture_digest_sha256 === contract.fixture.source_digest_sha256,
  `got ${certificate.fixture_digest_sha256}, want ${contract.fixture.source_digest_sha256}`);

// 3. Contract version matches
check("contract-version",
  certificate.contract_version === contract.contract_version,
  `got ${certificate.contract_version}, want ${contract.contract_version}`);

// 4. Expected semantic artifact id in fixture
const fixture = JSON.parse(fixtureBytes);
const wireObj = JSON.parse(fixture.wire);
check("fixture-contains-expected-id",
  wireObj.semantic_world_id === contract.fixture.expected_semantic_artifact_id,
  `got ${wireObj.semantic_world_id}`);

// 5. Every required implementation has a result
const requiredNames = contract.implementations
  .filter((i) => i.required)
  .map((i) => i.name);
const resultNames = new Set(certificate.results.map((r) => r.implementation_name));

for (const name of requiredNames) {
  check(`required-impl-present/${name}`, resultNames.has(name),
    `no result for ${name}`);
}

// 6. Check each result
for (const r of certificate.results) {
  const prefix = r.implementation_name;

  // Required fields present
  for (const field of [
    "implementation_name", "repository_revision", "impl_file_digest_sha256",
    "host_fingerprint", "process_id", "computed_semantic_artifact_id",
    "verification_result", "expected_identifier", "identifier_discrepancy"
  ]) {
    check(`${prefix}/has-${field}`, field in r, `missing field ${field}`);
  }

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

  // Discrepancy field consistency
  const idsAgree = r.computed_semantic_artifact_id === r.expected_identifier;
  check(`${prefix}/discrepancy-consistency`,
    (idsAgree && r.identifier_discrepancy === null) ||
    (!idsAgree && r.identifier_discrepancy !== null),
    `ids agree: ${idsAgree}, discrepancy: ${r.identifier_discrepancy}`);

  // Host fingerprint has required fields
  if (r.host_fingerprint) {
    for (const hf of ["hostname", "platform", "arch"]) {
      check(`${prefix}/fingerprint-has-${hf}`,
        typeof r.host_fingerprint[hf] === "string",
        `missing or non-string ${hf}`);
    }
  }
}

// 7. Certificate has host fingerprint
check("certificate-has-host-fingerprint",
  certificate.host_fingerprint &&
  typeof certificate.host_fingerprint.hostname === "string",
  "missing host fingerprint");

// 8. At least 2 results (one per required implementation)
check("minimum-result-count",
  certificate.results.length >= 2,
  `got ${certificate.results.length} results, need >= 2`);

console.log("\n%d checks, %d failures",
  certificate.results.length * 10 + 8 - failures + failures,
  failures);

if (failures > 0) {
  console.error("\nCERTIFICATE INVALID");
  process.exit(1);
} else {
  console.log("\nCERTIFICATE VALID");
  process.exit(0);
}

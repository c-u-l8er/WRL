#!/usr/bin/env node
/**
 * run-on-host -- Orchestrator for the live-local conformance run.
 *
 * Spawns each implementation as a SEPARATE child process, feeds it the fixture
 * on stdin, collects results, and writes a certificate bundle.
 *
 * Usage:
 *   node run-on-host.mjs [--check] [--wrl-js <path>] [--forge-dir <path>]
 *
 * --check       Dry run: verify that both implementations are available, exit 0/1.
 * --wrl-js      Path to wrl.js (default: ../../wrl.js relative to this file).
 * --forge-dir   Path to directory containing wrl_canonical.py + wrl_projection.py
 *               (default: ../../forge-probe relative to this file, falling back
 *               to FORGE_DIR env var).
 * --out         Output directory for certificate (default: ./certificates/).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { hostname, platform, arch } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    check: false,
    wrlJs: null,
    forgeDir: null,
    out: null,
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--check") opts.check = true;
    else if (args[i] === "--wrl-js" && args[i + 1]) opts.wrlJs = args[++i];
    else if (args[i] === "--forge-dir" && args[i + 1]) opts.forgeDir = args[++i];
    else if (args[i] === "--out" && args[i + 1]) opts.out = args[++i];
  }
  return opts;
}

function findWrlJs(opts) {
  if (opts.wrlJs) return resolve(opts.wrlJs);
  // Default: relative to bundle
  const rel = resolve(HERE, "..", "..", "wrl.js");
  if (existsSync(rel)) return rel;
  return null;
}

function findForgeDir(opts) {
  if (opts.forgeDir) return resolve(opts.forgeDir);
  if (process.env.FORGE_DIR) return resolve(process.env.FORGE_DIR);
  // Default: the forge-probe directory (has wrl_projection.py)
  // but wrl_canonical.py may need to be found elsewhere
  const probeDir = resolve(HERE, "..", "..", "forge-probe");
  if (existsSync(join(probeDir, "wrl_projection.py"))) {
    // Check if wrl_canonical.py is there too
    if (existsSync(join(probeDir, "wrl_canonical.py"))) return probeDir;
    // Look in TRVM/forge/
    const trvm = resolve(HERE, "..", "..", "..", "TRVM", "forge");
    if (existsSync(join(trvm, "wrl_canonical.py"))) return trvm;
  }
  return null;
}

function spawnChild(command, args, stdinData) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 30000,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("close", (code) => {
      resolve({ code, stdout, stderr, pid: child.pid });
    });
    child.on("error", (err) => {
      reject(err);
    });
    child.stdin.write(stdinData);
    child.stdin.end();
  });
}

async function main() {
  const opts = parseArgs();
  const contractPath = join(HERE, "contract.json");
  const fixturePath = join(HERE, "fixture.json");

  if (!existsSync(contractPath)) {
    console.error("contract.json not found in bundle");
    process.exit(1);
  }
  if (!existsSync(fixturePath)) {
    console.error("fixture.json not found in bundle");
    process.exit(1);
  }

  const contract = JSON.parse(readFileSync(contractPath, "utf8"));
  const fixtureBytes = readFileSync(fixturePath, "utf8");
  const fixtureDigest = createHash("sha256").update(fixtureBytes).digest("hex");

  if (fixtureDigest !== contract.fixture.source_digest_sha256) {
    console.error("FATAL: fixture.json digest mismatch");
    console.error("  expected: %s", contract.fixture.source_digest_sha256);
    console.error("  got:      %s", fixtureDigest);
    process.exit(1);
  }

  const wrlJsPath = findWrlJs(opts);
  const forgeDir = findForgeDir(opts);

  // --check mode: verify implementations are available
  if (opts.check) {
    let ok = true;
    if (!wrlJsPath || !existsSync(wrlJsPath)) {
      console.error("MISSING: wrl.js not found (tried: %s)", wrlJsPath || "default paths");
      ok = false;
    } else {
      console.log("OK: wrl.js at %s", wrlJsPath);
    }
    if (!forgeDir || !existsSync(join(forgeDir, "wrl_projection.py"))) {
      console.error("MISSING: Forge Python spine not found (tried: %s)", forgeDir || "default paths");
      ok = false;
    } else {
      console.log("OK: Forge Python spine at %s", forgeDir);
      if (!existsSync(join(forgeDir, "wrl_canonical.py"))) {
        console.error("MISSING: wrl_canonical.py not found in %s", forgeDir);
        ok = false;
      } else {
        console.log("OK: wrl_canonical.py at %s", join(forgeDir, "wrl_canonical.py"));
      }
    }
    process.exit(ok ? 0 : 1);
  }

  // Validate implementations exist before spawning
  const missing = [];
  if (!wrlJsPath || !existsSync(wrlJsPath)) missing.push("wrl-js-node");
  if (!forgeDir || !existsSync(join(forgeDir, "wrl_projection.py"))) missing.push("forge-python-spine (wrl_projection.py)");
  if (forgeDir && !existsSync(join(forgeDir, "wrl_canonical.py"))) missing.push("forge-python-spine (wrl_canonical.py)");
  if (missing.length > 0) {
    console.error("FATAL: required implementations missing: %s", missing.join(", "));
    process.exit(1);
  }

  const orchestratorPid = process.pid;
  console.log("orchestrator PID: %d", orchestratorPid);
  console.log("fixture digest: %s", fixtureDigest);
  console.log("expected sem id: %s", contract.fixture.expected_semantic_artifact_id);
  console.log("");

  const results = [];

  // 1. Run Node child
  console.log("--- wrl-js-node ---");
  try {
    const nodeResult = await spawnChild(
      process.execPath,
      [join(HERE, "run-node.mjs"), wrlJsPath],
      fixtureBytes
    );
    if (nodeResult.stderr) console.error("  stderr: %s", nodeResult.stderr.trim());
    if (nodeResult.code !== 0) {
      console.error("  Node runner exited with code %d", nodeResult.code);
      results.push({
        implementation_name: "wrl-js-node",
        repository_revision: "unknown",
        impl_file_digest_sha256: "unknown",
        host_fingerprint: { hostname: hostname(), platform: platform(), arch: arch() },
        process_id: nodeResult.pid,
        computed_semantic_artifact_id: null,
        verification_result: "error",
        expected_identifier: contract.fixture.expected_semantic_artifact_id,
        identifier_discrepancy: `child exited with code ${nodeResult.code}: ${nodeResult.stderr}`,
      });
    } else {
      const r = JSON.parse(nodeResult.stdout);
      console.log("  PID: %d, result: %s, id: %s", r.process_id, r.verification_result, r.computed_semantic_artifact_id);
      results.push(r);
    }
  } catch (e) {
    console.error("  spawn error: %s", e.message);
    process.exit(1);
  }

  // 2. Run Python child
  console.log("--- forge-python-spine ---");
  try {
    const pyResult = await spawnChild(
      "python3",
      [join(HERE, "run-python.py"), forgeDir],
      fixtureBytes
    );
    if (pyResult.stderr) console.error("  stderr: %s", pyResult.stderr.trim());
    if (pyResult.code !== 0) {
      console.error("  Python runner exited with code %d", pyResult.code);
      results.push({
        implementation_name: "forge-python-spine",
        repository_revision: "unknown",
        impl_file_digest_sha256: "unknown",
        host_fingerprint: { hostname: hostname(), platform: platform(), arch: arch() },
        process_id: pyResult.pid,
        computed_semantic_artifact_id: null,
        verification_result: "error",
        expected_identifier: contract.fixture.expected_semantic_artifact_id,
        identifier_discrepancy: `child exited with code ${pyResult.code}: ${pyResult.stderr}`,
      });
    } else {
      const r = JSON.parse(pyResult.stdout);
      console.log("  PID: %d, result: %s, id: %s", r.process_id, r.verification_result, r.computed_semantic_artifact_id);
      results.push(r);
    }
  } catch (e) {
    console.error("  spawn error: %s", e.message);
    process.exit(1);
  }

  // Validate: each child PID differs from orchestrator
  for (const r of results) {
    if (r.process_id === orchestratorPid) {
      console.error("FATAL: implementation %s ran in orchestrator PID %d", r.implementation_name, orchestratorPid);
      process.exit(1);
    }
  }

  // Build certificate
  const certificate = {
    contract_version: contract.contract_version,
    fixture_digest_sha256: fixtureDigest,
    host_fingerprint: {
      hostname: hostname(),
      platform: platform(),
      arch: arch(),
      node_version: process.version,
    },
    timestamp_utc: new Date().toISOString(),
    orchestrator_pid: orchestratorPid,
    results,
  };

  const outDir = opts.out ? resolve(opts.out) : join(HERE, "certificates");
  mkdirSync(outDir, { recursive: true });
  const certPath = join(outDir, "certificate.json");
  writeFileSync(certPath, JSON.stringify(certificate, null, 2) + "\n");
  console.log("\ncertificate written to %s", certPath);

  // Exit nonzero if any required implementation failed
  const requiredNames = contract.implementations
    .filter((i) => i.required)
    .map((i) => i.name);
  const resultNames = new Set(results.map((r) => r.implementation_name));
  const missingResults = requiredNames.filter((n) => !resultNames.has(n));
  const failures = results.filter(
    (r) => r.verification_result !== "pass" && requiredNames.includes(r.implementation_name)
  );
  const discrepancies = results.filter((r) => r.identifier_discrepancy !== null);

  let exitCode = 0;
  if (missingResults.length > 0) {
    console.error("FAIL: missing results for: %s", missingResults.join(", "));
    exitCode = 1;
  }
  if (failures.length > 0) {
    console.error("FAIL: verification failures: %s",
      failures.map((f) => `${f.implementation_name}: ${f.verification_result}`).join(", "));
    exitCode = 1;
  }
  if (discrepancies.length > 0) {
    console.error("FAIL: identifier discrepancies: %s",
      discrepancies.map((d) => `${d.implementation_name}: ${d.identifier_discrepancy}`).join(", "));
    exitCode = 1;
  }

  if (exitCode === 0) {
    console.log("\nALL PASS: %d implementations verified", results.length);
  }
  process.exit(exitCode);
}

main();

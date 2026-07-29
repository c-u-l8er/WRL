#!/usr/bin/env node
/**
 * Extract the pinned-fixture vector from projection-vectors.json and write
 * fixture.json + update contract.json with the digest.
 *
 * Run once at build time:  node extract-fixture.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const VECTORS = join(HERE, "..", "..", "test", "projection-vectors.json");

const doc = JSON.parse(readFileSync(VECTORS, "utf8"));
const pinned = doc.vectors.find((v) => v.name === "pinned-fixture");
if (!pinned) { console.error("pinned-fixture not found"); process.exit(1); }

const fixture = JSON.stringify(pinned, null, 2) + "\n";
const digest = createHash("sha256").update(fixture).digest("hex");

writeFileSync(join(HERE, "fixture.json"), fixture);

// Update contract.json with the real digest.
const contractPath = join(HERE, "contract.json");
const contract = JSON.parse(readFileSync(contractPath, "utf8"));
contract.fixture.source_digest_sha256 = digest;
writeFileSync(contractPath, JSON.stringify(contract, null, 2) + "\n");

console.log("fixture.json written, digest: %s", digest);

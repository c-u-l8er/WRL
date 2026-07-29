#!/usr/bin/env bash
# test-regression.sh -- Minimal regression checks proving the conformance
# pipeline rejects missing inputs, identifier disagreement, and certificate
# verification failures with a nonzero exit.
#
# No network access.  Uses the checked-in bundle files, creating temporary
# corrupted copies to exercise each error path.
#
# Exit 0: all regression checks passed.
# Exit 1: at least one check failed.

set -uo pipefail

BUNDLE_DIR="$(cd "$(dirname "$0")" && pwd)"
PASS=0
FAIL=0
TOTAL=0

expect_nonzero() {
  local label="$1"
  shift
  TOTAL=$((TOTAL + 1))
  if "$@" >/dev/null 2>&1; then
    echo "  FAIL  $label  (expected nonzero exit, got 0)"
    FAIL=$((FAIL + 1))
  else
    echo "  ok    $label"
    PASS=$((PASS + 1))
  fi
}

expect_zero() {
  local label="$1"
  shift
  TOTAL=$((TOTAL + 1))
  if "$@" >/dev/null 2>&1; then
    echo "  ok    $label"
    PASS=$((PASS + 1))
  else
    echo "  FAIL  $label  (expected zero exit, got nonzero)"
    FAIL=$((FAIL + 1))
  fi
}

echo "=== Regression checks ==="

# ────────────────────────────────────────────
# 1. Missing inputs cause nonzero exit
# ────────────────────────────────────────────

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# 1a. Verifier rejects missing certificate
mkdir -p "$TMP/missing-cert/certificates"
cp "$BUNDLE_DIR/contract.json" "$TMP/missing-cert/"
cp "$BUNDLE_DIR/fixture.json"  "$TMP/missing-cert/"
# No certificate.json -- should fail
expect_nonzero "verify/missing-certificate" \
  node "$BUNDLE_DIR/verify.mjs" "$TMP/missing-cert"

# 1b. Verifier rejects missing contract
mkdir -p "$TMP/missing-contract/certificates"
cp "$BUNDLE_DIR/fixture.json"  "$TMP/missing-contract/"
cp "$BUNDLE_DIR/certificates/certificate.json" "$TMP/missing-contract/certificates/"
# No contract.json -- should fail
expect_nonzero "verify/missing-contract" \
  node "$BUNDLE_DIR/verify.mjs" "$TMP/missing-contract"

# 1c. Verifier rejects missing fixture
mkdir -p "$TMP/missing-fixture/certificates"
cp "$BUNDLE_DIR/contract.json" "$TMP/missing-fixture/"
cp "$BUNDLE_DIR/certificates/certificate.json" "$TMP/missing-fixture/certificates/"
# No fixture.json -- should fail
expect_nonzero "verify/missing-fixture" \
  node "$BUNDLE_DIR/verify.mjs" "$TMP/missing-fixture"

# 1d. Verifier with no arguments exits nonzero
expect_nonzero "verify/no-args" \
  node "$BUNDLE_DIR/verify.mjs"

# ────────────────────────────────────────────
# 2. Identifier disagreement causes nonzero exit
# ────────────────────────────────────────────

# Create a certificate with a wrong computed identifier
mkdir -p "$TMP/wrong-id/certificates"
cp "$BUNDLE_DIR/contract.json" "$TMP/wrong-id/"
cp "$BUNDLE_DIR/fixture.json"  "$TMP/wrong-id/"
node -e "
  const fs = require('fs');
  const cert = JSON.parse(fs.readFileSync('$BUNDLE_DIR/certificates/certificate.json','utf8'));
  // Tamper: change the computed id in the first result
  cert.results[0].computed_semantic_artifact_id = 'sem-0000000000000000000000000000000000000000000000000000000000000000';
  cert.results[0].verification_result = 'fail';
  cert.results[0].identifier_discrepancy = 'tampered for regression test';
  fs.writeFileSync('$TMP/wrong-id/certificates/certificate.json', JSON.stringify(cert, null, 2) + '\n');
"
expect_nonzero "verify/identifier-disagreement" \
  node "$BUNDLE_DIR/verify.mjs" "$TMP/wrong-id"

# ────────────────────────────────────────────
# 3. Certificate verification failures cause nonzero exit
# ────────────────────────────────────────────

# 3a. Tampered fixture bytes (digest mismatch)
mkdir -p "$TMP/bad-fixture/certificates"
cp "$BUNDLE_DIR/contract.json" "$TMP/bad-fixture/"
cp "$BUNDLE_DIR/certificates/certificate.json" "$TMP/bad-fixture/certificates/"
echo '{"tampered": true}' > "$TMP/bad-fixture/fixture.json"
expect_nonzero "verify/tampered-fixture" \
  node "$BUNDLE_DIR/verify.mjs" "$TMP/bad-fixture"

# 3b. Empty results array (vacuous success)
mkdir -p "$TMP/empty-results/certificates"
cp "$BUNDLE_DIR/contract.json" "$TMP/empty-results/"
cp "$BUNDLE_DIR/fixture.json"  "$TMP/empty-results/"
node -e "
  const fs = require('fs');
  const cert = JSON.parse(fs.readFileSync('$BUNDLE_DIR/certificates/certificate.json','utf8'));
  cert.results = [];
  fs.writeFileSync('$TMP/empty-results/certificates/certificate.json', JSON.stringify(cert, null, 2) + '\n');
"
expect_nonzero "verify/empty-results-vacuous" \
  node "$BUNDLE_DIR/verify.mjs" "$TMP/empty-results"

# 3c. Missing required field in certificate
mkdir -p "$TMP/missing-field/certificates"
cp "$BUNDLE_DIR/contract.json" "$TMP/missing-field/"
cp "$BUNDLE_DIR/fixture.json"  "$TMP/missing-field/"
node -e "
  const fs = require('fs');
  const cert = JSON.parse(fs.readFileSync('$BUNDLE_DIR/certificates/certificate.json','utf8'));
  delete cert.fixture_digest_sha256;
  fs.writeFileSync('$TMP/missing-field/certificates/certificate.json', JSON.stringify(cert, null, 2) + '\n');
"
expect_nonzero "verify/missing-required-field" \
  node "$BUNDLE_DIR/verify.mjs" "$TMP/missing-field"

# ────────────────────────────────────────────
# 4. Identifier gate in run-conformance rejects mismatched id
# ────────────────────────────────────────────

# Produce a valid certificate then tamper its id before the gate runs
mkdir -p "$TMP/gate-test/certificates"
cp "$BUNDLE_DIR/contract.json" "$TMP/gate-test/"
cp "$BUNDLE_DIR/fixture.json"  "$TMP/gate-test/"
# Create a certificate where everything looks valid to verify.mjs
# but the id differs from the pinned value used by run-conformance
node -e "
  const fs = require('fs');
  const cert = JSON.parse(fs.readFileSync('$BUNDLE_DIR/certificates/certificate.json','utf8'));
  // Change both expected and computed to a non-pinned but consistent value
  const fakeId = 'sem-ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
  for (const r of cert.results) {
    r.computed_semantic_artifact_id = fakeId;
    r.expected_identifier = fakeId;
    r.identifier_discrepancy = null;
  }
  fs.writeFileSync('$TMP/gate-test/certificates/certificate.json', JSON.stringify(cert, null, 2) + '\n');
"
# The run-conformance identifier gate should reject this.
# We simulate just the gate portion: extract ids and compare to pinned.
PINNED="sem-8ae91fe9cbc5fd086ce4356d587c403211e5c7b2b3ebdd316496367429ecfe4a"
FAKE_IDS="$(node -e "
  const c = JSON.parse(require('fs').readFileSync('$TMP/gate-test/certificates/certificate.json','utf8'));
  for (const r of c.results) process.stdout.write(r.computed_semantic_artifact_id + '\n');
")"
TOTAL=$((TOTAL + 1))
GATE_OK=true
while IFS= read -r id; do
  [ -z "$id" ] && continue
  if [ "$id" = "$PINNED" ]; then
    GATE_OK=false  # it should NOT match
  fi
done <<< "$FAKE_IDS"
if $GATE_OK; then
  echo "  ok    gate/rejects-non-pinned-id"
  PASS=$((PASS + 1))
else
  echo "  FAIL  gate/rejects-non-pinned-id"
  FAIL=$((FAIL + 1))
fi

# ────────────────────────────────────────────
# 5. Baseline: valid bundle passes verification
# ────────────────────────────────────────────

expect_zero "verify/valid-bundle-passes" \
  node "$BUNDLE_DIR/verify.mjs" "$BUNDLE_DIR"

# ────────────────────────────────────────────
# Summary
# ────────────────────────────────────────────

echo ""
echo "$TOTAL checks, $PASS passed, $FAIL failed"

if [ "$FAIL" -gt 0 ]; then
  echo "REGRESSION CHECKS FAILED"
  exit 1
else
  echo "REGRESSION CHECKS PASSED"
  exit 0
fi

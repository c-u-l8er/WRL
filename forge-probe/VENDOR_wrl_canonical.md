# Vendored file: wrl_canonical.py

## Provenance

| Field | Value |
|---|---|
| Source repository | `TRVM` (first-party, sibling repo) |
| Source path | `TRVM/forge/wrl_canonical.py` |
| Source commit | `2bb18a9d5a36fb2c966978d1fdcf7d48f25142e6` |
| Source commit message | WRL Slice B + WRLM Step 2 + forge binding runs + multi-runtime scaffolding; remove all .zip packets |
| Vendored to | `forge-probe/wrl_canonical.py` |
| Vendored in commit | `92187919cd4a08706c77e1a9c878970678a3c0d5` |
| SHA-256 | `b7aa0d2a96df6494de632386e7f5556aadfea8b99a1c91aaee65200ece2b0630` |

## Why vendored

The conformance pipeline (`forge-probe/live-local-bundle/run-conformance`)
requires `wrl_canonical.py` at runtime. The original location in the sibling
`TRVM` repo meant clean checkouts of this repository alone could not execute
the pipeline without a manual copy step. Vendoring makes the pipeline
hermetic and network-free from any standalone clone.

## Updating

If `TRVM/forge/wrl_canonical.py` is updated at its source, re-vendor by:

1. Copy the new file: `cp ../TRVM/forge/wrl_canonical.py forge-probe/wrl_canonical.py`
2. Update this record with the new source commit and SHA-256.
3. Re-run `forge-probe/live-local-bundle/run-conformance` to verify.

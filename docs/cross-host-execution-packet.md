# Cross-Host Execution Packet

## Pinned identifier

```
sem-8ae91fe9cbc5fd086ce4356d587c403211e5c7b2b3ebdd316496367429ecfe4a
```

## Workflow reference

File: `.github/workflows/cross-host-conformance.yml`
Trigger: `workflow_dispatch` only (no automatic execution).

## Hosted-runner jobs

### Job A: `verify-host-a`

| Setting | Value |
|---|---|
| Runner | `ubuntu-22.04` |
| Node.js | `20` (via `actions/setup-node@v4`) |
| Python | `3.11` (via `actions/setup-python@v5`) |
| Entry point | `forge-probe/live-local-bundle/run-conformance` |
| Artifact name | `certificate-host-a-ubuntu2204-node20` |
| Artifact path | `forge-probe/live-local-bundle/certificates/certificate.json` |
| Retention | 90 days |

### Job B: `verify-host-b`

| Setting | Value |
|---|---|
| Runner | `ubuntu-24.04` |
| Node.js | `22` (via `actions/setup-node@v4`) |
| Python | `3.12` (via `actions/setup-python@v5`) |
| Entry point | `forge-probe/live-local-bundle/run-conformance` |
| Artifact name | `certificate-host-b-ubuntu2404-node22` |
| Artifact path | `forge-probe/live-local-bundle/certificates/certificate.json` |
| Retention | 90 days |

Jobs A and B run independently (no `needs:` dependency between them). They execute on separate GitHub-hosted runner instances with different OS versions and runtime versions, providing runtime-environment diversity.

## Identifier comparison gate

Job: `identifier-gate`
Depends on: `verify-host-a`, `verify-host-b` (runs only after both complete successfully).
Runner: `ubuntu-latest`

The gate performs three exact string comparisons:

1. Host A identifier == Host B identifier
2. Host A identifier == pinned identifier (`sem-8ae91fe9cbc5fd086ce4356d587c403211e5c7b2b3ebdd316496367429ecfe4a`)
3. Host B identifier == pinned identifier (`sem-8ae91fe9cbc5fd086ce4356d587c403211e5c7b2b3ebdd316496367429ecfe4a`)

All three must hold for the gate to pass. Any mismatch exits non-zero.

The identifier is extracted from each job's certificate via:

```javascript
const c = JSON.parse(require('fs').readFileSync(
  'forge-probe/live-local-bundle/certificates/certificate.json','utf8'));
for (const r of c.results) process.stdout.write(r.computed_semantic_artifact_id);
```

This concatenates all `computed_semantic_artifact_id` values from the certificate results. Because both required implementations must produce the same identifier for `run-conformance` to exit 0, and the workflow only reaches the gate if both jobs' `run-conformance` invocations succeeded, the extracted value is the repeated pinned identifier. The gate then confirms cross-job agreement.

## Evidence-ladder status

### Current rung: `live_local`

The portability and identity claims are at `live_local`. The two clean-local verification runs (see execution records below) confirm that the hermetic entry point works from a clean checkout on a single developer machine. Clean local environments do not establish distinct deployed machines.

The `live_local` evidence is:
- Two implementations (wrl-js-node, forge-python-spine) independently compute the pinned identifier in separate OS processes.
- The certificate is produced and verified by `run-conformance` and `verify.mjs`.
- The clean-local runs below reproduce this from independent fresh environments.

### `live_deployed` is not claimed

No hosted workflow execution has occurred. No hosted artifact retention has occurred. The workflow definition is checked in but has never been dispatched. This repository does not claim `live_deployed` or `external` status for any evidence produced by this objective.

### Follow-on objective: hosted execution

Actual hosted execution and artifact retention are blocked on:

1. **CI authorization** — the repository must be connected to GitHub Actions (or equivalent) with permissions to run `workflow_dispatch` workflows and upload artifacts.
2. **Runner availability** — `ubuntu-22.04` and `ubuntu-24.04` hosted runners must be available to the repository's organization/plan.

Once both are established, a follow-on objective should:
- Dispatch the workflow.
- Retrieve both certificate artifacts from the completed run.
- Verify that both certificates name the pinned identifier.
- Confirm that the two jobs' `host_fingerprint` fields name distinct runner instances.
- Assess whether GitHub-hosted runners constitute "deployed machines" per the spec's definition (see `docs/spec/README.md` § "Rejected alternatives" — CI runners were rejected for `live_deployed` because they are ephemeral and not the deployment substrate the stack runs on; this assessment remains valid and the follow-on should not claim `live_deployed` from CI runners alone).

## Execution records

### Clean-local run A

| Field | Value |
|---|---|
| Environment | `rsync` copy of worktree into `/tmp/wrl-clean-exec-a/`, `git init` + commit, on host PX13 (Linux 6.18.6-arch1-1 x86_64) |
| machine_id | `280bd2f747df4019ac625b71406ab387` |
| Command | `cd /tmp/wrl-clean-exec-a && FORGE_DIR=/tmp/wrl-clean-exec-a/forge-probe forge-probe/live-local-bundle/run-conformance` |
| Node version | v25.2.1 |
| Python version | 3.13.14 |
| wrl_canonical.py | Vendored at `forge-probe/wrl_canonical.py` (tracked; copied from `TRVM/forge/wrl_canonical.py`) |
| Orchestrator PID | 4087405 |
| wrl-js-node PID | 4087412 |
| forge-python-spine PID | 4087425 |
| Timestamp (UTC) | 2026-07-30T01:26:33.382Z |
| Certificate digest (SHA-256) | `5d1e70e9f629ef6917d523923d9dae11492efa31682a0204db1ff2b14c2a5313` |
| Results digest | `743fcb8b16736e63478e8c629bd86b095139c6c34e5a54db0dba036e479ea9ee` |
| Verifier result | CERTIFICATE VALID (67 checks, 0 failures) |
| Identifier gate | CONFORMANCE PASSED — all results match pinned `sem-8ae91fe9cbc5fd086ce4356d587c403211e5c7b2b3ebdd316496367429ecfe4a` |

### Clean-local run B

| Field | Value |
|---|---|
| Environment | `rsync` copy of worktree into `/tmp/wrl-clean-exec-b/`, `git init` + commit, on host PX13 (Linux 6.18.6-arch1-1 x86_64) |
| machine_id | `280bd2f747df4019ac625b71406ab387` |
| Command | `cd /tmp/wrl-clean-exec-b && FORGE_DIR=/tmp/wrl-clean-exec-b/forge-probe forge-probe/live-local-bundle/run-conformance` |
| Node version | v25.2.1 |
| Python version | 3.13.14 |
| wrl_canonical.py | Vendored at `forge-probe/wrl_canonical.py` (tracked; copied from `TRVM/forge/wrl_canonical.py`) |
| Orchestrator PID | 4087600 |
| wrl-js-node PID | 4087608 |
| forge-python-spine PID | 4087629 |
| Timestamp (UTC) | 2026-07-30T01:26:33.907Z |
| Certificate digest (SHA-256) | `4f842471d427e51d61ccc0aca942f917c688e666ca0b4c4519349038b58b4b91` |
| Results digest | `8f1f9c1bbaabaa1c85d13d1dd08749d6f63e6f4bb42c002cf93b7fa3ed2c52de` |
| Verifier result | CERTIFICATE VALID (67 checks, 0 failures) |
| Identifier gate | CONFORMANCE PASSED — all results match pinned `sem-8ae91fe9cbc5fd086ce4356d587c403211e5c7b2b3ebdd316496367429ecfe4a` |

### Cross-run comparison

Both runs produce the identical `sem-` identifier from both implementations. Certificate digests differ (expected — timestamps, PIDs, and git revisions vary between independent environments). The fixture digest (`ade989ea5d4b34b2e1ec1afd846a1be0fb795070ba96b0bdae078652a1c1547e`) and implementation file digests are identical across runs, confirming deterministic content-addressing.

Both clean-local environments are on the same developer machine (PX13, machine_id `280bd2f747df4019ac625b71406ab387`). Clean local environments do not establish distinct deployed machines. The portability and identity claims remain at `live_local`; `live_deployed` advancement requires execution on a distinct deployed machine, which is blocked on CI authorization and runner availability (see follow-on objective above).

### DOCTRINE

`live_local` — both clean-local executions independently verify the pinned identifier `sem-8ae91fe9cbc5fd086ce4356d587c403211e5c7b2b3ebdd316496367429ecfe4a` from two implementations in separate OS processes. This confirms the hermetic entry point works from a clean checkout. It does not constitute `live_deployed` evidence; hosted execution is a follow-on objective.

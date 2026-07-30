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

### Clean-local run A (git-clone clean checkout)

| Field | Value |
|---|---|
| Environment | `git clone --no-checkout` of repo into `/tmp/wrl-clean-env-A/`, detached HEAD at `9218791`, on host PX13 (Linux 6.18.6-arch1-1 x86_64) |
| machine_id | `280bd2f747df4019ac625b71406ab387` |
| Command | `cd /tmp/wrl-clean-env-A && bash forge-probe/live-local-bundle/run-conformance` |
| Node version | v25.2.1 |
| Python version | 3.13.14 |
| wrl_canonical.py | Vendored at `forge-probe/wrl_canonical.py` (tracked in repo) |
| Repository revision | `92187919cd4a08706c77e1a9c878970678a3c0d5` |
| Orchestrator PID | 55099 |
| wrl-js-node PID | 55112 |
| forge-python-spine PID | 55127 |
| Timestamp (UTC) | 2026-07-30T01:50:00.906Z |
| Certificate digest (SHA-256) | `fd9f7c2c41ec066cb7d90fc6750d511a45a08970329d3b820117d71515eb1952` |
| Results digest | `91aefbabca3b87fe31df2e400072b1e9b9c9437b12e81c03dd30a4f1fa31b8ab` |
| Verifier result | CERTIFICATE VALID (67 checks, 0 failures) |
| Identifier gate | CONFORMANCE PASSED — all results match pinned `sem-8ae91fe9cbc5fd086ce4356d587c403211e5c7b2b3ebdd316496367429ecfe4a` |

### Clean-local run B (git-clone clean checkout)

| Field | Value |
|---|---|
| Environment | `git clone --no-checkout` of repo into `/tmp/wrl-clean-env-B/`, detached HEAD at `9218791`, on host PX13 (Linux 6.18.6-arch1-1 x86_64) |
| machine_id | `280bd2f747df4019ac625b71406ab387` |
| Command | `cd /tmp/wrl-clean-env-B && bash forge-probe/live-local-bundle/run-conformance` |
| Node version | v25.2.1 |
| Python version | 3.13.14 |
| wrl_canonical.py | Vendored at `forge-probe/wrl_canonical.py` (tracked in repo) |
| Repository revision | `92187919cd4a08706c77e1a9c878970678a3c0d5` |
| Orchestrator PID | 55323 |
| wrl-js-node PID | 55330 |
| forge-python-spine PID | 55342 |
| Timestamp (UTC) | 2026-07-30T01:50:01.636Z |
| Certificate digest (SHA-256) | `6474a264c4ab5d8c5c300501fb76486fbb47d4c05852caf39fc4e51b586e19f0` |
| Results digest | `af70639fed0ecdf3ce3fc96c2b8ce18a70358e7ae033b90fd992169dc992eca1` |
| Verifier result | CERTIFICATE VALID (67 checks, 0 failures) |
| Identifier gate | CONFORMANCE PASSED — all results match pinned `sem-8ae91fe9cbc5fd086ce4356d587c403211e5c7b2b3ebdd316496367429ecfe4a` |

### Cross-run comparison

Both runs produce the identical `sem-` identifier from both implementations. Certificate digests differ (expected — timestamps, PIDs, and git revisions vary between independent environments). The fixture digest (`ade989ea5d4b34b2e1ec1afd846a1be0fb795070ba96b0bdae078652a1c1547e`) and implementation file digests are identical across runs, confirming deterministic content-addressing.

Both clean-local environments were created via `git clone --no-checkout` into separate `/tmp/` directories, each checked out at the same detached HEAD. This confirms the hermetic entry point works from a true clean checkout (no worktree state, no untracked files, no `.env`). Both environments are on the same developer machine (PX13, machine_id `280bd2f747df4019ac625b71406ab387`). Clean local environments do not establish distinct deployed machines. The portability and identity claims remain at `live_local`; `live_deployed` advancement requires execution on a distinct deployed machine, which is blocked on CI authorization and runner availability (see follow-on objective above).

### DOCTRINE

`live_local` — both clean-local executions independently verify the pinned identifier `sem-8ae91fe9cbc5fd086ce4356d587c403211e5c7b2b3ebdd316496367429ecfe4a` from two implementations in separate OS processes. This confirms the hermetic entry point works from a clean checkout with no worktree contamination. It does not constitute `live_deployed` evidence; hosted execution is a follow-on objective.

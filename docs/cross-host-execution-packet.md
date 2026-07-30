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

Both jobs extract a validated identifier from the certificate using the same logic (step id `extract-id`), write `cert_id=$ID` to `$GITHUB_OUTPUT`, and declare `cert_id` as a job output. This was corrected in `93f9e2d` — prior to that commit, `verify-host-b` was missing the `$GITHUB_OUTPUT` write.

## Identifier comparison gate

Job: `identifier-gate`
Depends on: `verify-host-a`, `verify-host-b` (runs only after both complete successfully).
Runner: `ubuntu-latest`

The gate performs three exact string comparisons:

1. Host A identifier == Host B identifier
2. Host A identifier == pinned identifier (`sem-8ae91fe9cbc5fd086ce4356d587c403211e5c7b2b3ebdd316496367429ecfe4a`)
3. Host B identifier == pinned identifier (`sem-8ae91fe9cbc5fd086ce4356d587c403211e5c7b2b3ebdd316496367429ecfe4a`)

All three must hold for the gate to pass. Any mismatch causes the gate to print the differing values, print `GATE FAILED`, and exit with code 1.

### Failure behavior

The gate has four distinct failure modes, each producing a non-zero exit:

| Failure mode | Where it fires | Behavior |
|---|---|---|
| Verification job failure | `verify-host-a` or `verify-host-b` | The gate job has `needs: [verify-host-a, verify-host-b]` — if either verification job fails, the gate job is skipped entirely by GitHub Actions (never runs). The workflow run shows a failed status. |
| Empty certificate results | `extract-id` step within each verification job | If `c.results` is falsy or empty, the extraction script calls `process.exit(1)`. The job fails before reaching artifact upload. The gate is never reached. |
| Intra-certificate identifier disagreement | `extract-id` step within each verification job | If any `computed_semantic_artifact_id` in the certificate's results array differs from the others, the extraction script prints each implementation's identifier to stderr and calls `process.exit(1)`. The job fails; the gate is never reached. |
| Cross-host or pinned identifier mismatch | `identifier-gate` job | If Host A != Host B, Host A != pinned, or Host B != pinned, the gate prints the specific failing comparison(s), prints `GATE FAILED`, and exits with code 1. All three comparisons are evaluated before exiting, so all mismatches are reported in a single run. |

In all cases, a non-zero exit causes the GitHub Actions workflow run to report failure. No partial success is possible — either all three identifiers match or the workflow fails.

### Identifier extraction algorithm

The identifier is extracted from each job's certificate via:

```javascript
const c = JSON.parse(require('fs').readFileSync(
  'forge-probe/live-local-bundle/certificates/certificate.json','utf8'));
if (!c.results || c.results.length === 0) { process.exit(1); }
const ids = c.results.map(r => r.computed_semantic_artifact_id);
if (ids.some(id => id !== ids[0])) {
  console.error('FAIL: results disagree on identifier');
  for (const r of c.results) console.error('  ' + r.implementation_name + ': ' + r.computed_semantic_artifact_id);
  process.exit(1);
}
process.stdout.write(ids[0]);
```

This validates that all `computed_semantic_artifact_id` values in the certificate results agree on a single identifier and emits exactly that one value. If the certificate has no results, or if any result's identifier disagrees with the others, the extraction step exits non-zero and the gate is never reached. The gate then confirms cross-job agreement between the single validated identifier from each host and the pinned identifier.

## Evidence-ladder status

### Current rung: `live_local`

The portability and identity claims are at `live_local`. The two clean-local verification runs (see execution records below) confirm that the hermetic entry point works from a clean checkout on a single developer machine. Clean local environments do not establish distinct deployed machines.

The `live_local` evidence is:
- Two implementations (wrl-js-node, forge-python-spine) independently compute the pinned identifier in separate OS processes.
- The certificate is produced and verified by `run-conformance` and `verify.mjs`.
- The clean-local runs below reproduce this from independent fresh environments at the corrected revision (`892476b`).

### live_deployed is not claimed

No hosted workflow execution has occurred. No hosted artifact retention has occurred. The workflow definition is checked in but has never been dispatched. This repository does not claim `live_deployed` or `external` status for any evidence produced by this objective.

### Follow-on objective: hosted execution

Actual hosted execution and artifact retention are blocked on:

1. **CI authorization** — the repository must be connected to GitHub Actions (or equivalent) with permissions to run `workflow_dispatch` workflows and upload artifacts.
2. **Runner availability** — `ubuntu-22.04` and `ubuntu-24.04` hosted runners must be available to the repository's organization/plan.

Once both are established, a follow-on objective should:

1. **Dispatch the workflow** — trigger `workflow_dispatch` on the `cross-host-conformance` workflow from the branch containing the hermetic entry point.
2. **Confirm the identifier gate passes** — all three jobs must succeed; the gate job must print `GATE PASSED` with the pinned identifier.
3. **Retrieve both certificate artifacts** — download `certificate-host-a-ubuntu2204-node20` and `certificate-host-b-ubuntu2404-node22` from the completed workflow run.
4. **Verify artifact retention** — confirm both artifacts are retrievable by name from the GitHub Actions artifact API within the 90-day retention window. Evidence: the `actions/download-artifact@v4` retrieval succeeds, or equivalent API call returns HTTP 200 with the expected artifact name and a non-zero size. Record the artifact IDs, sizes, and download timestamps.
5. **Verify certificate content** — for each retrieved artifact, parse the certificate JSON and confirm `computed_semantic_artifact_id` equals the pinned identifier for every result entry.
6. **Confirm distinct runner instances** — compare the two certificates' `host_fingerprint` fields; they must name different hostnames (GitHub-hosted runners assign unique hostnames per job).
7. **Assess evidence rung** — GitHub-hosted runners are ephemeral and are not the deployment substrate the stack runs on (see `docs/spec/README.md` § "Rejected alternatives"). CI runner execution may establish cross-host portability evidence but does not by itself constitute `live_deployed`. The follow-on should label this honestly and identify what additional substrate (if any) would reach `live_deployed`.

The follow-on objective must not claim `live_deployed` or `external` status from CI execution alone. It must produce its own execution records with the same fields as the clean-local records above, plus the artifact IDs, retention confirmation, and the honest rung assessment.

## Execution records

### Clean-local run A (git-clone clean checkout)

| Field | Value |
|---|---|
| Environment | `git clone --no-hardlinks` of repo into `/tmp/wrl-clean-clone-a-255717/`, detached HEAD at `892476b`, on host PX13 (Linux 6.18.6-arch1-1 x86_64) |
| machine_id | `280bd2f747df4019ac625b71406ab387` |
| Command | `cd /tmp/wrl-clean-clone-a-255717 && forge-probe/live-local-bundle/run-conformance` |
| Node version | v25.2.1 |
| Python version | 3.13.14 |
| wrl_canonical.py | Vendored at `forge-probe/wrl_canonical.py` (tracked in repo; source: TRVM commit `2bb18a9`) |
| Repository revision | `892476bc33475904722e5c37477002a5f5d58709` |
| Orchestrator PID | 255763 |
| wrl-js-node PID | 255771 |
| forge-python-spine PID | 255806 |
| Timestamp (UTC) | 2026-07-30T02:23:19.678Z |
| Certificate digest (SHA-256) | `6fda5827ea956109085ccf047ad9bc09d6ac96db1120f4f2ad045afd5849f562` |
| Results digest | `7244c203857783ce5c66c822e247cc2bf4da2beb296f90671528b631acc4e10f` |
| Verifier result | CERTIFICATE VALID (67 checks, 0 failures) |
| Identifier gate | CONFORMANCE PASSED — all results match pinned `sem-8ae91fe9cbc5fd086ce4356d587c403211e5c7b2b3ebdd316496367429ecfe4a` |

### Clean-local run B (git-clone clean checkout)

| Field | Value |
|---|---|
| Environment | `git clone --no-hardlinks` of repo into `/tmp/wrl-clean-clone-b-256471/`, detached HEAD at `892476b`, on host PX13 (Linux 6.18.6-arch1-1 x86_64) |
| machine_id | `280bd2f747df4019ac625b71406ab387` |
| Command | `cd /tmp/wrl-clean-clone-b-256471 && forge-probe/live-local-bundle/run-conformance` |
| Node version | v25.2.1 |
| Python version | 3.13.14 |
| wrl_canonical.py | Vendored at `forge-probe/wrl_canonical.py` (tracked in repo; source: TRVM commit `2bb18a9`) |
| Repository revision | `892476bc33475904722e5c37477002a5f5d58709` |
| Orchestrator PID | 256505 |
| wrl-js-node PID | 256513 |
| forge-python-spine PID | 256526 |
| Timestamp (UTC) | 2026-07-30T02:23:27.142Z |
| Certificate digest (SHA-256) | `5e1fb3532d3b61226fb4225de3b818cdfe2caf915ad209d332aecceca3c9ebc9` |
| Results digest | `30d5cf74d6af6d762739d5ba4fae0e6106dab73cca71de5b5eb4fbb1ab33b115` |
| Verifier result | CERTIFICATE VALID (67 checks, 0 failures) |
| Identifier gate | CONFORMANCE PASSED — all results match pinned `sem-8ae91fe9cbc5fd086ce4356d587c403211e5c7b2b3ebdd316496367429ecfe4a` |

### Cross-run comparison

Both runs produce the identical `sem-` identifier from both implementations. Certificate digests differ (expected — timestamps, PIDs, and git revisions vary between independent environments). The fixture digest (`ade989ea5d4b34b2e1ec1afd846a1be0fb795070ba96b0bdae078652a1c1547e`) and implementation file digests are identical across runs, confirming deterministic content-addressing.

Both clean-local environments were created via `git clone --no-hardlinks` into separate `/tmp/` directories, each checked out at detached HEAD `892476b`. This is the corrected revision that includes the `verify-host-b` `cert_id` output fix (`93f9e2d`) and the execution packet update (`892476b`). Both environments are on the same developer machine (PX13, machine_id `280bd2f747df4019ac625b71406ab387`). Clean local environments do not establish distinct deployed machines. The portability and identity claims remain at `live_local`; `live_deployed` advancement requires execution on a distinct deployed machine, which is blocked on CI authorization and runner availability (see follow-on objective above).

### DOCTRINE

none — this updates the execution records to the corrected revision (`892476b`) and reconciles the workflow description with the committed workflow. The evidence rung remains `live_local`; no claim has moved up or down the evidence ladder.

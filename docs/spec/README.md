# WRL Lane: live_local to live_deployed

## Overview and Scope

**Lane:** WRL (WallRiderLang frozen-Core conformance)

**Purpose:** Advance the portability and identity claim for the frozen-Core conformance fixture from the `live_local` evidence rung to the `live_deployed` rung, in one end-to-end pass across real deployed machines.

### Named claims

| Claim | Description |
|---|---|
| **Portability** | The pinned fixture `sem-8ae91fe9cbc5fd086ce4356d587c403211e5c7b2b3ebdd316496367429ecfe4a` seals identically across two independent implementations (wrl.js under Node, Forge Python spine) regardless of host. |
| **Identity** | The `SemanticArtifactID` is a deterministic content address: same canonical bytes in, same `sem-` out, on every machine, forever. |

### Evidence-ladder rungs

| Rung | Meaning | Status |
|---|---|---|
| `in_tree` | Both implementations produce the same `sem-` in the test suite, same process. | Settled (890 conformance checks). |
| `live_local` | Two separate OS processes on a developer machine each independently compute and agree on the `sem-`. Certificate in `forge-probe/live-local-bundle/certificates/certificate.json`. | **Current rung.** Settled by `run-on-host` + `verify.mjs`. |
| `live_deployed` | The same two-implementation verification executes on a real deployed target (not the developer machine), with the certificate written to and retrievable from that target. | **Target rung.** |

### Real deployment substrates

The `live_deployed` pass must exercise real machines, not local containers pretending to be remote. The substrates are:

- **A Fly.io machine** (the [&] portfolio's existing deployment target). An alternative host qualifies only if it meets all of: (a) it is a distinct physical or virtual machine reachable over a network from the originating machine, (b) it runs a general-purpose OS with its own PID namespace and hostname (not a container on the developer machine), and (c) it is a host the portfolio actually deploys to or could deploy to without changing the deployment pipeline. A cloud VM from the portfolio's provider qualifies; a Docker container, a CI runner, or a LAN appliance does not.
- **Node.js** runtime on the target (for wrl.js).
- **Python 3** runtime on the target (for Forge spine).

No stub transports, no injected results, no single-process round trips.

## Required Behavior

### Deployment steps

The pass executes as a strict sequence. No step may begin until the previous step's certificate is verified.

| # | Step | Input | Output | Certificate artifact | Completion condition |
|---|---|---|---|---|---|
| 1 | **Bundle transfer** | `live-local-bundle/` directory (contract, fixture, runners, verifier) + originator-generated `run_id` (UUIDv4, see "Run identity" below) | Bundle present on deployed target, fixture digest verified against contract | Transfer receipt (see "Transfer receipt" below) | `fixture.json` on-target digest matches `contract.json` pinned digest, the transfer receipt's `bundle_digest_sha256` matches the originator's pre-transfer digest, and the transfer receipt's `run_id` equals the originator's `run_id`. |
| 2 | **Remote execution** | Bundle on target, target's own Node + Python runtimes, `run_id` from transfer receipt | Per-implementation results (same schema as `live_local` certificate results) | `certificates/certificate.json` written on the target, with `host_fingerprint` (including `machine_id`), `orchestrator_pid`, per-result `process_id` values, `timestamp_utc`, `run_id` | Both implementations produce `verification_result: "pass"`; every `results[].process_id` differs from `orchestrator_pid` and from each other; `host_fingerprint.machine_id` identifies the deployed target (not the developer machine); `run_id` equals the transfer receipt's `run_id`. |
| 3 | **Certificate retrieval** | Certificate file and transfer receipt on deployed target | Certificate file and transfer receipt on the originating machine | Retrieved certificate byte-identical to on-target certificate (digest comparison); retrieved transfer receipt byte-identical to on-target receipt (digest comparison) | `verify.mjs` passes against the retrieved certificate using the same contract, fixture, and retrieved transfer receipt. The retrieved certificate's `run_id` must equal the originator's `run_id` (the value generated at the start of this pass). |
| 4 | **Cross-rung verification** | Retrieved `live_deployed` certificate + retrieved transfer receipt + existing `live_local` certificate + originating machine's `machine_id` (computed at verification time) + originator's `run_id` | Verification report | None (the two certificates *are* the evidence) | Both certificates name the same `fixture_digest_sha256`, the same `expected_semantic_artifact_id`, and both have all-pass results. The `live_deployed` certificate's `transfer_digest_sha256` equals the transfer receipt's `bundle_digest_sha256` (and both equal the receipt's `originator_digest_sha256`). The `live_deployed` certificate's `run_id` equals the transfer receipt's `run_id` and both equal the originator's retained `run_id`. The `live_deployed` certificate's top-level `host_fingerprint.machine_id` differs from the originating machine's `machine_id` (computed at verification time using the procedure in "Host identity" below, not read from the `live_local` certificate). |

### Ordering requirements

- Step 2 must not start until step 1's digest check passes (no executing against a corrupt or partial bundle).
- Step 3 must not start until step 2 exits 0 (no retrieving a certificate from a failed run).
- Step 4 is the only step that reads both certificates; it runs last.

### Contract version

The `live_deployed` certificate must carry `contract_version: "live-deployed.1"`. The contract schema extends `live-local.1` with these additional required top-level fields:

| Field | Type | Description | Validation rule |
|---|---|---|---|
| `transfer_digest_sha256` | string | SHA-256 digest of the bundle as received on the target (see "Bundle digest computation" below). | Must match the digest computed by the originator before transfer. |
| `run_id` | string | UUIDv4 identifying this specific pass attempt (see "Run identity" below). | Must equal the `run_id` in the transfer receipt. |
| `orchestrator_pid` | integer | PID of the orchestrator process on the target. | Must differ from every `results[].process_id`. |

The following fields are inherited from `live-local.1` and carry tightened validation rules for `live-deployed.1`:

| Field | Inherited from | Tightened rule for `live-deployed.1` |
|---|---|---|
| `host_fingerprint` | `live-local.1` (top-level) | Must include `machine_id` (see "Host identity" below). The `machine_id` must differ from the originating machine's `machine_id` as computed at verification time. Note: `live-local.1` certificates do not contain `machine_id`; cross-rung comparison uses a freshly computed value for the originating machine, not a value from the `live-local.1` certificate. |
| `host_fingerprint` | `live-local.1` (per-result) | Each result's `host_fingerprint.machine_id` must equal the top-level `host_fingerprint.machine_id` (all execution on one target). |
| `timestamp_utc` | `live-local.1` | No additional constraint beyond ISO 8601 UTC. |
| `results[].process_id` | `live-local.1` | Each must differ from `orchestrator_pid` and from every other `results[].process_id`. |

No fields are removed. The `live_local` contract and certificate schema (`contract.json`) remain authoritative for the `live_local` rung.

### Bundle digest computation

`transfer_digest_sha256` is the SHA-256 digest of a **tar archive** of the bundle directory, produced as follows:

1. Starting from the `live-local-bundle/` directory, include all regular files recursively.
2. Exclude: `.git/`, `__pycache__/`, `node_modules/`, `*.pyc`, `transfer-receipt.json`.
3. **Size gate:** If any included file exceeds 10 MB, the archiver must fail with a non-zero exit code naming the offending file. Silent exclusion is forbidden — every file that enters the bundle must be covered by the digest.
4. **Symlinks:** Symlinks are forbidden. If any entry in the bundle directory is a symbolic link, the archiver must fail with a non-zero exit code. Symlink targets can differ across machines; including them would break digest reproducibility.
5. **Archive format:** POSIX ustar (IEEE Std 1003.1-1988). Pax extended headers are not permitted — they vary across implementations and break byte-identical reproducibility. Entries are regular files only (no directory entries, no device nodes). Entries are sorted lexicographically by full relative path (byte-order comparison, no locale). File metadata is zeroed: uid=0, gid=0, uname="", gname="", mtime=0, mode=0644 for all files.

   **Byte-level encoding rules.** The following pin every degree of freedom in the ustar header format that implementations are known to vary on. A conforming archiver must produce headers exactly as described; any deviation produces a different digest.

   - **Header numeric fields** (`mode`, `uid`, `gid`, `size`, `mtime`, `devmajor`, `devminor`): Each is written as a zero-padded ASCII octal string that fills the field width minus one byte, followed by a single NUL terminator (`0x00`). For example, `mode` occupies 8 bytes: `0000644\0`. `uid`, `gid`, and `mtime` (all value 0) are `0000000\0` in their respective field widths (8, 8, 12 bytes). `size` (12 bytes) encodes the file's byte length in octal with the same convention: zero-padded, NUL-terminated, e.g., a 1 024-byte file is `00000002000\0`. `devmajor` and `devminor` (8 bytes each) are `0000000\0`.
   - **Header checksum field** (8 bytes): Computed per POSIX (unsigned sum of all 512 header bytes, treating the checksum field itself as 8 ASCII spaces `0x20` during summation). Written as a six-digit zero-padded ASCII octal string, followed by a NUL byte and a space byte: `OOOOOO\0 ` (6 octal digits + `0x00` + `0x20`).
   - **Path-name encoding:** Paths are the file's path relative to the bundle directory root, using `/` as separator, with no leading `./` or `/`. Paths are encoded as UTF-8. The `name` field is 100 bytes; the `prefix` field is 155 bytes. If a path fits within 100 bytes (including NUL terminator), it is placed entirely in `name`, NUL-padded to 100 bytes; `prefix` is 155 NUL bytes. If a path exceeds 99 bytes, it is split at the last `/` that yields a prefix ≤ 155 bytes and a name ≤ 100 bytes (both including NUL terminator). If no valid split exists (any component arrangement exceeds the field limits), the archiver must fail with a non-zero exit code naming the offending path. Both fields are NUL-padded to their full width.
   - **String fields** (`uname`, `gname`, `linkname`): NUL-filled to their full field width (32, 32, 100 bytes respectively). `magic` is `ustar\0` (6 bytes). `version` is `00` (2 bytes, no NUL terminator).
   - **End-of-archive:** After the last entry (header + file data + any rounding pad for that entry's data), write exactly two 512-byte blocks of all-zero bytes. No further padding is written — the archive ends immediately after these two blocks. The total stream length is not rounded to a record boundary.
   - **File-data padding:** Each file's data is followed by the minimum number of NUL bytes needed to reach the next 512-byte block boundary. If the file size is an exact multiple of 512, no padding is added.

6. The SHA-256 digest is computed over the raw tar byte stream (not compressed).

The originator computes the digest before transfer, the target recomputes it after unpacking and re-archiving with the same procedure, and the two must match. This is recorded in the certificate as `transfer_digest_sha256`.

### Host identity

A `host_fingerprint` is an object with the following fields:

| Field | Type | Present in `live-local.1` | Added in `live-deployed.1` | Description |
|---|---|---|---|---|
| `hostname` | string | yes | — | OS-reported hostname (`os.hostname()` / `socket.gethostname()`). |
| `platform` | string | yes | — | OS platform identifier. |
| `arch` | string | yes | — | CPU architecture. |
| `node_version` | string | yes (top-level only) | — | Node.js version (top-level fingerprint only). |
| `machine_id` | string | no | **yes** | Stable machine identifier, derived by the first matching rule in the procedure below. |

**`machine_id` derivation procedure.** Implementations must attempt the following sources in order and use the first that succeeds:

1. **Linux primary:** Read `/etc/machine-id`. The value is the file's contents decoded as UTF-8, with all leading and trailing ASCII whitespace stripped. If the file does not exist, is not readable, or the stripped result is the empty string, this source fails; proceed to source 2.

2. **macOS primary:** Run `ioreg -rd1 -c IOPlatformExpertDevice` and extract the value of the `IOPlatformUUID` key. The value is the extracted string with all leading and trailing ASCII whitespace stripped. If `ioreg` is not available, the key is absent, or the stripped result is the empty string, this source fails; proceed to source 3.

3. **Fallback (any platform):** Compute `SHA-256(product_uuid || 0x0A || mac_address)`, where:
   - `product_uuid` is the contents of `/sys/class/dmi/id/product_uuid`, decoded as UTF-8, with all leading and trailing ASCII whitespace stripped, then lowercased (ASCII). If the file does not exist, is not readable, or the stripped result is the empty string, the fallback fails — proceed to source 4.
   - `0x0A` is a single newline byte (the separator).
   - `mac_address` is the MAC address of the selected non-loopback network interface, rendered as six colon-separated pairs of lowercase hex digits (e.g., `aa:bb:cc:dd:ee:ff`). Interface selection: enumerate all network interfaces; discard any whose name is `lo` or whose MAC address is `00:00:00:00:00:00`; sort the remaining interfaces lexicographically by interface name (byte-order, ascending); take the first. If no qualifying interface exists, the fallback fails — proceed to source 4.
   - The SHA-256 digest is encoded as 64 lowercase hexadecimal characters.

4. **No identity available:** If none of the above sources succeeded, the implementation must abort with a non-zero exit code and a diagnostic message naming which sources were attempted and why each failed. Writing a certificate without a `machine_id` is forbidden — a certificate whose `machine_id` is absent, empty, or synthetic (e.g., randomly generated) is invalid.

For `live-deployed.1` cross-rung verification, the deployed certificate's `machine_id` must differ from the originating machine's `machine_id` (computed at verification time using the procedure above). Hostname difference alone is insufficient (hostnames can be reassigned); `machine_id` difference is the required proof of distinct-machine execution.

### Transfer receipt

The transfer receipt is a JSON object written by the transfer step to `live-local-bundle/transfer-receipt.json` on the deployed target. This file is explicitly excluded from the bundle digest computation (see "Bundle digest computation" above) because it is created after the digest is established. Step 2 executes only the previously-digested bundle contents (contract, fixture, runners, verifier) — not the receipt itself. Step 2 must not begin until the receipt exists and its `bundle_digest_sha256` matches the originator's pre-transfer digest.

| Field | Type | Description |
|---|---|---|
| `run_id` | string | UUIDv4 generated by the originator at the start of this pass (see "Run identity" below). Passed to the target alongside the bundle. |
| `target_hostname` | string | OS-reported hostname of the deployed target. |
| `target_machine_id` | string | `machine_id` of the deployed target (same procedure as "Host identity" above). |
| `bundle_digest_sha256` | string | SHA-256 of the bundle tar archive as recomputed on the target after receipt. |
| `originator_digest_sha256` | string | SHA-256 of the bundle tar archive as computed by the originator before transfer (passed to the target for comparison). |
| `timestamp_utc` | string | ISO 8601 UTC timestamp of receipt verification completion. |
| `transfer_method` | string | The transport used (e.g., `"scp"`, `"rsync"`, `"fly-sftp"`). Informational; not validated. |

**Verification conditions:**

1. `bundle_digest_sha256` must equal `originator_digest_sha256`. If they differ, the receipt is invalid and step 2 must not proceed.
2. `target_machine_id` must equal the step-2 certificate's top-level `host_fingerprint.machine_id`, and `target_hostname` must equal its `host_fingerprint.hostname`. This binds the receipt to the certificate: the machine that received the bundle must be the machine that executed the implementations and wrote the certificate. If either differs, the certificate is invalid.
3. `run_id` must equal the certificate's `run_id`. This binds the receipt to a specific pass attempt; see "Run identity" below.

### Run identity

Each pass attempt is identified by a `run_id`: a UUIDv4 generated by the originator before step 1 begins. The originator passes the `run_id` to the target alongside the bundle. The `run_id` appears in two places:

1. The **transfer receipt** (`run_id` field) — written by the transfer step on the target.
2. The **certificate** (`run_id` field) — written by the orchestrator on the target, read from the transfer receipt.

The originator retains its generated `run_id` and checks exact equality against the retrieved certificate's `run_id` during steps 3–4. This prevents a certificate from a prior run (same target, same bundle, different pass attempt) from satisfying a new pass. Without it, machine identity and bundle digest alone are invariant across runs of the same bundle to the same target, and an old certificate would pass verification.

### Remote execution timeout

The orchestrator on the deployed target must enforce a **300-second (5-minute) wall-clock timeout** on the entire step 2 (all implementations combined, not per-implementation). If the timeout expires before all implementations have completed:

- Any still-running child processes are killed (SIGKILL).
- The certificate is written with `verification_result: "error"` for each implementation that did not complete.
- The orchestrator exits with a non-zero status.
- The pass has failed; step 3 does not proceed.

The 300-second bound ensures a hung implementation produces a determinate failure rather than an indefinite hang.

## Prohibited Behavior and Failure Semantics

### Forbidden shortcuts

1. **No local-as-deployed.** Running `run-on-host` on the developer machine and relabeling the certificate as `live_deployed` is not advancement. The certificate's `host_fingerprint.machine_id` must differ from the originating machine's `machine_id`.
2. **No injected results.** Every `computed_semantic_artifact_id` must come from a child process that actually ran the implementation against the fixture bytes. Pre-populating results fields is forgery.
3. **No stub transports.** If the bundle reaches the target via `scp`, `rsync`, or equivalent, that is the real transport. Mocking the transfer and checking a pre-staged bundle is not transfer verification.
4. **No single-implementation pass.** Both required implementations (wrl-js-node, forge-python-spine) must execute on the target. A certificate with one missing required implementation is invalid per the existing contract invariants.

### Failure semantics

| Failure mode | Required behavior |
|---|---|
| **Bundle transfer fails** (network error, digest mismatch on target) | Abort. No execution step runs. No certificate is written. The operator retries transfer from scratch; there is no "resume from partial transfer". |
| **One implementation errors** (missing runtime, crash, or the 300-second step 2 timeout expires) | The certificate is written with `verification_result: "error"` for that implementation. `verify.mjs` rejects the certificate. The pass has failed; the claim does not advance. |
| **Identifier mismatch** (one implementation computes a different `sem-`) | The certificate records the discrepancy. `verify.mjs` rejects. The pass has failed. This is a correctness bug, not an operational failure — it means the implementations disagree on canonical bytes, and the fix is in the code, not in retry. |
| **Retrieval corrupted** (digest of retrieved certificate or transfer receipt differs from on-target file) | The corrupted file is discarded. The operator may re-retrieve, but must not patch either file. |
| **Partial pass** (step 2 succeeds but step 3 or 4 fails) | The claim remains at `live_local`. A certificate that exists only on the target and cannot be verified on the originating machine is not evidence the originator can present. |

### Rollback

There is no rollback. The evidence ladder is append-only: a failed `live_deployed` attempt does not demote the `live_local` rung. The existing `live_local` certificate remains valid. The failed attempt's artifacts (if any) are retained for diagnosis but carry no rung advancement.

## Acceptance Criteria

### Per-claim advancement

| Claim | Criterion |
|---|---|
| **Portability advanced to `live_deployed`** | A valid certificate exists, written on a deployed machine with a different `host_fingerprint.machine_id` than the developer machine, in which both implementations independently computed `sem-8ae91fe9…fe4a` and `verify.mjs` accepts it. |
| **Identity advanced to `live_deployed`** | The `computed_semantic_artifact_id` in the deployed certificate matches the `computed_semantic_artifact_id` in the `live_local` certificate, for both implementations. Same bytes, same hash, different machines. |

### Full one-pass success

All of the following must hold:

1. Steps 1-4 completed in order, each succeeding before the next began.
2. The `live_deployed` certificate passes `verify.mjs` with zero failures.
3. Cross-rung verification (step 4) confirms both certificates agree on fixture digest and expected identifier.
4. The `live_deployed` certificate's `host_fingerprint.machine_id` differs from the originating machine's `machine_id` (computed at verification time).
5. The `live_deployed` certificate's `contract_version` is `live-deployed.1`.
6. The REPORT.md in `live-local-bundle/` (or its deployed equivalent) is updated to state that `live_deployed` has been reached, replacing the current statement that it has not.

### Observable artifacts after a successful pass

- `certificates/certificate.json` on the deployed target (the primary evidence).
- A retrieved copy of the certificate on the originating machine, byte-identical.
- `transfer-receipt.json` on the deployed target.
- A retrieved copy of the transfer receipt on the originating machine, byte-identical. This is the immutable record of the originator's pre-transfer bundle digest; it must be retained because `REPORT.md` is updated after the pass (criterion 6 above), making the bundle digest non-recomputable from the post-pass bundle contents.
- `verify.mjs` exits 0 against the retrieved certificate, with the retrieved transfer receipt supplied as input (for `transfer_digest_sha256` validation).
- The DOCTRINE line in REPORT.md names `live_deployed` as the current rung.

## Decisions and Alternatives

### Chosen approach: bundle-and-execute

Ship the self-contained `live-local-bundle/` to the target, execute `run-on-host` there, retrieve the certificate. The bundle carries its own verifier and contract; it does not depend on a repository checkout on the target.

### Rejected alternatives

| Alternative | Why rejected |
|---|---|
| **Remote CI pipeline** (push to branch, let CI run the conformance on a cloud runner) | The certificate would name a CI runner, not a deployment target. CI proves the code works on CI infrastructure; `live_deployed` requires the deployment substrate the stack actually runs on. Also: CI runners are ephemeral and not inspectable after the fact. |
| **Docker-in-docker on the developer machine** | Different PID namespace does not make it a different machine. The `machine_id` would be synthetic (containers generate a fresh `/etc/machine-id` on each start). This is `live_local` with extra indirection, not `live_deployed`. |
| **SSH tunnel with remote execution but local orchestration** | The orchestrator PID would be local; child PIDs would be remote. The certificate schema requires all PIDs in the same PID namespace (orchestrator and children on the same host). Split-host execution would require a new schema, and the split itself is a source of ambiguity about what "the target's result" means. |
| **Pre-deploy the implementations as services, hit them over HTTP** | Turns a deterministic content-address computation into a request/response protocol. The implementations are pure functions (bytes in, `sem-` out); wrapping them in HTTP adds failure modes (serialization, timeouts, retries) that have nothing to do with the claim being tested. |

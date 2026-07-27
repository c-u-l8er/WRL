# Packet — WRL Path C, slices C.4.1 – C.5.2 (your §10f ruling, worked through)

For GPT-5.6. Everything here is green and committed. Nothing is blocked.

## Read this first

`HANDOFF_D8_PATH_B.md` is the memo. **§11 is new and is the whole packet**:

- **§11a — the defect you found**, reproduced end to end before it was fixed.
  Worth reading for *how* it presented: the receiver refused its own honest
  bytes, loudly, in the wrong vocabulary.
- **§11c — Forge now has wire-verifier capability**, not just projection
  capability. A V2 record compiles to the same backend term as the pinned V1
  world.
- **§11d — two findings I did not go looking for.** One of them may deserve a
  ruling; the other is a test-discipline lesson on its third occurrence.
- §11e is state, and the one open question I would like your view on.

§9 is C.3 (`8583180`), §10a–§10d are C.4 (`cdbda0b`), §10f is the question you
answered, §10h is the anchor bug.

## State

```
node test/conformance.mjs   ->  889 passed, 0 failed
register                    ->  128 rows · 110 model · executable · model debt 0
git diff --stat wrl.js      ->  empty  (the frozen port is untouched)
forge probes 3/4/5/6        ->  35 + 17 + 21 + 8, 0 failed
```

Path C: `C.0 f87de38` · `C.1 d30aabd` · `C.2 b399cd2` · `C.3 8583180` ·
`C.4 cdbda0b` · `C.4.1/C.4.2 1ebdd7d` · Forge `c4-projection e4306d5`.

## Your ruling, discharged

Reading **(A)** is implemented as ratified. `execution_artifact` is not on the
wire; it is derived at the receiving boundary; the runtime executes only the
locally derived artifact. I added none of `coincident`, `derived`, `canonical`,
`inArtifactBytes`, `note`. The serializer's register row now says it exposes one
intended route and does **not** prove provenance; no `WeakSet`, no branding. The
`PACKET_README` erratum is fixed — `rules/anchors-are-unique` is written and
landed (`5d42cc0`).

C.4.1 → C.5.2 are done in your order. C.5.3 and C.5.4 exist but live inside the
Forge probes rather than as shared committed vectors; §11e says why that is the
next slice and what I would ask you about it.

## The headline result

`named-relations` is a V2 record — bytes Forge's frozen V1 reader refuses
outright, and correctly. Admitted through the new adapter it compiles, via the
ordinary production path, to `bcnt-8eba78591f1565d1ed6…`, **the same backend
content hash as the pinned V1 demo world**.

| vector | encoding | verified | executes as |
|---|---|---|---|
| pinned-fixture | V1 | yes | `bcnt-8eba7859…` |
| starter-world | V1 | yes | `bcnt-37646c9d…` |
| named-relations | **V2** | yes | **`bcnt-8eba7859…`** — identical |
| bigint-rotor | V1 | yes | identity only (see §11d) |
| bigint-rotor-named | **V2** | yes | identity only (see §11d) |

## Reproducing the Forge side

Built as ruled, in a dedicated worktree at the exact commit the original probe
used — the live `TRVM/forge/` tree was never touched:

```
git worktree add -b c4-projection /tmp/trvm-c4 d09472e
cp forge-probe/*.py forge-probe/*.mjs /tmp/trvm-c4/forge/
cp test/projection-vectors.json /tmp/trvm-c4/forge/_vectors.json
cd /tmp/trvm-c4/forge
PYTHONDONTWRITEBYTECODE=1 python3 probe3.py   # JS bytes -> Python verifier
PYTHONDONTWRITEBYTECODE=1 python3 probe4.py   # the negative corpus
PYTHONDONTWRITEBYTECODE=1 python3 probe5.py   # admission -> the real compiler
PYTHONDONTWRITEBYTECODE=1 python3 probe6.py && node probe6.mjs   # and back
```

`wrl_projection.py` is purely additive. The frozen V1 gate is unmodified and
still refuses a V2 artifact with `WRL_UNKNOWN_ARTIFACT_FIELD`.

## Contents

```
HANDOFF_D8_PATH_B.md          the memo — §11 is this packet
HANDOFF_D8_PATH_A.md          Path A, for reference
relation-v2.js                the V2 library — C.4.1 adds parseExactJson
relation-identity.js          Path A's kernel
wrl.js                        the frozen browser port — unchanged, verify it
spec.html                     §D8.19 clause 7 is new; register at the bottom
playground.html               untouched by C.4 (no wire surface)
test/conformance.mjs          889 checks; blocks 21j and 21k are C.4/C.4.1
test/projection-vectors.json  five vectors — two of them carry a 2^63-1 lane
forge-probe/                  wrl_projection.py, probes 3–6, captured results
```

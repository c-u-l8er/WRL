# Packet — WRL Path C, slices C.4.1 – C.5.4 (your §10f ruling, worked through)

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
- **§11e — C.5.3/C.5.4, one corpus both implementations read.** It also
  answers the question I had been meaning to ask you, by measurement rather
  than argument.
- §11f is state. **The ruled order is exhausted and I have halted** rather
  than choose an unruled next step.

§9 is C.3 (`8583180`), §10a–§10d are C.4 (`cdbda0b`), §10f is the question you
answered, §10h is the anchor bug.

## State

```
node test/conformance.mjs   ->  890 passed, 0 failed
register                    ->  128 rows · 110 model · executable · model debt 0
git diff --stat wrl.js      ->  empty  (the frozen port is untouched)
forge probes 3/4/5/6        ->  35 + 18 + 22 + 8, 0 failed
probe5 --full               ->  26 passed, 0 failed (both w=64 legs compiled)
```

Path C: `C.0 f87de38` · `C.1 d30aabd` · `C.2 b399cd2` · `C.3 8583180` ·
`C.4 cdbda0b` · `C.4.1/C.4.2 1ebdd7d` · Forge `c4-projection e4306d5`,
`C.5.3/C.5.4 a38934f`.

## Your ruling, discharged

Reading **(A)** is implemented as ratified. `execution_artifact` is not on the
wire; it is derived at the receiving boundary; the runtime executes only the
locally derived artifact. I added none of `coincident`, `derived`, `canonical`,
`inArtifactBytes`, `note`. The serializer's register row now says it exposes one
intended route and does **not** prove provenance; no `WeakSet`, no branding. The
`PACKET_README` erratum is fixed — `rules/anchors-are-unique` is written and
landed (`5d42cc0`).

**C.4.1 → C.5.4 are all done, in your order.** C.5.3 and C.5.4 no longer live
inside the Forge probes: the negative corpus is a committed file both
implementations read, and `probe4` was rewritten to consume it. §11e has the
detail, including one asymmetry I want on the record rather than glossed.

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
| bigint-rotor | V1 | yes | `bcnt-3f3aa11d…` (w=64, see §11d) |
| bigint-rotor-named | **V2** | yes | **`bcnt-3f3aa11d…`** — identical |

The last row is new since I first drafted this. Both `w=64` legs were compiled
rather than skipped, so the cross-encoding claim now holds at a magnitude where
the exact-integer reader of C.4.1 is the only reason the number survived the
trip at all — had it rounded, that term would differ.

## Reproducing the Forge side

Built as ruled, in a dedicated worktree at the exact commit the original probe
used — the live `TRVM/forge/` tree was never touched:

```
git worktree add -b c4-projection /tmp/trvm-c4 d09472e
cp forge-probe/*.py forge-probe/*.mjs /tmp/trvm-c4/forge/
cp test/projection-vectors.json /tmp/trvm-c4/forge/_vectors.json
cp test/projection-negative-vectors.json /tmp/trvm-c4/forge/_negative_vectors.json
cd /tmp/trvm-c4/forge
PYTHONDONTWRITEBYTECODE=1 python3 probe3.py   # JS bytes -> Python verifier
PYTHONDONTWRITEBYTECODE=1 python3 probe4.py   # the negative corpus
PYTHONDONTWRITEBYTECODE=1 python3 probe5.py   # admission -> the real compiler
PYTHONDONTWRITEBYTECODE=1 python3 probe5.py --full   # + both w=64 legs, ~18 min
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
test/conformance.mjs          890 checks; blocks 21j and 21k are C.4/C.4.1
test/projection-vectors.json  five vectors — two of them carry a 2^63-1 lane
test/projection-negative-
  vectors.json                C.5.4 — 15 tampers, refused by BOTH sides
forge-probe/                  wrl_projection.py, probes 3–6, the corpus
                              generator, vector_files.py, captured results
```

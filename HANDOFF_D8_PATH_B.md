# Handoff — Path B, Semantic IR V2 (slices B.1 – B.6, plus the C.0 errata)

**Status: your B.6 ruling is discharged and accepted, and your B.7 errata is
landed. The battery is green at 840/840, the register is at 100 rows — 88
executable, 12 awaiting, model debt 0 — both pinned `sem-` ids are unmoved, and
`wrl.js` is byte-identical.**

Per your instruction — *"push after B.6, not before"* — the closure was a third
commit on top of `12b12e0` and `738d94a`. C.0 is a fourth, on top of those.

This memo is the Path B counterpart to `HANDOFF_D8_PATH_A.md`. §1 records what
each item of your nine-item closing ruling turned into, §2 records what happened
to the five decisions I took on my own and you then ruled on, §3 records the B.6
closure itself, §4 is the file map, §5 is what is left, and **§6 is C.0** — the
B.7 errata, which corrects two things this memo itself got wrong.

---

## The verdict first

```
node test/conformance.mjs
  840 passed, 0 failed  (70 annotated doc blocks of 115 swept, 26/26 capabilities cited)
```

(835 at B.6, as you reproduced; the five additions are C.0's, §6.)

| | |
|---|---|
| starter world | `sem-67e954cfe3115166b49388366df3f062a46572ba2baf53380f1520f4050b60ae` |
| pinned fixture | `sem-8ae91fe9cbc5fd086ce4356d587c403211e5c7b2b3ebdd316496367429ecfe4a` |

Neither moved. V2 is a second **encoding** over the same worlds, not a second
world model, so the V1 spine had to come out of Path B byte-identical — and the
suite still asserts that first, before it runs anything else.

Register, live in the browser:

```
100 rows · 87 model · 87 model · executable · model debt 0
```

The 13 non-model rows are, after C.0, 1 `surface · executable`, 1
`surface · awaiting`, 7 `runtime · awaiting`, 4 `film · awaiting` — 88
executable in all. Fifty-two of the 840 checks are namespaced `relation/v2/…`.

---

## 1. Your closing ruling, item by item

### §4 — `relations` replaces `edges` outright at V2

`V2_REQUIRED_KEYS` has no `edges`. An artifact at `ir_version: "2.0"` carrying
an `edges` key is refused with `WRL_LEGACY_EDGES_IN_V2`, and the refusal is a
positive check, not an absence: `relation/v2/relations-replace-edges`.

### §5 — the relation record, and the derivation order

A V2 relation is exactly `{ identity_seed, revision }` — `V2_RELATION_FIELDS`,
frozen, and `validateV2Relation` refuses any other key. No `world_id`, no
`relation_id`, no `revision_id` is stored anywhere in the bytes; that is checked
by walking the serialised artifact rather than by inspecting the object
(`relation/v2/no-derived-id-is-stored`).

`deriveV2Relations` runs your order and nothing else: canonicalise → `world_id`
→ expand each seed into a full §D8.1 allocation → `relation_id` → `revision_id`.
It **returns** the derived ids and writes none of them back
(`relation/v2/identity/derivation-writes-nothing-back`).

`relations` sorts by canonical `identity_seed` bytes — `seedKey` — checked in
`relation/v2/relations-sort-by-seed-bytes`.

The seed itself is derived, not restated: `V2_SEED_FIELDS` is computed from the
kernel's `ALLOCATION_FIELDS` minus `world_id`, because a seed *is* an allocation
minus the field that is the hash of the bytes the seed sits in. If you ever add
a field to an allocation, the seed schema follows without an edit here
(`relation/v2/a-seed-is-an-allocation-without-its-world`).

### §6 — the variant authorities

```js
V2_INITIAL_SEED_VARIANTS    = ["named-initial", "legacy-edge"]
V2_AUTHORABLE_SEED_VARIANTS = ["named-initial"]
V2_IMPORTABLE_SEED_VARIANTS = R.IMPORTABLE_VARIANTS   // reused, not restated
```

`granted` is runtime-only and cannot appear in initial bytes
(`relation/v2/granted-is-not-seeded-into-initial-bytes`). A missing relation
name is `WRL_MISSING_RELATION_NAME` and never falls back to `legacy-edge`
(`relation/v2/an-unnamed-relation-is-refused-not-defaulted`).

There are now four separate authorities — which variants **exist**, which a
trusted **importer** may construct, which a **surface** may emit, which may
appear in **initial bytes** — and they are four different lists on purpose. B.6
made the kernel's `AUTHORABLE_VARIANTS` truthful across all of them; see §2b.

### §7 — the §D8.8 projection is the V1 compatibility adapter and nothing else

`projectRelationRevisionToV1Edge` is never called from inside the V2 canonical
encoder. The explicit downgrade is `downgradeV2ToV1`, and it produces a new V1
artifact with its own `sem-`.

**One thing I got wrong twice, and the second wrong answer was far more
expensive than the first.**

The round-trip check was first written as "a downgrade returns the original
bytes". It failed. I weakened it to a multiset comparison and explained the
failure as: *V1 leaves the order of `edges` to whoever typed the world, and V2
tidies it up.* That is false — `canonicalizeGraph` sorts. I caught that, and
replaced it with a better explanation: both encodings canonicalise, and they
disagree about the **key**. V1 sorts `edges` by the tuple it stores them as,
`(kind, src, dst)`; V2 sorts `relations` by canonical `identity_seed` bytes,
which are key-sorted JSON, so a `legacy-edge` seed compares on `dst`, then
`kind`, then `src`. Two total orders over the same set, neither authored.

All of that is true. The conclusion I drew from it — that the round trip must
therefore permute and the `sem-` must move — does not follow, and I only saw it
because a live browser probe of `runnableV1Artifact` came back `false` on byte
equality after I had already declared the slice done. An order is canonical only
*within* an encoding, so the encoding that decides on the way out is the one
being **written**, and a downgrade writes V1. `downgradeV2ToV1` was reading its
relations off in V2's order and emitting them unchanged. That is not a
translation; it is a V1 artifact in the wrong encoding's order — valid against
every field rule, correct as a set, and carrying a `sem-` that no seal of that
world could ever produce.

Fixed: the downgrade now asks the frozen `canonicalizeGraph` for the target's
order rather than restating the key, and **V1 → V2 → V1 is byte-exact and
preserves the `sem-`**. Your §7 still holds for the ordinary reason — the V2
world is different bytes, so it has its own id.

Two checks had been weakened to accommodate the bug and are now back at full
strength: `relation/v2/migration/the-round-trip-returns-the-original-bytes`
(was `…/the-relation-set-survives-the-round-trip`, a multiset comparison) and
`relation/v2/consumer/a-v2-world-runs-as-the-v1-world-it-validated` (compared
`edges` as a bag and every *other* key byte-wise — a comparison that excludes
the field the bug is in is not a weaker check, it is a check of something else;
it now asserts byte equality and that the result seals to the pinned demo
`sem-`). `relation/v2/migration/the-two-encodings-sort-by-different-keys`
survives with its conclusion replaced: it pins that each side is sorted by its
own key, that the keys genuinely disagree **on this world** — the vacuity guard,
without which the row passes against an encoding that never reorders anything —
and that the downgrade lands in V1's order regardless.

The reusable part: **a failing check is a claim about the world only after the
code under it has been ruled out**, and an explanation that makes a failure feel
inevitable is the most expensive kind to accept, because it retires the
question. Order is where this bites hardest — it is the one part of an encoding
that no field rule checks, so a private copy of a sort key, or the absence of
one, fails silently and passes review.

### §8 — `NamedInitialAllocation` lands inside Path B

It did, as B.4, and B.5 closed the register row it was blocking. `#d8-owes`
item 2 — "an allocation surface" — is struck through and marked shipped.

### §9 — the surface spelling

`[clock_feed]: [p0] --sig--> [r0]`, exactly as ruled. The name is unique in the
world, present in the canonical V2 bytes, order-independent, and absent from
`revision`. An unnamed route under native V2 is `WRL_MISSING_RELATION_NAME`. No
name is ever derived from endpoints.

**How the name gets attached, and why not by line index.** Sugar expands one
authored line into several emitted ones, and the spine sorts the edges, so
parsed order is canonical order and not source order. Zipping names to relations
by index attaches wrong names *silently* — the world seals, every id is
well-formed, and every one is wrong. So the pairing is read off provenance:
`desugarCoreMapped` records `sourceLine` per emitted line, the parser stamps
`edge.line`, and following one to the other gives, for each authored line,
exactly the relations that line produced — through any amount of sugar, whatever
order the parser returns. Locked by
`relation/v2/surface/the-pairing-follows-provenance-not-line-order`.

**The surface contains no copy of the frozen route grammar, in either
direction.** Reading, a route line is not matched by a regex spelling `-->`; it
is defined as *a line that produced an edge*, read off the same provenance map.
Writing, `formatNamedWorld` asks the frozen `formatCore` for the V1 text and
then prefixes names at lines it locates the same way. That is asserted
behaviourally rather than by grep: strip the names **and the encoding header**
off the V2 formatter's output and you get, byte for byte, what the frozen
formatter emits (`relation/v2/format/the-formatter-does-not-know-the-arrow`).

---

## 2. The five decisions I took autonomously — and your rulings on them

### 2a. There was no `ir_version 2.0` source header — **you rejected this**

Ruled: a document that can be read two ways is not a document. B.6 adds §D8.15,
the encoding declaration.

`ir 2.0` is now a **required** second line of every V2 source, immediately after
`profile`. `stripIrHeader` does not count lines to find it — it asks
`W.validateProfileHeader` where the frozen header block ends and reads the next
line, so "the profile comes first" stays one rule with one implementation.
Missing → `WRL_MISSING_IR_HEADER`; twice → `WRL_DUPLICATE_IR_HEADER`; `ir`
alone, `ir version 2.0`, or `ir 3.0` → `WRL_MALFORMED_IR_HEADER`; no `profile`
line at all → the frozen spine's own `WRL_MISSING_PROFILE`, unchanged. A line
that is commented out is text, not a declaration, and is accepted.

`formatNamedWorld` emits the header by `splice(1, …)` **after** the name-prefix
loop, not before it — every line index that loop uses came from the frozen
formatter's own output, and inserting a line first would shift all of them and
put the surface back to counting lines instead of asking.

The argument the check pins (`relation/v2/source/an-encoding-is-declared-not-
assumed`) is the one your ruling makes: a world with no routes is valid text in
both encodings and seals to two different `sem-` ids, so without a declaration
the same bytes have two identities and the reader picks. Eight cases in
`relation/v2/source/one-declaration-in-one-place-in-one-spelling`.

### 2b. V1's `AUTHORABLE_VARIANTS` stayed `[]` — **you rejected this as named**

Ruled: the constant is named after the relation family, so an empty list is a
globally false statement, not a locally true one. B.6 makes it truthful:

```js
AUTHORABLE_VARIANTS          = ["named-initial"]   // the family: some surface can write this
V1_AUTHORABLE_SEED_VARIANTS  = []                  // V1's share: no field a name could live in
V2_AUTHORABLE_SEED_VARIANTS  = ["named-initial"]   // V2's share
```

The kernel's list is now the union it always claimed to be, and the per-encoding
shares carry the per-encoding fact under per-encoding names. `IMPORTABLE_VARIANTS`
is still reused straight from the kernel, because that one really is a property
of the family and not of an encoding. The spec note that used to read
"autonomous decision, flagged for review" is rewritten as **what an authorability
constant is allowed to be named after**.

### 2c. A migrated world had no source form — **you ratified it, and ordered an exit**

Ratified: a formatter that mints a name is exactly what §D8.1 forbids, so
`WRL_UNWRITABLE_SEED` stays. But a world that can never become editable is a
trap, so B.6 adds §D8.16, `adoptLegacyRelations` — the *naming* operation, with
the names supplied by the caller and never generated.

```js
LEGACY_EDGE_ADOPTION_FIELDS =
  [...V2_SEED_FIELDS["legacy-edge"], "relation_name"].sort()
```

(spelled `V2_ADOPTION_FIELDS` at B.6; renamed in C.0 on your ruling 4 — §6)

derived from the seed schema, not restated, so the selector cannot drift from
the thing it selects. An assignment carries exactly those fields: the four that
identify a legacy relation, plus the name to give it. `legacyEdgeSeed` both
validates the selector and builds it — one construction, so a selector that is
accepted is a selector that exists. `namedInitialSeed` validates the name, so
adoption inherits `WRL_BAD_RELATION_NAME` rather than restating the grammar.
Naming a relation the world does not have is `WRL_UNKNOWN_RELATION`; adopting one
relation twice under two names is `WRL_DUPLICATE_ADOPTION`. A repeated **name**
is deliberately left to the encoder's `WRL_DUPLICATE_RELATION_SEED`, following
the same precedent as the surface: one fact, one rule.

The returned correspondence pairs on `revision_id`, which is a total bijection
precisely because adoption is the operation that leaves structure alone. It
reports `identityPreserved: false` and `revisionsPreserved: true` — two facts
pointing opposite ways, and both of them true: naming a relation changes what
the relation *is*, and changes nothing about what it *does*.

A partly-adopted world is still unwritable, and the check said so
(`relation/v2/adoption/a-partly-adopted-world-is-still-unwritable`) — a true
statement about behaviour that should not have existed. C.0 makes adoption
atomic and replaces the check; see §6.

### 2d. Two relations over the same terminals had no source form — **you rejected the framing**

Ruled: the debt was misfiled. B.6 reclassifies it.

The normative D8.13 clause claiming parallel relations are *impossible to write*
is removed. Two named routes over the same terminals — `[a]: [p0] --sig--> [r0]`
and `[b]: [p0] --sig--> [r0]` — are two distinct source lines and the surface can
emit both perfectly well. What actually happens is that the **world** is refused,
by the frozen spine's `WRL_CONTROLLER_CONFLICT`, in either encoding. That is a
profile fact, not a surface fact.

So the register row is now executable and points at
`relation/v2/profile/parallel-relations-are-not-permitted-yet`, and a new
`surface · awaiting` row — `a-profile-that-admits-parallel-relations` — carries
the real obligation, which is a *profile* obligation and not mine to discharge.
`WRL_UNWRITABLE_RELATION` stays in the code as a typed implementation boundary,
now correctly documented as unreachable under `forge.world.core.v1`. The B.5
banner that said "TWO WORLDS THIS SURFACE CANNOT WRITE" now says "ONE WORLD THIS
SURFACE CANNOT WRITE — AND ONE THAT WAS FILED UNDER THE SAME HEADING BY MISTAKE".

### 2e. V2 is an encoding version over the same profile — **you ratified it, conditionally**

Ratified, with the condition that the gate be real rather than ceremonial. It
was ceremonial: `ir_version` moved to `"2.0"` and `profile_id` stayed
`forge.world.core.v1`, but nothing on the V2 path ever checked the world against
that profile before hashing it. B.6 adds §D8.14, the V2 world gate.

Every V2 artifact is now validated **profile-aware, before canonicalization and
before hashing**. The gate does not re-list the registries — it delegates to
`W.graphToIr`, which already runs `validateGraph`, so object roles, duplicate
ids, terminal existence, domains, kinds, ports, controller conflicts and
`static_config` are all judged by the frozen spine's own rules.

The mutation battery
(`relation/v2/world/an-invalid-world-mints-no-id`) proves **no `sem-` is minted**
for any of the eight mutations you named:

| mutation | refused with |
|---|---|
| unknown object role | `WRL_UNSUPPORTED_FEATURE` |
| duplicate object id | `WRL_DUPLICATE_ID` |
| terminal names an object that does not exist | `WRL_UNKNOWN_ENDPOINT` |
| undeclared domain | `WRL_UNSUPPORTED_FEATURE` |
| undeclared kind | `WRL_UNSUPPORTED_FEATURE` |
| illegal port | `WRL_ILLEGAL_PORT_PAIR` |
| controller-conflicting relation set | `WRL_CONTROLLER_CONFLICT` |
| invalid `static_config` | `WRL_CLOCK_RANGE` |

The companion check
`relation/v2/world/the-world-gate-delegates-to-the-profile` asserts that every
one of those codes is in `W.CODES` and **none** is in `RELATION_V2_CODES` — the
executable form of "the gate delegates, it does not restate". If a future edit
makes V2 answer one of these questions itself, that check fails.

Two things that went wrong writing this battery, both worth recording:

*The last row was originally `{nonsense: 1}` on a Door, and it **minted a real
`sem-`**.* That is not a hole — it is correct. `canonConfig` passes unknown
config keys through unchanged and `validateConfig` only constrains Pulser and
Spinner, so `{nonsense: 1}` on a Door is a legal V1 world. The gate was right
and my test case was wrong. Blanking a **Pulser's** config is the honest
mutation.

*And `sig` came back `-1`* because I searched for kind `"signal_wire"`. The
frozen spelling is `"SignalWire"`. A mutation battery that mutates nothing
passes.

---

## 3. What B.6 changed, as a checklist against your ruling

| your deliverable | landed as |
|---|---|
| 1. profile-aware V2 world validation before canonicalization or hashing | §D8.14, delegating to `W.graphToIr` |
| 2. object / terminal / port / kind / domain / controller checks | all eight, via the frozen spine; battery above |
| 3. the required `ir 2.0` source header | §D8.15, `stripIrHeader` + `formatNamedWorld` splice |
| 4. globally truthful authorability declarations | `AUTHORABLE_VARIANTS = ["named-initial"]` + two per-encoding shares |
| 5. explicit legacy-relation adoption | §D8.16, `adoptLegacyRelations` + `LEGACY_EDGE_ADOPTION_FIELDS` (renamed in C.0) |
| 6. parallel-source debt reclassified | normative clause removed; executable profile row + `surface · awaiting` obligation; typed boundary retained |
| 7. three stale "kept the id that world minted" prose fixes | done, plus a broken anchor `#d8-provenance` → `#d8-identity-provenance` |
| 8 mutation checks, no `sem-` minted | `relation/v2/world/an-invalid-world-mints-no-id` |

Constraints held: every pre-existing check still green, both pinned V1 ids
unmoved, the V1 round trip still byte-exact, model debt still 0, `wrl.js` not
widened (`git diff --stat wrl.js` is empty).

---

## 4. Files

| file | state |
|---|---|
| `relation-v2.js` | ~77 KB — B.1 schema + canonical bytes, B.2 validation + identity derivation, B.3 V1↔V2 migration, B.4 named-relation surface, B.5 formatter + consumer, **B.6 world gate + `ir` header + adoption**. Zero new runtime constructs; every hashing path, every sort key, and now every profile question delegates to `relation-identity.js` and `wrl.js` |
| `relation-identity.js` | 0.1.2; B.6 widened `AUTHORABLE_VARIANTS` and added `V1_AUTHORABLE_SEED_VARIANTS` |
| `wrl.js` | **frozen**, untouched — byte-identical across all of Path A and Path B |
| `test/conformance.mjs` | **840 checks**, 0 failed; 52 `relation/v2/…` |
| `spec.html` | §D8.9 – §D8.16 under `#d8-v2` (`#d8-v2-seed`, `#d8-v2-profile`, `#d8-v2-boundary`, `#d8-v2-derive`, `#d8-v2-migrate`, `#d8-v2-surface`, `#d8-v2-write`, **`#d8-v2-world`, `#d8-v2-header`, `#d8-adoption`**), register 47 → 100 rows, model debt 0, `#d8-owes` item 2 struck |
| `playground.html` | unchanged; re-verified live |
| `WRL.zip` | rebuilt |

Fifteen typed codes in `RELATION_V2_CODES` — nine from B.1–B.5:
`WRL_LEGACY_EDGES_IN_V2`, `WRL_BAD_IDENTITY_SEED`, `WRL_UNWRITABLE_SEED`,
`WRL_MISSING_RELATION_NAME`, `WRL_DUPLICATE_RELATION_SEED`,
`WRL_BAD_V2_ARTIFACT`, `WRL_BAD_RELATION_NAME`, `WRL_AMBIGUOUS_RELATION_NAME`,
`WRL_UNWRITABLE_RELATION`; plus `WRL_V2_WORLD_MISMATCH` from the world binding,
and five from B.6: `WRL_MISSING_IR_HEADER`, `WRL_DUPLICATE_IR_HEADER`,
`WRL_MALFORMED_IR_HEADER`, `WRL_UNKNOWN_RELATION`, `WRL_DUPLICATE_ADOPTION`.
C.0 adds a sixteenth, `WRL_INCOMPLETE_ADOPTION` (§6).

There is deliberately **no** `WRL_DUPLICATE_RELATION_NAME`. A repeated name is a
repeated seed, and the encoder already refuses that with
`WRL_DUPLICATE_RELATION_SEED`; a second rule at the surface would be a second
place for the two to drift apart. That the surface has no de-duplication rule of
its own is itself checked
(`relation/v2/surface/a-repeated-name-is-a-repeated-seed`) — an earlier spelling
keyed its intermediate map by name, which silently swallowed the collision
before the encoder could see it, and that bug is what the check exists to
prevent recurring. B.6's adoption path follows the same precedent for the same
reason.

Note that none of B.6's five new codes is a *world* code. The eight mutations in
the gate battery refuse under six distinct codes and every one of them is a
`W.CODES` entry. V2 grew no error surface for anything the profile already
answers — the only questions it answers itself are questions about the V2
encoding: its header, and its adoption operation.

---

## 5. What is left

Path B is closed. **One** `surface · awaiting` register row is the honest edge
of it — this memo said "two", which was already wrong when it was written, and
§6 is the repair:

1. **`a-profile-that-admits-parallel-relations`** — the reclassified 2d debt.
   This is a *profile* question, not a surface one: `forge.world.core.v1` admits
   at most one controller per socket, so two relations over the same terminals
   are refused before any surface sees them. Your ruling 3 says how it lands
   when it does: `profile_id` moves to `forge.world.core.v2`, `ir_version` stays
   `"2.0"`, and it arrives through `ProfileSchemaV1` rather than as another
   branch in frozen `wrl.js`.
2. The `runtime · awaiting` and `film · awaiting` rows are unchanged from B.5 —
   V2 was a library-level encoding at B.6. Your rulings 1 and 2 move that: C.1
   takes it to the playground, C.3 – C.4 to the runtime through a **derived**
   projection envelope rather than a raw downgrade.

The three open questions this section ended on are all answered. V2 goes to both
(ruling 1, ruling 2); the successor profile versions `profile_id` and not
`ir_version` (ruling 3); and the one shape you wanted spelled differently was
`V2_ADOPTION_FIELDS` (ruling 4). Path C is the work that follows:

```
C.0  B.7 register/prose errata and atomic adoption        ← landed, §6
C.1  unified V1/V2 playground admission
C.2  migration and adoption playground workflow
C.3  derived runtime-projection envelope
C.4  TRVM Forge static-runtime admission
C.5  cross-repository conformance and consumer checks
```

No grants, no dynamic attachment, no parallel profile anywhere in it.

---

## 6. C.0 — the B.7 errata

Two repairs, and neither is a new capability.

### 6a. A register row that was true, green, and pinning the wrong thing

`same-name-different-world-differs` sat at `surface · awaiting` on the
justification that no syntax existed for authored relation names. That stopped
being true in **B.4**, when `[name]: [src] --sig--> [dst]` landed — and nobody
re-read the row. You caught it by simply writing the world.

It is now `surface · executable`, pinned by
`relation/v2/surface/the-same-authored-name-is-world-scoped`. The check needs a
vacuity guard more than most: two worlds with *different* names would derive
different `rel-` ids trivially, and that is not §D8.5. So the second world
carries **byte-identical seeds** — same four authored names — and differs
somewhere that touches no route at all, a pulser's clock. What is left standing
is the sharp form: same seeds, same `rev-` ids, different `sem-`, and every
`rel-` moved.

### 6b. Adoption is one act — ruling 4

`V2_ADOPTION_FIELDS` → `LEGACY_EDGE_ADOPTION_FIELDS`, still derived from
`V2_SEED_FIELDS["legacy-edge"]` and not restated.

`adoptLegacyRelations` now requires an **exhaustive** assignment, and refuses a
partial one with the new `WRL_INCOMPLETE_ADOPTION`. The reason is where the seal
goes: a partial adoption is not a half-finished edit, it *seals* — it mints a
real world `sem-` and re-mints every `rel-` in that world, including the
relations it did not touch (§D8.5) — so a two-step naming leaves a throwaway
world and a set of throwaway relation ids that nothing distinguishes from wanted
ones. A playground may collect names one at a time; those partial names are
editor state, and editor state is not sealed.

The exhaustiveness check runs **from the world outward**: `available` is what
the world has, `chosen` is what the caller named, and the leftovers are read off
`available`. A caller cannot satisfy the gate by knowing less than the world
does.

`a-partly-adopted-world-is-still-unwritable` is replaced by
`adoption-is-atomic-or-refused`, which proves four things at once: the partial
is refused, the exhaustive one succeeds and its result is writable text, the
argument artifact comes out byte-identical, and an adopted world is not
re-adoptable. The lesson worth keeping is the one the old row demonstrates: a
passing check never asks whether the thing it pins should exist.

### 6c. Prose and documentation

`NamedInitialAllocation … ; needs a surface` → `; IR 2.0, authored`. "No surface
can write one yet" now points at §D8.12's `[clock_feed]: [p0] --sig--> [r0]`.
§D8.16's rule box states exhaustiveness, with a note on why partial adoption is
refused rather than allowed. The README gains a `relation-v2.js` section and a
three-row status table — IR 1.x frozen, IR 2.0 draft-implemented, §D8 draft.

That README section shipped a V2 world, which surfaced a real gap in the doc
sweep: it swept every complete world through the **V1** parser. Under ruling 1's
own principle it now dispatches on the source's own `ir` declaration, so the V2
example in the README is sealed by the V2 parser and its `sem-` is checked like
every other id on the site. A documentation sweep that assumed an encoding would
have printed the id of a world the reader was never shown.

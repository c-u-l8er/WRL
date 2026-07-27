# Handoff — Path B, Semantic IR V2 (slices B.1 – B.6, plus C.0, C.1 and C.2)

**Status: your B.6 ruling is discharged and accepted, your B.7 errata is landed,
and Path C is open — C.0, C.1 and C.2 are all closed. The battery is green at
868/868, the register is at 108 rows — 96 executable, 12 awaiting, model debt
0 — both pinned `sem-` ids are unmoved, and `wrl.js` is byte-identical.**

Per your instruction — *"push after B.6, not before"* — the closure was a third
commit on top of `12b12e0` and `738d94a`. C.0 is a fourth (`f87de38`); C.1 is a
fifth (`d30aabd`); C.2 is a sixth.

This memo is the Path B counterpart to `HANDOFF_D8_PATH_A.md`. §1 records what
each item of your nine-item closing ruling turned into, §2 records what happened
to the five decisions I took on my own and you then ruled on, §3 records the B.6
closure itself, §4 is the file map, §5 is what is left, **§6 is C.0** — the B.7
errata, which corrects two things this memo itself got wrong — **§7 is
C.1**, ruling 1 landed: V2 reaches the playground, dispatched on the source —
and **§8 is C.2**, the other half of ruling 1: the two explicit operations,
*import* and *adopt*, neither of them automatic on editor change.

---

## The verdict first

```
node test/conformance.mjs
  868 passed, 0 failed  (70 annotated doc blocks of 115 swept, 26/26 capabilities cited)
```

(835 at B.6, as you reproduced; 840 after C.0's five, §6; 865 after C.1's
twenty-five, §7; 868 after C.2's three, §8.)

| | |
|---|---|
| starter world | `sem-67e954cfe3115166b49388366df3f062a46572ba2baf53380f1520f4050b60ae` |
| pinned fixture | `sem-8ae91fe9cbc5fd086ce4356d587c403211e5c7b2b3ebdd316496367429ecfe4a` |

Neither moved. V2 is a second **encoding** over the same worlds, not a second
world model, so the V1 spine had to come out of Path B byte-identical — and the
suite still asserts that first, before it runs anything else.

There is now a third pinned id, and it is the first V2 one:

| | |
|---|---|
| the playground's `ir 2.0` world | `sem-9a491fe3a718d8c7262458812c9c220c0bf4157fc2155616f99bcde44263b019` |

It is pinned in three places that check each other — `README.md` prints it under
a complete V2 world, `playground.html` re-derives it in its self-check, and the
suite's playground sweep verifies both — and it is a `sem-` like any other,
because a world id names a sealed world and V1 and V2 are two encodings of one.

Register, live in the browser:

```
108 rows · 91 model · executable · model debt 0
```

The 17 non-model rows are, after C.2, 5 `surface · executable`, 1
`surface · awaiting`, 7 `runtime · awaiting`, 4 `film · awaiting` — 96
executable in all. Fifty-six of the 868 checks are namespaced `relation/v2/…`,
and 44 are `playground/…`.

Model debt is still 0 and stays 0 through the whole of Path C by construction:
C.2 added no model law, only two `surface` rows, because the rules it obeys were
already stated and already tested — the surface's job was to *call* them.

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
| `relation-identity.js` | 0.1.2; B.6 widened `AUTHORABLE_VARIANTS` and added `V1_AUTHORABLE_SEED_VARIANTS`; C.1 reworded one shared code gloss (§7c) |
| `wrl.js` | **frozen**, untouched — byte-identical across all of Path A and Path B |
| `test/conformance.mjs` | **868 checks**, 0 failed; 56 `relation/v2/…`, 44 `playground/…` |
| `spec.html` | §D8.9 – §D8.17 under `#d8-v2` (`#d8-v2-seed`, `#d8-v2-profile`, `#d8-v2-boundary`, `#d8-v2-derive`, `#d8-v2-migrate`, `#d8-v2-surface`, `#d8-v2-write`, **`#d8-v2-world`, `#d8-v2-header`, `#d8-adoption`, `#d8-admission`**), register 47 → 108 rows, model debt 0, `#d8-owes` item 2 struck; C.2 added §D8.16 clause 6 and two `surface` rows (§8) |
| `playground.html` | **C.1** — dispatches through `admitWorldSource`, holds no encoding control, shows two labelled ids, three new published examples (§7). **C.2** — a *Migration & adoption* panel with the two operations of ruling 1, staleness derived from the admitted world id, and no library function added (§8) |
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
C.1  unified V1/V2 playground admission                   ← landed, §7
C.2  migration and adoption playground workflow           ← landed, §8
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

---

## 7. C.1 — V2 reaches the playground, dispatched on the source

Your ruling 1, landed. Twenty-five checks, 865 total, register 100 → 106.

### 7a. The page has no encoding control, and the absence is checked

The one thing you were explicit about is the one thing easiest to get wrong by
building the obvious UI. So the playground grew **no** V1/V2 switch. `run()` is
three lines of dispatch and none of them decide anything:

```js
const r = await V2.admitWorldSource(text);
setFamily(r);
return r.family === "v2" ? renderV2(r) : renderV1(r);
```

The page does not hold a copy of "what a declaration looks like" — it calls the
admission and reads `r.family` off the answer. §D8.17 gained a sixth rule clause
saying exactly that: *a surface calls this rule; it does not restate it.*

The absence is now a **positive** check, `playground/no-encoding-switch`, which
sweeps the published HTML for a `<select>` or a `data-ir` / `data-encoding` /
`data-family` attribute. A future selector that reinterprets text already in the
editor fails the build. (A selector that inserts starter *text* is fine, and the
row's prose says why: text is the input; a control that reinterprets existing
text would make the id on screen a function of which button was last pressed.)

The conformance sweep dispatches the same way. It used to pick the parser
itself; now it calls `admitWorldSource` and asserts `family` **before** it
asserts the id. A sweep that chose the parser could not catch the page choosing
a different one — it would have agreed with itself while disagreeing with the
reader's screen.

### 7b. `badir` is the example that matters most

Three new one-click examples ship, each declaring its own encoding on line 2:

| example | declares | outcome |
|---|---|---|
| `named` | `ir 2.0` | seals `sem-9a491fe3…` — the README world, `[clock_feed]: [pulser:p0] --sig--> [relay:r0]` |
| `unnamed` | `ir 2.0` | `WRL_MISSING_RELATION_NAME` |
| `badir` | `ir 3.0` | `WRL_UNSUPPORTED_IR_VERSION` |

`badir` is a **well-formed V1 world** carrying one broken declaration. It is
precisely the source a fallback would have handled most convincingly, which is
why it is the one that is published and why its `family` is asserted: a page
that quietly downgraded it would show a reader a real `sem-` and no sign that
anything had gone wrong. `playground/badir-family` is the second new register
row, and it pins "declared badly ≠ not declared" at the surface.

### 7c. One repair the live page found: a gloss that argued with its own message

Clicking `badir` in a real browser printed the V2 diagnostic

> `ir_version "3.0" is outside the V2 family this surface reads (2.0)`

directly above the hint

> *an artifact's `ir_version` is outside the **V1** family this **adapter** reads*

`WRL_UNSUPPORTED_IR_VERSION` is raised by the V1 adapter about an **artifact**
and by the V2 header reader about a **source**, and its gloss named only the
first. It read as a contradiction the moment the playground put the two on one
screen. Reworded family-neutral in `relation-identity.js`:

> *an `ir_version` is outside the family the reader that met it accepts*

A code two readers share has to have a gloss true of both. Nothing pinned the
old string; the battery is unchanged at 865 across the edit.

The page's own error rendering learned the same lesson structurally: it reads
three code tables in order — `W.CODES` ?? `V2.RELATION_V2_CODES` ??
`R.RELATION_CODES` — because there are three layers and the frozen spine's error
surface is not a derived module's to extend.

### 7d. Two ids, and they are two different claims

Your display requirement is the part of ruling 1 with the most ways to comply
in letter and fail in spirit. Two `sem-` ids set identically in one box is how a
reader comes to treat them as interchangeable, so they are separated four ways:

* different labels — `Semantic V2 world id` above, `V1 execution view id` below
  (a V1 world shows one row, relabelled `SemanticArtifactID`, because a V1 world
  runs as itself: one id wearing both hats);
* a rule between the rows, and the lower row set in quieter ink;
* a byte-exactness verdict beside the lower id — the projection is compared
  against `denamedV1Artifact` and says so;
* a standing note under both saying which one a grant, a revision or a ledger
  event may be scoped to, and that nothing may be scoped to the other.

Two panels appear only for a V2 world, and they are deliberately **not** one
panel: `Named relation seeds` is marked *canonical · IN the bytes*, and
`Derived relations` is marked *derived · not canonical · not in the bytes*.
Putting seeds and the `rel-`/`rev-` ids they produce under one heading is how a
reader comes to believe a world carries its relation ids around, which is the
thing `DERIVED_NEVER_STORED` refuses.

The strongest demonstration on the page is a hand edit, and it was found by
being wrong first. I wrote that deleting the `ir 2.0` line reseals the same
topology to a different id; the live page answered `WRL_UNSUPPORTED_FEATURE`,
because the `[clock_feed]:` name prefix is still there and the V1 spine has no
rule for it. Deleting **both** markers yields `sem-90b3d0eb…` — which is
exactly the execution view id the lower row was already showing. The correction
is a better demonstration than the claim: type out the V1 world by hand and you
land on the subordinate id, never the world's own.

### 7e. What C.1 did not do

`renderV2` computes the projection inline with `V2.runnableV1Artifact`. That is
not the envelope of ruling 2 — C.3 owns `deriveRuntimeProjection` and its seven
laws, and when it lands the page should call it rather than keep a second way of
getting there. The projection shown today is a display of the downgrade, and it
is labelled as derived everywhere it appears.

*Import V1 as V2* and *Adopt legacy relations* were **not** on the page at C.1;
they are C.2, and your "neither automatic on editor change" is the constraint
they landed under — see §8. `migrationCorrespondence` is already wired into the correspondence
panel for a V2 world, where it correctly reports that nothing pairs — and the
panel says so in words, because *nothing pairs* is an answer here rather than a
gap.

### 7f. Decisions I took on my own in C.0 and C.1

1. **`family` is the admission discriminator**, and the V1 arm is returned
   unreshaped — a V1 admission carries `semanticId` and `graph` exactly as
   before, a V2 one carries `semanticWorldId` and `artifact`. I did not
   normalise the two into one shape, because a caller that cannot tell them
   apart without reading `family` is a caller that will eventually scope
   something to the wrong id.
2. **`declaresEncoding` was added rather than re-coding the misplaced-header
   diagnostic.** It shares `irHeaderScan` with `stripIrHeader` so no second
   grammar for `ir` exists. But this leaves something for you: §D8.15 still says
   a *late* declaration is `WRL_MISSING_IR_HEADER`, and now that dispatch
   depends on the declaration, "missing" is a false word for a line that is
   plainly present and merely in the wrong place. I did not change it, because
   renumbering a frozen-adjacent diagnostic is your call.
3. **§D8.17's numbering and its new sixth clause** — the surface-calls-the-rule
   clause is mine, not yours.
4. **The doc sweep dispatches on the source** (§6c) rather than assuming V1.
5. **The C.1 page computes the projection inline**, pending C.3 (§7e).
6. **The family-neutral rewording of `WRL_UNSUPPORTED_IR_VERSION`** (§7c).

### 7g. Verified live

`agent-browser` against `http://localhost:8901/playground.html`: self-check
green with all three ids re-derived in the browser, including `ir 2.0
sem-9a491fe3…`; the V2 example showing `sem-9a491fe3…` over `sem-90b3d0eb…`
with the byte-exact verdict; the V1 demo still showing its pinned id with
`4 paired · ids preserved yes`; Format round-tripping a V2 world to the same id;
desugar safe on V2; console clean.

Constraints held: `git diff --stat wrl.js` empty, both V1 pinned ids unmoved,
model debt 0.

---

## 8. C.2 — the other half of ruling 1: two operations, neither a consequence

> *"Expose two explicit operations: **Import V1 as V2** and **Adopt legacy
> relations**; neither automatic on editor change."*

C.2 is that sentence and nothing else. It added **no library function**. Every
call it makes — `migrateV1ToV2`, `v2WorldIdOfArtifact`, `migrationCorrespondence`,
`formatNamedWorld`, `adoptLegacyRelations`, `admitWorldSource` — already existed
and was already tested at B.3, B.5 and B.6/C.0. What was missing was a place for
a person to stand while the two acts happen, and that is a **panel**, not a
pipeline.

The panel is `#panel-migrate`, headed *Migration & adoption*, sitting under
Canonical graph in the left stack, badged `§D8.16`.

### 8a. Why the word is *operations*

The rest of the playground is a consequence of the editor: you type, the page
re-admits, everything downstream re-derives. That is right for everything that
is a *view* of what you wrote. It is exactly wrong for these two, because both of
them **seal a world you did not write**, and mint a `sem-` for it.

So the two buttons are the only two things on the page that mint an id nobody
asked for, and the shape of the code says so:

```js
$("panel-migrate").addEventListener("click", (e) => {
  if (e.target.id === "btn-import") doImport();
  else if (e.target.id === "btn-adopt") doAdopt();
});
```

One delegated listener, two button ids, and the `input` listener on the editor
does not mention either operation. That is not a comment, it is a check:

```
playground/migration/operations-are-not-consequences
```

which asserts that `migrateV1ToV2` and `adoptLegacyRelations` each appear
**exactly once** in the file, that neither appears anywhere inside the body of
the `input` listener, and that a `click` handler carrying both button ids exists.
A future refactor that re-fires migration from the debounce breaks it.

### 8b. Staleness is derived, not bookkept

The obvious way to keep a pending migration honest is to invalidate it from
every listener that could dirty it. That is a list, and lists rot. Instead the
workspace records the world id it was made from, and `run()` — which already
knows the id the editor currently seals to — compares:

```js
const held = !r.ok ? null
  : r.family === "v2" ? r.semanticWorldId : r.semanticId;
if (WORK && WORK.pinnedTo !== held) WORK = { stage: "discarded" };
```

Nothing has to remember to invalidate anything, and the behaviour falls out
correctly in both directions without a special case: pressing **Format**
re-writes the source and keeps the workspace, because a formatted world is the
same world; changing `every 2` to `every 3` discards it and says so in words,
because it isn't. Verified live in both directions.

This is the same move as §D8.5's — the correspondence is *computed* from the two
worlds rather than *claimed* by the thing that made them.

### 8c. The refusal is computed, not printed

After `doImport` builds the migrated artifact it asks the formatter to write it,
and prints whatever comes back:

```js
let refusal = null;
try { V2.formatNamedWorld(artifact); } catch (e) { refusal = e; }
```

So the panel's `WRL_UNWRITABLE_SEED` block is the library's own message, arriving
because the library refused, not because the page knows in advance that it will.
If B.5's writability rule ever changed, the panel would change with it and the
prose around it would be the only thing left to fix.

### 8d. The selector is derived from the constant the gate uses

`adoptLegacyRelations` matches an assignment to a relation by every adoption
field except the name. The panel needs that same key to build its form. It does
not restate it:

```js
const SELECTOR_FIELDS =
  V2.LEGACY_EDGE_ADOPTION_FIELDS.filter((k) => k !== "relation_name");
const selectorOf = (seed) =>
  Object.fromEntries(SELECTOR_FIELDS.map((k) => [k, seed[k]]));
```

and the non-restatement is itself a check —
`playground/migration/the-selector-is-not-restated` — because a surface holding
its own copy of a matching key is a surface that will silently disagree with the
library the day the key grows a field.

### 8e. The button is never disabled

Leaving a name blank and pressing **Adopt these names** submits the incomplete
form and gets `WRL_INCOMPLETE_ADOPTION` back, in the library's own words.

Disabling the button until every field is filled would have been the obvious UI,
and it would have been a **second copy of clause 5 of §D8.16** — living in an
interface state that no test can reach, since a disabled button has no failure to
assert on. The rule stays in one place, and the surface calls it. §D8.16 gained a
sixth clause saying exactly this (§8g).

**One bug found live and fixed.** The first version wiped the names you had
already typed when the refusal came back, because `renderMigrate` rebuilds the
form. The library's own message says *"Collect the names as editor state, then
adopt once"* — so the panel was throwing away the state the refusal had just
told it to keep. `WORK.names` now survives the refusal; re-verified live, the
fields read `["a","b","c",""]` after a partial adoption is refused.

### 8f. What the round trip proves

`playground/migration/import-adopt-round-trip` walks the whole path in one
check and asserts six things at once:

| | |
|---|---|
| the migrated world is a different world | `migratedId !== held.semanticId` |
| and cannot be written | `WRL_UNWRITABLE_SEED` |
| a partial adoption is refused | `WRL_INCOMPLETE_ADOPTION` |
| adoption moves identity again | `adoptedId !== migratedId` |
| and the formatter's text seals back to it | `back.family === "v2"`, `back.semanticWorldId === adoptedId` |
| **and the V1 execution view never moved** | `exec === W.DEMO_WORLD_SEMANTIC_ID` |

The last row is the point, and it is the sharpest thing in Path C so far. Take
the pinned fixture, import it, name its four relations, adopt. Three world
identities have now existed —

```
V1        sem-8ae91fe9…      what you loaded
migrated  sem-3e42fcb7…      re-encoded, unwritable
adopted   sem-1ce17289…      named, and ordinary IR 2.0 source
```

— and the **V1 execution projection is still `sem-8ae91fe9…`**, the fixture you
started from, unmoved. What this world *is* changed three times. What it *runs
as* never changed at all. That is §D8.6 and ruling 2 in one observation, and it
is visible on the page as two labelled ids sitting next to each other.

### 8g. Spec

§D8.16 gained clause 6:

> **Migration and adoption are *operations*, never consequences.** A surface
> exposes them as two acts a person performs — *import this V1 world as V2*,
> then *adopt these names* — and neither may run because the editor changed.
> Both of them **seal**. A surface also holds no copy of clause 5: the
> completeness gate is the library's, so an incomplete form is *submitted* and
> refused, rather than made unsubmittable by an interface state nothing can
> test.

and the register gained two `surface · executable` rows, taking it to 108:

```
migration-and-adoption-are-operations-not-consequences
  → playground/migration/operations-are-not-consequences
a-migrated-world-takes-exactly-one-adoption-to-become-writable
  → playground/migration/import-adopt-round-trip
```

Model debt is still 0, because C.2 stated no new model law — clause 6 is a
constraint on *surfaces*, and it is `surface · executable` for that reason.

### 8h. Decisions I took on my own in C.2

1. **Staleness is derived from the admitted world id** (§8b) rather than from an
   invalidation list. The consequence you should look at: **Format** preserves a
   pending migration, because it is the same world. I think that is right; it is
   a decision either way.
2. **The Adopt button is never disabled** (§8e).
3. **A migrated-but-unadopted world never reaches the editor as text**, because
   it has none — it lives only in the panel. The only text the page ever writes
   into the editor is an *adopted* world, and it is written programmatically, so
   no `input` event fires and the debounce never sees it; `run()` is called
   directly instead.
4. **§D8.16's sixth clause** is mine, not yours (§8g).
5. **The empty world offers no adoption.** A migrated world with no routes has
   no legacy relations, so it is already writable and there is nothing to adopt;
   the panel shows the migration and stops. This is a real case in the published
   examples, and it means "migrated" and "needs adoption" are not the same state.

### 8i. Verified live

`agent-browser` against `http://localhost:8902/playground.html`, the pinned
fixture: import → `sem-3e42fcb7…`, `4 paired · 0 dropped · 0 added`,
`WRL_UNWRITABLE_SEED` from the formatter; adopt three of four → refused
`WRL_INCOMPLETE_ADOPTION` with `["a","b","c",""]` still in the fields; adopt four
→ `sem-1ce17289…`, `every revision recurs yes`, `the source above re-seals to it
yes`, and the formatter's IR 2.0 text (`[a]: [sp] --socket--> [ob]`, …) in the
editor; the second id reading `sem-8ae91fe9…` throughout; a one-character edit
discarding the pending migration with a sentence saying why; the empty world
offering no Adopt button. Console clean.

Constraints held: `git diff --stat wrl.js` empty, both V1 pinned ids unmoved,
model debt 0, no new library function.

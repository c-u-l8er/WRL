# Handoff — Path B, Semantic IR V2 (slices B.1 – B.5)

**Status: your §8 build order is exhausted. B.1 through B.5 are landed, the
battery is green at 828/828, the register is at 92 rows with 80 model rows all
executable and model debt 0, and both pinned `sem-` ids are unmoved.**

This memo is the Path B counterpart to `HANDOFF_D8_PATH_A.md`. It is organised
by your nine-item closing ruling: §1 records what each of your decisions turned
into, §2 records the five things I decided on my own that I would rather you
overturn now than later, and §3 is the file map.

---

## The verdict first

```
node test/conformance.mjs
  828 passed, 0 failed  (70 annotated doc blocks of 115 swept, 26/26 capabilities cited)
```

| | |
|---|---|
| starter world | `sem-67e954cfe3115166b49388366df3f062a46572ba2baf53380f1520f4050b60ae` |
| pinned fixture | `sem-8ae91fe9cbc5fd086ce4356d587c403211e5c7b2b3ebdd316496367429ecfe4a` |

Neither moved. V2 is a second **encoding** over the same worlds, not a second
world model, so the V1 spine had to come out of Path B byte-identical — and the
suite still asserts that first, before it runs anything else.

Register, live in the browser:

```
92 rows · 80 model · 80 model · executable · model debt 0
```

Forty-four of the 828 checks are new and namespaced `relation/v2/…`.

---

## 1. Your ruling, item by item

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
V2_INITIAL_SEED_VARIANTS   = ["named-initial", "legacy-edge"]
V2_AUTHORABLE_SEED_VARIANTS = ["named-initial"]
V2_IMPORTABLE_SEED_VARIANTS = R.IMPORTABLE_VARIANTS   // reused, not restated
```

`granted` is runtime-only and cannot appear in initial bytes
(`relation/v2/granted-is-not-seeded-into-initial-bytes`). A missing relation
name is `WRL_MISSING_RELATION_NAME` and never falls back to `legacy-edge`
(`relation/v2/an-unnamed-relation-is-refused-not-defaulted`).

There are now four separate authorities — which variants **exist**, which a
trusted **importer** may construct, which a **surface** may emit, which may
appear in **initial bytes** — and they are four different lists on purpose.

### §7 — the §D8.8 projection is the V1 compatibility adapter and nothing else

`projectRelationRevisionToV1Edge` is never called from inside the V2 canonical
encoder. The explicit downgrade is `downgradeV2ToV1`, and it produces a new V1
artifact with its own `sem-`.

One correction to a claim I made in an earlier draft of the migration prose,
because it was wrong and the way it was wrong is worth recording. I wrote that
the V1 → V2 → V1 round trip permutes `edges` because "V1 leaves the order of
`edges` to whoever typed the world". It does not: `canonicalizeGraph` sorts.
Both encodings canonicalise the order. They disagree about the **key**. V1 sorts
`edges` by the tuple it stores them as, `(kind, src, dst)`; V2 sorts `relations`
by canonical `identity_seed` bytes, and those bytes are key-sorted JSON, so a
`legacy-edge` seed compares on `dst`, then `kind`, then `src`. Two total orders
over the same set, neither of them anybody's authoring order. A world whose
edges happen to agree under both keys round-trips byte-exactly; one that does
not comes back permuted with a new id. The check is now
`relation/v2/migration/the-two-encodings-sort-by-different-keys`, and it asserts
that each side really is sorted by its own key rather than merely that the two
disagree.

### §8 — `NamedInitialAllocation` lands inside Path B

It did, as B.4, and B.5 closed the register row it was blocking. `#d8-owes`
item 2 — "an allocation surface" — is struck through and marked shipped.

### §9 — the surface spelling

`[clock_feed]: [p0] --sig--> [r0]`, exactly as ruled. The name is unique in the
world, present in the canonical V2 bytes, order-independent, and absent from
`revision`. An unnamed route under native V2 is `WRL_MISSING_RELATION_NAME`. No
name is ever derived from endpoints — there is no code path that could, which is
the point of the two refusals in §2 below.

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
behaviourally rather than by grep: strip the names off the V2 formatter's output
and you get, byte for byte, what the frozen formatter emits
(`relation/v2/format/the-formatter-does-not-know-the-arrow`).

---

## 2. Five decisions I took autonomously

### 2a. There is no `ir_version 2.0` source header

Your §9 rules exactly one piece of V2 syntax and it is per-route. A document
header would be a second, unruled one. So the encoding is the **caller's**
choice, not a declaration inside the text: `parseNamedWorld` is the V2 parser,
`sealWorld` is the V1 one. This is also what keeps "an unnamed route under
native V2" a meaningful phrase — under V1 the same text is simply a V1 world.

If you want a header, it is a small change, but it needs ruling because it
creates a way for the text to disagree with the caller.

### 2b. V1's `AUTHORABLE_VARIANTS` stays `[]`

The V2 module keeps its own `V2_AUTHORABLE_SEED_VARIANTS = ["named-initial"]`
rather than mutating the kernel's list, which reads slightly against a literal
reading of your §6 ("`AUTHORABLE_VARIANTS = ["named-initial"]` by end of Path
B"). The reason: the two lists answer the same question about two different
encodings, and V1 has no field a name could live in. Merging them would make one
encoding's silence read as the other's permission. `IMPORTABLE_VARIANTS` **is**
reused from the kernel, because that one really is a property of the relation
family and not of an encoding.

### 2c. A migrated world has no source form, and is refused rather than named

A world that came in through `migrateV1ToV2` carries `legacy-edge` seeds. Those
have no names, and §9 gives no nameless route form, so `formatNamedWorld` raises
`WRL_UNWRITABLE_SEED`. The alternative — let the formatter mint a name — is
exactly what §D8.1 forbids, so I would rather it be a hard refusal than a
plausible-looking file. `relation/v2/format/a-migrated-world-has-no-source-form`.

This does mean there is currently no path from a legacy world to an editable
V2 source. If you want one, it is a *naming* operation and it needs its own
ruling about who chooses the names.

### 2d. Two relations over the same terminals have no source form either

V2 keys relations by name, so `{a: p0→r0, b: p0→r0}` is well-formed V2 and
something V1 could never represent. Printed, it is one route line twice, and the
spine refuses a duplicate edge key. So `formatNamedWorld` raises
`WRL_UNWRITABLE_RELATION` rather than emit text that will not re-read.

This is the first place where V2 is strictly more expressive than the surface
that writes it. It is a real gap, not a bug, and closing it means ruling a
parallel-relation syntax.

### 2e. V2 is an encoding version over the same profile

`ir_version` moves to `"2.0"`; `profile_id` stays `forge.world.core.v1`. The
world model did not change — the encoding of relations did. Everything in
`revision` is shared with V1 through the kernel's `edgeToRelationRevision`, and
`relation/v2/the-revision-model-is-shared-with-V1` asserts that rather than
letting it drift.

---

## 3. Files

| file | state |
|---|---|
| `relation-v2.js` | **new**, 55.6 KB — B.1 schema + canonical bytes, B.2 validation + identity derivation, B.3 V1↔V2 migration, B.4 named-relation surface, B.5 formatter + consumer. Zero new runtime constructs; every hashing path delegates to `relation-identity.js` and `wrl.js` |
| `relation-identity.js` | 0.1.2, unchanged by Path B except as a consumer |
| `wrl.js` | **frozen**, untouched |
| `test/conformance.mjs` | **828 checks**, 0 failed; 44 `relation/v2/…` |
| `spec.html` | new §D8.9 – §D8.13 under `#d8-v2` (`#d8-v2-seed`, `#d8-v2-profile`, `#d8-v2-boundary`, `#d8-v2-derive`, `#d8-v2-migrate`, `#d8-v2-surface`, `#d8-v2-write`), register 47 → 92 rows, model debt 0, `#d8-owes` item 2 struck |
| `playground.html` | unchanged; re-verified live |
| `WRL.zip` | rebuilt, now includes `relation-v2.js` |

New typed codes, all nine of them in `RELATION_V2_CODES`:
`WRL_LEGACY_EDGES_IN_V2`, `WRL_BAD_IDENTITY_SEED`, `WRL_UNWRITABLE_SEED`,
`WRL_MISSING_RELATION_NAME`, `WRL_DUPLICATE_RELATION_SEED`,
`WRL_BAD_V2_ARTIFACT`, `WRL_BAD_RELATION_NAME`, `WRL_AMBIGUOUS_RELATION_NAME`,
`WRL_UNWRITABLE_RELATION`.

There is deliberately **no** `WRL_DUPLICATE_RELATION_NAME`. A repeated name is a
repeated seed, and the encoder already refuses that with
`WRL_DUPLICATE_RELATION_SEED`; a second rule at the surface would be a second
place for the two to drift apart. That the surface has no de-duplication rule of
its own is itself checked
(`relation/v2/surface/a-repeated-name-is-a-repeated-seed`) — an earlier spelling
keyed its intermediate map by name, which silently swallowed the collision
before the encoder could see it, and that bug is what the check exists to
prevent recurring.

---

## 4. What I need from you

Your §8 sequence is exhausted, so there is no next slice I can start without a
ruling. In rough order of how much they block:

1. **2c and 2d** — the two unwritable worlds. Both are one syntax decision away
   from being writable, and neither syntax is mine to invent.
2. **2a** — header or no header.
3. **2b** — whether the two `AUTHORABLE` lists stay separate.
4. Whether V2 should reach the **playground** and the **runtime** now, or stay a
   library-level encoding until the surface gaps above are closed.

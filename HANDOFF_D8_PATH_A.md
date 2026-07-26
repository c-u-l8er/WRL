# Handoff — A.3 closure commit, Relation Identity Kernel 0.1.2

**Status: all eight items of your commit ruling are landed, the battery is green
at 782/782, and both pinned `sem-` ids are unmoved. Path A is ready to commit.**

This memo replaces the 0.1.1 handoff. It is organised as your ruling was: one
section per commit item, each stating what was wrong, what the repair is, and
which check would catch a regression. Section 9 is the part that needs you —
Path B, and two things I decided that I would rather you overturn now than
later.

---

## The verdict first

```
node test/conformance.mjs
  782 passed, 0 failed  (70 annotated doc blocks of 113 swept, 26/26 capabilities cited)
```

Pinned ids, re-verified live in the browser after every edit:

| | |
|---|---|
| starter world | `sem-67e954cfe3115166b49388366df3f062a46572ba2baf53380f1520f4050b60ae` |
| pinned fixture | `sem-8ae91fe9cbc5fd086ce4356d587c403211e5c7b2b3ebdd316496367429ecfe4a` |

Neither moved. That is not incidental to this commit — items 1, 2 and 3 all
change what the adapter *produces*, and if any of them had leaked into the
spine's preimage those two lines would be different. The suite asserts byte
equality between `sealWithRelations` and `sealWorld` for both fixtures before it
runs anything else, so a leak fails loudly and first.

`rev-` ids **did** move, as expected and as designed: a revision now carries
`domain: "signal"` and `texture: "solid"` where it previously carried
`domain: "forge.world.core.v1"` and no texture key. `rev-` is unpinned and
world-independent by §D8.3; nothing published depends on its value.

---

## 1. `domain = signal`

**Was.** `edgeToRelationRevision` wrote `artifact.profile_id` — the string
`forge.world.core.v1` — into the `domain` slot.

**Why it is wrong.** §D8's field table says a domain is a *profile-declared
namespace*: `signal`, `digital`, `mobility`, `electrical`. A profile **declares**
domains; it is not one. And §D8.8's own recovery table already fixed the value
for the frozen route at `domain = signal` — so the adapter was contradicting a
normative table sitting 300 lines away in the same document.

**Repair.** A declared map, not an expression:

```js
export const PROFILE_DEFAULT_DOMAIN = deepFreeze({ "forge.world.core.v1": "signal" });
export function profileDefaultDomain(profileId)   // → WRL_UNKNOWN_PROFILE_DOMAIN
```

An unknown profile is refused rather than defaulted, because defaulting is how
the original defect would come back.

**Consequence I did not expect, and want you to look at.** `domain` moved out of
the **free** row of the field partition and into **no V1 form**. It had been
filed free on the reasoning "a V1 edge writes no domain, so changing one cannot
disturb the id" — true, and irrelevant. A V1 edge writes no domain because it is
*entirely* a signal-domain encoding; its two kinds are the two kinds of that one
domain. An `electrical` relation is therefore not a relation whose domain V1
forgets to mention, it is one V1 **cannot represent** — exactly like an
`acausal` one. So the projection now refuses it, and the partition reads:

| | fields | |
|---|---|---|
| names it | `kind`, `endpoints` | 2 |
| free | `policy` | 1 |
| no V1 form | `domain`, `orientation`, `texture`, `attributes` | 4 |

Four of seven, not three. The spec's numeric claim was updated to match.

**Checks.** `relation/only-the-key-names-the-relation` (partition, mutating each
field in turn and classifying the result), `relation/revision-field-partition-is-total`
(the partition covers `REVISION_FIELDS` exactly),
`relation/the-import-supplies-only-declared-constants` (asserts the resolved
domain is *not* the profile id — the specific defect, named).

---

## 2. `texture = solid`, and directed-texture enforcement

You rejected my decision #1 with "V1 semantically implies `solid`; restore and
enforce it." Implemented, and you were right for a reason I had not seen.

**Was.** The adapter emitted no `texture` key. My argument: a missing key and a
`texture: null` are different claims, and no V1 world ever *considered* texture,
so inventing one would put an authored-looking value in an artifact that never
carried it.

**Why it is wrong.** That argument answers *may the adapter invent a value?*
when the question is *what does this encoding mean?* §5 gives V1 exactly one
writable texture, `--` solid. So a V1 structural edge does not **omit** a
texture, it **elides** one — the same relationship the artifact has to
`orientation`, which the adapter had been restoring all along without anyone
calling it authorship. The test is whether the omitted value is *determined*,
not whether the bytes contain it.

**What the mistake actually cost**, which is the part I think is worth keeping
on the page: it made *texture required for directed* — a rule §D8.7 **states** —
unenforceable, because the kernel's own relations violated it. So the rule got
filed as a V2 obligation, and §D8's texture row shipped as one enforced half and
one commented half. A table with a commented row has stopped being a table.

**Repair.** Both halves now come off one declaration:

```js
export const ORIENTATION_TEXTURE = deepFreeze({
  directed: "required", symmetric: "optional", acausal: "forbidden",
});
export const TEXTURES   = deepFreeze(["solid", "async", "verified", "fault"]);
export const V1_TEXTURE = "solid";
```

`WRL_MISSING_TEXTURE` is new. `projectRelationRevisionToV1Edge` now *elides* a
solid texture on the way out and refuses any other — where the 0.1.1 rule was
the opposite, *refuse any texture*, which round-tripped only because the adapter
had never restored one.

**Checks.** `relation/directed-carries-a-texture` (missing → `WRL_MISSING_TEXTURE`,
and the well-formed one still accepted — both halves, so a validator that
refused everything would not pass), `relation/acausal-carries-no-texture`,
`relation/texture-vocabulary-is-the-specs` (asserts §5's **four** and that V1
writes one of them; narrowing the model's enumeration to what the surface can
write would delete three guarantee classes while every other texture check
still passed).

**Test-authoring note.** Two acausal specimens were silently testing the wrong
rule after this change: they spread a directed `base` that now carries `solid`,
so they failed on `WRL_ACAUSAL_TEXTURE` under names like
`relation/canonical-order-is-role-then-terminal`. The specimen builder now drops
an inherited texture for acausal unless the check is deliberately supplying one.
And `relation/acausal-carries-no-texture` now supplies a **legal** texture,
because an invented one (`"braided"`) is refused by the vocabulary first and
leaves the orientation rule untested. Same class of error as the "a law about a
seam must parse, not grep" rule.

---

## 3. Semantic-ID / artifact binding

**Was.** `deriveRelations(artifact, semanticId)` took the world id as an
argument and trusted it. Callers passed the one `sealWorld` had just returned,
so it was always right, and it was checked by nothing.

**Why it is wrong.** You demonstrated it: an artifact handed over with
`sem-000…0` beside it minted a complete, well-formed set of relation ids scoped
to a world that does not exist. A world-scoped identity is only as scoped as the
world id it is scoped *to*, and a value whose meaning depends on an unverified
claim travelling next to it has no meaning. The failure is silent — every id
well-formed, every round trip green.

**Repair.** The id is **recomputed** from the artifact's own canonical bytes
inside `deriveRelations`; a supplied `sem-` becomes a cross-check refused on
mismatch (`WRL_SEMANTIC_ID_MISMATCH`). The recomputed path is the *only* path —
there is no faster one to fall back to. `deriveLegacyEdgeCorrespondence` routes
both of its sides through the same checked boundary, so a sealed-looking record
carrying a forged id is refused there too rather than only in the single-world
path.

**Checks.** `relation/binding/a-forged-world-id-is-refused`,
`relation/binding/the-world-id-is-recomputed-not-supplied` (running with **no**
claim gives the same ids — so the two paths cannot disagree and there is no
unchecked way in).

---

## 4. Explicit V1 source-version validation

The adapter's constants — `directed`, `solid`, `signal`, the frozen port pairs —
are V1's elisions. Applied to an artifact of a later version whose elisions
differ, they would not fail; they would produce confident, wrong relations.

```js
export const V1_IR_VERSIONS = deepFreeze(["1.0", "1.1"]);
export function assertV1Artifact(artifact)   // → WRL_UNSUPPORTED_IR_VERSION
```

Called before any edge is read, on both the single-world and the correspondence
paths.

**Check.** `relation/binding/an-unknown-ir-version-is-refused`.

**Flagged:** I admitted `"1.1"` alongside `"1.0"` because the frozen corpus
contains both and the elisions are identical across them. If you consider that
too permissive — i.e. that the adapter should be pinned to exactly the versions
whose elisions it has been *tested* against — say so and I will narrow it.

---

## 5. Deep-frozen identity tables

**Was.** Every exported vocabulary was an ordinary array or object.

**Why it is wrong.** You reversed `ENDPOINT_ROLES` and widened
`ORIENTATION_ROLES` after import, and canonicalisation obligingly produced a
different id for the same relation and admitted roles §D8 forbids. The role
enumeration is not merely a list — it is the **sort key** of the canonical form.
A closed enumeration a consumer can reopen is an open enumeration with a comment
attached.

**Repair.** A recursive `deepFreeze` applied to every exported table:
`ENDPOINT_ROLES`, `ORIENTATIONS`, `TEXTURES`, `ORIENTATION_ROLES`,
`ORIENTATION_TEXTURE`, `ALLOCATION_FIELDS`, `PROFILE_DEFAULT_DOMAIN`,
`V1_IR_VERSIONS`, `RELATION_IMPORTED_FIELDS`, `REVISION_FIELDS`.

**Check.** `relation/immutability/the-canon-cannot-be-moved-from-outside` —
tampers with all of them, then re-asserts canonical order *and* role legality.
It checks the consequence, not the `Object.isFrozen` flag.

---

## 6. Correspondence separated from `RelationImported`

This is the item I think was most valuable, and I want to state the general
rule rather than just the fix.

**Was.** `deriveCorrespondence` returned a field called `imported`, whose
entries had the four fields of a `RelationImported`.

**Why it is wrong.** The arithmetic was fine. What was wrong is that a
*derivation* produced a record whose entire content is *an operation was
accepted* — from two artifacts, which know nothing about operations. Read
strictly it says two worlds are related by a migration because they contain
matching edge keys, so two unrelated worlds built from the same starter template
would be full of imports nobody performed.

**Repair.** Three functions where there was one:

```js
deriveLegacyEdgeCorrespondence(from, to)  // structural, derived: { pairs, dropped, added }
candidateImportedFacts(correspondence)    // what a fact would have to be backed by
checkRelationImported(facts, corr)        // the join → WRL_UNVERIFIED_IMPORT
```

**The rule underneath it.** Derived values do not need checking against their
own inputs; **asserted** ones do. `RelationImported` is emitted by an accepted
migration operation, which makes it — uniquely in this kernel — a thing that can
be *maintained wrongly*, which is exactly why it is the one thing joined against
something derived. Merging the two loses the only join that could catch a wrong
assertion, and loses it by making the assertion **unfalsifiable** rather than by
making it false.

**Checks.** `relation/migration/a-pairing-is-not-an-import-fact` (asserts
`deriveCorrespondence` is *gone*, that no `imported` key exists, and that a pair
entry's keys are exactly `key`/`from_relation`/`to_relation`),
`relation/migration/an-unbacked-import-fact-is-refused`,
`relation/migration/the-fact-has-exactly-four-fields`.

`playground.html` was updated to the new API and re-verified live — it renders
`3 paired · 1 dropped · 0 added` against the pinned fixture.

---

## 7. Empty-world correspondence

`relation/migration/an-empty-world-still-corresponds-to-itself` — a world with
no relations mapped against itself reports `identityPreserved: true` with all
three lists empty. This is the degenerate case a correspondence that fails by
returning nothing would be **indistinguishable** from, which is why you asked
for it and why the other migration checks do not cover it. Verified live in the
playground on the "Empty world" preset as well.

---

## 8. The missing model-register rows, and the B7 re-stage

The register went **34 → 47 rows**; `model · executable` went **22 → 35**;
`model · awaiting` remains **0**, so the `REGISTERED_MODEL_DEBT_CAP = 0` ratchet
holds.

### 8a. The B7 split you ordered

Two rows were *half* misfiled, and I think this is the sharpest instance of the
register's own failure mode that has come up:

| law | was | is now |
|---|---|---|
| `same-name-different-world-differs` | surface · awaiting | **split**: `named-allocation-is-world-scoped` (model · executable) + itself, narrowed, still surface · awaiting |
| `overlapping-grants-do-not-collide` | runtime · awaiting | **split**: `granted-allocation-separates-grants` (model · executable) + itself, narrowed, still runtime · awaiting |

Both were filed correctly *as far as it went* — there is no syntax for naming a
relation and no machinery for issuing a grant. But an identity is a function of
a **preimage**, and both preimages are writable today: a `NamedInitialAllocation`
carries its `world_id`, a `GrantedAllocation` carries its `grant_id`. The
arithmetic was never blocked; only the way a *person* reaches it was. A single
row covering both had the effect of hiding a settled property behind an
unsettled one, and reported **less** than was known.

This is what forced the three-authorities separation:

1. **Which variants exist** — all three. `relationIdFromAllocation` mints any
   well-formed allocation, and mints it the same way for everyone.
2. **Which a trusted importer may construct** — only `legacy-edge`.
3. **Which an authoring surface may emit** — none, today.

`assertImportableAllocation` and `assertAuthorableAllocation` are separate
boundaries; the mint refuses nothing. Folding them into the hash, as 0.1.1 did,
made identity depend on **who was asking** — which is the property a content
address exists to not have.

### 8b. The other new rows

| law | check |
|---|---|
| `directed-carries-a-texture` | `relation/directed-carries-a-texture` |
| `texture-vocabulary-is-closed` | `relation/texture-vocabulary-is-the-specs` |
| `declared-vocabularies-are-immutable` | `relation/immutability/the-canon-cannot-be-moved-from-outside` |
| `allocation-variants-have-declared-fields` | `relation/allocations/each-variant-has-exactly-its-declared-fields` |
| `relation-id-binds-to-the-artifact-it-claims` | `relation/binding/a-forged-world-id-is-refused` |
| `world-id-is-recomputed-not-supplied` | `relation/binding/the-world-id-is-recomputed-not-supplied` |
| `import-admits-only-declared-artifact-versions` | `relation/binding/an-unknown-ir-version-is-refused` |
| `an-empty-world-corresponds-to-itself` | `relation/migration/an-empty-world-still-corresponds-to-itself` |
| `a-pairing-is-not-an-import-fact` | `relation/migration/a-pairing-is-not-an-import-fact` |
| `an-import-fact-is-backed-by-a-pairing` | `relation/migration/an-unbacked-import-fact-is-refused` |

Four existing rows had their **wording** corrected rather than their status,
because they were describing behaviour this commit changed:
`revision-does-not-move-relation-id` (partition is now 2/1/4),
`import-supplies-only-declared-constants` (adds the *resolved* class; texture is
no longer "a missing key, never a null"), `import-mints-one-allocation-variant`
(the refusal moved from the mint to the two writer boundaries),
`migration-correspondence-is-derivable` (no longer calls the derived pairing a
`RelationImported`).

---

## 9. What I need from you

### 9a. Two decisions I took autonomously

1. **`V1_IR_VERSIONS = ["1.0", "1.1"]`** — see §4. Narrow it if you disagree.
2. **`ir_version` and profile are checked; the *rulepack* is not.** The adapter
   reads `semantic_policies.rulepack_id` into `policy` without validating it
   against a declared set, on the grounds that `policy` is the one **free**
   field and so cannot reach an id. That is true today and stops being true the
   moment anything else consumes it. I left it, and I am flagging it rather than
   quietly relying on it.

### 9b. Path B

I have your B1–B7 rulings. Path A is now closed on my side and I can start B
under the byte-layout rulings, but B is a Semantic IR **V2** design task, and
the two things I do not have are:

- the V2 byte layout ruled at the level of detail A had — specifically: does the
  `relations` array replace `edges` outright at V2 or coexist with it, and does
  the frozen legacy projection of §D8.8 remain **normative** at V2 or become a
  read-only import path?
- whether the surface for `NamedInitialAllocation` lands *inside* B or after it.
  B7's split leaves one `surface · awaiting` row that only a surface can close,
  and I would rather not invent naming syntax to close a register row.

Everything in this memo is committed as one A.3 closure commit inside `WRL/`
(own repo `c-u-l8er/WRL`, branch `main`) — per your ruling, "after that battery
is green and the pinned V1 IDs remain unchanged".

---

## 10. Files

| file | state |
|---|---|
| `relation-identity.js` | **0.1.2** — domain resolution, texture restore + both orientation halves, artifact/`sem-` binding, `ir_version` admission, deep-frozen tables, three-authorities split, correspondence/`RelationImported` separation |
| `test/conformance.mjs` | **782 checks**, 0 failed; 13 new relation checks; 3 specimen-builder corrections |
| `spec.html` | §D8 field partition (2/1/4), §D8.7 both texture halves, §D8.1 three authorities, §D8.8 field map + correspondence separation, new `#d8-kernel-trust`, normative projection now names `domain` and `texture`; register 34 → 47 rows |
| `playground.html` | consumes `deriveLegacyEdgeCorrespondence` / `c.pairs`; verified live |
| `direction.html` | unchanged by A.3 — it carried no stale `deriveCorrespondence` or deferred-texture claim; its diff in this commit is the earlier D8.8 migration paragraph |
| `WRL.zip` | rebuilt |

/**
 * Semantic IR V2 -- the native relation encoding. Path B, slices B.1 - B.5.
 * ========================================================================
 *
 * V1 writes a world's topology as `edges: [{ kind, src, dst }]`. That record
 * can say four things, and §D8's relation can say seven; the difference is not
 * a gap V1 elides, it is a vocabulary V1 does not have. §D8.8's projection
 * makes the V1 shape READABLE as a relation, and the register calls the fields
 * it cannot vary `V1-fixed` -- one value, no alternative spelling. V2 is where
 * the alternatives become writable.
 *
 * THE FOUR PARTS, AND WHY THE FILE IS DIVIDED WHERE IT IS
 * -------------------------------------------------------
 * Above the `B.2` banner: the schema and the canonical bytes, and nothing
 * that hashes. Between `B.2` and `B.3`: everything that hashes, and nothing
 * that decides a byte. Between `B.3` and `B.4`: the two encodings meeting.
 * Below `B.4`: text -- the surface that reads it and the formatter that
 * writes it -- built only out of what the parts above already export, and
 * containing no copy of the frozen route grammar in either direction.
 *
 * The first line is worth keeping visible because identity is a function OF
 * canonical bytes -- so when a `sem-`, `rel-` or `rev-` id moves, the answer
 * to "which part moved it" is a file position rather than an investigation.
 * The last line is worth keeping visible for the same reason in reverse: a
 * surface that decided a byte would be a second answer to a settled question.
 *
 * THE FOUR RULINGS THIS ENCODES
 * -----------------------------
 *   1. `relations` REPLACES `edges` outright (§4 of the Path B ruling). They do
 *      not coexist: `edges` in a V2 artifact is `WRL_LEGACY_EDGES_IN_V2`, and
 *      `relations` in a V1 artifact is `WRL_RELATIONS_IN_V1`, raised by the V1
 *      adapter. An artifact holding both would seal to bytes that a V1 reader
 *      and a V2 reader each interpret happily and differently.
 *
 *   2. A relation record is `{ identity_seed, revision }` (§5). `world_id`,
 *      `relation_id` and `revision_id` are NEVER stored -- all three are
 *      functions of these bytes, and a stored copy is a second source of truth
 *      for a hash. The `_seed_` in the name is the whole argument: a
 *      `NamedInitialAllocation` is `{ world_id, relation_name }`, and the world
 *      id is the hash of the bytes the seed sits inside, so the stored form
 *      carries the allocation MINUS its world coordinate and derivation adds it
 *      back. See `V2_SEED_FIELDS`, which is computed from the allocation
 *      shapes rather than restated beside them.
 *
 *   3. `relations` sorts by canonical `identity_seed` bytes (§5). An array's
 *      order is in its bytes, so an unordered set has to have its order decided
 *      here or it is decided by whoever typed the world.
 *
 *   4. Initial bytes admit `named-initial` and `legacy-edge`; `granted` stays
 *      runtime-only (§6). A missing relation name is an error and never a
 *      silent fall back to `legacy-edge` -- that fallback would make an
 *      author's omission mint a name from the endpoints, which is the one
 *      derivation §D8.1 forbids.
 *
 * WHY V2 IS AN ENCODING VERSION AND NOT A NEW PROFILE
 * ---------------------------------------------------
 * AUTONOMOUS DECISION, flagged for review. The ruling fixes `ir_version` at
 * `2.0` and says nothing about `profile_id`, and the tempting move is to mint
 * `forge.world.core.v2` alongside it. This module does not, because the two
 * coordinates answer different questions:
 *
 *     ir_version  -- HOW is topology written        (edges vs relations)
 *     profile_id  -- WHAT vocabulary is it written in (domains, kinds, ports)
 *
 * Bumping both together would mean every new domain forces a new encoding
 * version, and every encoding change invalidates every profile. So V2 is a new
 * encoding over the SAME `forge.world.core.v1` profile, and a wider profile --
 * one declaring `electrical`, or an acausal kind -- arrives later without
 * touching the encoding. The admission gate is still the whole tuple, exactly
 * as A.4 made it for V1; only the version coordinate moved.
 *
 * WHAT THIS MODULE DOES NOT VALIDATE
 * ----------------------------------
 * It is a relation-layer encoder, not a whole-artifact validator. `schemas`,
 * `objects`' internal shape, and the non-rulepack policy ids pass through
 * untouched. Checking them here would duplicate `wrl.js`'s validation in a
 * module that cannot be the one that fails first.
 *
 * DEPENDENCY DIRECTION
 * --------------------
 * This imports `relation-identity.js`, which imports `wrl.js`. Neither imports
 * back. The revision model there -- terminals, roles, orientations, textures,
 * revision canonicalisation -- is FAMILY-NEUTRAL and V2 reuses it unchanged;
 * only `edgeToRelationRevision`, the projection and `deriveRelations` are V1
 * adapter code. That the two halves share a file is historical, and splitting
 * them is a B.5 candidate rather than something to do mid-path.
 */

import * as W from "./wrl.js";
import * as R from "./relation-identity.js";

/* Same discipline as the kernel's: an exported table is a shared mutable
 * object, and every table below decides bytes. */
const deepFreeze = (v) => {
  if (v && (typeof v === "object" || typeof v === "function") &&
      !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const k of Object.getOwnPropertyNames(v)) deepFreeze(v[k]);
  }
  return v;
};

const fail = (code, message, opts) => {
  throw new W.WrlError(code, message, opts);
};

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/* ------------------------------------------------------------------ codes */

/* Codes raised by the V2 encoder. Kept out of `W.CODES` for the reason the
 * kernel's are: the frozen spine's error surface is the frozen spine's.
 * `WRL_RELATIONS_IN_V1` is deliberately NOT here -- the V1 adapter raises it,
 * so it lives in `RELATION_CODES` with the rest of that adapter's surface. */
export const RELATION_V2_CODES = deepFreeze({
  WRL_LEGACY_EDGES_IN_V2:
    "a V2 artifact carries an edges key, which the relations key replaces",
  WRL_BAD_IDENTITY_SEED:
    "an identity seed does not have the shape its variant declares",
  WRL_UNWRITABLE_SEED:
    "a seed variant appears in initial bytes that may not be minted there",
  WRL_MISSING_RELATION_NAME:
    "a relation is written with no name, and a name is never derived",
  WRL_DUPLICATE_RELATION_SEED:
    "two relations in one world carry the same identity seed",
  WRL_BAD_V2_ARTIFACT:
    "a V2 artifact or one of its relation records has the wrong shape",
  WRL_BAD_RELATION_NAME:
    "a relation name is not an identifier",
  WRL_AMBIGUOUS_RELATION_NAME:
    "a relation name does not name exactly one relation",
  WRL_UNWRITABLE_RELATION:
    "a well-formed V2 relation has no form in the minimal surface",
});

/* -------------------------------------------------- the V2 source family */

export const V2_IR_VERSION = "2.0";

/**
 * The V2 admission table, in the shape A.4 established for V1.
 *
 * One row today. It is a table anyway, for the reason the V1 one is: a second
 * V2-era profile cannot then arrive without declaring which rulepack it comes
 * with, and the tuple gate below reads the table rather than three constants
 * that can drift apart.
 */
export const V2_RELATION_SOURCE_FAMILIES = deepFreeze({
  "2.0": {
    profile_id: "forge.world.core.v1",
    rulepack_id: "forge.world.core.rules.v1",
  },
});

export const V2_IR_VERSIONS =
  deepFreeze(Object.keys(V2_RELATION_SOURCE_FAMILIES));

/* ------------------------------------------------------------ the seed */

/**
 * Which allocation variants may appear in a V2 world's INITIAL bytes.
 *
 * This is a FOURTH authority, alongside the kernel's three (which variants
 * exist / which an importer may construct / which a surface may emit). The
 * question it answers is narrower than any of those: not who built the record,
 * but where the record is allowed to have been written down.
 *
 *   - `named-initial` is the native one. An author names a relation and the
 *     name is the preimage.
 *   - `legacy-edge` is admissible but IMPORT-ONLY. It records that a relation
 *     was NEVER NAMED -- its preimage is `{ kind, src, dst }`, the only name a
 *     V1 relation has -- so a migration cannot quietly invent a name for every
 *     relation it carries across and thereby make an import look like
 *     authorship. What it does NOT do is preserve an id: the world id moved,
 *     and the world id is in every allocation, so every `rel-` moves with it
 *     (§D8.5, and `D8.10` clause 5). Migration is a CORRESPONDENCE, and the
 *     seed is what makes that correspondence derivable rather than asserted.
 *     `assertAuthorableSeed` is what keeps an author out of the variant.
 *   - `granted` is absent, and its absence is the statement. A grant is drawn
 *     at RUNTIME (§D8.4) from an authority that does not exist at period 0, so
 *     a granted seed in initial bytes is a runtime fact asserted before the
 *     runtime ran.
 */
export const V2_INITIAL_SEED_VARIANTS =
  deepFreeze(["named-initial", "legacy-edge"]);

/**
 * A seed's fields: its allocation's fields, minus `world_id`.
 *
 * COMPUTED, not restated. The two shapes must differ by exactly that one
 * coordinate -- that is the definition of a seed -- and writing them out twice
 * one screen apart is how they come to differ by two. A variant that gains a
 * field in `ALLOCATION_FIELDS` gains it here, and `expandSeed` (B.2) then
 * reconstructs a record `validateAllocation` still accepts.
 *
 * `granted` is omitted from the map entirely rather than mapped to its own
 * fields, because there is no such thing as a granted SEED: `grant_id` already
 * scopes it, so removing `world_id` from it removes nothing and the record
 * would be its own seed. A variant with no world coordinate to drop is a
 * variant that is not seeded.
 */
export const V2_SEED_FIELDS = deepFreeze(Object.fromEntries(
  V2_INITIAL_SEED_VARIANTS.map((variant) => [
    variant,
    R.ALLOCATION_FIELDS[variant].filter((f) => f !== "world_id"),
  ])));

/**
 * Which variants an AUTHORING surface may write into a V2 world.
 *
 * `named-initial` only, once B.4 ships the surface. It is stated here rather
 * than reused from the kernel's `AUTHORABLE_VARIANTS` because that list is
 * about V1, where the answer is `[]` and stays `[]` -- V1 has no field to hold
 * a name, so the two lists are answers to the same question about two
 * different encodings, and merging them would make one encoding's silence read
 * as the other's permission.
 */
export const V2_AUTHORABLE_SEED_VARIANTS = deepFreeze(["named-initial"]);

/**
 * A well-formed seed of a variant initial bytes admit, or a typed refusal.
 *
 * Shape and admissibility, not authorship -- `assertAuthorableSeed` is the
 * separate question, for the reason `validateAllocation` and
 * `assertImportableAllocation` are separate: a validator that also enforced
 * provenance could not check the shape of a record it was not allowed to see.
 */
export function validateIdentitySeed(seed, where = "identity_seed") {
  if (!seed || typeof seed !== "object" || Array.isArray(seed) ||
      typeof seed.variant !== "string")
    fail("WRL_BAD_IDENTITY_SEED", "an identity seed must carry a variant tag",
         { fieldPath: `${where}.variant` });

  if (!R.ALLOCATION_VARIANTS.includes(seed.variant))
    fail("WRL_BAD_IDENTITY_SEED",
         `seed variant '${seed.variant}' is not an allocation variant ` +
         `(${R.ALLOCATION_VARIANTS.join(", ")})`,
         { fieldPath: `${where}.variant` });

  if (!V2_INITIAL_SEED_VARIANTS.includes(seed.variant))
    fail("WRL_UNWRITABLE_SEED",
         `a '${seed.variant}' allocation is not seeded into a world's ` +
         `initial bytes; initial relations are ` +
         `${V2_INITIAL_SEED_VARIANTS.join(" or ")}. A grant is drawn at ` +
         `runtime from an authority that does not exist at period 0, so a ` +
         `granted seed here is a runtime fact asserted before the runtime ran`,
         { fieldPath: `${where}.variant` });

  const want = V2_SEED_FIELDS[seed.variant];
  const have = Object.keys(seed).filter((k) => k !== "variant").sort();

  /* The circularity, named where it happens. `world_id` is the hash of the
   * bytes this seed sits inside, so a seed that carries one is either stating
   * its own container's hash before the container exists, or -- worse, because
   * it type-checks -- stating some OTHER world's, which mints this world's
   * relations under a name that world already owns. */
  if (have.includes("world_id"))
    fail("WRL_BAD_IDENTITY_SEED",
         `a seed carries no world_id: the world id is the hash of the bytes ` +
         `the seed is written in, so storing it would be stating a value the ` +
         `stored copy participates in producing. Derivation supplies it`,
         { fieldPath: `${where}.world_id` });

  /* An unnamed named-initial seed is its own code, and it is checked BEFORE
   * the field-set comparison so that it stays its own code. A missing key and
   * an empty string are the same author error, and reporting the first of them
   * as "expected { relation_name }, got { }" reads as a typo in a schema.
   *
   * §6, restated where it can be violated: never a fallback to `legacy-edge`.
   * An unnamed route under native V2 is not a route whose name can be worked
   * out from its endpoints -- deriving one would mean two authors who wired
   * the same two ports had written the same relation, and §D8.1's whole point
   * is that they have not. */
  if (seed.variant === "named-initial" &&
      (typeof seed.relation_name !== "string" || !seed.relation_name))
    fail("WRL_MISSING_RELATION_NAME",
         `a V2 relation is named by its author. This one is not, and a name ` +
         `is never derived from its endpoints and never defaulted to a ` +
         `legacy-edge seed -- both would make two independently authored ` +
         `relations over the same two ports the same relation`,
         { fieldPath: `${where}.relation_name` });

  if (W.serializeArtifact(have) !== W.serializeArtifact([...want].sort()))
    fail("WRL_BAD_IDENTITY_SEED",
         `a ${seed.variant} seed is { ${want.join(", ")} }; got ` +
         `{ ${have.join(", ")} }`, { fieldPath: where });

  for (const f of want)
    if (typeof seed[f] !== "string" || !seed[f])
      fail("WRL_BAD_IDENTITY_SEED",
           `seed field '${f}' must be a non-empty string`,
           { fieldPath: `${where}.${f}` });

  return seed;
}

/** An authoring surface's authority over V2 seeds. §6. */
export function assertAuthorableSeed(seed, where = "identity_seed") {
  validateIdentitySeed(seed, where);
  if (!V2_AUTHORABLE_SEED_VARIANTS.includes(seed.variant))
    fail("WRL_UNWRITABLE_SEED",
         `an authoring surface may write ` +
         `${V2_AUTHORABLE_SEED_VARIANTS.join(", ")} seeds, not ` +
         `'${seed.variant}'. A legacy-edge seed records that a relation ` +
         `arrived through the V1 migration and kept the id that world minted ` +
         `for it; authoring one would claim a provenance that did not happen`,
         { fieldPath: `${where}.variant` });
  return seed;
}

/** The canonical bytes a seed sorts by, and the key it is unique under. */
export const seedKey = (seed) => W.serializeArtifact(canonicalizeSeed(seed));

export function canonicalizeSeed(seed) {
  validateIdentitySeed(seed);
  const out = { variant: seed.variant };
  for (const f of V2_SEED_FIELDS[seed.variant]) out[f] = seed[f];
  return out;
}

/* ------------------------------------------------- the relation record */

/** A V2 relation record is exactly these two fields. §5. */
export const V2_RELATION_FIELDS = deepFreeze(["identity_seed", "revision"]);

/* The three values a relation record is FORBIDDEN to carry, and why they are
 * checked by name rather than caught by the exact-field-set rule above. The
 * field-set rule already refuses them, but it refuses them as "unexpected key
 * `relation_id`", which reads as a typo. Each of these is instead a specific
 * claim -- that a derived value was stored -- and the repair is to delete it
 * rather than to correct its spelling. */
const DERIVED_NEVER_STORED = deepFreeze({
  world_id: "the hash of the artifact these bytes are part of",
  relation_id: "the hash of the allocation this seed expands to",
  revision_id: "the hash of the canonical revision beside it",
});

export function validateV2Relation(rel, where = "relations[]") {
  if (!rel || typeof rel !== "object" || Array.isArray(rel))
    fail("WRL_BAD_V2_ARTIFACT", "a relation record is an object",
         { fieldPath: where });

  for (const [k, what] of Object.entries(DERIVED_NEVER_STORED))
    if (Object.prototype.hasOwnProperty.call(rel, k))
      fail("WRL_BAD_V2_ARTIFACT",
           `a relation record stores no '${k}': it is ${what}, so a stored ` +
           `copy is a second source of truth for a hash -- and the copy is ` +
           `the one a reader trusts, which is how a forged id gets believed`,
           { fieldPath: `${where}.${k}` });

  const have = Object.keys(rel).sort();
  if (W.serializeArtifact(have) !==
      W.serializeArtifact([...V2_RELATION_FIELDS].sort()))
    fail("WRL_BAD_V2_ARTIFACT",
         `a relation record is exactly { ${V2_RELATION_FIELDS.join(", ")} }; ` +
         `got { ${have.join(", ")} }`, { fieldPath: where });

  validateIdentitySeed(rel.identity_seed, `${where}.identity_seed`);
  R.validateRelationRevision(rel.revision);
  return rel;
}

/**
 * The canonical relation record: canonical seed, canonical revision.
 *
 * The revision is canonicalised by the kernel unchanged, which is the point of
 * B.1a's structured terminals. §D8.3 says the same relation structure in two
 * worlds yields the same `revision_id`; if V2 carried `{ object_id, port }`
 * and V1 carried `"p0.sig_out"`, that law would stop holding across exactly
 * the migration it exists to make checkable.
 */
export function canonicalizeV2Relation(rel) {
  validateV2Relation(rel);
  return {
    identity_seed: canonicalizeSeed(rel.identity_seed),
    revision: R.canonicalizeRelationRevision(rel.revision),
  };
}

/* ---------------------------------------------------------- the artifact */

/** The top-level keys the relation layer owns. Everything else passes through. */
export const V2_REQUIRED_KEYS =
  deepFreeze(["ir_version", "profile_id", "semantic_policies", "objects",
              "relations"]);

/**
 * Admit a V2 artifact, or refuse it with the coordinate that failed.
 *
 * The tuple gate is A.4's, moved one version along: `(ir_version, profile_id,
 * rulepack_id)`, each coordinate answering with its own code, because "this
 * version is not one I read" and "this rulepack is not the one that version
 * declares" are different repairs.
 */
export function assertV2Artifact(artifact) {
  if (!artifact || typeof artifact !== "object" || Array.isArray(artifact))
    fail("WRL_BAD_V2_ARTIFACT", "an artifact must be a record");

  const family = Object.prototype.hasOwnProperty.call(
    V2_RELATION_SOURCE_FAMILIES, artifact.ir_version)
      ? V2_RELATION_SOURCE_FAMILIES[artifact.ir_version] : undefined;
  if (!family)
    fail("WRL_UNSUPPORTED_IR_VERSION",
         `ir_version ${JSON.stringify(artifact.ir_version)} is outside the ` +
         `V2 family this encoder reads (${V2_IR_VERSIONS.join(", ")})`,
         { fieldPath: "ir_version" });

  if (artifact.profile_id !== family.profile_id)
    fail("WRL_UNSUPPORTED_PROFILE",
         `ir_version ${artifact.ir_version} names profile ` +
         `'${family.profile_id}', and this artifact declares ` +
         `${JSON.stringify(artifact.profile_id)}`,
         { fieldPath: "profile_id" });

  const rulepack = artifact.semantic_policies?.rulepack_id;
  if (rulepack !== family.rulepack_id)
    fail("WRL_UNSUPPORTED_RULEPACK",
         `family ${artifact.ir_version} declares rulepack ` +
         `'${family.rulepack_id}' and this artifact declares ` +
         `${JSON.stringify(rulepack)}. The rulepack is copied into every ` +
         `relation's policy, so an unrecognised one is sealed into revision ` +
         `identity`,
         { fieldPath: "semantic_policies.rulepack_id" });

  /* §4, the near half. The far half is `WRL_RELATIONS_IN_V1` in the V1
   * adapter, and the pair is what makes "replaces" mean replaces: neither
   * encoding treats the other's topology key as extra data it may ignore. */
  if (Object.prototype.hasOwnProperty.call(artifact, "edges"))
    fail("WRL_LEGACY_EDGES_IN_V2",
         `a ${artifact.ir_version} artifact encodes its topology in ` +
         `'relations', which REPLACES 'edges' rather than extending it. An ` +
         `artifact carrying both states two topologies, and a reader that ` +
         `preferred one would be deciding the world's meaning by which key ` +
         `it happened to look at first`,
         { fieldPath: "edges" });

  if (!Array.isArray(artifact.relations) || !Array.isArray(artifact.objects))
    fail("WRL_BAD_V2_ARTIFACT",
         "a V2 artifact carries objects and relations arrays");

  for (const k of V2_REQUIRED_KEYS)
    if (!Object.prototype.hasOwnProperty.call(artifact, k))
      fail("WRL_BAD_V2_ARTIFACT", `a V2 artifact carries '${k}'`,
           { fieldPath: k });

  /* The profile still has to declare a domain, for the same reason V1's does:
   * `domain` is a profile-declared namespace, and a V2 relation states one
   * explicitly rather than inheriting it -- but the encoder cannot check that
   * the stated one belongs to the profile without the profile saying so. */
  R.profileDefaultDomain(artifact.profile_id);
  return artifact;
}

/**
 * The canonical V2 artifact.
 *
 * Two array orders are decided here and one is not. `relations` sorts by
 * canonical seed bytes (§5). `objects` keeps V1's `(role, object_id)` order,
 * unchanged, because V2 changes the TOPOLOGY encoding and nothing else -- and
 * a canonicalisation that quietly reordered the objects too would make every
 * migrated world's bytes differ for a reason unrelated to the change being
 * made. Endpoint order inside a revision is the kernel's, untouched.
 *
 * Key order is not decided here at all: `serializeArtifact` sorts keys
 * recursively, so an object's field order is not in its bytes.
 */
export function canonicalizeV2Artifact(artifact) {
  assertV2Artifact(artifact);

  const relations = artifact.relations.map(canonicalizeV2Relation);

  /* Unique under the seed, and the refusal is sharper than "duplicate entry".
   * Two relations sharing a seed expand to one allocation and therefore one
   * `relation_id`, so the world cannot say which of the two a later revision
   * revises -- the same defect `checkRelationKeys` catches in V1, arriving
   * through the field an author now controls directly. */
  const seen = new Map();
  for (const rel of relations) {
    const key = W.serializeArtifact(rel.identity_seed);
    if (seen.has(key))
      fail("WRL_DUPLICATE_RELATION_SEED",
           `two relations carry the identity seed ${key}. A seed is the ` +
           `whole preimage of a relation_id, so a second relation under it ` +
           `is not a duplicate line -- it is a relation that cannot be ` +
           `revised or retired independently of the first`,
           { fieldPath: "relations" });
    seen.set(key, true);
  }

  relations.sort((a, b) => {
    const x = W.serializeArtifact(a.identity_seed);
    const y = W.serializeArtifact(b.identity_seed);
    return x < y ? -1 : x > y ? 1 : 0;
  });

  const objects = artifact.objects.slice().sort((a, b) =>
    cmp(a.role, b.role) || cmp(a.object_id, b.object_id));

  return { ...artifact, objects, relations };
}

/** Canonical bytes. The value `sem-` hashes below, and nothing else. */
export function serializeV2Artifact(artifact) {
  return W.serializeArtifact(canonicalizeV2Artifact(artifact));
}

/* =========================================================== B.2: identity */
/*
 * Everything above decides BYTES. Everything below hashes them, in the order
 * §5 of the ruling fixes:
 *
 *     canonicalize -> world_id from those bytes -> expand seed into an
 *     allocation -> relation_id -> revision_id
 *
 * The order is not a style note, it is the dependency graph. Each arrow is a
 * value that cannot be computed before the one to its left exists, and the two
 * places this scheme can go wrong are both places where someone is tempted to
 * skip an arrow: deriving from an artifact that was never canonicalized (so
 * two spellings of one world mint two sets of relations), or accepting a
 * `world_id` from the caller instead of recomputing it (so a forged seal mints
 * real-looking ids). V1 shipped the second bug and `worldIdOfArtifact` is the
 * fix; V2 inherits the fix rather than re-earning it.
 */

/**
 * A seed, plus the world it was written in, is an allocation. §D8.1.
 *
 * This is the inverse of the equation `V2_SEED_FIELDS` states, and it is the
 * only place the missing coordinate is supplied. The result is handed to the
 * KERNEL's `validateAllocation` rather than to a local check, so a seed that
 * reconstructs into something §D8.1 would not accept is refused by the section
 * that defines the preimage -- if the two ever disagreed, the disagreement
 * would show up as a `rel-` id that exists and is wrong, which no round trip
 * can see.
 */
export function expandSeed(worldId, seed) {
  validateIdentitySeed(seed);
  const allocation = { variant: seed.variant, world_id: worldId };
  for (const f of V2_SEED_FIELDS[seed.variant]) allocation[f] = seed[f];
  return R.validateAllocation(allocation);
}

/**
 * The world id a V2 artifact ACTUALLY hashes to.
 *
 * `sem-`, not a new prefix. A world id names a sealed world, and V1 and V2 are
 * two encodings of a world rather than two kinds of thing -- a `sem2-` would
 * make every consumer that holds a world id ask which family produced it, to
 * answer a question it never has to ask. What DOES change is the value: the
 * same topology written in the two encodings is two different byte strings and
 * therefore two different worlds, which is exactly what §7 means by saying a
 * downgrade produces a new artifact with a different id. Identity is a
 * function of bytes, and the encoding is in the bytes.
 */
export async function v2WorldIdOfArtifact(artifact) {
  return "sem-" + await sha256Hex(serializeV2Artifact(artifact));
}

/**
 * The relation view of a sealed V2 world: `rel-` and `rev-` for every relation.
 *
 * The shape mirrors `deriveRelations`, and the two flags that differ are the
 * whole difference between the families. In V1 the relation records are not in
 * the artifact at all -- the projection invents them from `edges`. In V2 the
 * SEED and the REVISION are canonical artifact content, and only the three ids
 * are derived. So `seedsInArtifactBytes` is true here and false there, and
 * `idsInArtifactBytes` is false in both: a stored id is a second source of
 * truth for a hash, which `DERIVED_NEVER_STORED` refuses at the door.
 *
 * `claimedSemanticId` is optional and CHECKED, for the reason V1's is.
 */
export async function deriveV2Relations(artifact, claimedSemanticId = null) {
  const canonical = canonicalizeV2Artifact(artifact);
  const worldId = "sem-" + await sha256Hex(W.serializeArtifact(canonical));

  if (claimedSemanticId !== null && claimedSemanticId !== worldId)
    fail("WRL_SEMANTIC_ID_MISMATCH",
         `the supplied artifact hashes to ${worldId}, and the caller claims ` +
         `${claimedSemanticId}. Relation identity is derived from the seal, ` +
         `so the seal is recomputed rather than believed`,
         { fieldPath: "semantic_artifact_id" });

  const relations = [];
  for (const rel of canonical.relations) {
    const allocation = expandSeed(worldId, rel.identity_seed);
    relations.push({
      identity_seed: rel.identity_seed,
      allocation,
      relation_id: await R.relationIdFromAllocation(allocation),
      revision: rel.revision,
      revision_id: await R.relationRevisionId(rel.revision),
    });
  }

  return {
    derived: true,
    seedsInArtifactBytes: true,
    idsInArtifactBytes: false,
    world_id: worldId,
    note: "RelationID and RelationRevisionID for the period-0 relations " +
          "written into this world. Both are functions of the sealed bytes " +
          "and neither is stored in them.",
    relations,
  };
}

/* ========================================================== B.3: migration */
/*
 * V1 -> V2, and the explicit downgrade back.
 *
 * THE THING THIS SLICE MUST NOT CLAIM
 * -----------------------------------
 * That a migrated relation keeps its id. It cannot: the world id moved, the
 * world id is in every allocation, so every `rel-` moves (§D8.5, D8.10 clause
 * 5). What survives is the `rev-`, because a revision is standalone -- and
 * that is the entire useful content of a migration. The relation's STRUCTURE
 * is carried across intact and its NAME is not, so the statement "these two
 * are the same relation" is a claim someone makes, not a fact the bytes show.
 *
 * The `legacy-edge` seed is what makes that claim derivable rather than
 * asserted. It records that the relation was never named -- its preimage is
 * `{ kind, src, dst }`, which is the only name a V1 relation has -- so the two
 * worlds can be indexed by the same key and paired without either side being
 * asked to remember the other. The alternative, minting a `named-initial` seed
 * per edge, would be a migration inventing a name for every relation it
 * touched, which makes an import look like authorship and collides with the
 * first author who later writes that name deliberately.
 */

/**
 * Which seed variants the V1 -> V2 migration may mint.
 *
 * REUSED from the kernel rather than restated, and the difference from
 * `V2_AUTHORABLE_SEED_VARIANTS` -- which is deliberately NOT reused -- is
 * worth being precise about, because the two look like the same kind of list:
 *
 *   IMPORTABLE is a question about the SOURCE encoding. "What can be minted
 *   from a V1 artifact?" has one answer no matter what is being written into,
 *   and the answer is forced by a fact about V1: it has no field for a name.
 *
 *   AUTHORABLE is a question about the TARGET encoding's surface. "What may an
 *   author write?" is answered by V1 with `[]` and by V2 with `named-initial`,
 *   so merging those two lists would make one encoding's silence read as the
 *   other's permission.
 */
export const V2_IMPORTABLE_SEED_VARIANTS = R.IMPORTABLE_VARIANTS;

/** The migration's authority, mirroring `assertImportableAllocation`. */
export function assertImportableSeed(seed, where = "identity_seed") {
  validateIdentitySeed(seed, where);
  if (!V2_IMPORTABLE_SEED_VARIANTS.includes(seed.variant))
    fail("WRL_UNWRITABLE_SEED",
         `the V1 migration may mint ` +
         `${V2_IMPORTABLE_SEED_VARIANTS.join(", ")} seeds, not ` +
         `'${seed.variant}'. A V1 artifact records only { kind, src, dst } ` +
         `per edge and has no field a name could come from, so minting one ` +
         `here would be the migration authoring relations on the author's ` +
         `behalf`, { fieldPath: `${where}.variant` });
  return seed;
}

/** The seed a V1 edge migrates to: its legacy allocation, minus the world. */
export function legacyEdgeSeed(edge) {
  if (!edge || typeof edge.kind !== "string" ||
      typeof edge.src !== "string" || typeof edge.dst !== "string")
    fail("WRL_BAD_IDENTITY_SEED",
         "a V1 edge carries kind, src and dst", { fieldPath: "edges[]" });
  return assertImportableSeed(
    { variant: "legacy-edge", kind: edge.kind, src: edge.src, dst: edge.dst });
}

/**
 * A V1 artifact, re-encoded as a V2 one. Pure: nothing here hashes.
 *
 * Every key but `ir_version` and `edges` passes through untouched, which is
 * the point -- a migration that also normalised `objects`, or reached into
 * `schemas`, would make the resulting world differ from its source for reasons
 * unrelated to the encoding change, and no test could then attribute a moved
 * id to the migration.
 *
 * The revisions come from §D8.8's importer unchanged, so the four V1-fixed
 * fields arrive at their fixed values. V2 makes them WRITABLE; it does not
 * retroactively make the migrated world have said something else.
 */
export function migrateV1ToV2(v1artifact) {
  R.assertV1Artifact(v1artifact);

  const relations = v1artifact.edges.map((edge) => ({
    identity_seed: legacyEdgeSeed(edge),
    revision: R.edgeToRelationRevision(v1artifact, edge),
  }));

  const out = {};
  for (const k of Object.keys(v1artifact))
    if (k !== "ir_version" && k !== "edges") out[k] = v1artifact[k];
  out.ir_version = V2_IR_VERSION;
  out.relations = relations;

  return canonicalizeV2Artifact(out);
}

/**
 * A V2 artifact, written back down into a named member of the V1 family. §7.
 *
 * The target version is a REQUIRED argument and not a remembered one. V2 does
 * not record which V1 version it was migrated from, because a value that
 * remembered its own provenance would be history stored in a field -- the
 * defect §D8.3 puts on the ledger instead. So a downgrade is a choice about
 * which V1 family member to write, and the caller makes it.
 *
 * The result is a NEW artifact with its own `sem-`, and §7 read literally --
 * "a different sem- ID" -- turns out to be true of the ORIGINAL V1 world too,
 * not only of the V2 one. The round trip preserves the relation SET and not
 * the byte string, and the reason is not that either encoding is careless
 * about order. Both canonicalise it. They disagree about the KEY. V1 sorts
 * `edges` by the tuple it stores them as, `(kind, src, dst)`; V2 sorts
 * `relations` by canonical `identity_seed` bytes, and those bytes are
 * key-sorted JSON, so a `legacy-edge` seed compares on `dst` before `kind`
 * before `src`. Two total orders over the same set, neither of them the order
 * anybody typed.
 *
 * So a V1 world whose edges happen to agree on both keys round-trips
 * byte-exactly, and one that does not comes back permuted, with a new id.
 * That is a normalisation rather than a loss of content -- the second round
 * trip is a fixed point -- but it is a real difference and the honest report
 * is that the id moves. An order that is derived from the record is not
 * arbitrary, but it is only canonical WITHIN an encoding: the two encodings
 * cannot both be right about a single sequence, and on the way back the one
 * that decides is the one whose canonical form is being written.
 */
export function downgradeV2ToV1(v2artifact, irVersion) {
  assertV2Artifact(v2artifact);

  if (!R.V1_IR_VERSIONS.includes(irVersion))
    fail("WRL_UNSUPPORTED_IR_VERSION",
         `a downgrade names the V1 version it writes; ` +
         `${JSON.stringify(irVersion)} is not one of ` +
         `${R.V1_IR_VERSIONS.join(", ")}. V2 does not remember which V1 ` +
         `version it came from, because a value that recorded its own ` +
         `provenance would be history stored in a field`,
         { fieldPath: "ir_version" });

  const canonical = canonicalizeV2Artifact(v2artifact);
  const edges = canonical.relations.map(
    (rel) => R.projectRelationRevisionToV1Edge(rel.revision));

  const out = {};
  for (const k of Object.keys(canonical))
    if (k !== "ir_version" && k !== "relations") out[k] = canonical[k];
  out.ir_version = irVersion;
  out.edges = edges;

  return R.assertV1Artifact(out);
}

/**
 * The correspondence between a sealed V1 world and a sealed V2 world.
 *
 * Deliberately the same SHAPE as `deriveLegacyEdgeCorrespondence`, so that the
 * kernel's `candidateImportedFacts` and `checkRelationImported` verify a
 * cross-family migration with no new checker. §D8.5 asks for one checkable
 * claim, not one per encoding pair.
 *
 * Both sides index by the legacy edge key, which each side already holds for
 * its own reasons: V1 because that key IS its relation's preimage, V2 because
 * the migrated seed preserved it. Neither world is read for anything but its
 * own relations, and no id from one enters a preimage in the other.
 *
 * `identityPreserved` is false whenever the worlds differ, which for a real
 * migration is always -- and that is the honest answer, not a limitation. A
 * migration that reported preserved identity would be claiming the thing
 * §D8.5 exists to deny.
 */
export async function migrationCorrespondence(sealedV1, sealedV2) {
  const need = (side, w) => {
    if (!w || typeof w !== "object" || !w.artifact)
      fail("WRL_MALFORMED_ARTIFACT",
           `the ${side} side must be a sealed world: { artifact, semanticId }`,
           { fieldPath: side });
    return typeof w.semanticId === "string" ? w.semanticId : null;
  };

  const fromView = await R.deriveRelations(
    sealedV1.artifact, need("from_world", sealedV1));
  const toView = await deriveV2Relations(
    sealedV2.artifact, need("to_world", sealedV2));

  const key = (o) => W.serializeArtifact(
    { kind: o.kind, src: o.src, dst: o.dst });

  const a = new Map(fromView.relations.map((r) => [key(r.allocation), r]));
  const b = new Map();
  for (const r of toView.relations) {
    /* A V2 world may hold NAMED relations too, and a named one has no legacy
     * key to pair on. It is not "dropped" -- nothing was lost -- it simply has
     * no counterpart in a V1 world, which is what `added` records. */
    if (r.identity_seed.variant !== "legacy-edge") continue;
    b.set(key(r.identity_seed), r);
  }
  const named = toView.relations.filter(
    (r) => r.identity_seed.variant !== "legacy-edge");

  const pairs = [], dropped = [], added = [];
  for (const k of [...a.keys()].sort()) {
    if (b.has(k))
      pairs.push({ key: k, from_relation: a.get(k).relation_id,
                   to_relation: b.get(k).relation_id });
    else
      dropped.push({ key: k, relation_id: a.get(k).relation_id });
  }
  for (const k of [...b.keys()].sort())
    if (!a.has(k))
      added.push({ key: k, relation_id: b.get(k).relation_id });
  for (const r of named)
    added.push({ key: W.serializeArtifact(r.identity_seed),
                 relation_id: r.relation_id });
  added.sort((x, y) => cmp(x.key, y.key));

  return {
    derived: true,
    canonical: false,
    inArtifactBytes: false,
    from_world: fromView.world_id,
    to_world: toView.world_id,
    identityPreserved: fromView.world_id === toView.world_id,
    pairs, dropped, added,
  };
}

/* ============================================================ B.4: surface */
/*
 * The minimal named-relation surface. §9: `[clock_feed]: [p0] --sig--> [r0]`.
 *
 * WHAT THIS SLICE IS ALLOWED TO BE
 * -------------------------------
 * A V2 source is a V1 source whose route lines carry a name. That is the
 * whole language change, and it is deliberately the whole language change:
 * every other line -- the profile header, object declarations, comments,
 * sugar -- is handed to the FROZEN spine untouched, so the surface cannot
 * quietly become a second parser that agrees with `wrl.js` today and drifts
 * from it later.
 *
 * The mechanism is a strip and a re-attach. Names come off the front of their
 * lines WITHOUT changing the line count, `W.sealWorld` does all the parsing
 * and all the validation, and the names go back on afterwards.
 *
 * THE PAIRING, WHICH IS THE ONLY HARD PART
 * ----------------------------------------
 * Re-attaching by line INDEX is wrong, twice over. Sugar can expand one
 * authored line into several emitted ones, and `canonicalizeGraph` SORTS the
 * edges, so the parsed order is a canonical order and not the order anyone
 * typed (the same fact `downgradeV2ToV1` reports about the round trip). An
 * index-based zip would silently attach the wrong name to the wrong relation,
 * and every id downstream would be wrong in a way no round-trip test catches.
 *
 * So the pairing is DERIVED, from provenance the spine already keeps:
 * `desugarCoreMapped` records a `sourceLine` for every emitted line, and the
 * parser stamps its emitted line onto each edge. Following that back gives,
 * for each authored line, exactly the relations it produced -- through any
 * amount of sugar and regardless of what order the parser hands them back.
 *
 * That same map is also how the surface knows which lines are ROUTES without
 * restating `wrl.js`'s edge grammar: a route line is a line that produced an
 * edge. A line the author must name is identified by what it did, not by a
 * regex kept in step with a frozen one by hand.
 *
 * WHY THERE IS NO `ir_version 2.0` HEADER
 * ---------------------------------------
 * AUTONOMOUS DECISION, flagged for review. §9 rules exactly one spelling and
 * it is a per-route one, so a document-level header would be a second, unruled
 * piece of V2 syntax. Instead the ENCODING IS THE CALLER'S CHOICE:
 * `parseNamedWorld` is the V2 parser, `W.sealWorld` is the V1 one, and a
 * source is native V2 because it was handed to the V2 parser. This keeps
 * §9's `WRL_MISSING_RELATION_NAME` meaningful -- "unnamed route under native
 * V2" needs "native V2" to be a fact about the request, since an unnamed route
 * under V1 is simply a route.
 */

/**
 * The shape of a relation name.
 *
 * An identifier, matching what object ids already look like, because a name
 * that could contain `]` or whitespace could not be told from the route it
 * prefixes. Uniqueness is NOT enforced here -- see `parseNamedWorld`.
 */
export const RELATION_NAME_RE = /^[A-Za-z_]\w*$/;

/**
 * The name prefix, detected LOOSELY and then validated.
 *
 * The loose bracket body is on purpose: `/^\s*\[(\w+)\]:/` would let
 * `[clock-feed]:` fall through to the core parser and come back as a syntax
 * error about a route, sending the author to look at the arrow. Catching
 * anything in brackets followed by a colon and then judging the name gives the
 * typed refusal instead.
 *
 * It cannot collide with a declaration or an epoch line. Both spell their
 * colon INSIDE the brackets -- `[pulser:p0]`, `[epoch:1]` -- so neither has
 * the `]:` this needs.
 */
const NAME_PREFIX_RE = /^(\s*)\[([^\]]*)\]:\s*(.*)$/;

/** A relation name, as the seed §D8.1 mints from it. */
export function namedInitialSeed(relationName, opts = {}) {
  if (typeof relationName !== "string" || !RELATION_NAME_RE.test(relationName))
    fail("WRL_BAD_RELATION_NAME",
         `a relation name is an identifier; ` +
         `${JSON.stringify(relationName)} is not. The name is the whole ` +
         `preimage of a named-initial allocation, so a name that could not be ` +
         `written back out unambiguously is an id that cannot be re-derived`,
         { fieldPath: "identity_seed.relation_name", ...opts });
  return assertAuthorableSeed(
    { variant: "named-initial", relation_name: relationName });
}

/**
 * A V2 source, split into the V1 source it wraps and the names it carried.
 *
 * LINE-PRESERVING, in the sense that matters: the result has the same number
 * of lines, in the same order, so every line number the spine reports about
 * the stripped text is a line number in the source the author wrote. Columns
 * move and nothing reads them.
 *
 * `names` is keyed by 1-based source line, not by name, because at this point
 * a name has not yet been shown to denote anything -- the line is what is
 * known, and the name is what is claimed about it.
 */
export function stripRelationNames(source) {
  if (typeof source !== "string")
    fail("WRL_MALFORMED_ARTIFACT", "a world source must be a string");

  const names = new Map();
  const lines = source.split("\n").map((raw, idx) => {
    const semi = raw.indexOf(";");
    const code = semi === -1 ? raw : raw.slice(0, semi);
    const tail = semi === -1 ? "" : raw.slice(semi);
    const m = NAME_PREFIX_RE.exec(code);
    if (!m) return raw;
    const [, indent, name, rest] = m;
    namedInitialSeed(name, { line: idx + 1 });   /* typed refusal, at the line */
    names.set(idx + 1, name);
    return indent + rest + tail;
  });

  return { source: lines.join("\n"), names };
}

/**
 * A named V2 world source, sealed into a V2 artifact. The V2 `sealWorld`.
 *
 * Returns `{ ok: true, source, denamed, v1, artifact, names }` or the same
 * `{ ok: false, code, message, line, ... }` shape the spine returns, so a
 * caller handles one result type whichever encoding it asked for.
 *
 * `v1` is kept because it is not a by-product: it is the artifact the spine
 * actually validated, and every check that a V2 world is a WELL-FORMED world
 * -- known endpoints, controller counts, port signatures -- happened to it.
 * V2 adds names to relations; it does not re-litigate what a legal world is.
 *
 * The revisions come from §D8.8's importer, exactly as the migration's do.
 * The surface and the migration differ in ONE field -- the seed -- and that
 * is the honest size of the difference between authoring a relation and
 * carrying one across.
 */
export async function parseNamedWorld(source) {
  let denamed, names;
  try {
    ({ source: denamed, names } = stripRelationNames(source));
  } catch (e) {
    if (e instanceof W.WrlError) return { ok: false, ...W.mapDiagnostic(e) };
    throw e;
  }

  const sealed = await W.sealWorld(denamed);
  if (!sealed.ok) return sealed;

  try {
    /* Each authored line, and the relations it actually produced. Derived
     * from the spine's own provenance -- never from line order. */
    const produced = new Map();
    for (const edge of sealed.graph.edges) {
      const o = sealed.origins[edge.line - 1];
      const at = o && o.emittedLine === edge.line ? o.sourceLine : edge.line;
      if (!produced.has(at)) produced.set(at, []);
      produced.get(at).push({ kind: edge[0], src: edge[1], dst: edge[2] });
    }

    /* §9: an unnamed route under native V2 is an error, and never a name
     * derived from the endpoints. */
    for (const at of [...produced.keys()].sort((a, b) => a - b))
      if (!names.has(at))
        fail("WRL_MISSING_RELATION_NAME",
             `the route on line ${at} has no name. A V2 relation's identity ` +
             `is its name, and a name is never derived from its endpoints -- ` +
             `deriving one would make renaming an object silently re-mint the ` +
             `relation`, { line: at });

    /* and a name denotes exactly one relation. Zero and many are the same
     * fault -- the name fails to denote -- so they share a code.
     *
     * Keyed by LINE, not by name. Keying by name was the first spelling and
     * it was wrong in a way that looked like a feature: a repeated name
     * OVERWROTE its earlier entry, one relation then came out unnamed, and
     * the duplicate was reported as a missing name at the wrong place. A
     * surface that de-duplicates its input cannot hand the encoder the
     * collision the encoder exists to refuse. */
    const nameOf = new Map();
    for (const [at, name] of names) {
      const edges = produced.get(at) || [];
      if (edges.length !== 1)
        fail("WRL_AMBIGUOUS_RELATION_NAME",
             `the name '${name}' on line ${at} names ` +
             (edges.length === 0
               ? `no relation -- the line declares or configures something, ` +
                 `and only a route has an identity to name`
               : `${edges.length} relations, because the line expands into ` +
                 `that many routes. Each relation needs its own name; one ` +
                 `name over several would make one id out of several`),
             { line: at });
      /* the edge key is unique within an artifact -- the spine guarantees it
       * -- so the re-attach never depends on array order */
      const e = edges[0];
      nameOf.set(W.serializeArtifact([e.kind, e.src, e.dst]), name);
    }

    const relations = sealed.artifact.edges.map((edge) => {
      const name = nameOf.get(
        W.serializeArtifact([edge.kind, edge.src, edge.dst]));
      if (name === undefined)
        fail("WRL_MISSING_RELATION_NAME",
             `the relation ${edge.src} --${edge.kind}--> ${edge.dst} came out ` +
             `of the parse with no authored line to take a name from`,
             { locator: `${edge.src}->${edge.dst}` });
      return {
        identity_seed: namedInitialSeed(name),
        revision: R.edgeToRelationRevision(sealed.artifact, edge),
      };
    });

    const out = {};
    for (const k of Object.keys(sealed.artifact))
      if (k !== "ir_version" && k !== "edges") out[k] = sealed.artifact[k];
    out.ir_version = V2_IR_VERSION;
    out.relations = relations;

    /* A repeated name is a repeated SEED, and the encoder already refuses
     * that. The surface deliberately has no duplicate-name rule of its own:
     * a second one could disagree with the first, and the encoder's is the
     * one that decides bytes. */
    return { ok: true, source, denamed, v1: sealed.artifact, names,
             artifact: canonicalizeV2Artifact(out) };
  } catch (e) {
    if (e instanceof W.WrlError) return { ok: false, ...W.mapDiagnostic(e) };
    throw e;
  }
}

/* ========================================================== B.5: the closure */
/*
 * The formatter, the round trip, and what a V2 world is actually FOR.
 *
 * WHAT A FORMATTER MAY NOT DO
 * ---------------------------
 * Emit text its own parser reads back as something else. `formatCore` learned
 * that the hard way -- it once wrote a `[mailbox:m]` line `parseWrlCore` then
 * refused -- and the V2 formatter inherits both the lesson and the mechanism:
 * it does not know the route grammar. It asks the FROZEN formatter for the V1
 * source, then finds the route lines the same way `parseNamedWorld` does, by
 * following the parser's own provenance back to the line each edge came from.
 * Neither direction of the surface contains a copy of the arrow syntax.
 *
 * TWO WORLDS THIS SURFACE CANNOT WRITE, AND SAYS SO
 * ------------------------------------------------
 * Both are real V2 worlds that the minimal surface has no text for, and both
 * are refused rather than approximated:
 *
 *   1. A world with `legacy-edge` seeds -- every MIGRATED world. Its relations
 *      have no names, and §9 gives the surface no way to write a route
 *      without one. So a migration produces a world that runs, seals and can
 *      be compared, but cannot be handed back to an author as text until
 *      someone names its relations. That is a real limit of a minimal surface
 *      and is FLAGGED for review, not papered over: the alternative -- letting
 *      the formatter mint names -- is the one thing §D8.1 forbids.
 *
 *   2. A world with two relations over the SAME terminals. V2 keys relations
 *      by name, so this is well-formed V2 and is the multigraph V1 could never
 *      have; but the route line it would print is the same line twice, and the
 *      spine refuses a duplicate edge key. A formatter that emitted it anyway
 *      would produce text that seals to a different world than the one it was
 *      given -- silently, and only for the world V2 exists to make possible.
 */

/**
 * A V2 artifact, written back out as V2 source. The inverse of
 * `parseNamedWorld`, and the round trip is a law rather than a hope.
 *
 * Routes come out in V2's canonical order -- sorted by seed bytes -- and not
 * in V1's. That is not a preference: route order in the SOURCE decides
 * nothing, because the spine sorts it, so emitting the order this encoding's
 * own bytes are in is the choice that restates nothing.
 */
export function formatNamedWorld(v2artifact) {
  assertV2Artifact(v2artifact);
  const canonical = canonicalizeV2Artifact(v2artifact);

  const nameOf = new Map();
  const edges = [];
  for (const rel of canonical.relations) {
    const seed = rel.identity_seed;
    if (seed.variant !== "named-initial")
      fail("WRL_UNWRITABLE_SEED",
           `a '${seed.variant}' relation has no source form: the surface ` +
           `writes a name, and this relation does not have one. A migrated ` +
           `world runs, seals and compares, but is not authorable text until ` +
           `its relations are named -- and a formatter that minted the names ` +
           `itself would be deriving identity, which §D8.1 forbids`,
           { fieldPath: "relations[].identity_seed.variant" });

    const e = R.projectRelationRevisionToV1Edge(rel.revision);
    const key = W.serializeArtifact([e.kind, e.src, e.dst]);
    if (nameOf.has(key))
      fail("WRL_UNWRITABLE_RELATION",
           `'${nameOf.get(key)}' and '${seed.relation_name}' are two ` +
           `relations over the same terminals. That is well-formed V2 -- ` +
           `relations are keyed by name -- and it is the multigraph V1 could ` +
           `never have, but the minimal surface writes one route per line and ` +
           `the spine refuses a duplicate edge key, so there is no text for ` +
           `it that reads back as this world`,
           { locator: `${e.src}->${e.dst}` });

    nameOf.set(key, seed.relation_name);
    edges.push([e.kind, e.src, e.dst]);
  }

  const g = new W.WrlGraph();
  g.profile = canonical.profile_id;
  g.nodes = canonical.objects.map(
    (o) => [o.role, o.object_id, o.static_config]);
  g.edges = edges;

  /* the frozen formatter writes the world; the name prefixes go on afterwards,
   * at lines found by provenance rather than by matching an arrow */
  const text = W.formatCore(g);
  const { origins } = W.desugarCoreMapped(text);
  const lines = text.split("\n");
  for (const edge of W.parseWrlCore(W.desugarCore(text)).edges) {
    const o = origins[edge.line - 1];
    const at = (o && o.emittedLine === edge.line ? o.sourceLine : edge.line) - 1;
    const name = nameOf.get(
      W.serializeArtifact([edge[0], edge[1], edge[2]]));
    lines[at] = `[${name}]: ${lines[at]}`;
  }
  return lines.join("\n");
}

/**
 * The V1 artifact a V2 world runs as. The consumer side of the encoding.
 *
 * V2 changes how topology is WRITTEN, not what a world IS, so nothing
 * downstream of the seal needs to learn a second encoding. This is the
 * function that says so: it returns the V1 artifact, and the artifact it
 * returns is the one the spine validated on the way in.
 *
 * It is `downgradeV2ToV1` under a name that states the intent, because the
 * two callers want different things from the same operation -- one is writing
 * a V1 world down, the other is feeding a runtime -- and a caller who reads
 * `downgrade` at a runtime boundary will eventually wonder what was lost.
 * Nothing is: the relations project through §D8.8's V1-fixed fields, which is
 * the same adapter the migration used in the other direction.
 */
export function runnableV1Artifact(v2artifact,
                                   irVersion = R.V1_IR_VERSIONS[0]) {
  return downgradeV2ToV1(v2artifact, irVersion);
}

/* -------------------------------------------------------------- internals */

/* Same digest the spine uses, private for the same reason it is private
 * there. A third copy is worse than a third import, but the frozen layer's
 * export surface is not a derived module's to widen. */
async function sha256Hex(text) {
  const buf = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0")).join("");
}

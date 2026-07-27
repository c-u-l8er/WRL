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
 * WHAT THIS MODULE VALIDATES (B.6, and it used to be the opposite)
 * ----------------------------------------------------------------
 * Through B.5 this header said the module was "a relation-layer encoder, not a
 * whole-artifact validator", and that `schemas`, `objects`' internal shape and
 * the non-rulepack policy ids "pass through untouched" because checking them
 * "would duplicate `wrl.js`'s validation in a module that cannot be the one
 * that fails first". Every clause of that was true except the conclusion. This
 * module IS the one that fails first -- nothing downstream of a sealed V2
 * artifact ever ran the frozen validator -- so `domain: "banana"`, kind
 * `"WarpTunnel"`, a terminal naming an object that does not exist, port
 * `"made_up"`, two objects sharing an id and role `"Alien"` all sealed, and
 * each got a real `sem-`.
 *
 * So it validates the whole world now, and it does so WITHOUT restating a
 * registry: `assertV2World` derives the V1 world the artifact describes and
 * hands it to `wrl.js`'s own `graphToIr`. Duplicating the validation was never
 * the alternative to skipping it. Delegating to it was.
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
  WRL_V2_WORLD_MISMATCH:
    "a V2 artifact states a derived field that its own world does not derive",
  WRL_MISSING_IR_HEADER:
    "a V2 source does not declare which encoding it is written in",
  WRL_DUPLICATE_IR_HEADER:
    "a V2 source declares its encoding more than once",
  WRL_MALFORMED_IR_HEADER:
    "a V2 source's encoding declaration is not one version token",
  WRL_UNKNOWN_RELATION:
    "an adoption names a relation the world does not have",
  WRL_DUPLICATE_ADOPTION:
    "one relation is adopted twice, under two names",
  WRL_INCOMPLETE_ADOPTION:
    "an adoption leaves a legacy relation unnamed, and would seal it that way",
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
 * DERIVED, not restated: the kernel's `AUTHORABLE_VARIANTS` says which
 * variants an author may mint at all, `V2_INITIAL_SEED_VARIANTS` says which
 * may appear in a world's initial bytes, and this is the intersection. It used
 * to be a local literal beside a comment explaining that the kernel's list was
 * "about V1, where the answer is `[]` and stays `[]`" -- which made a global
 * name's wrong value invisible from here, and left the two lists free to
 * disagree about whether authoring a named relation is a thing that happens.
 * It is; V1 simply has no syntax for it, which is now V1's own list to say.
 */
export const V2_AUTHORABLE_SEED_VARIANTS = deepFreeze(
  R.AUTHORABLE_VARIANTS.filter((v) => V2_INITIAL_SEED_VARIANTS.includes(v)));

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
         `crossed the V1 migration WITHOUT EVER BEING NAMED -- its id moved ` +
         `with the world id, as every relation's does -- so authoring one ` +
         `would claim a provenance that did not happen. To name such a ` +
         `relation, adopt it: see adoptLegacyRelations`,
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
 *
 * RETURNS the V1 world it derived on the way, because admitting an artifact
 * and deriving its world are one walk and running them separately is how the
 * two answers get to differ. Callers that only want the refusal ignore it.
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

  /* ...and then the world itself. Everything above judges the ENVELOPE: the
   * version tuple, which topology key is present, that two arrays are arrays.
   * None of it opens an object or an endpoint, and for one slice that was
   * defensible -- until it wasn't. See `assertV2World`. */
  return assertV2World(artifact);
}

/* ------------------------------------------------- the world behind the keys
 *
 * B.6. Through B.5 this module validated the relation LAYER and let the rest
 * of the artifact pass through, on the stated ground that "checking them here
 * would duplicate `wrl.js`'s validation in a module that cannot be the one
 * that fails first". The reasoning was wrong in a specific and checkable way,
 * and the review that found it did so by asking for ids rather than by reading
 * the argument: `domain: "banana"`, `kind: "WarpTunnel"`, a terminal naming an
 * object that does not exist, port `"made_up"`, two objects with one id, role
 * `"Alien"` -- every one of them produced an accepted artifact and a real
 * `sem-`. A gate that admits those is not a narrow gate, it is an open one,
 * and the module WAS the one that failed first because nothing downstream ran.
 *
 * The repair is not to restate `wrl.js`'s registries here. It is to DERIVE the
 * V1 world this V2 artifact describes and hand it to the frozen validator --
 * the same one a written world goes through -- so that every check is the
 * profile's own, reported with the profile's own code, and a profile that
 * widens widens both encodings at once. What this module adds is exactly one
 * check the frozen validator cannot make, because it never sees two copies of
 * anything: that the fields the V2 artifact STATES agree with the fields its
 * own objects and relations DERIVE.
 */

/**
 * The V1 world a V2 artifact describes, as the frozen lowering produces it.
 *
 * Every relation is projected to its V1 edge first, which is where a kind, a
 * domain, a texture, an orientation, an arity, an attribute set and a port
 * pairing are judged (`projectRelationRevisionToV1Edge`); the resulting graph
 * then goes through `graphToIr`, which is where a role, an object id, a static
 * config, an endpoint's existence and the controller counts are judged.
 *
 * A V2 world that no V1 world corresponds to therefore cannot be sealed today,
 * and that is a PROFILE limit rather than an encoding one: `forge.world.core.v1`
 * declares one domain, two kinds and one texture, so under this profile the
 * two encodings describe the same set of worlds and only spell them
 * differently. A wider profile arrives with its own projection, and this
 * function is where the fork goes.
 */
export function v2WorldAsV1(artifact) {
  const g = new W.WrlGraph();
  g.profile = artifact.profile_id;
  g.periods = 0;   /* run inputs are not in an artifact, in either encoding */

  artifact.objects.forEach((o, i) => {
    const where = `objects[${i}]`;
    if (!o || typeof o !== "object" || Array.isArray(o))
      fail("WRL_BAD_V2_ARTIFACT", "an object record is an object",
           { fieldPath: where });
    if (typeof o.object_id !== "string" || typeof o.role !== "string")
      fail("WRL_BAD_V2_ARTIFACT",
           "an object record carries a string object_id and role",
           { fieldPath: where });
    if (!o.static_config || typeof o.static_config !== "object" ||
        Array.isArray(o.static_config))
      fail("WRL_BAD_V2_ARTIFACT",
           `object '${o.object_id}' carries no static_config record. An ` +
           `absent one is not an empty one: the roles that need configuring ` +
           `are exactly the roles whose validation would crash reading it`,
           { fieldPath: `${where}.static_config` });
    const node = [o.role, o.object_id, o.static_config];
    node.line = i + 1;   /* declaration order, so a duplicate blames the later */
    g.nodes.push(node);
  });

  for (const rel of artifact.relations) {
    const { kind, src, dst } = R.projectRelationRevisionToV1Edge(rel.revision);
    g.edges.push([kind, src, dst]);
  }

  return W.graphToIr(W.canonicalizeGraph(g));
}

/* The keys a V2 artifact states that its own world also derives.
 *
 * `ir_version` is excluded and its exclusion is the one asymmetry: it is the
 * coordinate that MOVED, so the derived V1 value ("1.0" or "1.1") disagreeing
 * with the stated "2.0" is the encoding change rather than a defect. Every
 * other derived field is the same function of the same roles in both
 * encodings, so a disagreement is a claim about a world that is not this one.
 *
 * `objects` is compared separately, as a bag -- see below. */
const V2_DERIVED_KEYS = deepFreeze(["semantic_policies", "schemas"]);

/**
 * Refuse a V2 artifact whose world does not validate, or does not agree with
 * the fields the artifact states about it.
 *
 * Returns the derived V1 artifact, because the caller needs it: canonical
 * object order is the frozen lowering's answer, and asking for it here is what
 * stops this module from keeping a private copy of a sort key.
 */
export function assertV2World(artifact) {
  const derived = v2WorldAsV1(artifact);

  for (const k of V2_DERIVED_KEYS) {
    const want = W.serializeArtifact(derived[k]);
    const have = Object.prototype.hasOwnProperty.call(artifact, k)
      ? W.serializeArtifact(artifact[k]) : "<absent>";
    if (want !== have)
      fail("WRL_V2_WORLD_MISMATCH",
           `this artifact states ${k} = ${have}, and the world it encodes ` +
           `derives ${want}. These fields are functions of the objects -- a ` +
           `stated copy that disagrees is a second source of truth, and the ` +
           `stated one is the one a reader believes`,
           { fieldPath: k });
  }

  /* Objects are compared as a BAG, not as a sequence, because their order is
   * this function's to decide and the caller's to accept -- refusing an
   * unsorted artifact would make canonicalisation something the author has to
   * do first. Content is another matter: `ports` and `state_schema_ref` are
   * derived from the role, so an artifact carrying its own values for them is
   * describing objects the profile does not define, and a canonicaliser that
   * silently substituted the right ones would let the wrong ones be believed
   * everywhere the artifact is read and nowhere it is sealed. */
  const bag = (objs) =>
    W.serializeArtifact(objs.map((o) => W.serializeArtifact(o)).sort());
  if (bag(derived.objects) !== bag(artifact.objects))
    fail("WRL_V2_WORLD_MISMATCH",
         `this artifact's objects are not the objects its roles derive. ` +
         `state_schema_ref and ports are functions of the role, so a stated ` +
         `value for either describes an object this profile does not define`,
         { fieldPath: "objects" });

  return derived;
}

/**
 * The canonical V2 artifact.
 *
 * Two array orders are decided here and one is not. `relations` sorts by
 * canonical seed bytes (§5). `objects` keeps V1's order, unchanged, because V2
 * changes the TOPOLOGY encoding and nothing else -- and a canonicalisation
 * that quietly reordered the objects too would make every migrated world's
 * bytes differ for a reason unrelated to the change being made. Endpoint order
 * inside a revision is the kernel's, untouched.
 *
 * "Unchanged" is now ASKED rather than reproduced: the objects come back from
 * the derivation, which got them from `graphToIr`. Until B.6 this function
 * sorted them locally by `(role, object_id)` under a comment claiming that was
 * V1's order. V1 sorts objects IDENTITY-FIRST, by `(object_id, role)`. The two
 * agree on the demo world and on every world where no two objects share an id
 * prefix ordering -- which is to say the bug was invisible to every test that
 * existed, exactly as the edge-order bug one commit earlier was. Order is the
 * one part of an encoding no field rule checks, so a private copy of a sort
 * key fails silently and reads as correct.
 *
 * Key order is not decided here at all: `serializeArtifact` sorts keys
 * recursively, so an object's field order is not in its bytes.
 */
export function canonicalizeV2Artifact(artifact) {
  const derived = assertV2Artifact(artifact);

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

  return { ...artifact, objects: derived.objects, relations };
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
 * V1's canonical order for a bag of projected edges -- ASKED FOR, not restated.
 *
 * The sort key lives in the frozen `canonicalizeGraph` and this module holds no
 * copy of it. That matters more than the four lines it saves: an order is the
 * one part of an encoding that no field rule checks, so a private duplicate of
 * it fails silently, producing an artifact that is valid against every stated
 * rule and hashes to something the encoding could never have written.
 */
function v1CanonicalEdgeOrder(edges) {
  const g = new W.WrlGraph();
  g.edges = edges.map((e) => [e.kind, e.src, e.dst]);
  return W.canonicalizeGraph(g).edges.map(
    ([kind, src, dst]) => ({ kind, src, dst }));
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
 * The result is a NEW artifact with its own `sem-` -- necessarily, since it is
 * a different byte string in a different encoding -- and the version it is
 * written at is the caller's.
 *
 * The edges come out in V1'S canonical order, and the reason is worth stating
 * because getting it wrong is easy and silent. The two encodings BOTH sort;
 * they disagree about the KEY. V1 sorts `edges` by the tuple it stores them
 * as, `(kind, src, dst)`. V2 sorts `relations` by canonical `identity_seed`
 * bytes -- key-sorted JSON -- so a `legacy-edge` seed compares on `dst`, then
 * `kind`, then `src`. Two total orders over the same set, neither of them the
 * order anybody typed.
 *
 * Reading the relations off in V2's order and writing them straight out is
 * therefore not a translation, it is a V1 artifact in the WRONG encoding's
 * order: still valid against every field rule, still round-tripping as a set,
 * and carrying a `sem-` that no seal of that world could ever produce. An
 * order is canonical only WITHIN an encoding, so on the way out the encoding
 * that decides is the one being WRITTEN -- and once it does, the disagreement
 * is invisible from outside and a V1 -> V2 -> V1 round trip is byte-exact and
 * identity-preserving.
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
  const edges = v1CanonicalEdgeOrder(canonical.relations.map(
    (rel) => R.projectRelationRevisionToV1Edge(rel.revision)));

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

/* --------------------------------------------------------------- adoption */
/*
 * §D8.16. The way OUT of the state a migration leaves a world in.
 *
 * A migrated world's relations were never named -- that is a FACT about their
 * history, and `legacy-edge` records it -- so the surface cannot write them
 * (§D8.13) and `assertAuthorableSeed` refuses to author them. Left there, the
 * limit is permanent: a world that crossed the migration could never again be
 * handed to an author as text, which makes the migration a one-way door out of
 * the language.
 *
 * Adoption is the door back, and it is an ACT rather than a fix-up. Someone
 * supplies the names. That is the whole design:
 *
 *   THE NAMES COME FROM THE CALLER. Never from the endpoints, never from a
 *   counter, never from the old world. A generated name would make the
 *   formatter's forbidden move legal by moving it one function to the left,
 *   and the generated name would then be indistinguishable in the bytes from
 *   one an author chose -- which is precisely the confusion `legacy-edge`
 *   exists to prevent.
 *
 *   THE STRUCTURE DOES NOT MOVE. Every `rev-` recurs, because a revision is
 *   standalone (§D8.3) and a name is not in it. Adoption changes what a
 *   relation is CALLED, not what it connects.
 *
 *   THE IDENTITY DOES MOVE, all of it. The seeds changed, so the world's bytes
 *   changed, so the world `sem-` moved, so every allocation moved with it and
 *   every `rel-` is new -- including the relations that were NOT adopted.
 *   §D8.5 again, and the correspondence returned says so rather than letting a
 *   caller assume otherwise.
 *
 * The selector is the seed's own preimage -- `{ kind, src, dst }`, read out of
 * `V2_SEED_FIELDS` rather than restated -- so a caller names a relation by the
 * only name it has.
 *
 *   ADOPTION IS EXHAUSTIVE, AND THAT IS THE C.0 CORRECTION. B.6 allowed a
 *   partial adoption and registered "a partly adopted world is still
 *   unwritable" as a law. It is a true statement, and it was the wrong thing
 *   to permit. Every partial step SEALS: the world `sem-` moves, every `rel-`
 *   in the world is re-minted -- including the relations nobody touched -- and
 *   what comes out is a world no surface can write. Adopting the rest moves
 *   them all a second time. So a two-step adoption mints two throwaway
 *   identities on the way to the one the author wanted, and every id it minted
 *   is a real id of a real sealed world that can be stored, cited and
 *   corresponded against.
 *
 *   A caller collecting names one at a time is doing EDITOR work, and editor
 *   state is not sealed. Collect the names wherever you like; hand them over
 *   once. `WRL_INCOMPLETE_ADOPTION` is what says so.
 *
 *   The law this buys is stronger than the one it replaces, and shorter:
 *   a migrated world takes exactly one adoption to become writable.
 */

/**
 * An adoption assignment: the legacy seed's own fields, plus the new name.
 *
 * Named for the thing it selects, not for the encoding it happens to run
 * under. This shape is how you point at a relation THAT CAME THROUGH THE V1
 * MIGRATION -- it is the `legacy-edge` preimage plus a name. A future rename,
 * a re-adoption under a successor profile, or an adoption of some variant that
 * does not exist yet would each need their own selector, and would each be
 * wrong to fold in here. The B.6 spelling `V2_ADOPTION_FIELDS` claimed the
 * general case and delivered the specific one.
 */
export const LEGACY_EDGE_ADOPTION_FIELDS = deepFreeze(
  [...V2_SEED_FIELDS["legacy-edge"], "relation_name"].sort());

/**
 * Name every legacy relation in a migrated world, in one act. §D8.16.
 *
 * Returns `{ artifact, correspondence }`. The correspondence pairs on
 * `revision_id`, which is available because the structure is exactly what
 * adoption leaves alone, and is a total bijection for the same reason.
 *
 * The assignment must be EXHAUSTIVE: exactly one for every `legacy-edge`
 * relation in the world, no more and no fewer. A world with nothing left to
 * adopt is not adoptable (`WRL_UNKNOWN_RELATION`), and a world with something
 * left over is refused (`WRL_INCOMPLETE_ADOPTION`) rather than sealed
 * half-named.
 */
export async function adoptLegacyRelations(v2artifact, assignments) {
  const canonical = canonicalizeV2Artifact(v2artifact);

  if (!Array.isArray(assignments))
    fail("WRL_BAD_V2_ARTIFACT", `an adoption is a list of assignments`,
         { fieldPath: "assignments" });

  /* the relations there are to adopt, keyed by the seed each one already is */
  const available = new Map();
  for (const rel of canonical.relations)
    if (rel.identity_seed.variant === "legacy-edge")
      available.set(seedKey(rel.identity_seed), rel);

  /* An EMPTY assignment list is not refused here -- it falls through to the
   * exhaustiveness gate below, which is where it belongs and which gives it a
   * far more useful message. What IS refused here is adopting a world with
   * nothing adoptable in it, because there is no answer to give: every name
   * offered names a relation that is not here, and offering none asks for a
   * re-seal of identical bytes under a different name for the operation. */
  if (available.size === 0)
    fail("WRL_UNKNOWN_RELATION",
         `this world has no unnamed relation, so nothing in it is adoptable. ` +
         `A relation that already has a name is not re-adoptable: replacing ` +
         `its name would be a rename, which is a different act with different ` +
         `consequences for what an id meant`,
         { fieldPath: "assignments" });

  const chosen = new Map();
  assignments.forEach((a, i) => {
    const where = `assignments[${i}]`;
    if (!a || typeof a !== "object" || Array.isArray(a))
      fail("WRL_BAD_V2_ARTIFACT", "an assignment is a record",
           { fieldPath: where });

    const keys = Object.keys(a).sort();
    if (W.serializeArtifact(keys) !==
        W.serializeArtifact(LEGACY_EDGE_ADOPTION_FIELDS))
      fail("WRL_BAD_V2_ARTIFACT",
           `an assignment carries exactly ` +
           `${LEGACY_EDGE_ADOPTION_FIELDS.join(", ")}; ` +
           `this one carries ${keys.join(", ") || "nothing"}`,
           { fieldPath: where });

    if (typeof a.relation_name !== "string")
      fail("WRL_MISSING_RELATION_NAME",
           `${where} selects a relation and supplies no name. Adoption is ` +
           `how a migrated relation GETS a name; it never derives one, ` +
           `because a derived name is re-minted the moment an object is ` +
           `renamed and is indistinguishable in the bytes from a chosen one`,
           { fieldPath: `${where}.relation_name` });

    /* both of these VALIDATE as well as build: the selector through the
     * importer's own seed constructor, the name through the surface's */
    const seed = legacyEdgeSeed(a);
    namedInitialSeed(a.relation_name);

    const k = seedKey(seed);
    if (!available.has(k))
      fail("WRL_UNKNOWN_RELATION",
           `${where} adopts ${a.src} --${a.kind}--> ${a.dst}, and this world ` +
           `has no unnamed relation over those terminals. A relation that is ` +
           `already named is not adoptable: it has a name, and replacing it ` +
           `would be a rename`,
           { fieldPath: where, locator: `${a.src}->${a.dst}` });

    if (chosen.has(k))
      fail("WRL_DUPLICATE_ADOPTION",
           `${where} adopts ${a.src} --${a.kind}--> ${a.dst} a second time, ` +
           `as '${a.relation_name}' after '${chosen.get(k)}'. One of the two ` +
           `names would silently win, and a relation has one name`,
           { fieldPath: where, locator: `${a.src}->${a.dst}` });

    chosen.set(k, a.relation_name);
  });

  /* EXHAUSTIVE, or refused. Everything above judged the assignments the caller
   * DID supply; this judges the ones they did not. The two are separate
   * questions and neither implies the other: naming four relations correctly
   * says nothing about whether the world had five.
   *
   * Note which direction this runs. `available` holds what the world has and
   * `chosen` holds what the caller named, so the leftovers are read off the
   * WORLD -- a caller cannot satisfy this by knowing less than the world does. */
  const unadopted = [...available.entries()]
    .filter(([k]) => !chosen.has(k))
    .map(([, rel]) => rel.identity_seed);
  if (unadopted.length)
    fail("WRL_INCOMPLETE_ADOPTION",
         `${unadopted.length} of ${available.size} legacy relation(s) in this ` +
         `world were not adopted. Adoption is one act: a partial one seals a ` +
         `world that no surface can write, moves every id in it -- including ` +
         `the untouched relations -- and moves them all again when the rest ` +
         `are named. Collect the names as editor state, then adopt once`,
         { fieldPath: "assignments",
           locator: unadopted.map((s) => `${s.src}->${s.dst}`).sort().join(", ") });

  /* A repeated NAME is a repeated seed, and the encoder below refuses it --
   * including a name that collides with a relation this world already had.
   * The surface's rule applies here for the same reason it applies there: a
   * second rule about the same fact can disagree with the first. */
  const relations = canonical.relations.map((rel) => {
    if (rel.identity_seed.variant !== "legacy-edge") return rel;
    const name = chosen.get(seedKey(rel.identity_seed));
    if (name === undefined) return rel;
    return { identity_seed: namedInitialSeed(name), revision: rel.revision };
  });

  const artifact = canonicalizeV2Artifact({ ...canonical, relations });

  const before = await deriveV2Relations(canonical);
  const after = await deriveV2Relations(artifact);

  const wasNamed = new Map(
    before.relations.map((r) => [r.revision_id, r]));
  const pairs = [];
  let revisionsPreserved = wasNamed.size === after.relations.length;
  for (const r of after.relations) {
    const was = wasNamed.get(r.revision_id);
    if (!was) { revisionsPreserved = false; continue; }
    pairs.push({
      revision_id: r.revision_id,
      from_relation: was.relation_id,
      to_relation: r.relation_id,
      adopted: was.identity_seed.variant !== r.identity_seed.variant,
      relation_name: r.identity_seed.variant === "named-initial"
        ? r.identity_seed.relation_name : null,
    });
  }
  pairs.sort((x, y) => cmp(x.revision_id, y.revision_id));

  return {
    artifact,
    correspondence: {
      derived: true,
      canonical: false,
      inArtifactBytes: false,
      from_world: before.world_id,
      to_world: after.world_id,
      /* both of these are load-bearing, and they point opposite ways */
      identityPreserved: before.world_id === after.world_id,
      revisionsPreserved,
      pairs,
    },
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
 * THE `ir 2.0` HEADER, AND THE ARGUMENT THAT USED TO BE HERE
 * ----------------------------------------------------------
 * This banner used to explain why there was no header: §9 rules one spelling
 * and it is a per-route one, so a document-level declaration would be a
 * second, unruled piece of V2 syntax -- and instead "the encoding is the
 * caller's choice", `parseNamedWorld` being the V2 parser and `W.sealWorld`
 * the V1 one.
 *
 * The refutation is one source. Take an empty world -- a profile line and
 * nothing else -- and hand it to both parsers. Both accept. They produce two
 * DIFFERENT valid artifacts with two different `sem-` ids, and there is
 * nothing in the text that says which one those bytes mean. "The caller
 * decides" is only a workable rule while a document is in the caller's hands;
 * a file on disk has no caller, and a `sem-` is a claim about bytes.
 *
 * So the encoding is declared IN the source, as the second declaration, in
 * exactly the shape the profile line already has: required, singular, fixed in
 * position, with its own four refusals. It is not a new kind of syntax. It is
 * the kind of syntax the very first line of every world already is, which is
 * the argument the old banner was missing -- a header is unruled only if no
 * rule is written for it.
 *
 * §9's `WRL_MISSING_RELATION_NAME` survives unharmed and is now better off:
 * "unnamed route under native V2" no longer needs "native V2" to be a fact
 * about which function was called.
 */

/* The encoding declaration, matched the way the profile line is: loosely
 * enough that a malformed one is reported as a malformed HEADER rather than
 * falling through to the core parser and coming back as an unrecognised
 * notation. `ir` cannot collide with anything else in the grammar -- every
 * other line in a world either opens with `[` or is a profile line. */
const IR_HEADER_RE = /^ir(?:\s+(\S+))?(\s+\S[\s\S]*)?$/;

/**
 * A V2 source, split into the encoding it declares and the source without it.
 *
 * REQUIRED, SINGULAR, and SECOND -- the same three properties
 * `validateProfileHeader` gives the profile line, for the same reason. A world
 * that does not say which encoding its bytes are in is a world whose `sem-`
 * depends on who opened it.
 *
 * Where the header must sit is ASKED rather than restated: the frozen spine's
 * own `validateProfileHeader` is what establishes that the first non-comment
 * line is the profile, and this only requires the encoding to be the next one.
 * A local check for "line 1 is a profile line" would be a second copy of a
 * frozen rule, and the copy is the one that goes stale.
 *
 * The header is blanked LINE-PRESERVINGLY, keeping any comment tail, so every
 * line number the spine reports is a line number in the source the author
 * wrote.
 */
function irHeaderScan(source) {
  if (typeof source !== "string")
    fail("WRL_MALFORMED_ARTIFACT", "a world source must be a string");

  const raws = source.split("\n");
  const codeLines = [];
  const hits = [];
  raws.forEach((raw, i) => {
    const line = raw.split(";")[0].trim();
    if (!line) return;
    codeLines.push(i + 1);
    if (line === "ir" || line.startsWith("ir ") || line.startsWith("ir\t"))
      hits.push([i + 1, line]);
  });
  return { raws, codeLines, hits };
}

/**
 * Does this text DECLARE an encoding at all? §D8.17.
 *
 * A question about the text, answered before anything is parsed, and the only
 * question an admission is allowed to ask before it chooses a parser. It says
 * nothing about whether the declaration is well formed, in the right place, or
 * a version anything supports -- those are `stripIrHeader`'s four refusals, and
 * they belong to the V2 parser rather than to the choice of parser.
 *
 * The distinction is the whole point. "Declared badly" and "not declared" are
 * different facts, and a dispatcher that conflated them would hand a source
 * carrying a broken `ir` line to the V1 parser -- which is precisely the
 * fallback §D8.17 forbids, arriving as a helpful-looking error path.
 *
 * It shares `stripIrHeader`'s scan rather than re-testing for `ir`, because two
 * copies of "what an encoding declaration looks like" is exactly the kind of
 * private duplicate §D8.10 refuses; and it deliberately runs BEFORE
 * `validateProfileHeader`, since a source with no profile still has to be
 * routed somewhere, and the routing must not depend on a fault the chosen
 * parser is about to report anyway.
 */
export function declaresEncoding(source) {
  return irHeaderScan(source).hits.length > 0;
}

export function stripIrHeader(source) {
  /* scanned first because the scan is what refuses a non-string, and pure
   * either way; the PROFILE still gets to fault before any header rule does */
  const { raws, codeLines, hits } = irHeaderScan(source);
  W.validateProfileHeader(source);   /* the profile is first, and says so */

  if (!hits.length)
    fail("WRL_MISSING_IR_HEADER",
         `a V2 world declares its encoding: 'ir ${V2_IR_VERSION}', on the ` +
         `line after the profile. Without it the same bytes seal to one world ` +
         `through the V1 parser and a different one through the V2 parser, ` +
         `and nothing in the source says which was meant`,
         { line: codeLines[1] ?? codeLines[0] ?? null });

  if (hits.length > 1)
    fail("WRL_DUPLICATE_IR_HEADER",
         `the encoding is declared ${hits.length} times (lines ` +
         `${hits.map(([n]) => n).join(", ")}); a world is written in one`,
         { line: hits[1][0] });

  const [lineNo, line] = hits[0];
  if (lineNo !== codeLines[1])
    fail("WRL_MISSING_IR_HEADER",
         `the encoding must be declared immediately after the profile; line ` +
         `${codeLines[1]} declares something before it`, { line: lineNo });

  const m = IR_HEADER_RE.exec(line);
  if (!m || !m[1] || m[2] !== undefined)
    fail("WRL_MALFORMED_IR_HEADER",
         `'${line}' is not exactly 'ir <version>'`, { line: lineNo });

  if (!Object.prototype.hasOwnProperty.call(V2_RELATION_SOURCE_FAMILIES, m[1]))
    fail("WRL_UNSUPPORTED_IR_VERSION",
         `ir_version ${JSON.stringify(m[1])} is outside the V2 family this ` +
         `surface reads (${V2_IR_VERSIONS.join(", ")})`, { line: lineNo });

  const out = raws.slice();
  const semi = out[lineNo - 1].indexOf(";");
  out[lineNo - 1] = semi === -1 ? "" : out[lineNo - 1].slice(semi);
  return { source: out.join("\n"), irVersion: m[1] };
}

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
 *
 * The encoding is read from the text (§D8.15) rather than assumed. The
 * `ir_version` on the artifact this returns is the one the SOURCE declared,
 * so a world's bytes are decided by what it says it is, and never by which
 * function the caller happened to reach for.
 */
export async function parseNamedWorld(source) {
  let denamed, names, irVersion;
  try {
    ({ source: denamed, irVersion } = stripIrHeader(source));
    ({ source: denamed, names } = stripRelationNames(denamed));
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
    out.ir_version = irVersion;
    out.relations = relations;

    /* A repeated name is a repeated SEED, and the encoder already refuses
     * that. The surface deliberately has no duplicate-name rule of its own:
     * a second one could disagree with the first, and the encoder's is the
     * one that decides bytes. */
    return { ok: true, source, denamed, irVersion, v1: sealed.artifact, names,
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
 * ONE WORLD THIS SURFACE CANNOT WRITE -- AND ONE THAT WAS FILED UNDER THE
 * SAME HEADING BY MISTAKE
 * ------------------------------------------------------------------------
 *   1. An UNADOPTED MIGRATED world. Its relations carry `legacy-edge` seeds
 *      and therefore have no names, and §9 gives the surface no way to write
 *      a route without one. So a migration produces a world that runs, seals
 *      and compares, but is not authorable text until someone names its
 *      relations. That limit is real, and it is now EXITABLE: `adoptLegacy-
 *      Relations` (§D8.16) is the operation that supplies the names, as ONE
 *      explicit act with names the caller carries. What the formatter still
 *      may not do is mint them, which is the one thing §D8.1 forbids.
 *
 *   2. A world with two relations over the SAME terminals was listed here as
 *      the second such world, on the grounds that it is "well-formed V2" and
 *      only the text is missing. Both halves were wrong.
 *
 *      The text is not missing. `[a]: [p0] --sig--> [r0]` and
 *      `[b]: [p0] --sig--> [r0]` are two distinct, unambiguous source lines,
 *      and `stripRelationNames` reads them back as two names on two lines.
 *
 *      And the world is not well-formed. `forge.world.core.v1` admits one
 *      signal-wire input per object, so the second relation is a
 *      WRL_CONTROLLER_CONFLICT -- in EITHER encoding, from the same law. It
 *      only ever looked well-formed because the encoder did not look at the
 *      world (§D8.14). The multigraph is therefore a PROFILE debt and not a
 *      surface one, and it clears when a profile ships a wider controller law.
 *
 *      `WRL_UNWRITABLE_RELATION` stays as the implementation boundary that
 *      wider profile will meet -- one route per line and a spine that refuses
 *      a duplicate edge key -- but it is unreachable today, because the world
 *      gate refuses such a world before the formatter ever sees it. A code
 *      that names a real boundary is worth keeping; a code that names an
 *      impossibility is not, and this one changed categories.
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

  /* §D8.15: the encoding is declared, not inferred. It goes in AFTER the name
   * prefixes, not before, because every line index above came from the frozen
   * formatter's own output -- inserting a line first would shift them all, and
   * the surface would be back to counting lines instead of asking. */
  lines.splice(1, 0, `ir ${canonical.ir_version}`);
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

/* ================================================ C.1: admission, §D8.17 */
/*
 * ONE ENTRY POINT, TWO PARSERS, AND NOTHING THAT GUESSES
 * -----------------------------------------------------
 * Everything above this line is a library: a caller who already knows which
 * encoding they hold calls `sealWorld` or `parseNamedWorld` and is right. A
 * TOOL does not know. It holds a textarea, and the person typing into it may
 * be writing either encoding, may paste one over the other, and is not going
 * to announce which.
 *
 * That is a real question and it has exactly one honest answer: ASK THE
 * SOURCE. §D8.15 exists so the source can be asked -- the whole argument for
 * the `ir` line was that a world whose id depends on who opened it has no id
 * -- and an admission is that argument used rather than restated.
 *
 * WHAT THIS MAY NOT DO, AND WHY IT IS TEMPTING
 * --------------------------------------------
 *   1. It may not dispatch on anything but the source. Not a dropdown, not a
 *      file extension, not the last button pressed. A UI may put starter TEXT
 *      in an editor -- text is the input -- but a UI that decides how EXISTING
 *      text is read has made the id of a world a function of the interface,
 *      which is the defect §D8.15 was written against with a different guess
 *      in the blank.
 *
 *   2. It may not fall back. A source that declares `ir 3.0`, or `ir`, or
 *      declares it twice, is a source someone MEANT as V2 and got wrong.
 *      Handing it to V1 would be the most helpful-looking bug available here:
 *      most such sources are perfectly good V1 worlds, so the fallback would
 *      SEAL, print a real `sem-`, and the author would be looking at the id of
 *      a world in an encoding they did not write. The refusal has to be the
 *      end of the road, and this is why `declaresEncoding` answers a question
 *      about DECLARING rather than about parsing.
 *
 *   3. It may not seal twice. A V2 admission runs the V1 spine exactly once,
 *      inside `parseNamedWorld`, over the DE-NAMED text; the projection below
 *      is derived from the artifact afterwards. Two seals of two texts is two
 *      worlds, and a tool that showed both would be showing the reader an id
 *      nothing in the editor produces.
 */

/** The two families a source can be admitted under. The discriminator. */
export const ADMISSION_FAMILIES = deepFreeze(["v1", "v2"]);

/**
 * Admit a world source under the encoding IT declares. §D8.17.
 *
 * Returns a discriminated result, and the discriminator is `family`:
 *
 *   { ok: true,  family: "v1", declared: false, ...<sealWorld's own result> }
 *   { ok: true,  family: "v2", declared: true, irVersion, artifact, bytes,
 *                semanticWorldId, source, denamed, names, denamedV1Artifact }
 *   { ok: false, family, declared, code, message, line?, ... }
 *
 * The V1 arm is `sealWorld`'s result with two fields added and nothing removed
 * or renamed -- same `semanticId`, same `graph`, same `bytes`, same codes, same
 * lines. An admission that reshaped V1's verdict would be a second public
 * surface for a frozen one, and every existing consumer of a sealed world would
 * have to learn which of the two it was holding.
 *
 * `denamedV1Artifact` is the V1 artifact `parseNamedWorld` sealed on the way in
 * -- the frozen spine's own reading of the same world with the names taken off.
 * It is NOT the execution projection, which is `runnableV1Artifact` computed
 * from the V2 artifact. That the two are byte-identical is a fact worth
 * checking rather than assuming, and it is the fact a consumer means by "the
 * projection is exact"; C.3's envelope is where it stops being a coincidence
 * two callers can each rediscover.
 */
export async function admitWorldSource(source) {
  let declared;
  try {
    declared = declaresEncoding(source);
  } catch (e) {
    if (e instanceof W.WrlError)
      return { ok: false, family: null, declared: null, ...W.mapDiagnostic(e) };
    throw e;
  }

  if (!declared) {
    const sealed = await W.sealWorld(source);
    return { ...sealed, family: "v1", declared: false };
  }

  const parsed = await parseNamedWorld(source);
  if (!parsed.ok) return { ...parsed, family: "v2", declared: true };

  let semanticWorldId, bytes;
  try {
    bytes = serializeV2Artifact(parsed.artifact);
    semanticWorldId = await v2WorldIdOfArtifact(parsed.artifact);
  } catch (e) {
    if (e instanceof W.WrlError)
      return { ok: false, family: "v2", declared: true, ...W.mapDiagnostic(e) };
    throw e;
  }

  return { ok: true, family: "v2", declared: true, irVersion: parsed.irVersion,
           source, denamed: parsed.denamed, names: parsed.names,
           artifact: parsed.artifact, semanticWorldId, bytes,
           /* the seal `parseNamedWorld` already ran, carried rather than
            * repeated -- see note 3 above */
           denamedV1Artifact: parsed.v1 };
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

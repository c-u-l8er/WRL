/**
 * Relation Identity Kernel 0.1.2
 * ==============================
 *
 * 0.1.2 is the second repair, and its four defects share one shape with the
 * first: the implementation and its own model agreed with each other while
 * disagreeing with §D8. A battery written from the implementation cannot see
 * that, so each repair below arrives with a property that would have.
 *
 *   1. WRONG SLOT, AGAIN. `domain` held `artifact.profile_id`. §D8's field
 *      table says a domain is a profile-declared NAMESPACE -- `signal`,
 *      `digital`, `mobility` -- and §D8.8's own recovery table writes
 *      `domain = signal` for a frozen route. A profile DECLARES domains; it is
 *      not one. Resolved through `PROFILE_DEFAULT_DOMAIN` now, and the mapping
 *      is data so a second profile cannot arrive without one.
 *
 *   2. AN ELIDED DEFAULT IS NOT AN ABSENT VALUE. 0.1.1 left `texture` absent
 *      and registered directed-requires-texture as a V2 obligation, reasoning
 *      that a frozen edge records no texture field. That confused the ENCODING
 *      with the MEANING. V1's only surface-grounded texture is solid (§5), and
 *      the artifact elides it exactly the way it elides `orientation` and the
 *      implied ports -- both of which this adapter already restores. So
 *      `texture: "solid"` is restored too, the projection requires precisely
 *      that value and elides it on the way back, and the directed half of §D8's
 *      texture row becomes executable rather than deferred.
 *
 *   3. TWO SOURCES OF TRUTH FOR ONE HASH. `deriveRelations(artifact, id)`
 *      TRUSTED the caller's id. Passing a real artifact with a forged
 *      `sem-000…0` minted relation ids under the forgery without complaint,
 *      which falsifies the central claim that relation identity is derived
 *      from the sealed world. The world id is now computed from the artifact,
 *      and a supplied claim is CHECKED -- `WRL_SEMANTIC_ID_MISMATCH`.
 *
 *   4. A MUTABLE CANON. `ENDPOINT_ROLES` and its siblings were ordinary
 *      arrays. Reversing one after import reversed the canonical endpoint
 *      order, so a consumer could move a `revision_id` without touching this
 *      file. Every exported vocabulary is deep-frozen.
 *
 * And one confusion of KIND rather than of value: a structural pairing is not
 * an import fact. See `deriveLegacyEdgeCorrespondence` below.
 *
 * 0.1.1 was itself a repair, and the thing it repaired is worth keeping in
 * view: 0.1 built its endpoints as `{ terminal: "p0", role: "sig_out" }`.
 * That reverses §D8's two concepts. `role` is the SEMANTIC position a
 * participant holds -- `source`, `target`, `peer`, `terminal` -- and the
 * terminal is the port itself, `p0.sig_out`. Writing the port name in the role
 * slot meant the module round-tripped V1 edges correctly while proving nothing
 * about the model it claimed to embed them into: endpoint order was semantic
 * (reversing two endpoints moved `revision_id`), `orientation` admitted an
 * invented `undirected`, and none of §D8's role-legality or terminal-
 * uniqueness laws were enforced. The suite was green throughout, because none
 * of those obligations had been registered as properties. See §D8.7.
 *
 * Core Part II §D8 states that a relation has a stable `relation_id` minted
 * from an allocation, and a separate content-addressed `revision_id` for its
 * value. Until now none of that was executable: there is no writable relation
 * surface, so there was nothing to mint a name from.
 *
 * There is, though. A sealed V1 world already contains everything needed to
 * name its period-0 relations -- just not under a name an author chose. Every
 * edge in the frozen artifact carries `{ kind, src, dst }`, and where that
 * triple is unique within the world it distinguishes one relation from every
 * other. So this module derives identity from the seal rather than waiting for
 * syntax:
 *
 *     LegacyEdgeAllocation { world_id, kind, src, dst }
 *
 * and refuses `NamedInitialAllocation` outright, because a V1 artifact has no
 * field to hold a relation name. That refusal is the load-bearing part. If a
 * name were accepted here, two sources that named the same edge differently
 * would seal to identical bytes under one `sem-` id and still mint different
 * `relation_id`s -- a sealed world failing to determine its own future
 * semantics, which is the one thing sealing is for.
 *
 * WHY THIS IS A SEPARATE MODULE
 * -----------------------------
 * Not for convenience. `wrl.js` is the frozen identity spine, and everything
 * in this file is DERIVED, NON-CANONICAL, and ABSENT FROM ARTIFACT BYTES. Put
 * inside the spine, those three properties would be a comment that a later
 * edit could quietly falsify. Here they are structural: this module imports
 * `wrl.js` and `wrl.js` does not import this one, so no relation id can reach
 * a `sem-` preimage even by accident. `sealWithRelations` below is checked
 * against `sealWorld` for byte-identical output on every fixture; if a
 * relation ever leaked into the artifact, that check is what breaks.
 *
 * WHAT IS NOT HERE
 * ----------------
 * No grants, no proposals, no acceptance, no crash semantics, no Film
 * changes, and no new surface syntax. §D8.4, §D8.6 and all of §D9 stay
 * unexecuted, and the register in spec.html says so row by row. A green count
 * bought by inventing runtime semantics would be worth less than the red one
 * it replaced.
 */

import * as W from "./wrl.js";

/* ------------------------------------------------------------------ freeze */

/**
 * Every identity-critical table below is exported, and an exported array is a
 * shared mutable object. That is not a theoretical hazard: reversing
 * `ENDPOINT_ROLES` after importing this module reverses the canonical endpoint
 * sort, which moves every `revision_id` this kernel mints -- from OUTSIDE the
 * file that documents the order as normative. Widening `ORIENTATION_ROLES`
 * likewise changes what the validator accepts.
 *
 * So the vocabularies are deep-frozen. Freezing does not make the ordering
 * correct; it makes the ordering the only one there is, which is what a
 * canonical form has to be to be worth hashing.
 */
const deepFreeze = (v) => {
  if (v && (typeof v === "object" || typeof v === "function") &&
      !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const k of Object.getOwnPropertyNames(v)) deepFreeze(v[k]);
  }
  return v;
};

/* ------------------------------------------------------------------ codes */

/* Codes this kernel raises. They are deliberately NOT added to `W.CODES`:
 * that catalogue is the frozen spine's, and a derived layer that grows the
 * frozen layer's error surface is no longer derived. */
export const RELATION_CODES = deepFreeze({
  WRL_DUPLICATE_RELATION_KEY:
    "two relations in one world share the edge key that names them",
  WRL_UNWRITABLE_ALLOCATION:
    "an allocation variant was constructed by an authority that may not",
  WRL_BAD_ALLOCATION:
    "an allocation does not have the shape its variant declares",
  WRL_BAD_RELATION_REVISION:
    "a relation revision has the wrong shape",
  WRL_REVISION_BACKPOINTER:
    "a relation revision points at another revision",
  WRL_ENDPOINT_ROLE_ILLEGAL:
    "an endpoint holds a role its relation's orientation does not admit",
  WRL_DUPLICATE_TERMINAL:
    "one terminal appears twice in a single relation",
  WRL_INCOMPLETE_ORIENTATION:
    "an orientation's required roles are not all present",
  WRL_ACAUSAL_TEXTURE:
    "an acausal relation carries a texture, which a solver wall governs instead",
  WRL_MISSING_TEXTURE:
    "a directed relation states no texture, and §D8 requires one",
  WRL_BAD_TERMINAL:
    "a terminal is not the { object_id, port } record §D8 endpoints are made of",
  WRL_SEMANTIC_ID_MISMATCH:
    "a claimed world id is not the id the supplied artifact hashes to",
  /* family-neutral on purpose. This code is raised by the V1 adapter about an
   * ARTIFACT and by the V2 header reader about a SOURCE, and a gloss that
   * named V1 read as a contradiction the moment the playground showed it
   * under a V2 message. A code two readers share has to be true of both. */
  WRL_UNSUPPORTED_IR_VERSION:
    "an ir_version is outside the family the reader that met it accepts",
  WRL_UNSUPPORTED_PROFILE:
    "an artifact's profile is not the one its ir_version's source family names",
  WRL_UNSUPPORTED_RULEPACK:
    "an artifact's rulepack is not the one its source family declares",
  WRL_UNKNOWN_PROFILE_DOMAIN:
    "a profile declares no default relation domain for this adapter to resolve",
  WRL_RELATIONS_IN_V1:
    "a V1 artifact carries a relations key, which only a V2 artifact encodes",
  WRL_UNVERIFIED_IMPORT:
    "a RelationImported fact is not backed by the derived correspondence",
});

const fail = (code, message, opts) => {
  throw new W.WrlError(code, message, opts);
};

/* -------------------------------------------------- the V1 source family */

/**
 * The artifact families this adapter admits, named rather than assumed.
 *
 * §D8.8 originally said "V1", which in this repository is two things: `1.0`,
 * and `1.1` for a world carrying a mailbox. They share the structural edge
 * representation this kernel reads -- `{ kind, src, dst }` in an `edges`
 * array -- so both are admissible and the set is written down. A V2 artifact
 * encodes relations under a `relations` key with structured terminals; reading
 * one through this adapter would produce confident nonsense, so it is refused
 * BY NAME rather than by whatever happens when `.edges` is undefined.
 *
 * A family is a TUPLE, not a version. 0.1.2 gated only `ir_version`, which let
 * an artifact declare a frozen profile over an undeclared rulepack and still
 * be read as a recognised V1 relation source -- the rulepack was admitted for
 * being a nonempty string. That is not the same question as the field
 * partition's: "policy is free" says a revision may change its rulepack while
 * keeping relation identity, and says nothing about which sealed artifacts
 * this adapter knows how to interpret. The rulepack is also copied into
 * `revision.policy`, so it moves `revision_id` and can govern later behaviour;
 * admitting an unrecognised one is admitting a governance surface unread.
 *
 * Only the coordinates the RELATION adapter reads belong here. The mailbox
 * admit policy and the Film schema legitimately differ between `1.0` and `1.1`
 * and are not consulted to interpret a relation, so gating them here would
 * refuse real worlds for a difference that does not reach this layer. A full
 * artifact validator may check the complete policy tuple separately.
 */
export const V1_RELATION_SOURCE_FAMILIES = deepFreeze({
  "1.0": {
    profile_id: "forge.world.core.v1",
    rulepack_id: "forge.world.core.rules.v1",
  },
  "1.1": {
    profile_id: "forge.world.core.v1",
    rulepack_id: "forge.world.core.rules.v1",
  },
});

/* The version half of the family table, kept as its own name because it is
 * what §D8.8's prose quotes: the V1 artifact family is ir_version ∈ {1.0, 1.1}.
 * Derived rather than restated so the two cannot drift. */
export const V1_IR_VERSIONS =
  deepFreeze(Object.keys(V1_RELATION_SOURCE_FAMILIES));

/**
 * A profile's DEFAULT relation domain.
 *
 * §D8's field table: a domain is a profile-declared namespace -- `signal`,
 * `digital`, `mobility`, `electrical`. A profile declares domains; it is not
 * itself one, and putting `forge.world.core.v1` in the domain slot was the
 * same class of defect as putting a port name in the role slot. §D8.8's
 * recovery table fixes the value for a frozen route: `domain = signal`, and
 * both frozen edge kinds are kinds OF that domain.
 *
 * It is a table rather than a constant so that a second profile cannot arrive
 * without stating its default -- the resolution below refuses an unmapped one
 * instead of silently reaching for `signal`.
 */
export const PROFILE_DEFAULT_DOMAIN = deepFreeze({
  "forge.world.core.v1": "signal",
});

export function profileDefaultDomain(profileId) {
  const domain = Object.prototype.hasOwnProperty.call(
    PROFILE_DEFAULT_DOMAIN, profileId) ? PROFILE_DEFAULT_DOMAIN[profileId]
                                       : undefined;
  if (typeof domain !== "string")
    fail("WRL_UNKNOWN_PROFILE_DOMAIN",
         `profile '${profileId}' declares no default relation domain. §D8's ` +
         `domain is a profile-declared namespace, so it cannot be defaulted ` +
         `by guessing and must not be filled with the profile id itself`,
         { fieldPath: "profile_id" });
  return domain;
}

/**
 * Refuse an artifact this adapter cannot honestly read.
 *
 * "Honestly" is the operative word: `artifact.edges` is `undefined` on a V2
 * artifact, and a loop over `undefined` throws a TypeError somewhere far from
 * the cause. §D8.8's contract is that the importer reads only the sealed
 * artifact and invents nothing, which includes not inventing an opinion about
 * an encoding it has never seen.
 *
 * Admission is by the whole tuple `(ir_version, profile_id, rulepack_id)`.
 * Each coordinate answers with its own code, because "this version is not one
 * I read" and "this rulepack is not the one that version declares" are
 * different repairs.
 */
export function assertV1Artifact(artifact) {
  if (!artifact || typeof artifact !== "object" || Array.isArray(artifact))
    fail("WRL_MALFORMED_ARTIFACT", "an artifact must be a record");

  const family = Object.prototype.hasOwnProperty.call(
    V1_RELATION_SOURCE_FAMILIES, artifact.ir_version)
      ? V1_RELATION_SOURCE_FAMILIES[artifact.ir_version] : undefined;
  if (!family)
    fail("WRL_UNSUPPORTED_IR_VERSION",
         `ir_version ${JSON.stringify(artifact.ir_version)} is outside the V1 ` +
         `family this adapter reads (${V1_IR_VERSIONS.join(", ")}). A later ` +
         `artifact encodes relations directly; importing one through the ` +
         `legacy-edge adapter would mint identity from a shape it does not have`,
         { fieldPath: "ir_version" });

  if (artifact.profile_id !== family.profile_id)
    fail("WRL_UNSUPPORTED_PROFILE",
         `ir_version ${artifact.ir_version} names profile ` +
         `'${family.profile_id}' as its relation source, and this artifact ` +
         `declares ${JSON.stringify(artifact.profile_id)}. The edge kinds, ` +
         `their implied ports and the directed/solid reading are all facts ` +
         `about that profile, so another one is a different encoding wearing ` +
         `the same version`,
         { fieldPath: "profile_id" });

  const rulepack = artifact.semantic_policies?.rulepack_id;
  if (rulepack !== family.rulepack_id)
    fail("WRL_UNSUPPORTED_RULEPACK",
         `family ${artifact.ir_version} declares rulepack ` +
         `'${family.rulepack_id}' and this artifact declares ` +
         `${JSON.stringify(rulepack)}. The rulepack is copied into every ` +
         `derived revision's policy, so an unrecognised one is not merely ` +
         `unread -- it is sealed into revision identity and may govern later ` +
         `behaviour this adapter has never seen stated`,
         { fieldPath: "semantic_policies.rulepack_id" });

  if (!Array.isArray(artifact.edges) || !Array.isArray(artifact.objects))
    fail("WRL_MALFORMED_ARTIFACT",
         "a V1 artifact carries objects and edges arrays");

  /* The reciprocal half of V2's `WRL_LEGACY_EDGES_IN_V2`. The two encodings
   * REPLACE each other rather than layer, so a world carrying both has two
   * topologies and no rule for which one is the world -- and, worse, it seals
   * to bytes that a V1 reader and a V2 reader would each interpret happily and
   * differently. Refusing at the boundary is the only place that stays cheap:
   * one line later the derivation has already minted ids from the half it
   * happened to read. */
  if (Object.prototype.hasOwnProperty.call(artifact, "relations"))
    fail("WRL_RELATIONS_IN_V1",
         `a ${artifact.ir_version} artifact encodes its topology in ` +
         `'edges'; the 'relations' key belongs to the V2 encoding, which ` +
         `replaces 'edges' rather than extending it. An artifact carrying ` +
         `both states two topologies and names neither as the world`,
         { fieldPath: "relations" });

  profileDefaultDomain(artifact.profile_id);
  return artifact;
}

/**
 * The world id an artifact ACTUALLY hashes to.
 *
 * This exists because the alternative -- believing a caller -- was shipped and
 * was wrong. `deriveRelations` took the id as a parameter and used it as the
 * allocation preimage's `world_id`, so a real artifact paired with a forged
 * `sem-000…0` minted relation ids under the forgery. The whole claim of this
 * module is that relation identity is derived FROM THE SEAL; a function with
 * two independent sources of truth about what the seal is does not make that
 * claim, it asserts it.
 */
export async function worldIdOfArtifact(artifact) {
  assertV1Artifact(artifact);
  return "sem-" + await sha256Hex(W.serializeArtifact(artifact));
}

/* ------------------------------------------------------------- revisions */

/* The field list is §D8's, and the order here is presentational only -- the
 * canonical form is key-sorted, so nothing downstream depends on it. */
export const REVISION_FIELDS = deepFreeze(
  ["domain", "kind", "endpoints", "orientation", "texture", "attributes", "policy"]);

/* §D8's four roles, IN THE DECLARED ENUMERATION ORDER -- which is not
 * decoration: canonicalisation sorts endpoints by role and then terminal, and
 * the sort is by position in this list rather than alphabetically, so that the
 * tail of a directed relation precedes its head the way the spec's table reads.
 * Sorting these strings alphabetically would put `peer` before `source` and
 * silently make the canonical form disagree with the section that defines it. */
export const ENDPOINT_ROLES = deepFreeze(["source", "target", "peer", "terminal"]);

export const ORIENTATIONS = deepFreeze(["directed", "symmetric", "acausal"]);

/**
 * A TERMINAL is a record, not a packed string.
 *
 * 0.1.2 wrote `"p0.sig_out"`, which is the V1 edge's own packing habit leaking
 * into the model that is supposed to outlive it. Two costs, and the second is
 * the one that matters:
 *
 *   - `object.port` is only unambiguous while both halves are `\w+`. The
 *     projection needed a regex to take it apart again, and a regex that
 *     recovers structure is structure that was thrown away.
 *   - a V2 relation and the V1 relation it was migrated from would then have
 *     had DIFFERENT terminal encodings for the same terminal, so §D8.3's law --
 *     the same relation structure in two worlds yields the same
 *     `revision_id` -- would have stopped holding exactly across the migration
 *     it exists to make checkable.
 *
 * So the terminal encoding belongs to the REVISION MODEL, not to the artifact
 * family that produced it. There is one form, both families use it, and the V1
 * adapter LIFTS into it: `p0` plus the kind's frozen port pair becomes
 * `{ object_id: "p0", port: "sig_out" }`. That is the same expansion it already
 * performs, made visible in the value instead of hidden in a string.
 *
 * This moves every `rev-` id. No `rev-` is pinned anywhere -- not in the
 * fixtures, the register or the page -- and the two pinned `sem-` ids are
 * untouched, because the frozen spine still seals `edges` and knows nothing
 * about any of this.
 */
export const TERMINAL_FIELDS = deepFreeze(["object_id", "port"]);

const IDENT_RE = /^\w+$/;

export function validateTerminal(t, where = "terminal") {
  if (!t || typeof t !== "object" || Array.isArray(t))
    fail("WRL_BAD_TERMINAL",
         `${where} must be a { ${TERMINAL_FIELDS.join(", ")} } record, not ` +
         `${JSON.stringify(t)}. A packed 'object.port' string is a V1 edge's ` +
         `encoding, and a relation model that inherits it inherits its limits`,
         { fieldPath: where });
  const have = Object.keys(t).sort();
  if (W.serializeArtifact(have) !==
      W.serializeArtifact([...TERMINAL_FIELDS].sort()))
    fail("WRL_BAD_TERMINAL",
         `${where} is { ${TERMINAL_FIELDS.join(", ")} }; got ` +
         `{ ${have.join(", ")} }`, { fieldPath: where });
  for (const f of TERMINAL_FIELDS) {
    if (typeof t[f] !== "string" || !IDENT_RE.test(t[f]))
      fail("WRL_BAD_TERMINAL",
           `${where}.${f} must be a non-empty identifier; got ` +
           JSON.stringify(t[f]), { fieldPath: `${where}.${f}` });
  }
  return t;
}

/** Canonical bytes of a terminal -- the total sort key, and the identity a
 *  duplicate-terminal check compares on. */
export const terminalKey = (t) =>
  W.serializeArtifact({ object_id: t.object_id, port: t.port });

/** Display only. Nothing derived from this reaches a hash. */
export const formatTerminal = (t) => `${t.object_id}.${t.port}`;

const cmpStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/* §5's four irreducible textures, frozen as a SET. Only `--` solid is
 * surface-grounded in 0.1.2; the other three have IR or runtime footholds and
 * no construct. That is a fact about the surface, not about the vocabulary,
 * which is why all four are here and only one is reachable from a V1 edge. */
export const TEXTURES = deepFreeze(["solid", "async", "verified", "fault"]);

/* The texture a V1 structural edge MEANS. `--` is the only texture V1 can
 * write, and the artifact elides it the way it elides orientation and the
 * implied ports. Restoring it is expansion, not authorship: see the header. */
export const V1_TEXTURE = "solid";

/* Which roles each orientation admits, and which it REQUIRES.
 *
 * `directed` requires both halves because a hyperarc is an ordered pair of
 * disjoint vertex sets, and a pair with an empty tail is not one -- a relation
 * with three targets and no source says something crosses it from nowhere.
 * `symmetric` and `acausal` have a single role each, so requiring it is the
 * same statement as admitting it; it is written out anyway so that adding a
 * fourth orientation has an obvious place to declare both facts rather than
 * inheriting whichever one the code happened to check. */
export const ORIENTATION_ROLES = deepFreeze({
  directed:  { admits: ["source", "target"], requires: ["source", "target"] },
  symmetric: { admits: ["peer"],             requires: ["peer"] },
  acausal:   { admits: ["terminal"],         requires: ["terminal"] },
});

/* §D8's texture row, as the other half of the same table: REQUIRED for
 * directed, profile-defined for symmetric, ABSENT for acausal. Written as data
 * so the two halves cannot drift apart -- 0.1.1 enforced the acausal half and
 * filed the directed half as a V2 obligation, and a table with one enforced
 * row and one commented row is how that happens. */
export const ORIENTATION_TEXTURE = deepFreeze({
  directed:  "required",
  symmetric: "optional",
  acausal:   "forbidden",
});

/* Fields whose presence would make a revision refer to its own history. §D8.2
 * puts lifecycle in exactly one home, the ledger, so a value that points at
 * its predecessor is not a tighter version of the rule -- it is a second home,
 * and two homes disagree. */
const BACKPOINTER_FIELDS = deepFreeze(
  ["previous_revision", "prior_revision", "parent", "predecessor",
   "expected_prior_revision", "previous", "history"]);

/**
 * A V1 edge, read as a §D8 relation revision.
 *
 * Everything here comes from the sealed artifact, either READ off it or
 * RESOLVED from something frozen about V1:
 *
 *   domain      RESOLVED  the profile's declared default -- `signal`. Not the
 *                         profile id, which is what declares domains rather
 *                         than being one.
 *   orientation SUPPLIED  `directed`, because both V1 edge kinds are.
 *   texture     SUPPLIED  `solid`. V1's only surface-grounded texture (§5).
 *                         The artifact elides it exactly as it elides
 *                         orientation and the implied ports; an elided default
 *                         is a value the world states, not one it withholds.
 *   attributes  SUPPLIED  empty, because there is nowhere in V1 to put one.
 *
 * A V1 edge names two OBJECTS and leaves their ports implicit, because the
 * kind determines them: `EDGE_PORTS` is the frozen pair. §D8 terminals are
 * ports, not objects, so the port is made explicit here -- `p0.sig_out`, not
 * `p0`. That is what keeps two edges of different kinds between the same two
 * objects distinct relations rather than a collision, and it is why the
 * projection below can be a real inverse: the suffix it strips is recoverable
 * from the kind, so nothing was invented on the way in.
 *
 * The ROLES are §D8's semantic positions. Both V1 edge kinds are directed, so
 * every derived relation has one `source` and one `target`.
 */
export function edgeToRelationRevision(artifact, edge) {
  assertV1Artifact(artifact);
  if (!edge || typeof edge.kind !== "string")
    fail("WRL_BAD_RELATION_REVISION", "an edge must carry kind, src and dst");

  const ports = W.EDGE_PORTS[edge.kind];
  if (!ports)
    fail("WRL_UNSUPPORTED_FEATURE",
         `edge kind '${edge.kind}' is outside frozen Semantic IR v1`,
         { locator: `edge ${edge.kind}` });

  const known = new Set(artifact.objects.map((o) => o.object_id));
  for (const t of [edge.src, edge.dst]) {
    if (!known.has(t))
      fail("WRL_UNKNOWN_ENDPOINT",
           `edge names object '${t}', which the artifact never declares`,
           { locator: `edge ${edge.kind} ${edge.src}->${edge.dst}` });
  }

  return canonicalizeRelationRevision({
    domain: profileDefaultDomain(artifact.profile_id),
    kind: edge.kind,
    endpoints: [
      { terminal: { object_id: edge.src, port: ports[0] }, role: "source" },
      { terminal: { object_id: edge.dst, port: ports[1] }, role: "target" }],
    orientation: "directed",
    texture: V1_TEXTURE,
    attributes: {},
    policy: artifact.semantic_policies.rulepack_id,
  });
}

/**
 * Validate a revision, or raise. Separated from canonicalization because a
 * validator that also rewrites its input cannot be used to check something
 * somebody else produced.
 */
export function validateRelationRevision(rev) {
  if (!rev || typeof rev !== "object" || Array.isArray(rev))
    fail("WRL_BAD_RELATION_REVISION", "a relation revision must be a record");

  for (const f of BACKPOINTER_FIELDS) {
    if (f in rev)
      fail("WRL_REVISION_BACKPOINTER",
           `a relation revision carries '${f}'. Lifecycle history has one ` +
           `home and it is the ledger; a value that names its predecessor is ` +
           `a second home, and the two will disagree`,
           { fieldPath: f });
  }

  const unknown = Object.keys(rev).filter((k) => !REVISION_FIELDS.includes(k));
  if (unknown.length)
    fail("WRL_BAD_RELATION_REVISION",
         `relation revision carries unknown field(s) ${unknown.join(", ")}`,
         { fieldPath: unknown[0] });

  for (const f of ["domain", "kind", "orientation", "policy"]) {
    if (typeof rev[f] !== "string" || !rev[f])
      fail("WRL_BAD_RELATION_REVISION",
           `relation revision field '${f}' must be a non-empty string`,
           { fieldPath: f });
  }
  if (!ORIENTATIONS.includes(rev.orientation))
    fail("WRL_BAD_RELATION_REVISION",
         `orientation '${rev.orientation}' is not one of ` +
         ORIENTATIONS.join(", "), { fieldPath: "orientation" });
  const { admits, requires } = ORIENTATION_ROLES[rev.orientation];

  if (!Array.isArray(rev.endpoints) || rev.endpoints.length < 2)
    fail("WRL_BAD_RELATION_REVISION",
         "a relation revision needs at least two endpoints",
         { fieldPath: "endpoints" });
  for (const [i, e] of rev.endpoints.entries()) {
    if (!e || typeof e !== "object" || Array.isArray(e) ||
        typeof e.role !== "string")
      fail("WRL_BAD_RELATION_REVISION",
           `endpoint ${i} must be { terminal, role }`,
           { fieldPath: `endpoints[${i}]` });
    const extra = Object.keys(e).filter((k) => k !== "terminal" && k !== "role");
    if (extra.length)
      fail("WRL_BAD_RELATION_REVISION",
           `endpoint ${i} carries unknown field(s) ${extra.join(", ")}`,
           { fieldPath: `endpoints[${i}].${extra[0]}` });
    validateTerminal(e.terminal, `endpoints[${i}].terminal`);

    /* the two role checks are separate because they fail for different
     * reasons and a reader needs to know which: an unknown role is a typo or
     * an invented vocabulary, an unadmitted one is a legal role in the wrong
     * kind of relation */
    if (!ENDPOINT_ROLES.includes(e.role))
      fail("WRL_ENDPOINT_ROLE_ILLEGAL",
           `endpoint role '${e.role}' is not one of ${ENDPOINT_ROLES.join(", ")}`,
           { fieldPath: `endpoints[${i}].role` });
    if (!admits.includes(e.role))
      fail("WRL_ENDPOINT_ROLE_ILLEGAL",
           `a ${rev.orientation} relation does not admit role '${e.role}'; ` +
           `it admits ${admits.join(", ")}`,
           { fieldPath: `endpoints[${i}].role` });
  }

  /* §D8's normative uniqueness rule: at most once per RELATION, not per role.
   * The weaker per-role reading admits {(x, source), (x, target)} -- one
   * terminal simultaneously in the tail and the head -- and also leaves the
   * canonical sort key non-total, since role would have to break the tie
   * between two entries that share a terminal. */
  const seen = new Set();
  for (const e of rev.endpoints) {
    const key = terminalKey(e.terminal);
    if (seen.has(key))
      fail("WRL_DUPLICATE_TERMINAL",
           `terminal '${formatTerminal(e.terminal)}' appears twice in one ` +
           `relation. A terminal holds at most one position in a relation; a ` +
           `self-loop uses two different terminals on the same object`,
           { fieldPath: "endpoints" });
    seen.add(key);
  }

  const roles = new Set(rev.endpoints.map((e) => e.role));
  const absent = requires.filter((r) => !roles.has(r));
  if (absent.length)
    fail("WRL_INCOMPLETE_ORIENTATION",
         `a ${rev.orientation} relation requires ${requires.join(" and ")}; ` +
         `[${absent.join(", ")}] absent`, { fieldPath: "endpoints" });

  if (!rev.attributes || typeof rev.attributes !== "object" ||
      Array.isArray(rev.attributes))
    fail("WRL_BAD_RELATION_REVISION", "attributes must be a record",
         { fieldPath: "attributes" });

  if ("texture" in rev &&
      (typeof rev.texture !== "string" || !TEXTURES.includes(rev.texture)))
    fail("WRL_BAD_RELATION_REVISION",
         `texture, where present, is one of ${TEXTURES.join(", ")}; got ` +
         JSON.stringify(rev.texture), { fieldPath: "texture" });

  /* §D8's texture row, BOTH halves, read out of one table.
   *
   * ABSENT for acausal: an acausal connection has no writer, so there is
   * nothing for a texture to describe the delivery of, and settlement is
   * governed by a solver wall (§D4). A texture here would be a second,
   * disagreeing account of how the connection settles.
   *
   * REQUIRED for directed. 0.1.1 declined to enforce this and registered it as
   * a V2 obligation, on the grounds that a frozen artifact's edge records no
   * texture field. That reasoning confused the encoding with the meaning: V1's
   * only surface-grounded texture is `--` solid (§5), and the artifact elides
   * it the same way it elides `orientation` -- which the adapter was already
   * restoring without anyone calling it an invention. So the adapter restores
   * `solid`, and the rule can be enforced on everything, including the
   * relations this kernel derives. */
  const demand = ORIENTATION_TEXTURE[rev.orientation];
  if (demand === "forbidden" && "texture" in rev)
    fail("WRL_ACAUSAL_TEXTURE",
         "an acausal relation carries no texture -- it has no writer, and a " +
         "solver wall governs settlement instead (§D4)",
         { fieldPath: "texture" });
  if (demand === "required" && !("texture" in rev))
    fail("WRL_MISSING_TEXTURE",
         `a ${rev.orientation} relation states a texture: §D8's field table ` +
         `writes it required for directed, and §5's textures are guarantee ` +
         `classes, so a directed relation with none makes no statement about ` +
         `whether it settles within the period`, { fieldPath: "texture" });

  return rev;
}

/**
 * Canonical form: validated, endpoints SORTED, absent optionals absent rather
 * than null.
 *
 * `texture: undefined` and no `texture` key are the same fact, and if one of
 * them survived into the hash the two spellings would be two revisions. The
 * serializer is key-sorted, so no OBJECT needs ordering -- but `endpoints` is
 * an array, and an array's order is in its bytes. §D8 says endpoints are an
 * unordered SET, so the order has to be decided here or it is decided by
 * whoever typed the relation. Six spellings of one three-terminal net would
 * otherwise be six revisions of six different ids.
 *
 * The sort is by role position in `ENDPOINT_ROLES`, then terminal, and it is
 * total because a terminal appears at most once per relation -- so no two
 * entries can tie on both keys.
 */
export function canonicalizeRelationRevision(rev) {
  validateRelationRevision(rev);
  const out = {};
  for (const f of REVISION_FIELDS) {
    if (!(f in rev) || rev[f] === undefined) continue;
    out[f] = f === "endpoints"
      ? rev.endpoints
          .map((e) => ({
            terminal: { object_id: e.terminal.object_id, port: e.terminal.port },
            role: e.role,
          }))
          .sort((a, b) =>
            ENDPOINT_ROLES.indexOf(a.role) - ENDPOINT_ROLES.indexOf(b.role) ||
            cmpStr(terminalKey(a.terminal), terminalKey(b.terminal)))
      : rev[f];
  }
  return out;
}

/** RelationRevisionID = "rev-" + sha256(canonical revision bytes). */
export async function relationRevisionId(rev) {
  return "rev-" + await sha256Hex(
    W.serializeArtifact(canonicalizeRelationRevision(rev)));
}

/* ----------------------------------------------------------- allocations */

export const ALLOCATION_VARIANTS =
  deepFreeze(["named-initial", "legacy-edge", "granted"]);

/**
 * The shape of each variant, exactly, from §D8.1's preimage block.
 *
 * Written as data because the preimages are the identity scheme: a variant
 * that gained a field, or lost one, would mint different names for the same
 * relations, and the difference between those two hashes is not visible in a
 * round-trip test. `world_id` is absent from `granted` on purpose -- §D8.1
 * says `grant_id` already covers it, and restating it would be the same fact
 * in two places one line apart, in a section about not doing that.
 */
export const ALLOCATION_FIELDS = deepFreeze({
  "named-initial": ["world_id", "relation_name"],
  "legacy-edge":   ["world_id", "kind", "src", "dst"],
  "granted":       ["grant_id", "local_counter"],
});

/* THREE AUTHORITIES, NOT ONE.
 *
 * 0.1.1 had a single `MINTABLE_VARIANTS`, and it conflated three different
 * questions that happen to have the same answer in V1:
 *
 *   - which variants EXIST                    -> ALLOCATION_VARIANTS
 *   - which a trusted IMPORTER may construct  -> IMPORTABLE_VARIANTS
 *   - which an AUTHORING SURFACE may emit     -> AUTHORABLE_VARIANTS
 *
 * The conflation had a real cost: because `relationIdFromAllocation` refused
 * the other two variants outright, §D8.1's preimage law for them -- that a
 * named allocation is world-scoped, that two grants cannot collide -- could
 * not be stated as a property at all, and both rows sat `awaiting` behind a
 * runtime they do not actually need. Identity is a pure function of a
 * preimage. WHO may construct that preimage is a separate rule, and it belongs
 * at the boundary where the construction happens.
 */
export const IMPORTABLE_VARIANTS = deepFreeze(["legacy-edge"]);

/**
 * Which variants ANY authoring surface, in any encoding, may mint.
 *
 * This was `[]` through 0.1.2, and the value was wrong the moment B.4 shipped
 * a surface that writes `named-initial` seeds -- but nothing caught it,
 * because V2's own list was stated locally and the global one was never
 * consulted again. A constant whose name makes a claim about every encoding
 * has to be true of every encoding; one that is only true of the encoding it
 * was written beside is a fact that goes stale silently.
 *
 * The encoding-scoped answers live beside their encodings, and each is an
 * INTERSECTION of this list with what that encoding's initial bytes admit --
 * so a variant cannot become authorable in one encoding without becoming
 * authorable in general, and cannot stay authorable in general once no
 * encoding admits it.
 */
export const AUTHORABLE_VARIANTS = deepFreeze(["named-initial"]);

/**
 * V1's share of that authority: none, and the emptiness is a property of the
 * ENCODING rather than of the variant.
 *
 * A V1 artifact records `{ kind, src, dst }` per edge and has nowhere to put a
 * name, so `named-initial` -- authorable in general -- is unwritable here.
 * That is the distinction the single `[]` above used to hide: it read as "no
 * one may author a named relation", and what is true is "V1 cannot spell one".
 */
export const V1_AUTHORABLE_SEED_VARIANTS = deepFreeze([]);

/**
 * The V1 importer's authority. A V1 artifact records only `{ kind, src, dst }`
 * per edge and has no field for a relation name or a grant, so an adapter that
 * produced either would be asserting a surface and a grant machinery that do
 * not exist -- and two worlds with identical bytes could then mint different
 * ids, which is the one thing sealing is for.
 */
export function assertImportableAllocation(allocation) {
  validateAllocation(allocation);
  if (!IMPORTABLE_VARIANTS.includes(allocation.variant))
    fail("WRL_UNWRITABLE_ALLOCATION",
         `the V1 importer may not construct a '${allocation.variant}' ` +
         `allocation; it constructs ${IMPORTABLE_VARIANTS.join(", ")}. A V1 ` +
         `artifact records only { kind, src, dst } per edge and has no field ` +
         `for a relation name or a grant`, { fieldPath: "variant" });
  return allocation;
}

/**
 * An authoring surface's authority, in any encoding.
 *
 * `named-initial` is in and the other two are out, and both halves are the
 * statement. An author names a relation; that is what authoring a relation
 * IS. A `legacy-edge` allocation records that a relation was never named and
 * arrived through a migration, so emitting one from a surface would claim a
 * provenance that did not happen. A `granted` allocation is drawn at runtime
 * from an authority that does not exist while a world is being written.
 *
 * Which SURFACE can spell a named relation is a further question, and it is
 * the encoding's: see `V1_AUTHORABLE_SEED_VARIANTS` and V2's counterpart.
 */
export function assertAuthorableAllocation(allocation) {
  validateAllocation(allocation);
  if (!AUTHORABLE_VARIANTS.includes(allocation.variant))
    fail("WRL_UNWRITABLE_ALLOCATION",
         `an authoring surface may emit ${AUTHORABLE_VARIANTS.join(", ")} ` +
         `allocations, not '${allocation.variant}'. A legacy-edge allocation ` +
         `records that a relation was never named and arrived through a ` +
         `migration; a granted one is drawn at runtime from an authority that ` +
         `does not exist while a world is being written`,
         { fieldPath: "variant" });
  return allocation;
}

/**
 * A well-formed allocation of a KNOWN variant, or a typed refusal.
 *
 * Shape only. This says nothing about who was allowed to build the record --
 * that is the two assertions above -- because a hash function that also
 * enforced provenance would make §D8.1's preimage laws untestable for every
 * variant no surface can yet produce.
 */
export function validateAllocation(allocation) {
  if (!allocation || typeof allocation !== "object" ||
      Array.isArray(allocation) || typeof allocation.variant !== "string")
    fail("WRL_BAD_ALLOCATION", "an allocation must carry a variant tag",
         { fieldPath: "variant" });

  if (!ALLOCATION_VARIANTS.includes(allocation.variant))
    fail("WRL_BAD_ALLOCATION",
         `allocation variant '${allocation.variant}' is not one of ` +
         ALLOCATION_VARIANTS.join(", "), { fieldPath: "variant" });

  const want = ALLOCATION_FIELDS[allocation.variant];
  const have = Object.keys(allocation).filter((k) => k !== "variant").sort();
  if (W.serializeArtifact(have) !== W.serializeArtifact([...want].sort()))
    fail("WRL_BAD_ALLOCATION",
         `a ${allocation.variant} allocation is { ${want.join(", ")} }; got ` +
         `{ ${have.join(", ")} }. An extra field is a value in the preimage ` +
         `that §D8.1 does not name, and a missing one is a name that ` +
         `collides with every other allocation missing the same field`,
         { fieldPath: "variant" });

  for (const f of want) {
    if (f === "local_counter") {
      if (!Number.isInteger(allocation[f]) || allocation[f] < 0)
        fail("WRL_BAD_ALLOCATION",
             `local_counter is a non-negative integer; got ` +
             JSON.stringify(allocation[f]), { fieldPath: f });
      continue;
    }
    if (typeof allocation[f] !== "string" || !allocation[f])
      fail("WRL_BAD_ALLOCATION",
           `allocation field '${f}' must be a non-empty string`,
           { fieldPath: f });
    if (f === "world_id" && !/^sem-[0-9a-f]{64}$/.test(allocation[f]))
      fail("WRL_BAD_ALLOCATION",
           `world_id must be a sem- id; got ${JSON.stringify(allocation[f])}`,
           { fieldPath: f });
  }
  return allocation;
}

/**
 * The period-0 allocation a V1 world can actually produce.
 *
 * `world_id` is the `sem-` id of the sealed world. It is in the preimage on
 * purpose: without it the edge key is world-portable, and a relation id that
 * survives being carried into another world is a migration nobody wrote.
 */
export function legacyEdgeAllocation(worldId, edge) {
  if (!edge || typeof edge.kind !== "string" ||
      typeof edge.src !== "string" || typeof edge.dst !== "string")
    fail("WRL_BAD_ALLOCATION", "an edge must carry kind, src and dst");
  return assertImportableAllocation(
    { variant: "legacy-edge", world_id: worldId,
      kind: edge.kind, src: edge.src, dst: edge.dst });
}

/** The period-0 allocation a WRITABLE surface would produce. §D8.1. */
export function namedInitialAllocation(worldId, relationName) {
  return validateAllocation(
    { variant: "named-initial", world_id: worldId,
      relation_name: relationName });
}

/** The runtime allocation §D8.4 draws from a grant. §D8.1. */
export function grantedAllocation(grantId, localCounter) {
  return validateAllocation(
    { variant: "granted", grant_id: grantId, local_counter: localCounter });
}

/**
 * RelationID = "rel-" + sha256(canonical allocation bytes).
 *
 * The preimage is a canonically serialized RECORD, not a concatenation. §D8.1
 * writes it with `‖` separators, and the note beside it says what that means:
 * three adjacent free-form strings joined by an unframed separator cannot tell
 * ("ab","c") from ("a","bc"), and the legacy-edge variant is the first
 * preimage with three of them. Key-sorted JSON frames every field, so the
 * ambiguity cannot arise -- and the `variant` field is what keeps two families
 * apart even if a world_id and a grant_id ever coincided as bytes.
 */
export async function relationIdFromAllocation(allocation) {
  validateAllocation(allocation);
  return "rel-" + await sha256Hex(
    W.serializeArtifact({ tag: "WRL_RELATION", ...allocation }));
}

/* ------------------------------------------------------------- projection */

/**
 * The revision, read back as the V1 edge it came from.
 *
 * This is the compatibility proof, and it has to be a real inverse rather than
 * a plausible one: edge -> revision -> projection must reproduce the ORIGINAL
 * edge's bytes exactly, or the derived layer is describing a different world
 * from the one that sealed.
 */
export function projectRelationRevisionToV1Edge(rev) {
  const r = canonicalizeRelationRevision(rev);

  const ports = W.EDGE_PORTS[r.kind];
  if (!ports)
    fail("WRL_UNSUPPORTED_FEATURE",
         `relation kind '${r.kind}' has no V1 edge form`,
         { fieldPath: "kind" });
  if (r.orientation !== "directed")
    fail("WRL_UNSUPPORTED_FEATURE",
         `a V1 edge is directed; a ${r.orientation} relation has no V1 form`,
         { fieldPath: "orientation" });
  if (r.endpoints.length !== 2)
    fail("WRL_UNSUPPORTED_FEATURE",
         `a V1 edge has exactly two endpoints; this relation has ` +
         `${r.endpoints.length}`, { fieldPath: "endpoints" });
  if (Object.keys(r.attributes).length)
    fail("WRL_UNSUPPORTED_FEATURE",
         "a V1 edge carries no attributes, so a relation that has some " +
         "cannot be projected into one without losing them",
         { fieldPath: "attributes" });

  /* §D8.8's normative projection names `domain = signal` as its first clause,
   * so it is checked as one. A `mobility.occupies` relation with two frozen
   * edge kinds' worth of shape is still not a V1 edge. */
  const domain = profileDefaultDomain(W.PROFILE_ID);
  if (r.domain !== domain)
    fail("WRL_UNSUPPORTED_FEATURE",
         `a V1 edge encodes the ${domain} domain; a ${r.domain} relation has ` +
         `no V1 form`, { fieldPath: "domain" });

  /* ELIDED, not absent -- and elision is only lossless if the value being
   * dropped is the one the encoding implies. `--` solid is the whole of what a
   * V1 structural edge can mean (§5), so a solid texture is dropped on the way
   * out and any other texture is a relation V1 genuinely cannot represent. The
   * 0.1.1 rule was the opposite -- refuse ANY texture -- which round-tripped
   * only because the adapter had not restored one. */
  if (r.texture !== V1_TEXTURE)
    fail("WRL_UNSUPPORTED_FEATURE",
         `a V1 edge encodes only the ${V1_TEXTURE} texture; a ` +
         `${"texture" in r ? r.texture : "textureless"} relation has no V1 ` +
         `form`, { fieldPath: "texture" });

  /* found BY ROLE, never by position. Destructuring `const [src, dst] =
   * r.endpoints` is what 0.1 did, and it reads correctly right up until
   * canonicalisation reorders a set whose order was never meaning -- at which
   * point the head and the tail swap silently and the projection produces a
   * reversed edge that still round-trips through itself. */
  const src = r.endpoints.find((e) => e.role === "source");
  const dst = r.endpoints.find((e) => e.role === "target");
  if (!src || !dst)
    fail("WRL_INCOMPLETE_ORIENTATION",
         `a V1 edge needs one source and one target endpoint`,
         { fieldPath: "endpoints" });

  /* The port is not carried into the edge: it is recoverable from the kind,
   * and writing it down twice would let the two copies disagree. It is CHECKED
   * against the kind instead, which is the same test the frozen validator
   * applies to a written edge.
   *
   * This used to unpack `"p0.sig_out"` with a regex. The terminal is a record
   * now, so there is nothing to unpack -- which is the point of the change:
   * recovering structure by parsing is a sign the structure was discarded. */
  const object = (e, port, half) => {
    if (e.terminal.port !== port)
      fail("WRL_ILLEGAL_PORT_PAIR",
           `relation of kind ${r.kind} reaches ${e.terminal.port} as its ` +
           `${half}, but V1 pairs ${ports[0]} -> ${ports[1]}`,
           { fieldPath: "endpoints" });
    return e.terminal.object_id;
  };

  /* Key order matches `graphToIr`'s edge record for readability only. It is
   * NOT what makes the round trip exact -- `serializeArtifact` sorts keys
   * recursively, so these three could be written in any order and produce the
   * same bytes. This comment used to claim the order was load-bearing; a
   * mutation test that scrambled it expecting red got green. The correction is
   * left visible because a comment asserting a guarantee that nothing enforces
   * is how the next reader learns to trust the wrong thing. */
  return { kind: r.kind,
           src: object(src, ports[0], "source"),
           dst: object(dst, ports[1], "target") };
}

/* ------------------------------------------------------ the duplicate key */

/**
 * Refuse a world whose edge keys do not distinguish its relations.
 *
 * This runs BEFORE controller-count validation, and the ordering is the point.
 * A world with two identical `[sp] --socket--> [ob]` lines is today reported
 * as `WRL_CONTROLLER_CONFLICT: ob has 2 controllers`, which is true of the
 * lowered graph and useless as a diagnostic: there is one controller, written
 * twice. Under §D8 it is a sharper failure than a miscount -- the two lines
 * are two relations whose only available name is the same name, so the world
 * cannot say which one a later revision means. Reporting the miscount first
 * sends an author to look for a second controller that does not exist.
 */
export function checkRelationKeys(graph) {
  const seen = new Map();
  for (const [kind, src, dst] of graph.edges) {
    const key = W.serializeArtifact({ kind, src, dst });
    if (seen.has(key))
      fail("WRL_DUPLICATE_RELATION_KEY",
           `two relations share the edge key (${kind}, ${src}, ${dst}). In ` +
           `V1 that key is the only name a period-0 relation has, so a ` +
           `second one is not a duplicate line -- it is a relation that ` +
           `cannot be named, revised or retired independently of the first`,
           { locator: `edge ${kind} ${src}->${dst}` });
    seen.set(key, true);
  }
  return graph;
}

/* ------------------------------------------------------- the derived view */

/**
 * The derivation itself, from a SEALED world: the artifact and the id it
 * hashed to, nothing else.
 *
 * Taking the artifact rather than the source is the whole claim made
 * elsewhere on this page -- a relation view is a function of the sealed
 * world, not of how the world was written -- expressed as a signature, so a
 * consumer holding only a `sealWorld` result can derive without re-parsing
 * and without a second opinion about whether the world is admissible.
 *
 * That matters for the playground in particular. V1's error surface is
 * frozen: a doubled edge is `WRL_CONTROLLER_CONFLICT` there, and the sharper
 * `WRL_DUPLICATE_RELATION_KEY` this module can give is available only through
 * `sealWithRelations`. A page that showed the derived view must not silently
 * acquire the derived verdict along with it, so the two are separable.
 */
export async function deriveRelations(artifact, claimedSemanticId = null) {
  const worldId = await worldIdOfArtifact(artifact);

  /* The claim is OPTIONAL and CHECKED, and it used to be neither.
   *
   * 0.1.1 took the id as a parameter and put it straight into the allocation
   * preimage. Handing it a real artifact and a forged `sem-000…0` minted
   * relation ids under the forgery, silently -- so the module's central claim,
   * that relation identity is derived from the sealed world, was true only of
   * callers who were already telling the truth. A function with two
   * independent sources of truth about one hash has no source of truth. */
  if (claimedSemanticId !== null && claimedSemanticId !== worldId)
    fail("WRL_SEMANTIC_ID_MISMATCH",
         `the supplied artifact hashes to ${worldId}, and the caller claims ` +
         `${claimedSemanticId}. Relation identity is derived from the seal, ` +
         `so the seal is recomputed rather than believed`,
         { fieldPath: "semantic_artifact_id" });

  const relations = [];
  for (const edge of artifact.edges) {
    const allocation = legacyEdgeAllocation(worldId, edge);
    const revision = edgeToRelationRevision(artifact, edge);
    relations.push({
      allocation,
      relation_id: await relationIdFromAllocation(allocation),
      revision,
      revision_id: await relationRevisionId(revision),
    });
  }
  return {
    derived: true,
    canonical: false,
    inArtifactBytes: false,
    world_id: worldId,
    note: "InitialRelationDeclared facts for period 0. Not hashed into " +
          "the artifact and not part of the SemanticArtifactID.",
    relations,
  };
}

/* ------------------------------------------------- the migration statement */

/* The fields of a RelationImported fact, exactly. Named as data for the same
 * reason REVISION_FIELDS is: a test can require the set to be exhausted, so a
 * fifth field cannot arrive unclassified.
 *
 * WHO imported, WHEN, and UNDER WHAT AUTHORITY are deliberately not here.
 * §D8.3 puts provenance on the ledger EVENT rather than in the value, and a
 * four-field payload wrapped in an event envelope is that rule obeyed; five
 * fields would be it broken. */
export const RELATION_IMPORTED_FIELDS =
  deepFreeze(["from_world", "from_relation", "to_world", "to_relation"]);

/**
 * The STRUCTURAL correspondence between the relations of two sealed worlds.
 *
 * §D8.5 says a relation id is world-scoped and is not preserved by re-sealing,
 * and that any claim two relations across two sealed worlds are "the same
 * relation" is a MIGRATION claim carried by an explicit map a checker can
 * verify. This computes the CANDIDATE map, and the name says so.
 *
 * 0.1.1 called this `deriveCorrespondence` and had it emit records typed
 * `RelationImported`, which was a category error worth spelling out because it
 * looked like a naming quibble. Two independently authored worlds can contain
 * the same V1 edge keys without either having been imported from the other. A
 * derivation over two artifacts can see that the keys match; it cannot see
 * that a migration happened, because that is a historical claim and neither
 * artifact records history. So the derivation produces `pairs` -- candidates
 * -- and an accepted migration OPERATION is what emits `RelationImported`
 * facts, which `checkRelationImported` then verifies against these candidates.
 *
 * Why it can be built now rather than after V2: the break V2 will cause --
 * every `sem-` moves, so by §D8.5 every relation id moves with it -- is not
 * new in V2. Re-authoring any V1 world and re-sealing it does exactly the same
 * thing, at a smaller scale, inside the frozen corpus.
 *
 * The properties that make the result usable:
 *
 *   DERIVABLE. Computed from the two sealed artifacts alone, with each side's
 *   world id RECOMPUTED rather than taken on the caller's word. The pairing
 *   key is the legacy edge key -- in V1 the only name a period-0 relation has.
 *
 *   OUTSIDE THE VALUE. Neither artifact is read for anything but its own
 *   relations, and no id from one world enters a preimage in the other.
 *   Recording an import moves no id, which is the whole reason it is a ledger
 *   fact and not a field.
 *
 * An edge with no counterpart is NOT paired. It lands in `dropped` or `added`,
 * because a migration that quietly invents a correspondence for a relation
 * that stopped existing is the exact failure §D8.5 calls "silence is not
 * continuity".
 */
export async function deriveLegacyEdgeCorrespondence(from, to) {
  const index = async (field, w) => {
    if (!w || typeof w !== "object" || !w.artifact)
      fail("WRL_MALFORMED_ARTIFACT",
           `the ${field} side must be a sealed world: ` +
           `{ artifact, semanticId }`, { fieldPath: field });
    /* the claim is passed THROUGH the checked boundary, so a sealed-looking
     * record carrying a forged id is refused here too rather than only in the
     * single-world path */
    const view = await deriveRelations(
      w.artifact, typeof w.semanticId === "string" ? w.semanticId : null);
    const m = new Map();
    for (const r of view.relations)
      m.set(W.serializeArtifact({ kind: r.allocation.kind,
                                  src: r.allocation.src,
                                  dst: r.allocation.dst }), r);
    return { world_id: view.world_id, byKey: m };
  };

  const a = await index("from_world", from);
  const b = await index("to_world", to);
  const pairs = [], dropped = [], added = [];

  for (const key of [...a.byKey.keys()].sort()) {
    if (b.byKey.has(key))
      pairs.push({ key,
                   from_relation: a.byKey.get(key).relation_id,
                   to_relation: b.byKey.get(key).relation_id });
    else
      dropped.push({ key, relation_id: a.byKey.get(key).relation_id });
  }
  for (const key of [...b.byKey.keys()].sort())
    if (!a.byKey.has(key))
      added.push({ key, relation_id: b.byKey.get(key).relation_id });

  return {
    derived: true,
    canonical: false,
    inArtifactBytes: false,
    from_world: a.world_id,
    to_world: b.world_id,
    /* From world identity, and from nothing else.
     *
     * 0.1.1 defined this as "every pair has equal ids AND there is at least
     * one pair", which made two EMPTY worlds -- including one empty world
     * compared with itself -- report that identity was not preserved. That is
     * not what §D8.5 says. A relation id is meaningful relative to its sealed
     * world; two different worlds cannot preserve one whether or not they have
     * any relations to preserve, and one world trivially does. */
    identityPreserved: a.world_id === b.world_id,
    pairs, dropped, added,
  };
}

/**
 * The `RelationImported` facts a migration WOULD emit for this correspondence.
 *
 * Candidates. Calling this does not make a migration have happened; an
 * accepted migration operation emits these into a ledger, wrapped in the event
 * envelope that carries the authority and the timing.
 */
export function candidateImportedFacts(correspondence) {
  return correspondence.pairs.map((p) => ({
    from_world: correspondence.from_world,
    from_relation: p.from_relation,
    to_world: correspondence.to_world,
    to_relation: p.to_relation,
  }));
}

/**
 * Verify emitted `RelationImported` facts against the derived candidates.
 *
 * This is the checker §D8.5 asks for. A migration claim is authored -- an
 * operation asserted it -- so unlike the correspondence it CAN be maintained
 * wrongly, and the correction is that every fact must be backed by a pairing
 * the two sealed artifacts independently produce.
 */
export function checkRelationImported(facts, correspondence) {
  if (!Array.isArray(facts))
    fail("WRL_UNVERIFIED_IMPORT", "RelationImported facts are a list",
         { fieldPath: "facts" });

  const backed = new Set(candidateImportedFacts(correspondence)
    .map((f) => W.serializeArtifact(f)));

  for (const [i, f] of facts.entries()) {
    if (!f || typeof f !== "object" || Array.isArray(f) ||
        W.serializeArtifact(Object.keys(f).sort()) !==
          W.serializeArtifact([...RELATION_IMPORTED_FIELDS].sort()))
      fail("WRL_UNVERIFIED_IMPORT",
           `RelationImported fact ${i} is not exactly ` +
           `{ ${RELATION_IMPORTED_FIELDS.join(", ")} }`,
           { fieldPath: `facts[${i}]` });
    if (!backed.has(W.serializeArtifact({
          from_world: f.from_world, from_relation: f.from_relation,
          to_world: f.to_world, to_relation: f.to_relation })))
      fail("WRL_UNVERIFIED_IMPORT",
           `RelationImported fact ${i} claims ${f.from_relation} in ` +
           `${f.from_world} became ${f.to_relation} in ${f.to_world}, and the ` +
           `two sealed artifacts do not pair those relations. A migration ` +
           `claim is asserted, not derived, so it is the one thing here that ` +
           `can be maintained wrongly -- which is why it is checked`,
           { fieldPath: `facts[${i}]` });
  }
  return facts;
}

/**
 * Seal a world and return its derived relation view alongside.
 *
 * The `derived` block is marked, at runtime and in one place, with the three
 * properties that make it safe: it is derived, it is not canonical, and it is
 * not in the artifact bytes. `bytes` and `semanticId` come out of the same
 * pipeline `sealWorld` runs, and the suite checks byte equality against it for
 * every fixture -- which is the real guarantee, since a marker is only a claim.
 */
export async function sealWithRelations(source) {
  let origins = null;
  try {
    const mapped = W.desugarCoreMapped(source);
    origins = mapped.origins;
    const graph = W.canonicalizeGraph(W.parseWrlCore(mapped.text));

    /* before graphToIr, which is where validateGraph -- and its controller
     * count -- lives */
    checkRelationKeys(graph);

    const artifact = W.graphToIr(graph);
    const bytes = W.serializeArtifact(artifact);
    const semanticId = "sem-" + await sha256Hex(bytes);

    return {
      ok: true, source, desugared: mapped.text, origins, graph, artifact,
      bytes, semanticId, sugared: mapped.text !== source,
      derived: await deriveRelations(artifact, semanticId),
    };
  } catch (e) {
    if (e instanceof W.WrlError)
      return { ok: false, ...W.mapDiagnostic(e, origins) };
    return { ok: false, code: "WRL_MALFORMED_ARTIFACT", message: String(e),
             line: null, authoredLine: null };
  }
}

/* -------------------------------------------------------------- internals */

/* Same digest the spine uses. Duplicated rather than imported because
 * `wrl.js` keeps it private, and a derived module is the wrong place to argue
 * for widening the frozen layer's export surface. */
async function sha256Hex(text) {
  const buf = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0")).join("");
}

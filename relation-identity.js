/**
 * Relation Identity Kernel 0.1
 * ============================
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

/* ------------------------------------------------------------------ codes */

/* Codes this kernel raises. They are deliberately NOT added to `W.CODES`:
 * that catalogue is the frozen spine's, and a derived layer that grows the
 * frozen layer's error surface is no longer derived. */
export const RELATION_CODES = {
  WRL_DUPLICATE_RELATION_KEY:
    "two relations in one world share the edge key that names them",
  WRL_UNWRITABLE_ALLOCATION:
    "an allocation variant was used that no surface can yet produce",
  WRL_BAD_RELATION_REVISION:
    "a relation revision has the wrong shape",
  WRL_REVISION_BACKPOINTER:
    "a relation revision points at another revision",
};

const fail = (code, message, opts) => {
  throw new W.WrlError(code, message, opts);
};

/* ------------------------------------------------------------- revisions */

/* The field list is §D8's, and the order here is presentational only -- the
 * canonical form is key-sorted, so nothing downstream depends on it. */
export const REVISION_FIELDS =
  ["domain", "kind", "endpoints", "orientation", "texture", "attributes", "policy"];

/* Fields whose presence would make a revision refer to its own history. §D8.2
 * puts lifecycle in exactly one home, the ledger, so a value that points at
 * its predecessor is not a tighter version of the rule -- it is a second home,
 * and two homes disagree. */
const BACKPOINTER_FIELDS =
  ["previous_revision", "prior_revision", "parent", "predecessor",
   "expected_prior_revision", "previous", "history"];

/**
 * A V1 edge, read as a §D8 relation revision.
 *
 * Everything here comes from the sealed artifact. `orientation` is `directed`
 * because both V1 edge kinds are; `texture` is absent because a V1 edge
 * carries none, and absent rather than null because §D8 writes it `texture?`;
 * `attributes` is empty because there is nowhere in V1 to put one.
 *
 * The endpoint ROLES are the port names -- the frozen `EDGE_PORTS` pair for
 * the kind. They are the reason two edges of different kinds between the same
 * two objects are different relations rather than a collision: `sig_out` is
 * not `socket`.
 */
export function edgeToRelationRevision(artifact, edge) {
  if (!artifact || !Array.isArray(artifact.objects))
    fail("WRL_BAD_RELATION_REVISION",
         "a relation revision needs the sealed artifact for its endpoints");
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
    domain: artifact.profile_id,
    kind: edge.kind,
    endpoints: [{ terminal: edge.src, role: ports[0] },
                { terminal: edge.dst, role: ports[1] }],
    orientation: "directed",
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
  if (rev.orientation !== "directed" && rev.orientation !== "undirected")
    fail("WRL_BAD_RELATION_REVISION",
         `orientation '${rev.orientation}' is neither directed nor undirected`,
         { fieldPath: "orientation" });

  if (!Array.isArray(rev.endpoints) || rev.endpoints.length < 2)
    fail("WRL_BAD_RELATION_REVISION",
         "a relation revision needs at least two endpoints",
         { fieldPath: "endpoints" });
  for (const [i, e] of rev.endpoints.entries()) {
    if (!e || typeof e.terminal !== "string" || typeof e.role !== "string")
      fail("WRL_BAD_RELATION_REVISION",
           `endpoint ${i} must be { terminal, role }`,
           { fieldPath: `endpoints[${i}]` });
    const extra = Object.keys(e).filter((k) => k !== "terminal" && k !== "role");
    if (extra.length)
      fail("WRL_BAD_RELATION_REVISION",
           `endpoint ${i} carries unknown field(s) ${extra.join(", ")}`,
           { fieldPath: `endpoints[${i}].${extra[0]}` });
  }

  if (!rev.attributes || typeof rev.attributes !== "object" ||
      Array.isArray(rev.attributes))
    fail("WRL_BAD_RELATION_REVISION", "attributes must be a record",
         { fieldPath: "attributes" });

  if ("texture" in rev && typeof rev.texture !== "string")
    fail("WRL_BAD_RELATION_REVISION",
         "texture, where present, must be a string", { fieldPath: "texture" });

  return rev;
}

/**
 * Canonical form: validated, with absent optionals absent rather than null.
 *
 * `texture: undefined` and no `texture` key are the same fact, and if one of
 * them survived into the hash the two spellings would be two revisions. The
 * serializer is key-sorted, so nothing else needs ordering.
 */
export function canonicalizeRelationRevision(rev) {
  validateRelationRevision(rev);
  const out = {};
  for (const f of REVISION_FIELDS) {
    if (!(f in rev) || rev[f] === undefined) continue;
    out[f] = f === "endpoints"
      ? rev.endpoints.map((e) => ({ terminal: e.terminal, role: e.role }))
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

export const ALLOCATION_VARIANTS = ["named-initial", "legacy-edge", "granted"];

/* Variants this build can actually mint. `named-initial` is known and refused,
 * not omitted: a reader who reaches for it gets a typed answer naming what is
 * missing, rather than the silence that reads like "not implemented yet" and
 * gets implemented locally. */
export const MINTABLE_VARIANTS = ["legacy-edge"];

/**
 * The period-0 allocation a V1 world can actually produce.
 *
 * `world_id` is the `sem-` id of the sealed world. It is in the preimage on
 * purpose: without it the edge key is world-portable, and a relation id that
 * survives being carried into another world is a migration nobody wrote.
 */
export function legacyEdgeAllocation(worldId, edge) {
  if (typeof worldId !== "string" || !/^sem-[0-9a-f]{64}$/.test(worldId))
    fail("WRL_MALFORMED_ARTIFACT",
         `world_id must be a sem- id; got ${JSON.stringify(worldId)}`,
         { fieldPath: "world_id" });
  if (!edge || typeof edge.kind !== "string" ||
      typeof edge.src !== "string" || typeof edge.dst !== "string")
    fail("WRL_MALFORMED_ARTIFACT", "an edge must carry kind, src and dst");
  return { variant: "legacy-edge", world_id: worldId,
           kind: edge.kind, src: edge.src, dst: edge.dst };
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
  if (!allocation || typeof allocation.variant !== "string")
    fail("WRL_MALFORMED_ARTIFACT", "an allocation must carry a variant tag",
         { fieldPath: "variant" });

  if (!ALLOCATION_VARIANTS.includes(allocation.variant))
    fail("WRL_MALFORMED_ARTIFACT",
         `allocation variant '${allocation.variant}' is not one of ` +
         ALLOCATION_VARIANTS.join(", "), { fieldPath: "variant" });

  if (!MINTABLE_VARIANTS.includes(allocation.variant))
    fail("WRL_UNWRITABLE_ALLOCATION",
         `allocation variant '${allocation.variant}' has no surface that can ` +
         `produce it in this build. A V1 artifact records only ` +
         `{ kind, src, dst } per edge and has no field for a relation name, ` +
         `so minting from one would let two worlds with identical bytes mint ` +
         `different ids`, { fieldPath: "variant" });

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
         "a V1 edge is directed; an undirected relation has no V1 form",
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
  if ("texture" in r)
    fail("WRL_UNSUPPORTED_FEATURE",
         "a V1 edge carries no texture", { fieldPath: "texture" });

  const [src, dst] = r.endpoints;
  if (src.role !== ports[0] || dst.role !== ports[1])
    fail("WRL_ILLEGAL_PORT_PAIR",
         `relation of kind ${r.kind} connects ${src.role} -> ${dst.role}, ` +
         `but V1 pairs ${ports[0]} -> ${ports[1]}`,
         { fieldPath: "endpoints" });

  /* Key order matches `graphToIr`'s edge record for readability only. It is
   * NOT what makes the round trip exact -- `serializeArtifact` sorts keys
   * recursively, so these three could be written in any order and produce the
   * same bytes. This comment used to claim the order was load-bearing; a
   * mutation test that scrambled it expecting red got green. The correction is
   * left visible because a comment asserting a guarantee that nothing enforces
   * is how the next reader learns to trust the wrong thing. */
  return { kind: r.kind, src: src.terminal, dst: dst.terminal };
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

    const relations = [];
    for (const edge of artifact.edges) {
      const allocation = legacyEdgeAllocation(semanticId, edge);
      const revision = edgeToRelationRevision(artifact, edge);
      relations.push({
        allocation,
        relation_id: await relationIdFromAllocation(allocation),
        revision,
        revision_id: await relationRevisionId(revision),
      });
    }

    return {
      ok: true, source, desugared: mapped.text, origins, graph, artifact,
      bytes, semanticId, sugared: mapped.text !== source,
      derived: {
        derived: true,
        canonical: false,
        inArtifactBytes: false,
        note: "InitialRelationDeclared facts for period 0. Not hashed into " +
              "the artifact and not part of the SemanticArtifactID.",
        relations,
      },
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

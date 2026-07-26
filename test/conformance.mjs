/* test/conformance.mjs -- the browser spine's conformance corpus.
 *
 *     node test/conformance.mjs
 *
 * WHY THIS EXISTS. `selfCheck()` proves that one fixture still hashes to one
 * id. That is a floor, and it was read as a ceiling: it stayed green while the
 * documentation printed the four-object starter world wearing the six-object
 * fixture's id, while `(banana=7)` sealed silently, while `period=2x` parsed as
 * 2, while a missing `profile` line sealed, while diagnostics reported
 * generated line numbers, and while `formatCore` emitted a role its own parser
 * refuses. Every one of those is a contract the documentation states. So the
 * contract is tested here, not asserted in prose.
 *
 * Two halves:
 *
 *   1. A CORPUS of (source -> expected id | expected diagnostic) cases.
 *   2. A DOC SWEEP that extracts every WRL block from the published HTML and
 *      seals it. A block that is a complete world MUST carry `data-seal` or
 *      `data-reject`; an unannotated one fails the run. That is the step that
 *      would have caught the wrong hero id the moment it was written.
 *
 * No dependencies. Node >= 18 (WebCrypto + BigInt).
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as W from "../wrl.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

let pass = 0, fail = 0;
const failures = [];

/* every check name that actually ran, so the pending-battery register at the
 * bottom can tell a property that claims to be executable from one that merely
 * says so */
const ran = new Set();

function ok(name, cond, detail) {
  ran.add(name);
  if (cond) { pass++; return true; }
  fail++; failures.push(`${name}\n      ${detail}`);
  return false;
}

async function expectSeal(name, source, id) {
  const r = await W.sealWorld(source);
  if (!r.ok) return ok(name, false, `rejected ${r.code}: ${r.message}`);
  return ok(name, r.semanticId === id, `got  ${r.semanticId}\n      want ${id}`);
}

async function expectReject(name, source, code, line) {
  const r = await W.sealWorld(source);
  if (r.ok) return ok(name, false, `sealed ${r.semanticId}; expected ${code}`);
  if (!ok(name, r.code === code, `got ${r.code} ("${r.message}"); want ${code}`)) return false;
  if (line !== undefined) {
    return ok(`${name} @line`, r.line === line, `reported line ${r.line}, want ${line}`);
  }
  return true;
}

async function sealId(source) {
  const r = await W.sealWorld(source);
  return r.ok ? r.semanticId : `REJECT:${r.code}`;
}

/* ===================================================== 1. the two fixtures */

await expectSeal("fixture/starter", W.STARTER_WORLD, W.STARTER_WORLD_SEMANTIC_ID);
await expectSeal("fixture/pinned", W.DEMO_WORLD, W.DEMO_WORLD_SEMANTIC_ID);
ok("fixture/distinct",
   W.STARTER_WORLD_SEMANTIC_ID !== W.DEMO_WORLD_SEMANTIC_ID,
   "the starter world and the pinned fixture must not share an id");

/* ============================================== 2. what is inert vs what moves */

const TWIN = `profile forge.world.core.v1

[pulser:p0](mode=periodic, period=2, phase=0){sig_out}
[relay:r0]{sig_in, sig_out}
[spinner:sp](w=16, n=8, rotor=181.0.0.181, configurable){sig_in, socket}
[orb:ob]{pose}
[pulser:p1](mode=once, epoch=1){sig_out}
[door:d0]{sig_in}

[pulser:p0] --sig--> [relay:r0]
[relay:r0] --sig--> [spinner:sp]
[spinner:sp] --socket--> [orb:ob]
[pulser:p1] --sig--> [door:d0]
`;
await expectSeal("inert/sugar-twin", TWIN, W.DEMO_WORLD_SEMANTIC_ID);

const SHUFFLED = `profile forge.world.core.v1

[spinner:sp] --socket--> [orb:ob]
[pulser:p1] --sig--> [door:d0]
[relay:r0]    --sig-->   [spinner:sp]
[pulser:p0] --sig--> [relay:r0]

[door:d0]{sig_in}
[pulser:p1](once at 1){sig_out}      ; fires exactly once
[orb:ob]{pose}
[spinner:sp](w=16, n=8, rotor=quarter_turn_z, configurable){sig_in, socket}
[relay:r0]{sig_in, sig_out}
[pulser:p0](every 2){sig_out}
`;
await expectSeal("inert/declaration-order", SHUFFLED, W.DEMO_WORLD_SEMANTIC_ID);
await expectSeal("inert/whitespace-comments",
  W.DEMO_WORLD.replace(/\n/g, "\n\n").replace(
    "[orb:ob]{pose}", "[orb:ob]{pose}   ; a pose sink"),
  W.DEMO_WORLD_SEMANTIC_ID);

/* sugar has no identity of its own -- but a sugar EDIT is still an edit */
ok("moves/rotor-name",
   await sealId(W.STARTER_WORLD.replace("quarter_turn_z", "identity")) !==
   W.STARTER_WORLD_SEMANTIC_ID,
   "changing the named rotor must move the id");
ok("moves/geometry",
   await sealId(W.STARTER_WORLD.replace("n=8", "n=4")) !==
   W.STARTER_WORLD_SEMANTIC_ID,
   "the same rotor name at a different n projects differently");
ok("moves/sugar-value",
   await sealId(W.STARTER_WORLD.replace("every 2", "every 3")) !==
   W.STARTER_WORLD_SEMANTIC_ID,
   "'no sugar-specific identity' does not mean a sugar edit is free");

/* ================================================== 3. the profile header */

const P = "profile forge.world.core.v1\n";
const RELAY = "[relay:r0]{sig_in, sig_out}\n";

await expectReject("profile/missing-entirely", "", "WRL_MISSING_PROFILE");
await expectReject("profile/absent", RELAY, "WRL_MISSING_PROFILE", 1);
await expectReject("profile/duplicated", P + P + RELAY, "WRL_DUPLICATE_PROFILE", 2);
await expectReject("profile/not-first", RELAY + P, "WRL_MISSING_PROFILE", 2);
await expectReject("profile/trailing-junk",
  "profile forge.world.core.v1 junk\n" + RELAY, "WRL_MALFORMED_PROFILE", 1);
/* a bare `profile` is a profile line that is MALFORMED, not one that is
   missing -- the author clearly reached for the header and mis-spelled it, and
   saying "you have no profile line" would send them looking for the wrong bug */
await expectReject("profile/bare", "profile\n" + RELAY, "WRL_MALFORMED_PROFILE", 1);
await expectReject("profile/unknown-dialect",
  "profile forge.world.core.v9\n" + RELAY, "WRL_UNSUPPORTED_FEATURE");
ok("profile/comments-may-precede",
   (await W.sealWorld("; a header comment\n\n" + P + RELAY)).ok,
   "a comment before the profile line is legal");

/* an empty world is a WORLD; an empty document is not */
const emptyWorld = await W.sealWorld(P);
ok("profile/empty-world-seals", emptyWorld.ok,
   `a profile-only document is a legal empty world (${emptyWorld.code})`);

/* ============================================ 4. the closed config grammar */

await expectReject("config/unknown-key",
  P + "[relay:r](banana=7){sig_in, sig_out}\n", "WRL_UNKNOWN_CONFIG_KEY", 2);
await expectReject("config/unknown-key-on-pulser",
  P + "[pulser:p](mode=periodic, period=2, phase=0, banana=7){sig_out}\n",
  "WRL_UNKNOWN_CONFIG_KEY", 2);
await expectReject("config/unknown-flag",
  P + "[spinner:s](w=16, n=8, rotor=181.0.0.181, banana){sig_in, socket}\n",
  "WRL_UNKNOWN_CONFIG_KEY", 2);
await expectReject("config/duplicate-key",
  P + "[pulser:p](mode=periodic, period=2, period=3, phase=0){sig_out}\n",
  "WRL_DUPLICATE_CONFIG_KEY", 2);
await expectReject("config/wrong-field-for-mode",
  P + "[pulser:p](mode=once, epoch=1, phase=0){sig_out}\n",
  "WRL_UNKNOWN_CONFIG_KEY", 2);
await expectReject("config/missing-field-for-mode",
  P + "[pulser:p](mode=periodic, period=2){sig_out}\n",
  "WRL_CLOCK_RANGE", 2);
await expectReject("config/non-boolean",
  P + "[spinner:s](w=16, n=8, rotor=181.0.0.181, configurable=maybe){sig_in, socket}\n",
  "WRL_UNSUPPORTED_FEATURE", 2);
await expectReject("config/configurable-twice",
  P + "[spinner:s](w=16, n=8, rotor=181.0.0.181, configurable, configurable=true){sig_in, socket}\n",
  "WRL_DUPLICATE_CONFIG_KEY", 2);

/* ================================================== 5. strict integers */

await expectReject("int/numeric-prefix",
  P + "[pulser:p](mode=periodic, period=2x, phase=0){sig_out}\n",
  "WRL_NUMERIC_RANGE", 2);
await expectReject("int/rotor-prefix",
  P + "[spinner:s](w=16, n=8, rotor=181x.0.0.181){sig_in, socket}\n",
  "WRL_NUMERIC_RANGE", 2);
await expectReject("int/empty",
  P + "[pulser:p](mode=periodic, period=, phase=0){sig_out}\n",
  "WRL_NUMERIC_RANGE", 2);
/* NOTE a rotor cannot carry a float: `.` already separates lanes, so
   `rotor=181.5.0.0` is the perfectly legal four-lane rotor (181, 5, 0, 0).
   Floats are only spellable on a scalar field, so that is where this is tested;
   a rotor with the wrong LANE COUNT is the neighbouring case. */
await expectReject("int/float",
  P + "[pulser:p](mode=periodic, period=2.5, phase=0){sig_out}\n",
  "WRL_NUMERIC_RANGE", 2);
await expectSeal("int/rotor-dots-are-lanes-not-a-float",
  P + "[spinner:s](w=16, n=8, rotor=181.5.0.0){sig_in, socket}\n",
  await sealId(P + "[spinner:s](w=16, n=8, rotor=181.5.0.0){sig_in, socket}\n"));
await expectReject("int/rotor-lane-count",
  P + "[spinner:s](w=16, n=8, rotor=181.0.0){sig_in, socket}\n",
  "WRL_NUMERIC_RANGE", 2);
await expectReject("int/unsafe-scalar",
  P + "[pulser:p](mode=periodic, period=9007199254740993, phase=0){sig_out}\n",
  "WRL_NUMERIC_RANGE", 2);

/* rotor lanes are the exception: exact at any width */
{
  const big = P +
    "[spinner:s](w=64, n=8, rotor=9223372036854775807.0.0.0){sig_in, socket}\n";
  const r = await W.sealWorld(big);
  ok("int/bigint-lane-seals", r.ok, r.ok ? "" : `${r.code}: ${r.message}`);
  if (r.ok) {
    ok("int/bigint-lane-exact",
       r.bytes.includes('"rotor":[9223372036854775807,0,0,0]'),
       `serialized as ${/"rotor":\[[^\]]*\]/.exec(r.bytes)?.[0]}`);
  }
  const over = P +
    "[spinner:s](w=8, n=4, rotor=9223372036854775807.0.0.0){sig_in, socket}\n";
  await expectReject("int/lane-over-2^w", over, "WRL_NUMERIC_RANGE");
}

/* ============================================== 6. clock sugar is a grammar */

await expectSeal("clock/every-K",
  P + "[pulser:p](every 2){sig_out}\n",
  await sealId(P + "[pulser:p](mode=periodic, period=2, phase=0){sig_out}\n"));
await expectSeal("clock/every-K-phase-P",
  P + "[pulser:p](every 4, phase 1){sig_out}\n",
  await sealId(P + "[pulser:p](mode=periodic, period=4, phase=1){sig_out}\n"));
await expectSeal("clock/once-at-E",
  P + "[pulser:p](once at 3){sig_out}\n",
  await sealId(P + "[pulser:p](mode=once, epoch=3){sig_out}\n"));
await expectReject("clock/trailing-tokens",
  P + "[pulser:p](every 2 garbage phase 1 nonsense){sig_out}\n",
  "WRL_SUGAR_MALFORMED", 2);
await expectReject("clock/every-without-period",
  P + "[pulser:p](every){sig_out}\n", "WRL_SUGAR_MALFORMED", 2);
await expectReject("clock/once-without-at",
  P + "[pulser:p](once 3){sig_out}\n", "WRL_SUGAR_MALFORMED", 2);

/* ================================================ 7. structural validation */

await expectReject("struct/controller-conflict", `${P}
[pulser:p0](every 2){sig_out}
[pulser:p1](every 3){sig_out}
[relay:r0]{sig_in, sig_out}
[pulser:p0] --sig--> [relay:r0]
[pulser:p1] --sig--> [relay:r0]
`, "WRL_CONTROLLER_CONFLICT");
await expectReject("struct/unknown-endpoint",
  P + "[relay:r0]{sig_in, sig_out}\n[r0] --sig--> [nope]\n",
  "WRL_UNKNOWN_ENDPOINT", 3);
await expectReject("struct/illegal-port-pair",
  P + "[door:d]{sig_in}\n[orb:o]{pose}\n[d] --sig--> [o]\n",
  "WRL_ILLEGAL_PORT_PAIR", 4);
await expectReject("struct/duplicate-id",
  P + "[relay:r]{sig_in, sig_out}\n[door:r]{sig_in}\n", "WRL_DUPLICATE_ID", 3);
await expectReject("struct/port-signature",
  P + "[relay:r]{sig_in}\n", "WRL_PORT_SIGNATURE", 2);
await expectReject("struct/duplicate-port",
  P + "[relay:r]{sig_in, sig_in}\n", "WRL_PORT_SIGNATURE", 2);
await expectReject("struct/bad-id",
  P + "[relay:a__b]{sig_in, sig_out}\n", "WRL_UNSUPPORTED_FEATURE", 2);

/* an OPTIONAL role prefix is a checked assertion */
await expectSeal("struct/role-prefix-correct",
  P + "[pulser:p](every 2){sig_out}\n[door:d]{sig_in}\n[pulser:p] --sig--> [door:d]\n",
  await sealId(P + "[pulser:p](every 2){sig_out}\n[door:d]{sig_in}\n[p] --sig--> [d]\n"));
await expectReject("struct/role-prefix-lie",
  P + "[pulser:p](every 2){sig_out}\n[door:d]{sig_in}\n[door:p] --sig--> [spinner:d]\n",
  "WRL_ROLE_PREFIX_MISMATCH", 4);

/* ==================================== 8. the world / scenario document boundary */

await expectReject("boundary/periods",
  P + "[relay:r]{sig_in, sig_out}\nperiods 7\n",
  "WRL_WORLD_SOURCE_HAS_SCENARIO", 3);
await expectReject("boundary/epoch-claim",
  P + "[relay:r]{sig_in, sig_out}\n[epoch:3] SetRotor sp 1.0.0.0\n",
  "WRL_WORLD_SOURCE_HAS_SCENARIO", 3);
{
  const combined = W.DEMO_WORLD + "periods 7\n[epoch:3] SetRotor sp 181.0.0.181\n";
  const { world, runInputs } = W.splitLegacyDocument(combined);
  ok("boundary/split-is-lexical", runInputs.split("\n").filter((l) => l.trim()).length === 2,
     "the legacy split moves run-input lines and nothing else");
  await expectSeal("boundary/split-preserves-id", world, W.DEMO_WORLD_SEMANTIC_ID);
}

/* ======================================= 9. diagnostics map to AUTHORED lines */

{
  /* r*3 mints r0,r1,r2 at emitted lines 3,4,5; the explicit r2 the author
     typed on line 4 lands at emitted line 6 and collides. */
  const src = `${P}
[relay:r*3]{sig_in, sig_out}
[relay:r2]{sig_in, sig_out}
`;
  const r = await W.sealWorld(src);
  ok("remap/rejects", !r.ok && r.code === "WRL_DUPLICATE_ID",
     `got ${r.ok ? "a seal" : r.code}`);
  ok("remap/authored-line", r.line === 4,
     `reported line ${r.line}; the author typed the collision on line 4`);
}
{
  /* a fault INSIDE an expansion reports the authored line AND says so */
  const src = `${P}
[pulser:p*2](every 2){sig_out}
[relay:r0]{sig_in, sig_out}
[p*2] --sig--> [r0]
`;
  const r = await W.sealWorld(src);
  ok("remap/inside-expansion", !r.ok && r.code === "WRL_CONTROLLER_CONFLICT",
     `got ${r.ok ? "a seal" : r.code}`);
}

/* ============================== 10. formatter round-trip and IR-only refusal */

for (const [name, source] of [["starter", W.STARTER_WORLD],
                              ["pinned", W.DEMO_WORLD]]) {
  const sealed = await W.sealWorld(source);
  const round = await W.sealWorld(W.formatCore(sealed.graph));
  ok(`format/round-trip-${name}`,
     round.ok && round.semanticId === sealed.semanticId,
     round.ok ? `${round.semanticId} != ${sealed.semanticId}` : round.code);
  ok(`format/idempotent-${name}`,
     W.formatCore(sealed.graph) === W.formatCore(round.graph),
     "formatting a formatted world must be a no-op");
}
{
  const g = new W.WrlGraph();
  g.nodes.push(["Mailbox", "m", { w: 8, cap: 4 }]);
  let refused = false;
  try { W.formatCore(g); } catch (e) { refused = e.code === "WRL_UNSUPPORTED_FEATURE"; }
  ok("format/refuses-ir-only-role", refused,
     "formatCore must not emit a role parseWrlCore rejects");
  ok("format/debug-marks-ir-only", W.formatIrDebug(g).includes(";! [mailbox:m]"),
     "formatIrDebug should show it, commented out");
  ok("format/debug-output-is-not-source",
     !/^\[mailbox:/m.test(W.formatIrDebug(g)),
     "the debug rendering must never look like valid source");
}
await expectReject("surface/mailbox-unwritable",
  P + "[mailbox:m](w=8, cap=4)\n", "WRL_UNSUPPORTED_FEATURE", 2);

/* ============================== 11. route textures that are not IR v1 edges */

for (const [tex, name] of [["~~sig~~>", "async"], ["==sig==>", "verified"],
                           ["!!sig!!>", "fault"]]) {
  await expectReject(`texture/${name}-not-an-edge`,
    P + `[pulser:p](every 2){sig_out}\n[door:d]{sig_in}\n[p] ${tex} [d]\n`,
    "WRL_UNSUPPORTED_FEATURE", 4);
}

/* ============================================ 12. the published code catalog */

for (const id of W.BROWSER_CODE_IDS) {
  ok(`catalog/${id}-described`, typeof W.CODES[id] === "string" && W.CODES[id],
     "every browser code needs a one-line description");
}
ok("catalog/browser-subset",
   W.BROWSER_CODE_IDS.every((c) => c in W.CODES),
   "BROWSER_CODE_IDS must be a subset of CODES");

/* ==================================================== 13. the doc sweep */

const TAG = /<pre\b([^>]*)>\s*<code\b[^>]*>([\s\S]*?)<\/code>\s*<\/pre>/g;
const ATTR = (attrs, name) =>
  (new RegExp(`${name}="([^"]*)"`).exec(attrs) || [])[1] || null;

function decode(html) {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

const htmlFiles = readdirSync(ROOT).filter((f) => f.endsWith(".html"));
let blocks = 0, annotated = 0;
let notCurrentWorlds = 0, notCurrentFragments = 0;

/* ---------------------------------------------- the capability registry
 *
 * reference.html#capability-registry is the ONE place a promotion capability
 * may be declared. Everything else on the site may only cite it. Parsing the
 * published table rather than a parallel JS constant is deliberate: a registry
 * that can drift from the page it documents is not a registry. */
const REGISTRY = (() => {
  const html = readFileSync(join(ROOT, "reference.html"), "utf8");
  const table = /<table id="capability-registry">([\s\S]*?)<\/table>/.exec(html);
  const out = new Map();
  if (!table) return out;
  /* whole rows, not just the opening tag: the STEP lives in a cell, and the
   * published row ORDER is itself a claim that gets checked below */
  let order = 0;
  for (const row of table[1].matchAll(/<tr ([^>]*data-capability[^>]*)>([\s\S]*?)<\/tr>/g)) {
    const [, a, cells] = row;
    const tds = [...cells.matchAll(/<td>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
    out.set(ATTR(a, "data-capability"), {
      tier: ATTR(a, "data-tier"),
      impl: ATTR(a, "data-implementation"),
      stages: (ATTR(a, "data-stages") || "")
        .split(",").map((s) => s.trim()).filter(Boolean),
      refusedAt: ATTR(a, "data-refused-at"),
      /* the step cell is the only all-digit cell in a row */
      step: Number(tds.find((t) => /^\d+$/.test(t.trim())) ?? NaN),
      order: order++,
    });
  }
  return out;
})();

ok("caps/registry-found", REGISTRY.size > 0,
   "reference.html#capability-registry did not parse -- no capability can be checked");

/* Three ORTHOGONAL axes, because collapsing them is what let the site claim a
 * promotion mechanism it did not have. `tier` says how settled the MEANING is;
 * `impl` says how much of the toolchain does it; `stages` says exactly which
 * pipeline stages accept it when the answer is "some of them". */
const STAGES =
  ["desugar", "parse", "validate", "canonicalize", "serialize", "seal", "execute"];

/* Every stage name above except `execute` is a FUNCTION THAT EXISTS in wrl.js,
 * and the map below is what makes a stage claim executable rather than merely
 * declared. This matters because the stage vocabulary has now been wrong twice.
 *
 *   v1: "refused at lowering" -- overstated. There is no route declaration and
 *       no lowering step for these textures.
 *   v2: "tokenize" completes   -- ALSO wrong, in the opposite direction. There
 *       is no tokenizer. `parseWrlCore` splits on newlines, strips comments and
 *       dispatches on regular expressions. Naming a stage the implementation
 *       does not have is not a smaller error than naming one it has not reached.
 *
 * Both errors were possible because the claim lived only in prose and in a
 * matching constant, so the two could agree with each other and with nothing
 * else. A stage is now claimed by NAMING A FUNCTION AND RUNNING IT: every stage
 * a capability says it completes must actually return, and the stage it says
 * refuses it must actually throw. `desugar` survives that test -- `desugarCore`
 * rewrites the surrounding sugar and passes the texture line through untouched
 * -- and `tokenize` could not have, because there would have been nothing to
 * put in the map.
 *
 * `execute` deliberately has no entry: the browser port stops at the seal (it
 * does not reduce films), so no capability may claim to complete it. */
const STAGE_FNS = {
  desugar: (src) => W.desugarCore(src),
  parse: (src) => W.parseWrlCore(W.desugarCore(src)),
  validate: (src) => W.validateGraph(W.parseWrlCore(W.desugarCore(src))),
  canonicalize: (src) =>
    W.canonicalizeGraph(W.validateGraph(W.parseWrlCore(W.desugarCore(src)))),
  serialize: (src) =>
    W.serializeArtifact(
      W.graphToIr(W.canonicalizeGraph(
        W.validateGraph(W.parseWrlCore(W.desugarCore(src)))))),
  seal: async (src) => (await W.sealWorld(src)).semanticId,
};

/* What is still true beyond stage position, and worth proving separately, is
 * that the texture is RECOGNIZED rather than merely rejected -- the parser has
 * a branch for it that explains what it is, instead of letting it fall through
 * to "unrecognized notation". Asserting that from the code would be circular,
 * so each probe is paired with a line of genuine nonsense and the two are
 * required to fail DIFFERENTLY. If the reserved branch were ever deleted, both
 * would produce the same fall-through diagnostic and the recognition claim
 * would fail by name. */
const STAGE_PROBES = {
  "async-route": { texture: "~~sig~~>", through: ["desugar"], refusedAt: "parse" },
  "verified-route": { texture: "==sig==>", through: ["desugar"], refusedAt: "parse" },
};
const probeSource = (texture) =>
  `profile forge.world.core.v1\n` +
  `[pulser:p0](every 2){sig_out}\n` +
  `[relay:r0]{sig_in, sig_out}\n` +
  `[p0] ${texture} [r0]\n`;

/* the control: syntactically a line, semantically nothing at all */
const NONSENSE = await W.sealWorld(probeSource("qqq zzz"));

for (const [cap, r] of REGISTRY) {
  ok(`caps/${cap}-classified`, ["settled", "drafted", "sketched"].includes(r.tier),
     `capability "${cap}" has tier "${r.tier}"; expected settled|drafted|sketched`);
  ok(`caps/${cap}-implementation`,
     ["unshipped", "partial", "shipped"].includes(r.impl),
     `capability "${cap}" has implementation "${r.impl}"; ` +
     `expected unshipped|partial|shipped. Meaning maturity and implementation ` +
     `status are different axes and both must be stated.`);

  if (r.impl === "partial") {
    const probe = STAGE_PROBES[cap];
    ok(`caps/${cap}-has-probe`, !!probe,
       `capability "${cap}" claims implementation="partial" but test/conformance.mjs ` +
       `has no stage probe for it. A partial claim must be demonstrated.`);
    ok(`caps/${cap}-stages-declared`,
       r.stages.length > 0 && r.stages.every((s) => STAGES.includes(s)),
       `a partial capability must name the stages that work, from ${STAGES.join("|")}`);
    ok(`caps/${cap}-refusal-stage`,
       STAGES.includes(r.refusedAt) &&
       r.stages.every((s) => STAGES.indexOf(s) < STAGES.indexOf(r.refusedAt)),
       `a partial capability must name the stage that REFUSES it, and it must ` +
       `come after every stage it completes; got stages="${r.stages.join(",")}" ` +
       `refused-at="${r.refusedAt}"`);
    if (probe) {
      /* THE STAGE CLAIM, EXECUTED. Everything above compares the registry to
         another constant in this file; the two checks below compare it to the
         toolchain. Each claimed stage is run and must return; the refusing
         stage is run and must throw. A stage name with no function behind it
         (`tokenize`, as this file once claimed) cannot pass either. */
      const src = probeSource(probe.texture);
      for (const stage of r.stages) {
        let completed = false, why = "";
        try { await STAGE_FNS[stage]?.(src); completed = !!STAGE_FNS[stage]; }
        catch (e) { why = ` -- it threw ${e.code || ""} ${e.message || e}`; }
        ok(`caps/${cap}-completes-${stage}`, completed,
           `"${cap}" claims the input completes the "${stage}" stage, so ` +
           `running that stage must return${why}. If there is no function in ` +
           `wrl.js named by STAGE_FNS["${stage}"], the stage does not exist and ` +
           `the claim cannot be made at all.`);
      }
      let refused = null;
      try { await STAGE_FNS[r.refusedAt]?.(src); }
      catch (e) { refused = e; }
      ok(`caps/${cap}-refused-by-${r.refusedAt}`,
         !!refused && refused.code === "WRL_UNSUPPORTED_FEATURE",
         `"${cap}" claims the "${r.refusedAt}" stage refuses it, so running ` +
         `that stage must throw WRL_UNSUPPORTED_FEATURE; got ` +
         `${refused ? refused.code : "no throw at all"}`);

      const res = await W.sealWorld(src);
      ok(`caps/${cap}-probe-located`,
         !res.ok && res.code === "WRL_UNSUPPORTED_FEATURE" && res.line > 0,
         `the probe for "${cap}" should be refused with a LOCATED ` +
         `WRL_UNSUPPORTED_FEATURE; got ok=${res.ok} code=${res.code} line=${res.line}`);
      /* Recognition, demonstrated rather than asserted. Both the texture and
         the nonsense line fail with the same CODE, so the code proves nothing;
         the difference is that nonsense falls through to "unrecognized", while
         a reserved texture hits a branch that names what it is. Comparing the
         two messages verbatim would be weak -- they quote different source --
         so the property tested is the fall-through itself. */
      ok(`caps/${cap}-probe-recognized`,
         !NONSENSE.ok && /unrecognized/i.test(NONSENSE.message) &&
         !/unrecognized/i.test(res.message),
         `"${cap}" claims its texture is RECOGNIZED, but the toolchain treats ` +
         `it as a fall-through: nonsense says "${NONSENSE.message}" and the ` +
         `texture says "${res.message}". A reserved construct must be explained ` +
         `by its own branch, not by the catch-all.`);
      ok(`caps/${cap}-stages-match-probe`,
         r.stages.join(",") === probe.through.join(",") &&
         r.refusedAt === probe.refusedAt,
         `registry says stages "${r.stages.join(",")}" refused at "${r.refusedAt}" ` +
         `but the probe demonstrates "${probe.through.join(",")}" refused at ` +
         `"${probe.refusedAt}"`);
    }
  } else {
    ok(`caps/${cap}-no-stray-stages`, r.stages.length === 0 && !r.refusedAt,
       `only a partial capability may name stages or a refusal stage; ` +
       `"${cap}" is ${r.impl}`);
  }
}

/* every capability cited anywhere, so we can check both directions */
const cited = new Map();      /* capability -> [labels]  */
const futurePairs = new Map(); /* equivalence id -> [labels] */

/* ids that some block on the site DEMONSTRABLY seals to, collected as the
 * sweep verifies them. The tutorial legitimately prints the ids of the
 * half-built worlds it passes through; those are earned, not asserted. */
const verified = new Map();

/* A block is a COMPLETE WORLD if a profile line appears anywhere in it -- a
 * leading comment is legal source, so anchoring at the first character would
 * have let the landing page's hero block, which opens with
 * `; a signal, a rotation, a pose`, slip past unchecked. It did. */
const isWorld = (s) => /^[ \t]*profile\s+\S/m.test(s);

for (const file of htmlFiles) {
  /* the playground's markup is UI chrome, not documentation; the sources it
     actually loads are swept separately, below, from its EXAMPLES table */
  if (file === "playground.html") continue;
  const text = readFileSync(join(ROOT, file), "utf8");
  let m, i = 0;
  while ((m = TAG.exec(text)) !== null) {
    i++;
    const [, attrs, body] = m;
    const source = decode(body);
    const seal = ATTR(attrs, "data-seal");
    const reject = ATTR(attrs, "data-reject");
    const future = ATTR(attrs, "data-future");
    /* presence test, not ATTR: the annotation is a bare boolean attribute and
       ATTR's `|| null` would swallow an empty value */
    const notCurrent = /\bdata-not-current\b/.test(attrs);
    const requires = (ATTR(attrs, "data-requires") || "")
      .split(",").map((s) => s.trim()).filter(Boolean);
    const equiv = ATTR(attrs, "data-equivalent-future");
    const label = `doc/${file}#${i}`;
    blocks++;

    /* Every named requirement must be a registered capability. A typo here
       would otherwise produce a snippet that silently waits on nothing. */
    for (const cap of requires) {
      ok(`${label}/requires-${cap}`, REGISTRY.has(cap),
         `names capability "${cap}", which is not in reference.html#capability-registry`);
      if (!cited.has(cap)) cited.set(cap, []);
      cited.get(cap).push(label);
    }

    if (equiv) {
      if (!futurePairs.has(equiv)) futurePairs.set(equiv, []);
      futurePairs.get(equiv).push({ label, requires });
    }

    /* FRAGMENT or WORLD. This is derived rather than declared, because a
     * derived fact cannot drift; the attribute is honoured when an author
     * states it, so that a block whose classification matters can pin it. The
     * distinction is not cosmetic: for a complete world, "does not seal" is a
     * claim about the CONSTRUCT; for a fragment it is very nearly a tautology,
     * since a fragment has no profile line and could not seal whatever the
     * toolchain supported. */
    const kind = isWorld(source) ? "world" : "fragment";
    const declaredKind = ATTR(attrs, "data-snippet-kind");
    if (declaredKind) {
      ok(`${label}/snippet-kind`, declaredKind === kind,
         `declares data-snippet-kind="${declaredKind}" but is a ${kind} ` +
         `(a world is a block containing a profile line)`);
    }

    if (notCurrent) {
      if (kind === "world") notCurrentWorlds++; else notCurrentFragments++;
      /* The honest negative claim for a DRAFT snippet. `data-future` asserts a
       * specific diagnostic, which is a lie for draft-notation blocks: the
       * parser's first complaint is almost always the missing profile line, not
       * the construct the block is actually demonstrating. So assert only what
       * is true and load-bearing -- the toolchain does not accept this -- and
       * let `data-requires` carry the reason.
       *
       * This comment used to end "when the capability ships, the block starts
       * sealing and this goes red". That is FALSE for the 54 fragments, which
       * carry no profile line and will keep failing on WRL_MISSING_PROFILE
       * forever, and it is the exact overclaim the promotion trip-wire below
       * exists to replace. Do not restore it: a fragment's non-acceptance is
       * weak evidence by construction, and the mechanism that actually forces a
       * correction lives on the registry row, not here. */
      annotated++;
      const r = await W.sealWorld(source.endsWith("\n") ? source : source + "\n");
      ok(`${label} (not-current: ${requires.join(" ") || "?"})`, !r.ok,
         `this block is marked data-not-current but SEALED to ${r.semanticId}. ` +
         `If the capability shipped, drop the annotation and document it.`);
      ok(`${label}/states-a-requirement`, requires.length > 0,
         "a data-not-current block must say which capabilities it waits on");
    } else if (future) {
      /* A block marked as design draft is making the negative claim: you cannot
       * write this today. That claim is checkable, so check it. The reviewer's
       * complaint was documentation asserting MORE than the implementation
       * does; this is the same failure in the other direction, and it is the
       * one that rots silently. When `~~` finally ships, this test goes red on
       * the pages that still call it unwritable, and the docs get corrected
       * because the build stops -- not because somebody remembered. */
      annotated++;
      await expectReject(`${label} (draft: ${future})`,
        source.endsWith("\n") ? source : source + "\n",
        "WRL_UNSUPPORTED_FEATURE");
    } else if (seal) {
      annotated++;
      if (await expectSeal(label, source.endsWith("\n") ? source : source + "\n", seal)) {
        verified.set(seal, `${file} block ${i}`);
      }
    } else if (reject) {
      annotated++;
      await expectReject(label, source.endsWith("\n") ? source : source + "\n", reject);
    } else if (isWorld(source)) {
      /* a complete world with no stated expectation is exactly how a wrong id
         gets published. Annotate it. */
      ok(label, false,
         `this block is a complete world but carries no data-seal / ` +
         `data-reject. It currently seals to ${await sealId(source)}`);
    }
  }
}

ok("doc/sweep-found-blocks", blocks > 0, "no code blocks were extracted at all");
ok("doc/annotations-present", annotated > 0, "no block asserts an outcome");

/* A registry entry nothing cites is a capability the site invented and then
   forgot. Either something depends on it or it does not belong in the ladder. */
for (const cap of REGISTRY.keys()) {
  ok(`caps/${cap}-cited`, cited.has(cap),
     `capability "${cap}" is registered but no snippet requires it. ` +
     `Either annotate the block that needs it, or remove the row.`);
}

/* ------------------------------------------------------- duplicated claims ---
 * The link checker proves every citation RESOLVES. It cannot prove two pages
 * that both resolve are saying the same thing, and that is the failure mode
 * this site keeps hitting: the ladder was reordered in direction.html while
 * reference.html still carried the old step numbers, and a falsification
 * condition was retired in spec.html while direction.html went on publishing
 * it. Both survive a link check perfectly.
 *
 * So the duplicated structures get a single source of truth and a comparison.
 * The registry owns the step numbers; Direction's ladder must agree with it. */
{
  const dir = readFileSync(join(ROOT, "direction.html"), "utf8");
  const tbl = /<h2 id="ladder">[\s\S]*?<tbody>([\s\S]*?)<\/tbody>/.exec(dir);
  ok("ladder/table-found", !!tbl,
     "could not locate the dependency-ladder table in direction.html");

  if (tbl) {
    /* Each rung declares its number AND the exact capabilities it delivers.
       Both are needed. An earlier version of this block read only the printed
       number, and a reviewer showed that check was decorative: swapping the
       steps of `supervision` and `dynamic-topology` in the registry and
       re-sorting the rows left the suite at 569 passed, 0 failed. Range and
       sort order are internal-consistency properties, and two pages can be
       internally consistent while disagreeing with each other -- which is the
       failure this check exists to catch, and is exactly the dependency error
       (a fault route promoted before the supervision floor it requires) that
       the ladder was written to prevent. */
    const rungs = [...tbl[1].matchAll(
      /<tr data-step="(\d+)" data-capabilities="([^"]*)"><td>(\d+)<\/td>/g)]
      .map((m) => ({
        step: Number(m[1]),
        printed: Number(m[3]),
        caps: m[2].split(",").map((s) => s.trim()).filter(Boolean),
      }));
    const steps = rungs.map((r) => r.step);
    ok("ladder/steps-are-1..n",
       steps.length > 0 && steps.every((n, i) => n === i + 1),
       `the ladder must be numbered 1..n with no gaps or repeats; got ` +
       `[${steps.join(", ")}]. If this is empty, the rows lost their ` +
       `data-step / data-capabilities annotations.`);
    ok("ladder/number-matches-annotation",
       rungs.every((r) => r.step === r.printed),
       `a rung's data-step must equal the number printed in its first cell, ` +
       `or the machine-readable ladder and the human-readable one differ: ` +
       rungs.filter((r) => r.step !== r.printed)
            .map((r) => `data-step=${r.step} prints ${r.printed}`).join(", "));

    /* THE MAPPING, BOTH DIRECTIONS. This is what makes the ladder load-bearing
       rather than illustrative: the registry's step number and the rung that
       names the capability must be the same rung, and no capability may be
       unplaced or placed twice. */
    const placement = new Map();
    for (const r of rungs) {
      for (const c of r.caps) {
        ok(`ladder/${c}-placed-once`, !placement.has(c),
           `capability "${c}" is claimed by rung ${placement.get(c)} and rung ` +
           `${r.step}. A capability is delivered at one step or the ladder is ` +
           `not a dependency order.`);
        ok(`ladder/${c}-is-registered`, REGISTRY.has(c),
           `rung ${r.step} claims to deliver "${c}", which is not a row in the ` +
           `published capability registry. A rung cannot promise something the ` +
           `registry does not track.`);
        placement.set(c, r.step);
      }
    }
    const top = steps.length;
    for (const [cap, r] of REGISTRY) {
      ok(`ladder/${cap}-step-in-range`,
         Number.isInteger(r.step) && r.step >= 1 && r.step <= top,
         `the registry puts "${cap}" at step ${r.step}, but the ladder in ` +
         `direction.html has rungs 1..${top}. One of the two pages is stale.`);
      ok(`ladder/${cap}-step-agrees`, placement.get(cap) === r.step,
         `reference.html puts "${cap}" at step ${r.step}; direction.html's ` +
         `ladder ` + (placement.has(cap)
           ? `delivers it at rung ${placement.get(cap)}. The two pages disagree ` +
             `about the roadmap, and a reader has no way to tell which is right.`
           : `does not deliver it at any rung. Every registered capability must ` +
             `be named by exactly one rung, or the ladder is not a complete plan.`));
    }

    /* and the published row order must match the numbers, so a reader
       scanning the table and a program parsing it see the same roadmap */
    const rows = [...REGISTRY.entries()]
      .sort((a, b) => a[1].order - b[1].order);
    const sorted = [...rows].sort((a, b) =>
      a[1].step - b[1].step || a[0].localeCompare(b[0]));
    ok("caps/registry-sorted-by-step",
       rows.every(([cap], i) => sorted[i][0] === cap),
       `the capability registry is published out of order. Sort rows by ` +
       `(step, capability). Expected:\n    ` +
       sorted.map(([c, r]) => `${r.step} ${c}`).join("\n    "));

    /* THE README COPY. README.md restates the ladder in prose, and prose that
       restates a machine-read table drifts from it. It did: the arrow chain
       there put dynamic topology BEFORE supervision -- the exact inversion the
       ladder itself had already been corrected for -- and omitted step 3
       entirely, while the ladder check above passed, because the check had no
       idea the README existed. A third copy of a fact needs a third edge in
       the graph, not a promise to remember. */
    const readme = readFileSync(join(ROOT, "README.md"), "utf8");
    const listed = [...readme.matchAll(
      /^(\d+)\. [^\n]*— (`[a-z-]+`(?:, `[a-z-]+`)*)$/gm)]
      .map((m) => ({
        step: Number(m[1]),
        caps: [...m[2].matchAll(/`([a-z-]+)`/g)].map((c) => c[1]).sort(),
      }));
    ok("readme/ladder-is-present", listed.length === rungs.length,
       `README.md must restate all ${rungs.length} ladder steps as a numbered ` +
       `list ending in backticked capability ids; found ${listed.length}. ` +
       `If this is 0, the list was reworded into a form the check cannot read.`);
    for (const r of rungs) {
      const line = listed.find((l) => l.step === r.step);
      const want = [...r.caps].sort();
      ok(`readme/step-${r.step}-agrees`,
         line !== undefined && line.caps.join(",") === want.join(","),
         line === undefined
           ? `README.md has no entry for ladder step ${r.step}.`
           : `README.md says step ${r.step} delivers [${line.caps.join(", ")}]; ` +
             `direction.html's ladder says [${want.join(", ")}]. The roadmap ` +
             `is published twice and the two copies disagree.`);
    }
  }
}

/* THE DRAFT RULE INDEX. Part II states that a rule keeps the number it was
 * given, so §D8 reads D8.1, D8.4, D8.2, D8.3, D8.5 -- and that the sidebar is
 * therefore the ordered view. That is a promise about a hand-maintained list,
 * which is exactly the shape of promise this suite exists to stop trusting: a
 * rule added without a nav entry would be invisible to every reader who
 * navigates rather than scrolls, and nothing would say so. Both halves are
 * checkable, so both are checked. */
{
  const spec = readFileSync(join(ROOT, "spec.html"), "utf8");

  /* the rules as they are actually stated, in document order */
  const stated = [...spec.matchAll(/<b>Draft rule (D\d+\.\d+)\b/g)]
    .map((m) => m[1]);

  /* the sidebar index, which is everything before the first </aside> */
  const aside = spec.slice(0, spec.indexOf("</aside>"));
  const indexed = [...aside.matchAll(
    /<a href="#([^"]+)">(D\d+\.\d+) · /g)]
    .map((m) => ({ anchor: m[1], rule: m[2] }));

  /* UNIQUENESS. The four checks below were written first and all four passed
   * while the same rule number was stated twice, which is the one thing the
   * page's own metaphor forbids: a number is an identity, and two rules can no
   * more share one than two relations can share a relation_id. Set membership
   * is not identity, and every check above was a set check. */
  const dupes = (xs) => [...new Set(xs.filter((x, i) => xs.indexOf(x) !== i))];

  const restated = dupes(stated);
  ok("rules/stated-ids-are-unique", restated.length === 0,
     `spec.html states rule number(s) [${restated.join(", ")}] more than once. ` +
     `A rule number is an identity: two statements under one number means one ` +
     `of them is unreachable by citation, and the two can drift apart silently.`);

  const listedTwice = dupes(indexed.map((i) => i.rule));
  ok("rules/index-ids-are-unique", listedTwice.length === 0,
     `the sidebar lists rule number(s) [${listedTwice.join(", ")}] more than ` +
     `once, so the ordered view has two entries competing for one identity.`);

  ok("rules/some-are-stated", stated.length > 0,
     "spec.html states no numbered sub-rules; this check is vacuous. If the " +
     "rules were reworded, teach the check the new spelling rather than " +
     "deleting it.");

  const num = (r) => r.slice(1).split(".").map(Number);
  const missing = stated.filter((r) => !indexed.some((i) => i.rule === r));
  ok("rules/every-rule-is-indexed", missing.length === 0,
     `spec.html states rule(s) [${missing.join(", ")}] that the sidebar index ` +
     `does not list. A rule a reader cannot navigate to is a rule that will be ` +
     `restated somewhere else instead.`);

  const invented = indexed.filter((i) => !stated.includes(i.rule));
  ok("rules/index-invents-nothing", invented.length === 0,
     `the sidebar lists rule(s) [${invented.map((i) => i.rule).join(", ")}] ` +
     `that spec.html does not state. Either the rule was retired and the index ` +
     `kept it, or the index is aspirational.`);

  /* the index is only useful as an ordered view if it is ordered */
  const order = indexed.map((i) => i.rule);
  const want = [...order].sort((a, b) => {
    const [x, y] = [num(a), num(b)];
    return x[0] - y[0] || x[1] - y[1];
  });
  ok("rules/index-is-in-number-order",
     order.every((r, i) => want[i] === r),
     `the sidebar publishes rules as [${order.join(", ")}]. Part II claims the ` +
     `index is the ordered view precisely because the prose is not; if the ` +
     `index is unsorted too, that claim is false. Expected [${want.join(", ")}].`);

  /* and each entry must point at an anchor that exists, or the ordered view
     is a list of dead ends */
  const dead = indexed.filter((i) => !spec.includes(`id="${i.anchor}"`));
  ok("rules/index-anchors-resolve", dead.length === 0,
     `sidebar entr(ies) [${dead.map((i) => `${i.rule}→#${i.anchor}`).join(", ")}] ` +
     `point at anchors spec.html does not define.`);
}

/* THE IDENTITY PREIMAGES. direction.html republishes the relation identity
 * equations as a summary of spec.html's rules. That is a third copy of a fact,
 * and the README ladder already showed what a third copy does when nothing
 * checks it. These equations are the worst possible thing to let drift: a
 * reader who implements the summary and a reader who implements the spec would
 * mint different ids for the same relation and neither page would be visibly
 * wrong. So the summary's equations must appear verbatim in the spec. */
{
  /* Strip tags before reading lines, for the same reason the census below
   * does. A raw line match is wrong at both ends of a <pre><code> block: an
   * equation on the first line is preceded by markup and is silently SKIPPED,
   * and an equation on the last line carries </code></pre> into the compared
   * text and reports drift that is not there. This reader hit the second the
   * moment a block stopped ending with something other than an equation --
   * which is to say it was always going to, and only the first has the
   * failure mode nobody notices. */
  const eq = (file) => readFileSync(join(ROOT, file), "utf8")
    .replace(/<[^>]*>/g, "\n")
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => /^relation_id\s*=\s*H\(/.test(l));

  const inSpec = new Set(eq("spec.html"));
  const inDir = eq("direction.html");

  ok("identity/spec-publishes-preimages", inSpec.size > 0,
     "spec.html publishes no relation_id preimage; this check is vacuous");
  ok("identity/direction-publishes-preimages", inDir.length > 0,
     "direction.html publishes no relation_id preimage; this check is vacuous");

  const drifted = inDir.filter((e) => !inSpec.has(e));
  ok("identity/preimages-agree", drifted.length === 0,
     `direction.html publishes relation identity equation(s) that spec.html ` +
     `does not state:\n    ${drifted.join("\n    ")}\n  Spec states:\n    ` +
     `${[...inSpec].join("\n    ")}\n  Two pages minting different ids for one ` +
     `relation is the failure this whole section exists to prevent.`);
}

/* THE PREIMAGE CLASSIFICATION. The check above asserts direction ⊆ spec. It
 * therefore says nothing at all about an *extra* equation in spec.html, and an
 * extra equation is exactly the failure that occurred: D8.5 went on printing
 * the superseded flat triple long after D8.1 replaced it with a tagged union,
 * and the suite reported green. Substituting a fabricated formula for it also
 * reported green, which is the honest measure of how much the check was doing.
 *
 * A subset check cannot catch a surplus. The law that can is a *census*: every
 * relation_id equation anywhere on the site is classified, and each allocation
 * variant has exactly one normative equation. Then a stale formula is not a
 * stale formula -- it is either an unclassified one, or a second normative
 * statement for a variant that already has one, and both are failures. The
 * classification is deliberately three-valued, because the page needs to keep
 * publishing formulas that are not the rule: H(attach_event) is a cycle kept
 * on purpose as the counterexample that motivates the whole design, and
 * deleting it to satisfy a checker would destroy the argument. Marking is the
 * fix, not removal. */
{
  const KINDS = new Set(["normative", "counterexample", "retired"]);
  const EQ = /relation_id\s*=\s*H\(/g;
  const norm = (s) => s.replace(/\s+/g, " ").trim();

  const unclassified = [];   // equation lines outside any tagged block
  const badKind = [];        // data-preimage with an unknown value
  const normative = [];      // { file, text }

  /* The equations live inside <pre><code>, so the first line of a block starts
   * with markup rather than with the equation. An anchored line match silently
   * skips exactly those, which made the first version of this check pass a
   * reinstated stale formula -- the same class of one-directional blind spot it
   * was written to remove. Strip the tags, then read lines. */
  const equationsIn = (html) => html
    .replace(/<[^>]*>/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^relation_id\s*=\s*H\(/.test(l))
    .map(norm);

  for (const f of htmlFiles) {
    const src = readFileSync(join(ROOT, f), "utf8");
    let accounted = 0;
    for (const m of src.matchAll(/<pre\b([^>]*)>([\s\S]*?)<\/pre>/g)) {
      const [, attrs, body] = m;
      const lines = equationsIn(body);
      accounted += lines.length;
      if (lines.length === 0) continue;
      const kind = (attrs.match(/data-preimage="([^"]*)"/) || [])[1];
      if (kind === undefined) { unclassified.push(...lines.map((l) => `${f}: ${l}`)); continue; }
      if (!KINDS.has(kind)) { badKind.push(`${f}: data-preimage="${kind}"`); continue; }
      if (kind === "normative") normative.push(...lines.map((text) => ({ file: f, text })));
    }
    /* Reconciliation. Every occurrence in the file must have been read by the
     * block walk above. A surplus means an equation in running prose, or a
     * <pre> this regex failed to pair -- either way an equation nothing has
     * classified, which is the condition being tested. */
    const total = (src.match(EQ) || []).length;
    if (total !== accounted) {
      unclassified.push(
        `${f}: ${total} relation_id equation(s) present, ${accounted} accounted ` +
        `for inside <pre> blocks`);
    }
  }

  ok("identity/preimages-are-classified", unclassified.length === 0,
     `relation identity equation(s) published with no data-preimage ` +
     `classification:\n    ${unclassified.join("\n    ")}\n  An unclassified ` +
     `equation is indistinguishable from the current rule to a reader and ` +
     `invisible to this suite, which is how the superseded flat triple ` +
     `survived three revisions of §D8.`);

  ok("identity/preimage-kinds-are-known", badKind.length === 0,
     `data-preimage must be one of ${[...KINDS].join(", ")}: ` +
     `${badKind.join(", ")}`);

  /* The variants are read out of the union rather than listed here. A list in
   * the test would be a fourth copy of the same fact and would drift the first
   * time a third allocation source is added -- and drift silently, in the
   * direction of not checking the new one. */
  const specSrc = readFileSync(join(ROOT, "spec.html"), "utf8");

  /* The tag is the variant name in kebab case: NamedInitialAllocation is
   * tagged "named-initial". A plain toLowerCase() was enough while every
   * variant was one word, and would have silently derived "namedinitial" --
   * matching no equation, so `one-normative-preimage-per-variant` would have
   * reported zero and the failure would have read as a missing rule rather
   * than as this reader being wrong. */
  const kebab = (s) => s.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
  const variants = [...new Set(
    [...specSrc.matchAll(/\b([A-Z]\w*)Allocation\s*\{/g)]
      .map((m) => m[1])
      .filter((v) => v !== "Relation")
      .map(kebab))];

  ok("identity/allocation-variants-are-declared", variants.length >= 3,
     `spec.html declares ${variants.length} allocation variant(s) ` +
     `(${variants.join(", ") || "none"}); D8.1 states three, so either the ` +
     `union was reshaped or this reader stopped matching it.`);

  ok("identity/normative-preimages-name-a-variant",
     normative.every((e) => variants.filter((v) => e.text.includes(`"${v}"`)).length === 1),
     `every normative relation_id equation must carry exactly one variant tag ` +
     `(${variants.map((v) => `"${v}"`).join(", ")}) in its preimage. Offenders:\n    ` +
     `${normative.filter((e) => variants.filter((v) => e.text.includes(`"${v}"`)).length !== 1)
        .map((e) => `${e.file}: ${e.text}`).join("\n    ")}\n  An equation with ` +
     `no tag cannot be attributed to an allocation source, so nothing can tell ` +
     `whether it is the current rule for one variant or a leftover for none.`);

  const perVariant = variants.map((v) => {
    const forV = normative.filter((e) => e.text.includes(`"${v}"`));
    return { v, texts: [...new Set(forV.map((e) => e.text))], where: forV.map((e) => e.file) };
  });

  const wrongCount = perVariant.filter((p) => p.texts.length !== 1);
  ok("identity/one-normative-preimage-per-variant", wrongCount.length === 0,
     `each allocation variant must have exactly one distinct normative ` +
     `equation sitewide. Violations:\n    ` +
     `${wrongCount.map((p) => `${p.v}: ${p.texts.length} distinct — ${p.texts.join(" | ")}`).join("\n    ")}\n` +
     `  Zero means a variant can be allocated with no stated preimage. Two ` +
     `means two implementers mint two different names for one relation, which ` +
     `is unrecoverable and invisible: neither page reads as wrong.`);

  /* Republication is welcome and is the reason for "distinct" above: a summary
   * page may restate the equations, byte for byte, as many times as it likes.
   * What it may not do is restate them differently, and it may not be the only
   * place they appear. */
  const orphanVariant = perVariant.filter((p) => !p.where.includes("spec.html"));
  ok("identity/normative-preimages-live-in-the-spec", orphanVariant.length === 0,
     `variant(s) [${orphanVariant.map((p) => p.v).join(", ")}] state a normative ` +
     `preimage only outside spec.html (${orphanVariant.map((p) => p.where.join(",")).join("; ")}). ` +
     `A summary may republish the rule; it may not be the rule.`);
}

/* THE RETIRED VOCABULARY. Renaming a defined term is the same defect as the
 * stale preimage above, one level up: the old name goes on reading like a
 * current one everywhere it was not caught by hand. TransitionKey was retired
 * because the period inside it contradicted D8.6's retry rule; the rename
 * touched five places and there was no way to know it was five.
 *
 * The register is deliberately not a delete-list. This page's whole method is
 * that a superseded idea is more useful visible, with the reason attached, than
 * removed -- so a retired term MAY be named, and may only be named inside the
 * element that explains its retirement. Everywhere else it is a failure. */
{
  const readable = (name) => name.replace(/_/g, "_");
  const spanOf = (src, at) => {
    /* Walk back to the opening '<' of the tag carrying the attribute, then
     * forward with a depth counter. A non-greedy match to the first close tag
     * would silently truncate the allowed region the first time a note gained
     * a nested element, which would turn this check into a source of false
     * failures rather than a source of true ones. */
    const open = src.lastIndexOf("<", at);
    const tag = (src.slice(open).match(/^<([a-zA-Z0-9]+)/) || [])[1];
    if (!tag) return null;
    const marks = [...src.matchAll(new RegExp(`</?${tag}\\b`, "g"))]
      .filter((m) => m.index >= open);
    let depth = 0;
    for (const m of marks) {
      depth += m[0][1] === "/" ? -1 : 1;
      if (depth === 0) return src.slice(open, m.index + m[0].length);
    }
    return null;
  };

  const register = [];   // { term, file, allowed: string[] }
  for (const f of htmlFiles) {
    const src = readFileSync(join(ROOT, f), "utf8");
    for (const m of src.matchAll(/data-retired-term="([^"]+)"/g)) {
      const span = spanOf(src, m.index);
      ok(`vocabulary/retired-register-span-parses[${f}]`, span !== null,
         `a data-retired-term attribute in ${f} is on an element this reader ` +
         `could not close; the register would silently allow nothing.`);
      for (const term of m[1].split(",").map((s) => s.trim()).filter(Boolean)) {
        const e = register.find((r) => r.term === term) ||
                  (register.push({ term, allowed: [] }), register[register.length - 1]);
        if (span) e.allowed.push(span);
      }
    }
  }

  ok("vocabulary/retired-register-is-not-vacuous", register.length > 0,
     `no term is registered as retired anywhere on the site. This page retires ` +
     `vocabulary as a matter of method -- the stale D8.5 preimage is what ` +
     `happens when it does not -- so an empty register is far more likely to ` +
     `mean the register was deleted than that nothing was ever renamed.`);

  const escaped = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const leaks = [];
  for (const { term, allowed } of register) {
    const re = () => new RegExp(`\\b${escaped(term)}s?\\b`, "g");
    let allowedHits = 0;
    for (const span of allowed) allowedHits += (span.match(re()) || []).length;
    let total = 0;
    const where = [];
    for (const f of htmlFiles) {
      const n = (readFileSync(join(ROOT, f), "utf8").match(re()) || []).length;
      total += n;
      if (n > 0) where.push(`${f}×${n}`);
    }
    if (total !== allowedHits) {
      leaks.push(`${readable(term)}: ${total} occurrence(s) [${where.join(", ")}], ` +
                 `${allowedHits} inside the element that retires it`);
    }
  }

  ok("vocabulary/retired-terms-stay-retired", leaks.length === 0,
     `retired term(s) still in use outside the note that retires them:\n    ` +
     `${leaks.join("\n    ")}\n  A retired name that is still spoken normally ` +
     `is not retired; it is a second vocabulary, and a reader has no way to ` +
     `tell which one the rule is written in.`);
}

/* SPLIT RULES. Two rules here now say two things at once: a law about the world
 * that a replayer can establish from the ledger, and an obligation on one
 * participant that nothing outside it can ever observe. Stated fused, the
 * unverifiable half stands for the whole and the rule reads as aspiration --
 * which is exactly the criticism both rules earned before they were split.
 *
 * What a checker can enforce is not that the classification is *true* -- no
 * text-level check establishes that -- but that it is *complete and referred
 * to*: a rule split into halves declares each half exactly once, declares both
 * kinds, and every half named in prose is a half that exists. The last clause
 * is the one that bites, because prose citing D8.6-c is how a third half gets
 * invented without anyone stating it. */
{
  const KINDS = new Set(["replay", "participant"]);
  const declared = new Map();      // "D8.4-a" -> { kind, file, count }

  for (const f of htmlFiles) {
    const src = readFileSync(join(ROOT, f), "utf8");
    for (const m of src.matchAll(/data-rule-half="([^"]+)"[^>]*data-established-by="([^"]+)"/g)) {
      const [, half, kind] = m;
      const e = declared.get(half) || { kind, file: f, count: 0 };
      e.count += 1;
      declared.set(half, e);
    }
  }

  ok("rules/split-rules-exist", declared.size > 0,
     `no rule declares halves. D8.4 and D8.6 each state a replay-establishable ` +
     `law beside a participant obligation; if neither is annotated any more, ` +
     `the distinction has been dissolved back into prose.`);

  const badKind = [...declared].filter(([, e]) => !KINDS.has(e.kind));
  ok("rules/rule-half-kinds-are-known", badKind.length === 0,
     `data-established-by must be one of ${[...KINDS].join(", ")}: ` +
     `${badKind.map(([h, e]) => `${h}="${e.kind}"`).join(", ")}. The taxonomy ` +
     `is two-valued on purpose -- a third value would be a place to file the ` +
     `rules nobody wants to classify.`);

  const twice = [...declared].filter(([, e]) => e.count !== 1);
  ok("rules/rule-halves-are-declared-once", twice.length === 0,
     `rule half/halves declared more than once: ` +
     `${twice.map(([h, e]) => `${h}×${e.count}`).join(", ")}. Two declarations ` +
     `is two homes for one fact, which is the defect §D8 exists to remove.`);

  /* Group by the rule they belong to, and require both kinds present. A rule
   * with only a replay half needs no split and should not claim one; a rule
   * with only a participant half is the original defect wearing an
   * annotation. */
  const byRule = new Map();
  for (const [half, e] of declared) {
    const rule = half.replace(/-[a-z]$/, "");
    (byRule.get(rule) || byRule.set(rule, []).get(rule)).push(e.kind);
  }
  const lopsided = [...byRule].filter(([, ks]) => ![...KINDS].every((k) => ks.includes(k)));
  ok("rules/split-rules-state-both-kinds", lopsided.length === 0,
     `rule(s) declaring halves without both kinds: ` +
     `${lopsided.map(([r, ks]) => `${r} has only [${[...new Set(ks)].join(", ")}]`).join("; ")}\n` +
     `  A rule that only has a replay half does not need splitting. A rule ` +
     `that only has a participant half is the unverifiable-rule defect with a ` +
     `label on it.`);

  const cited = new Set();
  for (const f of htmlFiles) {
    for (const m of readFileSync(join(ROOT, f), "utf8").matchAll(/\bD\d+\.\d+-[a-z]\b/g)) {
      cited.add(m[0]);
    }
  }
  const phantom = [...cited].filter((h) => !declared.has(h));
  ok("rules/cited-rule-halves-are-declared", phantom.length === 0,
     `prose cites rule half/halves that nothing declares: ${phantom.join(", ")}. ` +
     `A citation is how a half nobody wrote acquires authority.`);

  const unused = [...declared.keys()].filter((h) => {
    let n = 0;
    for (const f of htmlFiles) {
      n += (readFileSync(join(ROOT, f), "utf8").match(new RegExp(`\\b${h}\\b`, "g")) || []).length;
    }
    return n < 2;   /* the declaration itself, plus at least one reference */
  });
  ok("rules/declared-rule-halves-are-cited", unused.length === 0,
     `rule half/halves declared and never referred to anywhere: ` +
     `${unused.join(", ")}. A distinction nothing downstream uses is a ` +
     `distinction that was drawn for the reviewer, not for the design.`);
}

/* THE NUMBERED LAWS. D9.3 rests its verifiability claim on one row of the
 * objects table -- "law 3 makes rehydration verifiable rather than trusted" --
 * and a citation by bare number is the cheapest thing on this page to break.
 * Reorder the table, insert a row, and the sentence goes on reading fluently
 * while pointing at a different law. Citations are therefore written as links
 * carrying the number they mean, and the rows carry theirs; nothing checks that
 * law 3 says what the sentence claims, but a citation can no longer point at a
 * row that does not exist. draft.html has its own unrelated numbered laws,
 * which is exactly why the citation form is explicit rather than a text match
 * on "law N". */
{
  const src = readFileSync(join(ROOT, "spec.html"), "utf8");
  const rows = new Set([...src.matchAll(/data-law-row="(\d+)"/g)].map((m) => m[1]));
  const cites = [...src.matchAll(/data-law-cited="(\d+)"/g)].map((m) => m[1]);

  ok("laws/object-table-is-numbered", rows.size > 0,
     `the objects table publishes no data-law-row numbers, so every citation ` +
     `into it is unverifiable.`);
  ok("laws/citations-exist", cites.length > 0,
     `nothing cites a numbered law; this check is vacuous. D9.3 cited law 3 ` +
     `when it was written.`);

  const phantom = [...new Set(cites)].filter((n) => !rows.has(n));
  ok("laws/cited-laws-exist", phantom.length === 0,
     `spec.html cites law(s) ${phantom.join(", ")} that the objects table does ` +
     `not number. A rule resting on a law that is not there is a rule resting ` +
     `on nothing, and it reads exactly like one that is not.`);

  /* The numbers must also be dense and start at one, or "law 3" is ambiguous
   * between the third row and the row labelled 3. */
  const seq = [...rows].map(Number).sort((a, b) => a - b);
  ok("laws/law-numbers-are-dense",
     seq.every((n, i) => n === i + 1),
     `the objects table numbers laws [${seq.join(", ")}]; they must be 1..n ` +
     `with no gaps, or an ordinal citation and a labelled citation stop ` +
     `meaning the same thing.`);
}

/* THE RECORD CENSUS. The preimage census above generalises, and it had to,
 * because the check that caught the stale equation did not catch the stale
 * *record*: §D8's own rule block went on declaring
 * RelationAllocation { world_id, issuer, nonce } long after §D8.1 replaced it
 * with a tagged union, and it was found by looking at the rendered page.
 *
 * Two definitions of one type is the same defect as two preimages for one
 * variant, one level less severe only because a reader can sometimes tell which
 * is newer. The law is the same: a type name is an identity, so it gets one
 * definition. A page that wants to show a superseded shape may -- inside a
 * block classified as a counterexample or a retirement, exactly as with the
 * equations. Everywhere else, a second shape is a failure. */
{
  const DEFN = /^([A-Z][A-Za-z0-9]*)\s*(\{[^}]*\}|=)\s*$/;
  const seen = new Map();     // TypeName -> Map<definitionText, [places]>

  /* Three things share this syntax and only one of them is a declaration.
   *   Name { a, b }        a declaration -- the shape of the type
   *   Name { a = 1 }       an instance -- an example with values bound
   *   Name { a, … }        a projection -- part of the record, shown to make
   *                        a point about that part
   * Only declarations are censused. Instances are how §D9's examples read and
   * there may be many; a projection is an explicit promise that it is not the
   * whole thing, which is the honest way to quote a record you are not
   * defining, and is what the mint section should have used all along. */
  const isDeclaration = (shape) =>
    shape === "=" || !(/=/.test(shape) || /…|\.\.\./.test(shape));

  const record = (line, f) => {
    const d = line.replace(/;.*$/, "").trim().match(DEFN);
    if (!d) return;
    const [, name, shape] = d;
    if (!isDeclaration(shape)) return;
    const text = `${name} ${shape.replace(/\s+/g, " ")}`;
    const byText = seen.get(name) || seen.set(name, new Map()).get(name);
    byText.set(text, [...(byText.get(text) || []), f]);
  };

  for (const f of htmlFiles) {
    const src = readFileSync(join(ROOT, f), "utf8");
    for (const m of src.matchAll(/<pre\b([^>]*)>([\s\S]*?)<\/pre>/g)) {
      const [, attrs, body] = m;
      const kind = (attrs.match(/data-preimage="([^"]*)"/) || [])[1];
      if (kind === "counterexample" || kind === "retired") continue;
      /* Strip markup, then read only lines that are a whole declaration. A
       * field line inside a multi-line record never matches, and a name merely
       * mentioned in prose never reaches here. */
      for (const raw of body.replace(/<[^>]*>/g, "\n").split("\n")) record(raw, f);
    }
    /* Inline spans too. The flat RelationAllocation survived in a <pre>, but
     * the operations table restates records inline, and a check that only
     * reads display blocks leaves the more numerous hiding place open. */
    for (const m of src.matchAll(/<code class="inline">([^<]*)<\/code>/g)) {
      record(m[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">"), f);
    }
  }

  ok("records/census-is-not-vacuous", seen.size > 0,
     `no record declarations were found in any <pre> block. Either the record ` +
     `syntax changed or this reader stopped matching it; both leave the ` +
     `duplicate-shape defect unguarded.`);

  const forked = [...seen].filter(([, byText]) => byText.size > 1);
  ok("records/one-definition-per-type", forked.length === 0,
     `type(s) declared in more than one shape:\n    ` +
     `${forked.map(([n, byText]) => `${n}\n      ` +
        [...byText].map(([t, ws]) => `${t}   [${[...new Set(ws)].join(", ")}]`)
          .join("\n      ")).join("\n    ")}\n` +
     `  A type name is an identity. Two shapes under one name means a reader ` +
     `implements whichever they reached first, and the page cannot say which ` +
     `of them is wrong -- which is exactly how the flat ` +
     `RelationAllocation outlived the union that replaced it.`);
}

/* The falsification conditions are the other duplicated structure. Direction
 * states them at length; the spec states its own list. They drifted once
 * already -- Direction published a condition D9 had explicitly retired -- so
 * both pages now tag conditions with a machine-readable id and the suite
 * requires Direction's set to be a subset of the spec's, with nothing invented
 * and nothing resurrected. */
{
  const idsIn = (file) => new Set(
    [...readFileSync(join(ROOT, file), "utf8")
      .matchAll(/data-falsifier="([^"]+)"/g)].map((m) => m[1]));
  const spec = idsIn("spec.html");
  const dir = idsIn("direction.html");

  ok("falsify/spec-declares-conditions", spec.size > 0,
     "spec.html declares no data-falsifier ids; the parity check is vacuous");
  ok("falsify/direction-declares-conditions", dir.size > 0,
     "direction.html declares no data-falsifier ids; the parity check is vacuous");

  const orphans = [...dir].filter((id) => !spec.has(id));
  ok("falsify/no-orphan-conditions", orphans.length === 0,
     `direction.html publishes falsification condition(s) [${orphans.join(", ")}] ` +
     `that spec.html does not declare. Either the spec retired the condition ` +
     `and Direction is stale, or Direction invented one.`);

  /* Set parity is necessary and not sufficient. It stops a condition being
     invented or resurrected under a new id; it does nothing about the two
     pages describing the same id differently, which is the likelier drift and
     the one that already happened once. There is no way to diff prose
     mechanically, so the structural answer is to designate ONE statement as
     normative and make the other cite it: spec.html §D7 states each condition
     and carries `id="falsify-<id>"`, and every Direction heading must link to
     that anchor. A reader who suspects drift is then one click from the
     authority, and the link-integrity check above proves the anchor exists. */
  const dirSrc = readFileSync(join(ROOT, "direction.html"), "utf8");
  const specSrc = readFileSync(join(ROOT, "spec.html"), "utf8");
  for (const id of dir) {
    ok(`falsify/${id}-has-normative-anchor`,
       specSrc.includes(`id="falsify-${id}"`),
       `spec.html declares falsifier "${id}" but gives it no id="falsify-${id}" ` +
       `anchor, so Direction has nothing citable to point at.`);
    const heading = dirSrc.match(
      new RegExp(`<h3 data-falsifier="${id}">([\\s\\S]*?)</h3>`));
    ok(`falsify/${id}-cites-normative`,
       !!heading && heading[1].includes(`href="spec.html#falsify-${id}"`),
       `direction.html's heading for "${id}" must link to ` +
       `spec.html#falsify-${id}. Direction is a non-normative summary; without ` +
       `the citation the two statements can drift in wording while both ids ` +
       `stay present and this check stays green.`);
  }
}

/* THE PROMOTION TRIP-WIRE, and the honest version of a claim this suite used
 * to make loosely.
 *
 * The old claim was that when a capability ships, every snippet depending on it
 * "becomes a test obligation" automatically. That was not true and could not
 * be: most draft snippets are fragments with no profile line, so they go on
 * failing to seal for a reason that has nothing to do with the capability, and
 * nothing would go red.
 *
 * What IS mechanical is this. Shipping a capability means editing its registry
 * row to implementation="shipped" -- and the moment that row changes, every
 * snippet still citing it fails HERE, by name, with the file and block number.
 * The trip-wire is on the registry, where a human must act, rather than on the
 * snippet, where nothing would have happened. The docs are then corrected
 * because the build stopped, which was always the point. */
for (const [cap, r] of REGISTRY) {
  if (r.impl !== "shipped") continue;
  const stale = cited.get(cap) || [];
  ok(`caps/${cap}-shipped-but-still-required`, stale.length === 0,
     `capability "${cap}" is marked implementation="shipped", but ${stale.length} ` +
     `block(s) still wait on it: ${stale.join(", ")}. Each one must now be ` +
     `re-annotated -- a complete world becomes data-seal, a fragment gets a ` +
     `fixture context -- and this row's promotion documented.`);
}

/* Paired snippets: two spellings that must eventually canonicalize to the same
 * bytes. Today neither parses, so this is a REGISTERED EQUIVALENCE CLAIM and
 * not yet an executable equality test -- the suite is careful to call it that.
 * Two things about the pair are checkable now, and both are checked: that it is
 * a pair, and that both halves wait on the same capabilities. The second
 * matters because a pair whose halves have different prerequisites can never
 * become an equality test -- one spelling would be writable while the other
 * still is not, and there would be nothing to compare it against. */
for (const [id, entries] of futurePairs) {
  const labels = entries.map((e) => e.label);
  ok(`equiv/${id}-is-a-pair`, entries.length === 2,
     `data-equivalent-future="${id}" appears on ${entries.length} block(s): ` +
     `${labels.join(", ")}. An equivalence claim needs exactly two spellings.`);
  if (entries.length === 2) {
    const [a, b] = entries.map((e) => [...e.requires].sort().join(","));
    ok(`equiv/${id}-same-prerequisites`, a === b,
       `the two spellings of "${id}" wait on different capabilities ` +
       `("${a}" vs "${b}"). They cannot both become writable at the same time, ` +
       `so the equality could never be tested.`);
  }
}

/* ------------------------------------------------------------------ links ---
 * Every argument on this site is made by cross-reference: a claim in
 * direction.html is justified by an anchor in spec.html, and a capability row
 * in reference.html points at the section that defines it. A broken anchor is
 * therefore not a cosmetic defect — it is a citation to a source that does not
 * exist, which is exactly the failure mode the rest of this suite is built to
 * prevent. Anchors are also the most fragile thing here: renaming one heading
 * silently orphans every reference to it, and nothing complains, because HTML
 * has no link checker. So the suite is the link checker. */
{
  const idsOf = new Map();
  for (const file of htmlFiles) {
    const set = new Set();
    for (const m of readFileSync(join(ROOT, file), "utf8").matchAll(/\sid="([^"]+)"/g))
      set.add(m[1]);
    idsOf.set(file, set);
  }

  let checked = 0;
  const broken = [];
  for (const file of htmlFiles) {
    for (const m of readFileSync(join(ROOT, file), "utf8").matchAll(/href="([^"]+)"/g)) {
      const href = m[1];
      if (/^(https?:|mailto:|#$)/.test(href)) continue;   /* external, or a no-op */
      const [target, frag] = href.split("#");
      const page = target === "" ? file : target;         /* "#x" is same-page */
      checked++;
      if (!idsOf.has(page)) {
        if (!existsSync(join(ROOT, page)))
          broken.push(`${file} -> ${href} (no such file)`);
        continue;                                          /* a non-HTML asset */
      }
      if (frag && !idsOf.get(page).has(frag))
        broken.push(`${file} -> ${href} (no element with id="${frag}")`);
    }
  }

  ok("links/no-broken-anchors", broken.length === 0,
     `${broken.length} of ${checked} internal link(s) point nowhere:\n    ` +
     broken.join("\n    "));
  ok("links/swept", checked > 100,
     `only ${checked} internal links found; the sweep probably matched nothing`);
}

/* The playground's ten examples are the only sources on this site that a reader
 * actually EXECUTES, and each one is a claim: the button says "An illegal
 * rewire", so that source had better be rejected, and rejected for that reason.
 * A demo that quietly seals is worse than no demo, because the reader concludes
 * the language does not check the thing the button just promised it checks.
 * These live in a JS object literal rather than a `<pre>`, so the block sweep
 * above cannot see them; they get their own pass. */
{
  const text = readFileSync(join(ROOT, "playground.html"), "utf8");
  const open = text.indexOf("const EXAMPLES = {");
  ok("playground/examples-found", open !== -1,
     "could not locate the EXAMPLES table in playground.html");

  if (open !== -1) {
    const close = text.indexOf("\n};", open);
    const literal = text.slice(open + "const EXAMPLES = ".length, close + 2);
    /* evaluated with the module passed in, because two entries are the module's
       own exported fixtures rather than inline text */
    const EX = new Function("W", "return " + literal)(W);

    /* what each button PROMISES. An example with no entry here fails: adding a
       demo to the page is adding a claim to the page. */
    const expected = {
      starter:  { seal: W.STARTER_WORLD_SEMANTIC_ID },
      demo:     { seal: W.DEMO_WORLD_SEMANTIC_ID },
      /* the twin and the shuffle are the whole argument for canonical bytes:
         different spellings, one id, and it is the pinned fixture's id */
      twin:     { seal: W.DEMO_WORLD_SEMANTIC_ID },
      shuffled: { seal: W.DEMO_WORLD_SEMANTIC_ID },
      repl:     { seal: "sem-769b11b7e47db6485dd49b4da03dc3cf996aecb23a3ce53bd72a2b6c0f00cbe5" },
      empty:    { seal: "sem-b5bdc908d2ce549a46fc8ae95d39c34e1deb245e282075730e5436097433fae6" },
      conflict: { reject: "WRL_CONTROLLER_CONFLICT" },
      scenario: { reject: "WRL_WORLD_SOURCE_HAS_SCENARIO" },
      typo:     { reject: "WRL_SUGAR_MALFORMED" },
      remap:    { reject: "WRL_DUPLICATE_ID" },
    };

    for (const [name, source] of Object.entries(EX)) {
      const want = expected[name];
      if (!want) {
        ok(`playground/${name}`, false,
           `this example is offered to readers but states no outcome here`);
        continue;
      }
      const src = source.endsWith("\n") ? source : source + "\n";
      if (want.seal) {
        if (await expectSeal(`playground/${name}`, src, want.seal)) {
          verified.set(want.seal, `playground example '${name}'`);
        }
      } else {
        await expectReject(`playground/${name}`, src, want.reject);
      }
    }

    for (const name of Object.keys(expected)) {
      ok(`playground/${name}-exists`, name in EX,
         `an outcome is stated for '${name}' but the page no longer offers it`);
    }
  }
}

/* Markdown too -- README.md prints a world and an id, and is the first thing
 * anyone reads on the repository page. */
{
  const md = readFileSync(join(ROOT, "README.md"), "utf8");
  const FENCE = /```[a-z]*\n([\s\S]*?)```/g;
  let m, i = 0, worlds = 0;
  while ((m = FENCE.exec(md)) !== null) {
    i++;
    if (!isWorld(m[1])) continue;
    worlds++;
    /* README has no attributes to hang an annotation on, so the rule is
       positional: the fenced block immediately following must be its id. */
    const after = md.slice(m.index + m[0].length);
    const claimed = /```[a-z]*\n\s*(sem-[0-9a-f]{64})\s*\n```/.exec(after);
    if (!ok(`doc/README#${i}-states-an-id`, !!claimed,
            "a complete world in the README must be followed by the id it seals to")) continue;
    await expectSeal(`doc/README#${i}`, m[1], claimed[1]);
  }
  ok("doc/README-has-a-world", worlds > 0, "the README should show a world");
}

/* Finally: every id LITERAL published anywhere, in a code block or in running
 * prose, must be an id this module actually produces. The wrong hero id was
 * never inside a code block -- it sat in a `<div class="idline">` beside one,
 * where no block-level check could ever have seen it. */
{
  const known = new Map([...verified,
                         [W.STARTER_WORLD_SEMANTIC_ID, "the starter world"],
                         [W.DEMO_WORLD_SEMANTIC_ID, "the pinned fixture"]]);
  const FULL = /sem-[0-9a-f]{64}/g;
  /* the site also prints elided ids, `sem-<12 hex>…<10 hex>`; check the halves */
  const ELIDED = /sem-([0-9a-f]{6,20})(?:…|&hellip;|\.\.\.)([0-9a-f]{6,20})/g;

  for (const file of [...htmlFiles, "README.md"]) {
    const text = readFileSync(join(ROOT, file), "utf8");
    for (const [lit] of [...text.matchAll(FULL)].map((x) => [x[0]])) {
      ok(`ids/${file}/${lit.slice(0, 12)}`, known.has(lit),
         `this page prints ${lit}, which is not an id this build produces.\n` +
         `      known: ${[...known].map(([k, v]) => `${k} (${v})`).join("\n             ")}`);
    }
    for (const el of text.matchAll(ELIDED)) {
      const [whole, head, tail] = el;
      ok(`ids/${file}/elided-${head.slice(0, 8)}`,
         [...known.keys()].some((k) => k.startsWith("sem-" + head) && k.endsWith(tail)),
         `this page prints the elided id ${whole}, which does not match ` +
         `either known id at both ends`);
    }
  }
}

/* ============================================ 21. the relation identity kernel
 *
 * The first executable content of §D8. Everything here is derived from worlds
 * that are ALREADY SEALED -- V1 artifacts carry no authored relation name, so
 * a period-0 relation's only name is its frozen `(kind, src, dst)` edge key.
 * That is a ruling, not a shortcut: any scheme that let two sources with the
 * same artifact bytes produce different relation ids would mean the sealed
 * world did not determine its own future semantics, which is the one thing
 * `sem-` is for.
 *
 * The kernel lives in its own module and imports `wrl.js`; `wrl.js` does not
 * import it. That direction is the guarantee. A derived, non-canonical view
 * that is not in the artifact bytes cannot become any of those things by
 * accident if the frozen spine has no way to reach it.
 *
 * These checks are what let four register rows below stop saying `awaiting`.
 * They are deliberately not the whole of §D8: nothing here mints a grant,
 * schedules a transition or survives a crash, and the rows for those stay
 * pending rather than being handed a check that tests something easier. */
{
  const s = await import("../relation-identity.js");

  const worlds = { starter: W.STARTER_WORLD, demo: W.DEMO_WORLD };
  const sealed = {};

  /* -- compatibility. The kernel re-runs the spine's pipeline in order to
   *    interpose one census between canonicalization and lowering. If that
   *    interposition moved a single byte, every id on this site would be
   *    wrong, and the derived view would be worth nothing. This is checked
   *    first because nothing after it means anything if it fails. */
  for (const [name, src] of Object.entries(worlds)) {
    const base = await W.sealWorld(src);
    const kern = await s.sealWithRelations(src);
    sealed[name] = kern;
    ok(`relation/${name}/seal-is-byte-identical`,
       kern.ok && base.ok && kern.bytes === base.bytes &&
       kern.semanticId === base.semanticId,
       !kern.ok ? `the kernel refused a fixture the spine seals: ${kern.code}`
       : `the kernel's ${name} world seals to ${kern.semanticId}, the spine's ` +
         `to ${base.semanticId}. A derived view that perturbs what it derives ` +
         `from is not a view.`);
  }

  /* Everything below reads a sealed fixture's artifact. If the compatibility
   * check above failed, those fixtures are diagnostics rather than worlds, and
   * a suite that dereferences them dies with a TypeError instead of reporting
   * the failure it already found. A test file that crashes on its own red is
   * the worst instrument on this page: it turns a named, legible failure into
   * a stack trace, and takes every check after it down unnamed. */
  if (!(sealed.starter?.ok && sealed.demo?.ok)) {
    ok("relation/fixtures-are-sealable", false,
       `the kernel refused a pinned fixture, so §D8's battery could not run. ` +
       `Its checks below are not passing -- they did not execute.`);
  } else {

  /* -- the projection round trip. A relation revision is a richer record than
   *    a V1 edge, so the claim that V1 edges ARE relations is only honest if
   *    the enrichment is lossless in the direction that matters: every edge
   *    the spine sealed has to come back out of its revision as the same
   *    bytes, not as an equivalent-looking record. */
  for (const [name, kern] of Object.entries(sealed)) {
    if (!kern.ok) continue;
    const wrong = kern.artifact.edges.filter((edge) => {
      const back = s.projectRelationRevisionToV1Edge(
        s.edgeToRelationRevision(kern.artifact, edge));
      return W.serializeArtifact(back) !== W.serializeArtifact(edge);
    });
    ok(`relation/${name}/every-edge-projects-back-exactly`,
       kern.artifact.edges.length > 0 && wrong.length === 0,
       wrong.length
         ? `${wrong.length} edge(s) did not survive the round trip, e.g. ` +
           W.serializeArtifact(wrong[0])
         : `the ${name} world has no edges, so this proves nothing`);
  }

  /* -- §D8.7. The endpoint model itself, which 0.1 did not implement.
   *
   * Every check in this block would have passed on a module that had faithfully
   * embedded V1 edges into §D8's relation, and every one of them FAILED on the
   * module that shipped -- which had `{ terminal: "p0", role: "sig_out" }`,
   * reversing the two concepts, and enforced none of the orientation laws.
   *
   * The register above it was green throughout, and that is the lesson worth
   * more than the repair: a ratchet enforces zero debt among the properties it
   * KNOWS ABOUT. None of these were rows, so nothing on the page could notice
   * that the implementation and the model disagreed. The repair is the code;
   * the correction is that these are now registered obligations. */
  {
    const kern = sealed.starter;
    const rels = kern.derived.relations;
    const base = rels[0].revision;

    /* the vocabulary has to be EXPORTED before anything below can read it.
     * Without this the battery run against the 0.1 module died with a
     * TypeError on `undefined.includes`, taking every check after it down
     * unnamed -- the same defect the fixture guard above exists to prevent,
     * found the same way, one block later. A red is only useful if it has a
     * name. */
    const vocabulary =
      Array.isArray(s.ENDPOINT_ROLES) && Array.isArray(s.ORIENTATIONS);
    ok("relation/vocabulary-is-exported", vocabulary,
       `relation-identity.js exports no ENDPOINT_ROLES / ORIENTATIONS. §D8's ` +
       `roles and orientations are a closed enumeration; a module that keeps ` +
       `them private cannot be checked against the section that declares them.`);
    if (vocabulary) {

    /* Both helpers swallow the throw ON PURPOSE. Every assertion below is
     * about WHAT a module answered, and a check that only works when the
     * module already behaves cannot report on one that does not -- it reports
     * a stack trace with no check name attached, and takes the rest of the
     * battery with it. That happened twice while this block was being written,
     * which is how both guards got here. */

    /* what a refusal was, or null if the thing was accepted */
    const refused = (build) => {
      try { s.canonicalizeRelationRevision(build()); return null; }
      catch (e) { return e.code || String(e); }
    };
    /* the canonical form, or null if the module would not produce one */
    const canon = (build) => {
      try { return s.canonicalizeRelationRevision(build()); }
      catch { return null; }
    };
    const endpoint = (terminal, role) => ({ terminal, role });
    /* §D8's texture row is stated PER ORIENTATION -- required for directed,
     * profile-defined for symmetric, absent for acausal -- and `base` is a
     * directed relation carrying `solid`. Spreading it unchanged would put a
     * texture on every acausal specimen below, so each of those checks would
     * really be re-testing the texture rule under someone else's name. The
     * specimen therefore drops the inherited texture for acausal unless the
     * check is deliberately supplying one. */
    const withEnds = (orientation, endpoints, extra = {}) =>
      () => {
        const r = { ...base, orientation, endpoints, ...extra };
        if (orientation === "acausal" &&
            !Object.prototype.hasOwnProperty.call(extra, "texture"))
          delete r.texture;
        return r;
      };

    /* 1. terminals are PORTS, not objects. `p0` is an object; the terminal a
     *    relation reaches is `p0.sig_out`, and the port half has to be the one
     *    the kind names or the projection's inverse is a guess. */
    {
      const wrong = rels.filter((r) => {
        const ports = W.EDGE_PORTS[r.revision.kind];
        const src = r.revision.endpoints.find((e) => e.role === "source");
        const dst = r.revision.endpoints.find((e) => e.role === "target");
        return !src || !dst ||
               src.terminal !== `${r.allocation.src}.${ports[0]}` ||
               dst.terminal !== `${r.allocation.dst}.${ports[1]}`;
      });
      ok("relation/terminals-are-port-qualified",
         rels.length > 0 && wrong.length === 0,
         wrong.length
           ? `${wrong.length} derived relation(s) name an object where §D8 ` +
             `names a terminal, e.g. ` +
             W.serializeArtifact(wrong[0].revision.endpoints)
           : `the fixture derived no relations, so this proves nothing`);
    }

    /* 2. roles are SEMANTIC POSITIONS. The failure this catches is specific:
     *    0.1 put the port name in the role slot, which type-checks, round-trips
     *    and is wrong. So the assertion is not merely that roles are known --
     *    it is that no role is a port name, which is the shape of the defect. */
    {
      const portNames = new Set(Object.values(W.EDGE_PORTS).flat());
      const roles = rels.flatMap((r) => r.revision.endpoints.map((e) => e.role));
      const invented = roles.filter((r) => !s.ENDPOINT_ROLES.includes(r));
      const ports = roles.filter((r) => portNames.has(r));
      ok("relation/roles-are-semantic-positions",
         roles.length > 0 && invented.length === 0 && ports.length === 0,
         ports.length
           ? `role(s) [${[...new Set(ports)].join(", ")}] are PORT names. A ` +
             `port is what a terminal identifies; a role is the position the ` +
             `participant holds in the relation, and putting one in the ` +
             `other's slot leaves §D8's vocabulary unimplemented while every ` +
             `round trip still passes`
           : `role(s) [${[...new Set(invented)].join(", ")}] are outside ` +
             `${s.ENDPOINT_ROLES.join(", ")}`);
    }

    /* 3. endpoint ORDER is not meaning. §D8 says the set is unordered; an
     *    array's order is in its bytes, so unless canonicalisation decides one,
     *    two authors describing one net seal two ids. Reversal is the smallest
     *    reordering that is still one. */
    {
      let flipped = null;
      try {
        flipped = await s.relationRevisionId(
          { ...base, endpoints: [...base.endpoints].reverse() });
      } catch (e) { flipped = `refused as ${e.code || e}`; }
      ok("relation/endpoint-order-is-not-semantic",
         flipped === rels[0].revision_id,
         `reversing a revision's endpoints moved its id from ` +
         `${rels[0].revision_id} to ${flipped}. Endpoints are a set; if their ` +
         `written order reaches the hash, the id measures typing order rather ` +
         `than topology.`);
    }

    /* 4. and the order canonicalisation picks is the one §D8 states -- role in
     *    the DECLARED enumeration order, then terminal. Sorting the roles as
     *    strings would put `peer` first and pass check 3 while disagreeing
     *    with the section that defines the form. Checked on a three-terminal
     *    acausal relation, where the terminal tiebreak is also exercised. */
    {
      const scrambled = canon(withEnds("acausal",
        [endpoint("r1.pin", "terminal"),
         endpoint("n1.pin", "terminal"),
         endpoint("vcc.pin", "terminal")]));
      const directed = canon(
        () => ({ ...base, endpoints: [...base.endpoints].reverse() }));
      const seq = (r, k) => r ? r.endpoints.map((e) => e[k]).join(",") : "(refused)";
      ok("relation/canonical-order-is-role-then-terminal",
         seq(scrambled, "terminal") === "n1.pin,r1.pin,vcc.pin" &&
         seq(directed, "role") === "source,target",
         `canonicalisation ordered a scrambled acausal net as ` +
         `[${seq(scrambled, "terminal")}] and a reversed directed relation as ` +
         `[${seq(directed, "role")}]. §D8 sorts by role in its declared ` +
         `enumeration order, then terminal.`);
    }

    /* 5. a terminal appears at most once per RELATION. The weaker per-role
     *    rule admits exactly the record below -- one terminal simultaneously
     *    in the tail and the head -- and also leaves the sort key non-total. */
    ok("relation/duplicate-terminal-is-refused",
       refused(withEnds("directed", [endpoint("p0.sig_out", "source"),
                                     endpoint("p0.sig_out", "target")]))
         === "WRL_DUPLICATE_TERMINAL",
       `a relation naming one terminal as both its source and its target was ` +
       `${refused(withEnds("directed", [endpoint("p0.sig_out", "source"), endpoint("p0.sig_out", "target")])) ||
          "accepted"}. A hyperarc's tail and head are disjoint sets.`);

    /* 6-8. role legality, one orientation at a time. Each check asserts BOTH
     *      halves: the illegal role is refused AND the legal one is accepted.
     *      A validator that refused everything would satisfy the first half
     *      alone, and would be indistinguishable from one that works. */
    ok("relation/directed-admits-only-source-and-target",
       refused(withEnds("directed", [endpoint("a.sig_out", "source"),
                                     endpoint("b.sig_in", "peer")]))
         === "WRL_ENDPOINT_ROLE_ILLEGAL" &&
       refused(withEnds("directed", [endpoint("a.sig_out", "source"),
                                     endpoint("b.sig_in", "target")])) === null,
       `a directed relation admits source and target only, and must admit ` +
       `both; got peer=${refused(withEnds("directed", [endpoint("a.sig_out", "source"), endpoint("b.sig_in", "peer")]))}, ` +
       `well-formed=${refused(withEnds("directed", [endpoint("a.sig_out", "source"), endpoint("b.sig_in", "target")]))}`);

    ok("relation/symmetric-admits-only-peers",
       refused(withEnds("symmetric", [endpoint("a.sig_out", "source"),
                                      endpoint("b.sig_in", "target")]))
         === "WRL_ENDPOINT_ROLE_ILLEGAL" &&
       refused(withEnds("symmetric", [endpoint("a.pin", "peer"),
                                      endpoint("b.pin", "peer")])) === null,
       `a symmetric relation distinguishes no side, so source and target have ` +
       `no meaning in one; got ` +
       `${refused(withEnds("symmetric", [endpoint("a.sig_out", "source"), endpoint("b.sig_in", "target")]))}, ` +
       `peers=${refused(withEnds("symmetric", [endpoint("a.pin", "peer"), endpoint("b.pin", "peer")]))}`);

    ok("relation/acausal-admits-only-terminals",
       refused(withEnds("acausal", [endpoint("a.pin", "peer"),
                                    endpoint("b.pin", "terminal")]))
         === "WRL_ENDPOINT_ROLE_ILLEGAL" &&
       refused(withEnds("acausal", [endpoint("a.pin", "terminal"),
                                    endpoint("b.pin", "terminal"),
                                    endpoint("c.pin", "terminal")])) === null,
       `an acausal connection has no writer and no distinguished pair, so its ` +
       `members are terminals; got ` +
       `${refused(withEnds("acausal", [endpoint("a.pin", "peer"), endpoint("b.pin", "terminal")]))}, ` +
       `net=${refused(withEnds("acausal", [endpoint("a.pin", "terminal"), endpoint("b.pin", "terminal"), endpoint("c.pin", "terminal")]))}`);

    /* 9. texture is ABSENT for acausal -- §D4's solver wall governs settlement
     *    instead, and a texture would be a second account of it. The specimen
     *    carries a LEGAL texture, because an invented one is refused by the
     *    vocabulary first and would leave the orientation rule untested. */
    ok("relation/acausal-carries-no-texture",
       refused(withEnds("acausal", [endpoint("a.pin", "terminal"),
                                    endpoint("b.pin", "terminal")],
                        { texture: "solid" })) === "WRL_ACAUSAL_TEXTURE",
       `an acausal relation carrying a texture was ` +
       `${refused(withEnds("acausal", [endpoint("a.pin", "terminal"), endpoint("b.pin", "terminal")], { texture: "solid" })) || "accepted"}. ` +
       `There is no writer for a texture to describe the delivery of.`);

    /* 9b. and the OTHER half of the same row, which 0.1.1 filed as a V2
     *     obligation and therefore never enforced: texture is REQUIRED for
     *     directed. A table with one enforced row and one deferred row reads
     *     as a table, so both halves are driven from `ORIENTATION_TEXTURE` and
     *     both are checked here. The specimen deletes the texture rather than
     *     nulling it, because a null is a stated absence and §D8 wants the key
     *     gone or meant. */
    {
      const bare = () => { const r = { ...base }; delete r.texture; return r; };
      ok("relation/directed-carries-a-texture",
         refused(bare) === "WRL_MISSING_TEXTURE" &&
         refused(() => base) === null,
         `a directed relation stating no texture was ` +
         `${refused(bare) || "accepted"}, and the well-formed one answered ` +
         `${refused(() => base) || "accepted"}. §5's textures are guarantee ` +
         `classes; a directed relation with none makes no statement about ` +
         `whether it settles within the period.`);

      /* 9c. and the vocabulary the demand is satisfied from is §5's four, not
       *     the single one V1 happens to be able to write. Narrowing the
       *     enumeration to `solid` would pass every other texture check on
       *     this page while deleting three guarantee classes from the model. */
      ok("relation/texture-vocabulary-is-the-specs",
         s.TEXTURES.join(",") === "solid,async,verified,fault" &&
         s.V1_TEXTURE === "solid" &&
         refused(() => ({ ...base, texture: "braided" }))
           === "WRL_BAD_RELATION_REVISION" &&
         refused(() => ({ ...base, texture: "verified" })) === null,
         `the module admits textures [${(s.TEXTURES || []).join(", ")}] with ` +
         `V1 writing '${s.V1_TEXTURE}'; invented=` +
         `${refused(() => ({ ...base, texture: "braided" })) || "accepted"}, ` +
         `declared-but-unwritable=` +
         `${refused(() => ({ ...base, texture: "verified" })) || "accepted"}. ` +
         `What V1 can ENCODE and what §5 DECLARES are different sets, and ` +
         `collapsing them loses the three textures V1 cannot write.`);
    }

    /* 10. role-set COMPLETENESS, which role legality alone does not give: two
     *     targets and no source is a relation every endpoint of which holds an
     *     admitted role, and which still says something crosses it from
     *     nowhere. */
    ok("relation/directed-needs-both-halves",
       refused(withEnds("directed", [endpoint("a.sig_in", "target"),
                                     endpoint("b.sig_in", "target")]))
         === "WRL_INCOMPLETE_ORIENTATION",
       `a directed relation with a head and no tail was ` +
       `${refused(withEnds("directed", [endpoint("a.sig_in", "target"), endpoint("b.sig_in", "target")])) || "accepted"}. ` +
       `A hyperarc is an ordered PAIR of vertex sets; neither may be empty.`);

    /* 11. and the orientation vocabulary is §D8's, not one the module coined.
     *     0.1 accepted `undirected`, which appears nowhere in the spec. */
    ok("relation/orientation-vocabulary-is-the-specs",
       s.ORIENTATIONS.join(",") === "directed,symmetric,acausal" &&
       refused(() => ({ ...base, orientation: "undirected" }))
         === "WRL_BAD_RELATION_REVISION",
       `the module admits orientations [${s.ORIENTATIONS.join(", ")}] and ` +
       `answered ${refused(() => ({ ...base, orientation: "undirected" })) || "accepted"} ` +
       `to 'undirected'. §D8 states three, and an invented fourth is one no ` +
       `other implementation has to honour.`);
    }
  }

  /* -- §D8.1, as a census rather than a spot check.
   *
   * D8.1 says a relation's identity does not move when its revision changes.
   * Tested by mutating one field and looking for stability, that is nearly
   * vacuous -- the id is minted from an allocation, and an allocation the
   * check builds by hand need never have touched a revision at all. So the
   * revision is routed THROUGH the projection, which is the only path by
   * which revision content can reach a V1 identity, and then every field of
   * the revision is mutated in turn and classified by what happened.
   *
   * The result has to be a TOTAL partition of the declared field set. A
   * subset check would let a new field appear unclassified, which is exactly
   * how a field that quietly names a relation would get in. */
  {
    const kern = sealed.starter;
    const edge = kern.artifact.edges[0];
    const base = s.edgeToRelationRevision(kern.artifact, edge);
    const idOf = async (rev) => s.relationIdFromAllocation(
      s.legacyEdgeAllocation(kern.semanticId,
                             s.projectRelationRevisionToV1Edge(rev)));
    const baseId = await idOf(base);

    /* one mutation per field, each the smallest change that is still a change.
     *
     * `kind` and `endpoints` move the TERMINAL rather than the role, because
     * after the 0.1.1 repair the role is the semantic position and stays
     * `source`/`target` whatever the kind is; it is the port half of the
     * terminal that a kind determines. `orientation` mutates to a WELL-FORMED
     * symmetric relation -- peers, not source and target -- so that what the
     * projection refuses is a legal relation with no V1 form, rather than an
     * invalid record the validator would have rejected first. Those are
     * different facts, and only the first one is what this row claims.
     *
     * `domain` mutates to another namespace a profile could plausibly declare
     * -- §D8's field table names `electrical` beside `signal` -- rather than to
     * a profile id, because a profile id in the domain slot is the 0.1.1 defect
     * itself and would test the wrong thing. */
    const MUTATE = {
      domain:      (r) => ({ ...r, domain: "electrical" }),
      kind:        (r) => ({ ...r, kind: "SocketControl",
                             endpoints: [{ terminal: "sp.socket", role: "source" },
                                         { terminal: "ob.pose",   role: "target" }] }),
      endpoints:   (r) => ({ ...r, endpoints: [{ ...r.endpoints[0], terminal: "zz.sig_out" },
                                               r.endpoints[1]] }),
      orientation: (r) => ({ ...r, orientation: "symmetric",
                             endpoints: r.endpoints.map(
                               (e) => ({ ...e, role: "peer" })) }),
      texture:     (r) => ({ ...r, texture: "async" }),
      attributes:  (r) => ({ ...r, attributes: { weight: 1 } }),
      policy:      (r) => ({ ...r, policy: "other.rules.v1" }),
    };

    /* the declared partition. Changing it is a semantic decision and should
     * read like one -- which is why it is written out here rather than
     * inferred from whatever the code happens to do today. */
    const NAMES        = ["kind", "endpoints"];
    const FREE         = ["policy"];
    const UNPROJECTED  = ["domain", "orientation", "texture", "attributes"];

    const observed = {};
    for (const f of s.REVISION_FIELDS) {
      if (!MUTATE[f]) { observed[f] = "unmutated"; continue; }
      try {
        observed[f] = (await idOf(MUTATE[f](base))) === baseId ? "free" : "names";
      } catch { observed[f] = "unprojected"; }
    }

    const expected = Object.fromEntries([
      ...NAMES.map((f) => [f, "names"]),
      ...FREE.map((f) => [f, "free"]),
      ...UNPROJECTED.map((f) => [f, "unprojected"]),
    ]);

    const declared = [...NAMES, ...FREE, ...UNPROJECTED];
    const missing = s.REVISION_FIELDS.filter((f) => !declared.includes(f));
    const extra = declared.filter((f) => !s.REVISION_FIELDS.includes(f));
    ok("relation/revision-field-partition-is-total",
       missing.length === 0 && extra.length === 0,
       `the partition and the revision's field set disagree: ` +
       `${missing.length ? `unclassified [${missing.join(", ")}]` : ""}` +
       `${extra.length ? ` classified but absent [${extra.join(", ")}]` : ""}. ` +
       `An unclassified field is how a second name for a relation gets in.`);

    const wrong = s.REVISION_FIELDS.filter((f) => observed[f] !== expected[f]);
    ok("relation/only-the-key-names-the-relation",
       wrong.length === 0 && FREE.length > 0,
       wrong.length
         ? wrong.map((f) => `'${f}' is declared ${expected[f]} but behaves ` +
                            `${observed[f]}`).join("; ")
         : `no field is free to change, so §D8.1 has no content here: a ` +
           `revision that cannot change trivially never moves an id`);
  }

  /* -- §D8.2. A revision that names its predecessor is a second home for
   *    lifecycle history, and two homes disagree. Checked in both directions:
   *    the validator refuses a backpointer by name, and no revision the kernel
   *    itself produces carries a value shaped like another revision's id. */
  {
    const kern = sealed.starter;
    const rev = kern.derived.relations[0].revision;
    let refused = null;
    try { s.validateRelationRevision({ ...rev, previous_revision: "rev-0" }); }
    catch (e) { refused = e.code; }
    const selfRef = kern.derived.relations.filter(
      (r) => /(^|")rev-/.test(W.serializeArtifact(r.revision)));
    ok("relation/revision-has-no-backpointer",
       refused === "WRL_REVISION_BACKPOINTER" && selfRef.length === 0,
       refused !== "WRL_REVISION_BACKPOINTER"
         ? `a revision carrying previous_revision was ${refused ? `refused as ` +
            `${refused}` : "accepted"}, not named as a backpointer`
         : `${selfRef.length} produced revision(s) already reference a revision id`);
  }

  /* -- §D8.3 and §D8.5, which are one fact seen from two sides.
   *
   * The two hashes read disjoint inputs, and that is the whole design: a
   * relation's IDENTITY is world-scoped, so the same key in two worlds is two
   * relations; a relation's DESCRIPTION is world-independent, so the same
   * structure in two worlds is the same revision. Checking either alone would
   * pass on a build that had accidentally made both hashes read the same
   * thing, so they are checked as a pair on the same edge. */
  {
    const a = sealed.starter, b = sealed.demo;
    const key = (r) => `${r.allocation.kind}|${r.allocation.src}|${r.allocation.dst}`;
    const byKey = new Map(b.derived.relations.map((r) => [key(r), r]));
    const shared = a.derived.relations
      .map((r) => [r, byKey.get(key(r))]).filter(([, m]) => m);

    ok("relation/the-two-fixtures-share-an-edge-key", shared.length > 0,
       `the two pinned worlds have no edge key in common, so neither half of ` +
       `this pair proves anything`);

    ok("relation/revision-id-is-world-independent",
       shared.length > 0 && shared.every(([x, y]) => x.revision_id === y.revision_id),
       `the same relation structure got different revision ids in two worlds. ` +
       `A revision describes; what world it was described in is provenance, ` +
       `and provenance that moves a description's id makes the description ` +
       `unshareable.`);

    ok("relation/relation-id-is-world-scoped",
       shared.length > 0 && shared.every(([x, y]) => x.relation_id !== y.relation_id),
       `the same edge key produced the same relation id in two different ` +
       `worlds. Two worlds' relations are not the same relation, and an ` +
       `identity that says they are cannot be revised independently.`);
  }

  /* -- the duplicate key, and where it is reported.
   *
   * The ordering is the point, so it is tested as an ordering. Today the spine
   * reports a doubled edge as a controller miscount, which is true of the
   * lowered graph and useless to the author: there is one controller, written
   * twice. Under §D8 it is sharper than a miscount -- two relations whose only
   * available name is the same name. Asserting the kernel's code alone would
   * pass even if the spine had started saying the same thing, so the spine's
   * answer is asserted too, as the thing being improved on. */
  {
    const doubled = W.STARTER_WORLD + "\n[p0] --sig--> [r0]\n";
    const spine = await W.sealWorld(doubled);
    const kern = await s.sealWithRelations(doubled);
    ok("relation/duplicate-key-is-named-as-itself",
       !kern.ok && kern.code === "WRL_DUPLICATE_RELATION_KEY",
       `a world with one edge written twice was ${kern.ok ? "sealed"
          : `refused as ${kern.code}`}`);
    ok("relation/duplicate-key-precedes-the-controller-count",
       !spine.ok && spine.code === "WRL_CONTROLLER_CONFLICT" &&
       kern.code === "WRL_DUPLICATE_RELATION_KEY",
       `the census is meant to run before validateGraph's controller count, ` +
       `but the spine now reports ${spine.code} and the kernel ${kern.code}. ` +
       `If those have converged, this check has nothing left to guard.`);

    /* and the other direction: two DISTINCT edges that do overload a
     * controller must still reach the frozen validator. A census that fires
     * here would be refusing worlds §7 admits. */
    const twoControllers = W.STARTER_WORLD +
      "\n[spinner:sp2](w=16, n=8, rotor=quarter_turn_z, configurable){sig_in, socket}\n" +
      "[r0] --sig--> [sp2]\n[sp2] --socket--> [ob]\n";
    const overloaded = await s.sealWithRelations(twoControllers);
    ok("relation/distinct-keys-reach-the-frozen-validator",
       !overloaded.ok && overloaded.code === "WRL_CONTROLLER_CONFLICT",
       `two distinct edges onto one orb were reported as ` +
       `${overloaded.ok ? "acceptable" : overloaded.code}; the key census ` +
       `must be silent about worlds whose keys are distinct`);
  }

  /* -- the two allocation variants that have no V1 source, and WHERE they are
   *    refused.
   *
   * 0.1.1 refused them inside `relationIdFromAllocation` -- the hash function
   * itself. That put three different questions behind one list: which variants
   * exist, which a trusted importer may construct, and which an authoring
   * surface may emit. In V1 those have the same answer, which is exactly why
   * conflating them was invisible; the cost only showed up as two §D8.1
   * preimage laws that could not be stated as properties, because the
   * allocations they are about could not be built at all.
   *
   * So the refusal moved to the boundary where construction happens, and this
   * check moved with it. The obligation is unchanged: an adapter that could
   * mint all three would be asserting a surface and a grant machinery that do
   * not exist. */
  {
    const world = sealed.starter.semanticId;
    const specimen = {
      "named-initial": { variant: "named-initial", world_id: world,
                         relation_name: "n" },
      "legacy-edge":   { variant: "legacy-edge", world_id: world,
                         kind: "SignalWire", src: "p0", dst: "r0" },
      "granted":       { variant: "granted", grant_id: "g",
                         local_counter: 0 },
    };
    const refusal = (assert, a) => {
      try { assert(a); return null; } catch (e) { return e.code || String(e); }
    };

    const results = [];
    for (const variant of s.ALLOCATION_VARIANTS) {
      const a = specimen[variant];
      if (!a) { results.push(`${variant} has no specimen`); continue; }
      const importer = refusal(s.assertImportableAllocation, a);
      const surface  = refusal(s.assertAuthorableAllocation, a);
      const wantImporter = s.IMPORTABLE_VARIANTS.includes(variant)
        ? null : "WRL_UNWRITABLE_ALLOCATION";
      const wantSurface = s.AUTHORABLE_VARIANTS.includes(variant)
        ? null : "WRL_UNWRITABLE_ALLOCATION";
      if (importer !== wantImporter)
        results.push(`the importer answered ${importer} for ${variant}, ` +
                     `expected ${wantImporter}`);
      if (surface !== wantSurface)
        results.push(`the surface answered ${surface} for ${variant}, ` +
                     `expected ${wantSurface}`);
    }

    ok("relation/unwritable-variants-are-refused",
       results.length === 0 &&
       s.IMPORTABLE_VARIANTS.length === 1 &&
       s.AUTHORABLE_VARIANTS.length === 0 &&
       s.ALLOCATION_VARIANTS.length === 3,
       results.join("; ") ||
       `the three authorities are ${s.ALLOCATION_VARIANTS.length} known / ` +
       `${s.IMPORTABLE_VARIANTS.length} importable / ` +
       `${s.AUTHORABLE_VARIANTS.length} authorable; V1 has three variants, ` +
       `one importer and no writable relation surface`);
  }

  /* -- and the §D8.1 preimage laws the conflation had been hiding.
   *
   * Neither of these needs a runtime. They are statements about what a hash is
   * taken over, and they were `awaiting` only because the allocation could not
   * be constructed. Both rows are split accordingly: the model half runs here,
   * and the surface/runtime half -- an author actually writing a name, a grant
   * actually being issued and drawn -- stays pending. */
  {
    const A = sealed.starter.semanticId, B = sealed.demo.semanticId;
    const id = (a) => s.relationIdFromAllocation(a);

    const sameName = [await id(s.namedInitialAllocation(A, "clock_feed")),
                      await id(s.namedInitialAllocation(B, "clock_feed"))];
    ok("relation/world-scoping/a-named-allocation-is-world-scoped",
       A !== B && sameName[0] !== sameName[1] &&
       sameName[0] === await id(s.namedInitialAllocation(A, "clock_feed")),
       `one authored relation name minted ${sameName[0] === sameName[1]
          ? "the same id in two worlds" : "unstable ids in one world"}. ` +
       `§D8.1 puts world_id in the named-initial preimage, so a name is a ` +
       `name WITHIN a world -- and a name that travelled would be a migration ` +
       `nobody wrote.`);

    /* §D8.4's claim, stated as arithmetic rather than as an allocator. The
     * section says two grants cannot collide "whatever their ranges, even
     * overlapping ones", and gives the reason: grant_id is in the preimage.
     * That reason is checkable without issuing a grant. */
    const g1 = await id(s.grantedAllocation("grant-a", 7));
    const g2 = await id(s.grantedAllocation("grant-b", 7));
    const g3 = await id(s.grantedAllocation("grant-a", 8));
    ok("relation/world-scoping/a-granted-allocation-separates-grants",
       g1 !== g2 && g1 !== g3 && g2 !== g3 &&
       g1 === await id(s.grantedAllocation("grant-a", 7)),
       `the same counter drawn from two grants minted ` +
       `${g1 === g2 ? "one id" : "unstable ids"}. §D8.4's whole correction is ` +
       `that allocator mutual exclusion is not required BECAUSE grant_id is ` +
       `in the preimage; if it is not, a surviving zombie allocator collides ` +
       `with its successor.`);

    /* and the tag that keeps the three families apart, which §D8.1 says is
     * why the variant is written into the preimage at all */
    const shapes = [];
    for (const bad of [{ variant: "legacy-edge", world_id: A, kind: "k",
                         src: "a", dst: "b", extra: 1 },
                       { variant: "named-initial", world_id: A },
                       { variant: "granted", grant_id: "g",
                         local_counter: -1 },
                       { variant: "granted", grant_id: "g",
                         local_counter: "0" },
                       { variant: "invented", world_id: A }]) {
      try { await id(bad); shapes.push(`${bad.variant} accepted`); }
      catch (e) {
        if (e.code !== "WRL_BAD_ALLOCATION")
          shapes.push(`${bad.variant} refused as ${e.code}`);
      }
    }
    ok("relation/allocations/each-variant-has-exactly-its-declared-fields",
       shapes.length === 0 &&
       W.serializeArtifact(Object.keys(s.ALLOCATION_FIELDS).sort()) ===
         W.serializeArtifact([...s.ALLOCATION_VARIANTS].sort()),
       shapes.join("; ") ||
       `ALLOCATION_FIELDS and ALLOCATION_VARIANTS name different variant ` +
       `sets, so a variant exists whose preimage shape nothing states`);
  }

  /* -- the marker on the derived view. A marker is only a claim, and the byte
   *    equality above is the real guarantee -- but a claim that disagrees with
   *    the guarantee is worse than no claim, so the claim is held to it. */
  {
    const d = sealed.starter.derived;
    ok("relation/derived-view-is-marked-non-canonical",
       d.derived === true && d.canonical === false && d.inArtifactBytes === false &&
       !W.serializeArtifact(sealed.starter.artifact).includes("rel-"),
       `the derived view claims derived=${d.derived} canonical=${d.canonical} ` +
       `inArtifactBytes=${d.inArtifactBytes}, or a relation id reached the ` +
       `artifact bytes`);
  }

  /* -- the derivation is BOUND to the artifact it derives from.
   *
   * This is the defect that mattered most in the 0.1.1 review, because it
   * falsified the sentence the whole module rests on. `deriveRelations` took
   * `(artifact, semanticId)` and used the second argument as the allocation
   * preimage's `world_id` WITHOUT checking it against the first. Handed the
   * real starter artifact and a forged `sem-000…0`, it minted relation ids
   * under the forgery and said nothing.
   *
   * Every other check in this battery passed on that module, because they all
   * supply the honest pair. A function with two independent sources of truth
   * about one hash is only correct for callers who were already telling the
   * truth -- which is not a property, it is an audience. */
  {
    const forged =
      "sem-" + "0".repeat(64);
    let code = null, ids = null;
    try {
      ids = (await s.deriveRelations(sealed.starter.artifact, forged))
        .relations.map((r) => r.relation_id);
    } catch (e) { code = e.code || String(e); }

    ok("relation/binding/a-forged-world-id-is-refused",
       code === "WRL_SEMANTIC_ID_MISMATCH",
       ids ? `a forged world id was accepted and minted ${ids[0]}. The claim ` +
             `that relation identity is derived from the seal is exactly the ` +
             `claim that this cannot happen`
           : `a forged world id was refused as ${code}, not ` +
             `WRL_SEMANTIC_ID_MISMATCH`);

    /* the recomputation is the real boundary, so it has to work with NO claim
     * at all -- otherwise the check above is satisfied by a module that
     * merely compares two things the caller supplied */
    const unclaimed = await s.deriveRelations(sealed.starter.artifact);
    ok("relation/binding/the-world-id-is-recomputed-not-supplied",
       unclaimed.world_id === sealed.starter.semanticId &&
       W.serializeArtifact(unclaimed.relations.map((r) => r.relation_id)) ===
         W.serializeArtifact(
           sealed.starter.derived.relations.map((r) => r.relation_id)),
       `deriving without a claimed id produced ${unclaimed.world_id} and a ` +
       `different relation set. The artifact determines its own world id; a ` +
       `derivation that needs to be told it is not derived from the seal.`);
  }

  /* -- and the source family the adapter admits, named rather than assumed.
   *
   * §D8.8 said "V1", and this repository has two: `1.0`, and `1.1` for a world
   * with a mailbox. Both are read here because they share the structural edge
   * representation. A later artifact does not, and reading one through the
   * legacy-edge adapter would not fail -- `artifact.edges` would be undefined
   * and the loop would derive nothing, reporting a world with no relations.
   * Silence about an artifact one cannot read is the migration failure §D8.5
   * names, arriving one layer lower. */
  {
    const seen = new Set(Object.values(sealed).map((k) => k.artifact.ir_version));
    const results = [];
    for (const v of [...s.V1_IR_VERSIONS, "2.0", "0.9", undefined]) {
      const artifact = { ...sealed.starter.artifact, ir_version: v };
      let code = null;
      try { s.assertV1Artifact(artifact); } catch (e) { code = e.code; }
      const want = s.V1_IR_VERSIONS.includes(v)
        ? null : "WRL_UNSUPPORTED_IR_VERSION";
      if (code !== want)
        results.push(`ir_version ${JSON.stringify(v)} answered ${code}, ` +
                     `expected ${want}`);
    }
    ok("relation/binding/an-unknown-ir-version-is-refused",
       results.length === 0 &&
       W.serializeArtifact([...s.V1_IR_VERSIONS].sort()) ===
         W.serializeArtifact([W.IR_VERSION, W.IR_VERSION_V1_1].sort()) &&
       [...seen].every((v) => s.V1_IR_VERSIONS.includes(v)),
       results.join("; ") ||
       `the adapter admits [${s.V1_IR_VERSIONS.join(", ")}] and the spine ` +
       `writes [${W.IR_VERSION}, ${W.IR_VERSION_V1_1}]. An adapter whose ` +
       `accepted set is narrower than what the spine seals refuses real ` +
       `worlds; wider, and it reads a shape it has never seen`);
  }

  /* -- the canonical vocabulary cannot be moved from outside this module.
   *
   * `ENDPOINT_ROLES` is a normative sort key: canonicalization orders
   * endpoints by position in it, so reversing the array after importing the
   * module reverses every derived relation's canonical form and moves every
   * `revision_id` -- from a file that does not contain the rule. The 0.1.1
   * review did exactly that, and also widened `ORIENTATION_ROLES` to change
   * what the validator accepted.
   *
   * The mutations are ATTEMPTED here rather than assumed to throw, because
   * `Object.freeze` fails loudly in a module and silently in a script, and the
   * property being checked is the consequence -- the canon did not move -- not
   * the mechanism. */
  {
    const before = {
      order: W.serializeArtifact(
        s.canonicalizeRelationRevision(
          sealed.starter.derived.relations[0].revision).endpoints),
      roles: W.serializeArtifact([...s.ENDPOINT_ROLES]),
      orientations: W.serializeArtifact([...s.ORIENTATIONS]),
      fields: W.serializeArtifact([...s.REVISION_FIELDS]),
      variants: W.serializeArtifact([...s.ALLOCATION_VARIANTS]),
      importable: W.serializeArtifact([...s.IMPORTABLE_VARIANTS]),
      imported: W.serializeArtifact([...s.RELATION_IMPORTED_FIELDS]),
      admits: W.serializeArtifact([...s.ORIENTATION_ROLES.directed.admits]),
    };

    const tamper = (f) => { try { f(); } catch { /* frozen, loudly */ } };
    tamper(() => s.ENDPOINT_ROLES.reverse());
    tamper(() => { s.ENDPOINT_ROLES[0] = "target"; });
    tamper(() => s.ORIENTATIONS.push("undirected"));
    tamper(() => s.REVISION_FIELDS.push("payload"));
    tamper(() => s.ALLOCATION_VARIANTS.push("invented"));
    tamper(() => s.IMPORTABLE_VARIANTS.push("named-initial"));
    tamper(() => s.RELATION_IMPORTED_FIELDS.push("imported_by"));
    tamper(() => s.ORIENTATION_ROLES.directed.admits.push("peer"));

    /* a peer endpoint on a directed relation was illegal before the tamper,
     * and the tamper's whole point was to make it legal */
    let widened = null;
    try {
      s.canonicalizeRelationRevision({
        ...sealed.starter.derived.relations[0].revision,
        endpoints: [{ terminal: "p0.sig_out", role: "source" },
                    { terminal: "r0.sig_in", role: "peer" }],
      });
      widened = "accepted";
    } catch (e) { widened = e.code; }

    const after = {
      order: W.serializeArtifact(
        s.canonicalizeRelationRevision(
          sealed.starter.derived.relations[0].revision).endpoints),
      roles: W.serializeArtifact([...s.ENDPOINT_ROLES]),
      orientations: W.serializeArtifact([...s.ORIENTATIONS]),
      fields: W.serializeArtifact([...s.REVISION_FIELDS]),
      variants: W.serializeArtifact([...s.ALLOCATION_VARIANTS]),
      importable: W.serializeArtifact([...s.IMPORTABLE_VARIANTS]),
      imported: W.serializeArtifact([...s.RELATION_IMPORTED_FIELDS]),
      admits: W.serializeArtifact([...s.ORIENTATION_ROLES.directed.admits]),
    };

    const moved = Object.keys(before).filter((k) => before[k] !== after[k]);
    ok("relation/immutability/the-canon-cannot-be-moved-from-outside",
       moved.length === 0 && widened === "WRL_ENDPOINT_ROLE_ILLEGAL",
       moved.length
         ? `a consumer moved ${moved.join(", ")} by mutating an exported ` +
           `table. A canonical sort key that a caller can reverse is not a ` +
           `canonical form -- every revision_id this module mints would move ` +
           `without the file that documents the order changing`
         : `after widening ORIENTATION_ROLES.directed.admits, a peer endpoint ` +
           `on a directed relation was ${widened}. Role legality has to be ` +
           `the module's, not the caller's`);
  }

  /* -- and the property that makes the whole derivation usable: it is a
   *    function of the sealed world, not of how the world was written.
   *
   * The comparison is deliberately NOT sorted. Sorted, this check could not
   * fail: relation ids are minted from `artifact.edges`, which canonicalization
   * has already ordered, so the SET is order-proof by construction and the
   * check would be reporting a property of `canonicalizeGraph` rather than of
   * this module. The list ORDER is the part that is not free -- a kernel that
   * walked the parse instead of the artifact would produce the same set in a
   * different sequence, and every consumer that holds a relation by position
   * would be holding a different one for the same world. */
  {
    const lines = W.STARTER_WORLD.trim().split("\n");
    const reordered = [lines[0], "", ...lines.slice(2).filter(Boolean).reverse()]
      .join("\n") + "\n";
    const other = await s.sealWithRelations(reordered);
    const ids = (k) => k.derived.relations
      .map((r) => `${r.relation_id}/${r.revision_id}`).join(",");
    ok("relation/reordering-the-source-moves-nothing",
       other.ok && other.semanticId === sealed.starter.semanticId &&
       ids(other) === ids(sealed.starter),
       other.ok
         ? `a reordered source sealed to ${other.semanticId} and listed its ` +
           `relations differently; a derivation that reads writing order is ` +
           `not a derivation from the seal`
         : `the reordered source was refused: ${other.code}`);

    /* -- and the same property against the OTHER thing that is not identity:
     * sugar. §16's law is that a sugared program and its explicit twin lower
     * to identical canonical bytes, so a derivation that reads the seal
     * inherits that law for free -- and one that reads the source text does
     * not. The starter world is written in sugar twice over (a named rotor
     * and a clock phrase), so its desugared twin is a real second spelling
     * and not a rephrasing of the same characters. This is exit condition 5
     * of the Path A hardening pass, and it is checked rather than argued
     * because "derived from the seal" is exactly the kind of claim that stays
     * true right up until someone reaches for the parse for convenience. */
    const twin = W.desugarCore(W.STARTER_WORLD);
    const sugarFree = await s.sealWithRelations(twin);
    ok("relation/the-sugar-twin-is-a-different-spelling",
       twin !== W.STARTER_WORLD && /rotor=\d/.test(twin),
       `desugaring the starter world produced ${twin === W.STARTER_WORLD
          ? "the same text" : "no explicit rotor lanes"}, so this pair is not ` +
       `testing two spellings and the check below cannot fail`);
    ok("relation/sugar-moves-no-relation-id",
       sugarFree.ok && sugarFree.semanticId === sealed.starter.semanticId &&
       ids(sugarFree) === ids(sealed.starter),
       sugarFree.ok
         ? `the explicit twin sealed to ${sugarFree.semanticId} and derived ` +
           `different relation or revision ids. Sugar is upstream of identity; ` +
           `a derived view that disagrees is reading the source, not the world`
         : `the desugared twin was refused: ${sugarFree.code}`);
  }

  }

  /* -- §D8.8. What the import adapter is allowed to SAY.
   *
   * A V1 edge carries three values. A relation revision has seven fields. So
   * four of them come from somewhere other than the edge, and the honest
   * question about Path A is not whether it round-trips -- D8.7 established
   * that it can round-trip while meaning almost nothing -- but whether it
   * INVENTS anything on the way in.
   *
   * The partition is written out here rather than read off the code, because
   * "what the adapter supplies" is a contract with V2's importer and not an
   * implementation detail. READ fields must equal a value the artifact
   * actually carries. SUPPLIED fields must equal the declared constant, which
   * is in every case the only thing V1 can mean. ABSENT fields must be missing
   * keys, not nulls: a null texture is a claim that the world considered
   * texture and declined, and V1 never considered it.
   *
   * The three sets must exhaust REVISION_FIELDS. A subset check would let an
   * eighth field arrive unclassified, which is the exact shape of the defect
   * D8.7 was written for -- a value the adapter chose, presented as a value
   * the world stated. */
  {
    const READ     = ["kind", "endpoints", "policy"];
    /* RESOLVED, and it is its own category for the reason the row exists.
     * `domain` is neither read off the edge nor a constant of the adapter: it
     * is looked up from the profile the artifact names, through a table §D8
     * owns. 0.1.1 classified it READ and satisfied that by copying
     * `profile_id` into it -- a check that agreed with the implementation
     * because it had been written from the implementation. A profile DECLARES
     * domains; it is not one. */
    const RESOLVED = { domain: (a) => s.PROFILE_DEFAULT_DOMAIN[a.profile_id] };
    /* `texture` moved from ABSENT to SUPPLIED in 0.1.2, and the move is the
     * correction. V1 elides the solid texture the way it elides orientation
     * and the implied ports -- all three are values the frozen schema MEANS
     * and does not spell. Calling the first one absent while restoring the
     * other two was inconsistent, and it deferred half of §D8's texture row to
     * V2 for no reason that survived being written down. */
    const SUPPLIED = { orientation: "directed", texture: "solid",
                       attributes: {} };
    const ABSENT   = [];

    const declared = [...READ, ...Object.keys(RESOLVED),
                      ...Object.keys(SUPPLIED), ...ABSENT];
    const unclassified = s.REVISION_FIELDS.filter((f) => !declared.includes(f));
    const phantom = declared.filter((f) => !s.REVISION_FIELDS.includes(f));

    const wrong = [];
    for (const [name, kern] of Object.entries(sealed)) {
      if (!kern.ok) continue;
      for (const edge of kern.artifact.edges) {
        const rev = s.edgeToRelationRevision(kern.artifact, edge);
        const ports = W.EDGE_PORTS[edge.kind];
        const want = {
          kind: edge.kind,
          endpoints: [{ terminal: `${edge.src}.${ports[0]}`, role: "source" },
                      { terminal: `${edge.dst}.${ports[1]}`, role: "target" }],
          policy: kern.artifact.semantic_policies.rulepack_id,
        };
        for (const [f, resolve] of Object.entries(RESOLVED)) {
          const v = resolve(kern.artifact);
          if (rev[f] !== v)
            wrong.push(`${name}: resolved field '${f}' is ` +
                       `${JSON.stringify(rev[f])}, and the profile declares ` +
                       `${JSON.stringify(v)}`);
          if (rev[f] === kern.artifact.profile_id)
            wrong.push(`${name}: '${f}' holds the profile id itself. A ` +
                       `profile declares domains; it is not one`);
        }
        for (const f of READ) {
          if (W.serializeArtifact(rev[f]) !== W.serializeArtifact(want[f]))
            wrong.push(`${name}: read field '${f}' is ` +
                       `${W.serializeArtifact(rev[f])}, and the artifact says ` +
                       `${W.serializeArtifact(want[f])}`);
        }
        for (const [f, v] of Object.entries(SUPPLIED)) {
          if (W.serializeArtifact(rev[f]) !== W.serializeArtifact(v))
            wrong.push(`${name}: supplied field '${f}' is ` +
                       `${W.serializeArtifact(rev[f])}, not the declared ` +
                       `constant ${W.serializeArtifact(v)}`);
        }
        for (const f of ABSENT) {
          if (f in rev)
            wrong.push(`${name}: '${f}' is present as ` +
                       `${W.serializeArtifact(rev[f])}; V1 records no ${f}, ` +
                       `and a key that is there is a value the world did not say`);
        }
      }
    }

    ok("relation/the-import-supplies-only-declared-constants",
       wrong.length === 0 && unclassified.length === 0 && phantom.length === 0,
       [...new Set(wrong)].slice(0, 4).join("; ") ||
       `the import partition and the revision's field set disagree: ` +
       `${unclassified.length ? `unclassified [${unclassified.join(", ")}]` : ""}` +
       `${phantom.length ? ` classified but absent [${phantom.join(", ")}]` : ""}. ` +
       `An unclassified field is a value V2's importer would have to guess ` +
       `the provenance of.`);
  }

  /* -- §D8.5. Relation identity is world-scoped, and the migration claim.
   *
   * The handoff memo argued this in prose and registered it as awaiting V2.
   * That was one step too cautious. §D8.5's own table says re-sealing moves
   * `sem-`, and §D8.1 mints the relation id from the world id -- so re-authoring
   * ANY V1 world produces exactly the break V2 will produce, at a smaller
   * scale, inside the frozen corpus. The law is therefore testable now, and
   * V2 becomes one more instance of it rather than the first.
   *
   * Two halves, and only one of them runs. The half that runs is world
   * SCOPING: two sealed worlds cannot mint the same relation id, because the
   * world id is in the preimage. The half that does not run is authored NAMES
   * -- `named-initial` is refused for want of a surface, so "the same NAME in
   * two worlds" cannot be written down at all. That row stays `awaiting`, and
   * this one is added beside it rather than in place of it. */
  if (s.deriveLegacyEdgeCorrespondence && s.RELATION_IMPORTED_FIELDS) {
    const reseal = await s.sealWithRelations(
      W.STARTER_WORLD.replace("every 2", "every 3"));

    const keys = (k) => k.derived.relations
      .map((r) => W.serializeArtifact({ kind: r.allocation.kind,
                                        src: r.allocation.src,
                                        dst: r.allocation.dst })).sort();
    /* Guard first. Everything below is a claim about a PAIR of worlds that
     * share their edge keys and differ in their seal. If the edit failed to
     * move `sem-`, or moved an edge, the checks after it are comparing
     * something else and would pass for the wrong reason. */
    ok("relation/migration/the-reseal-pair-is-two-worlds",
       reseal.ok && reseal.semanticId !== sealed.starter.semanticId &&
       W.serializeArtifact(keys(reseal)) ===
         W.serializeArtifact(keys(sealed.starter)),
       !reseal.ok ? `the re-sealed world was refused: ${reseal.code}`
       : reseal.semanticId === sealed.starter.semanticId
         ? `re-authoring the starter world did not move its sem- id, so this ` +
           `pair is not a re-seal and the checks below cannot fail`
         : `the re-sealed world has different edge keys, so the pair is not ` +
           `testing scope -- it is testing two different topologies`);

    /* The scoping law itself already runs, one block up, against the two
     * independently pinned fixtures -- `relation/relation-id-is-world-scoped`.
     * It is not restated here. What follows is the half of §D8.5 that had no
     * check: what a re-seal does to those ids, and what is owed when it
     * happens.
     *
     * The correspondence: derivable, and loud about what it cannot pair. */
    const across = await s.deriveLegacyEdgeCorrespondence(sealed.starter, reseal);

    ok("relation/migration/correspondence-pairs-every-surviving-relation",
       across.pairs.length === sealed.starter.artifact.edges.length &&
       across.dropped.length === 0 && across.added.length === 0,
       `the re-seal correspondence reported ${across.pairs.length} pairs, ` +
       `${across.dropped.length} dropped and ${across.added.length} added ` +
       `across two worlds with identical edge keys. Every relation survived ` +
       `this edit; a map that says otherwise is describing a topology change ` +
       `that did not happen.`);

    ok("relation/migration/identity-is-not-preserved-across-a-reseal",
       across.identityPreserved === false &&
       across.pairs.every((r) => r.from_relation !== r.to_relation),
       `re-sealing preserved ${across.pairs.filter(
          (r) => r.from_relation === r.to_relation).length} relation id(s). ` +
       `§D8.5 says a relation id is meaningful relative to its world and only ` +
       `relative to it; an id that survives a re-seal is claiming a continuity ` +
       `no migration asserted.`);

    /* -- and the guard that keeps the check above from being vacuous. If the
     * correspondence simply never paired equal ids, the line above would pass
     * for a module that was broken in the other direction. */
    const itself =
      await s.deriveLegacyEdgeCorrespondence(sealed.starter, sealed.starter);
    ok("relation/migration/a-world-corresponds-to-itself-exactly",
       itself.identityPreserved === true &&
       itself.pairs.length === sealed.starter.artifact.edges.length &&
       itself.pairs.every((r) => r.from_relation === r.to_relation),
       `a world mapped against itself did not preserve every id. World scope ` +
       `is one sealed version, so the identity migration must be the identity ` +
       `map -- and if it is not, the check above is passing because nothing ` +
       `ever pairs.`);

    /* -- the same law where there is nothing to pair.
     *
     * 0.1.1 defined `identityPreserved` as "every pair is equal AND there is
     * at least one pair", so an empty world compared with ITSELF reported that
     * identity was not preserved -- a world failing to be itself. The summary
     * is a statement about world identity, and a summary computed from the
     * pairs was answering a different question that happens to agree whenever
     * there is at least one relation. */
    const emptyToItself =
      await s.deriveLegacyEdgeCorrespondence(emptyWorld, emptyWorld);
    const emptyToStarter =
      await s.deriveLegacyEdgeCorrespondence(emptyWorld, sealed.starter);
    ok("relation/migration/an-empty-world-still-corresponds-to-itself",
       emptyWorld.ok && emptyToItself.identityPreserved === true &&
       emptyToItself.pairs.length === 0 &&
       emptyToStarter.identityPreserved === false &&
       emptyToStarter.pairs.length === 0 &&
       emptyToStarter.added.length === sealed.starter.artifact.edges.length,
       `an empty world compared with itself reported identityPreserved=` +
       `${emptyToItself.identityPreserved}. §D8.5 scopes a relation id to a ` +
       `sealed world; whether that world has any relations is a different ` +
       `question, and a summary that conflates them says a world with no ` +
       `edges is not itself.`);

    /* -- silence is not continuity. §D8.5's phrase, as a measurement. */
    const shrink =
      await s.deriveLegacyEdgeCorrespondence(sealed.demo, sealed.starter);
    const grow =
      await s.deriveLegacyEdgeCorrespondence(sealed.starter, sealed.demo);
    const gone = W.serializeArtifact(
      { kind: "SignalWire", src: "p1", dst: "d0" });
    ok("relation/migration/a-relation-with-no-counterpart-is-not-paired",
       shrink.dropped.length === 1 && shrink.dropped[0].key === gone &&
       shrink.added.length === 0 &&
       grow.added.length === 1 && grow.added[0].key === gone &&
       grow.dropped.length === 0 &&
       shrink.pairs.length === 3 && grow.pairs.length === 3,
       `the demo world's fourth edge was reported as ` +
       `${shrink.dropped.length} dropped / ${grow.added.length} added instead ` +
       `of exactly one each way. A migration that pairs a relation which ` +
       `stopped existing is the failure §D8.5 names: silence is not continuity.`);

    /* -- A PAIRING IS NOT AN IMPORT FACT, and the distinction is the one thing
     *    in this block that is not about arithmetic.
     *
     * 0.1.1 emitted records typed `RelationImported` straight out of the
     * derivation, and argued that because they were derivable they could not
     * be maintained wrongly. Only the CANDIDATE pairing is derivable. Two
     * independently authored worlds can share V1 edge keys without either
     * having been imported from the other, and no amount of reading the two
     * artifacts can tell you whether a migration happened -- neither artifact
     * records history. So the derivation reports structure, an accepted
     * migration operation emits facts, and a checker joins them.
     *
     * The starter world and the demo world are exactly that adversarial case:
     * they share three edge keys and neither was migrated from the other. */
    const paired = await s.deriveLegacyEdgeCorrespondence(sealed.starter,
                                                          sealed.demo);
    const candidates = s.candidateImportedFacts(paired);
    let honest = null, invented = null, crossed = null;
    try { s.checkRelationImported(candidates, paired); } catch (e) {
      honest = e.code || String(e);
    }
    try {
      s.checkRelationImported([{ ...candidates[0], to_relation: candidates[1]
        ? candidates[1].to_relation : "rel-" + "0".repeat(64) }], paired);
      invented = "accepted";
    } catch (e) { invented = e.code; }
    try {
      s.checkRelationImported(
        s.candidateImportedFacts(itself), paired);
      crossed = "accepted";
    } catch (e) { crossed = e.code; }

    ok("relation/migration/a-pairing-is-not-an-import-fact",
       typeof s.deriveCorrespondence === "undefined" &&
       Array.isArray(paired.pairs) && !("imported" in paired) &&
       paired.pairs.length === 3 &&
       paired.pairs.every((p) =>
         W.serializeArtifact(Object.keys(p).sort()) ===
         W.serializeArtifact(["from_relation", "key", "to_relation"])),
       `the structural derivation still hands back records typed as import ` +
       `facts. Sharing an edge key is evidence two worlds have the same ` +
       `shape; it is not evidence one came from the other, and a derivation ` +
       `cannot see history that neither artifact records.`);

    ok("relation/migration/an-unbacked-import-fact-is-refused",
       honest === null && invented === "WRL_UNVERIFIED_IMPORT" &&
       crossed === "WRL_UNVERIFIED_IMPORT" && candidates.length === 3,
       honest !== null
         ? `the checker refused its own candidates as ${honest}, so it ` +
           `cannot verify anything`
         : `a rewired fact was ${invented} and a fact from another world pair ` +
           `was ${crossed}. A migration claim is asserted rather than derived, ` +
           `which makes it the one record here that CAN be maintained wrongly ` +
           `-- so §D8.5 asks for a checker, and this is it.`);

    /* -- DERIVABLE. The two properties that make a RelationImported a fact
     *    rather than a note, checked separately because they fail separately.
     *
     * First: every id in the map equals what each side derives on its own,
     * from its own sealed artifact. Nothing in the correspondence is authored,
     * so nothing in it can be maintained wrongly. */
    const lhs = await s.deriveRelations(sealed.starter.artifact,
                                        sealed.starter.semanticId);
    const rhs = await s.deriveRelations(reseal.artifact, reseal.semanticId);
    const known = (side) => new Set(side.relations.map((r) => r.relation_id));
    ok("relation/migration/the-correspondence-is-derived-not-authored",
       across.pairs.every((r) => known(lhs).has(r.from_relation) &&
                                 known(rhs).has(r.to_relation)) &&
       across.from_world === sealed.starter.semanticId &&
       across.to_world === reseal.semanticId,
       `the correspondence names a relation id that neither world derives on ` +
       `its own. Every value in the map must be recomputable from the two ` +
       `sealed artifacts; one that is not is authored, and an authored map is ` +
       `one that can be maintained wrongly.`);

    /* Second: OUTSIDE THE VALUE. Recording an import must move nothing. The
     * strong form is the one worth checking -- not merely that the artifacts
     * are unmutated, but that the `to` world derives the identical ids when it
     * has never heard of the `from` world. That is what "no id enters the
     * other world's preimage" means operationally, and it is the property that
     * would break under the tempting alternative of carrying the V1 world id
     * into the V2 preimage to keep ids stable. */
    const innocent = await s.deriveRelations(reseal.artifact, reseal.semanticId);
    const reReseal = await W.sealWorld(
      W.STARTER_WORLD.replace("every 2", "every 3"));
    ok("relation/migration/recording-an-import-moves-no-id",
       W.serializeArtifact(innocent.relations.map((r) => r.relation_id)) ===
         W.serializeArtifact(rhs.relations.map((r) => r.relation_id)) &&
       reReseal.ok && reReseal.semanticId === reseal.semanticId &&
       reReseal.bytes === reseal.bytes,
       `deriving the imported world in ignorance of the import produced ` +
       `different ids, or the world stopped sealing to ${reseal.semanticId}. ` +
       `A correspondence that changes what it describes is a field, not a ` +
       `fact, and §D8.3 puts provenance on the event rather than in the value.`);

    const facts = s.candidateImportedFacts(across);
    ok("relation/migration/the-fact-has-exactly-four-fields",
       facts.length > 0 && facts.every((r) =>
         W.serializeArtifact(Object.keys(r).sort()) ===
         W.serializeArtifact([...s.RELATION_IMPORTED_FIELDS].sort())),
       `a RelationImported record's fields are not exactly ` +
       `[${s.RELATION_IMPORTED_FIELDS.join(", ")}]. Authority, operation ` +
       `identity and timing belong to the ledger event that carries the fact ` +
       `(§D8.3); a fifth field here would be provenance inside the value.`);
  } else {
    ok("relation/migration/correspondence-is-exported", false,
       `relation-identity.js exports no deriveLegacyEdgeCorrespondence or ` +
       `RELATION_IMPORTED_FIELDS, so §D8.5's migration battery could not run. ` +
       `Its checks are not passing -- they did not execute.`);
  }

  /* -- the derived view has a CONSUMER, which is a property of the site and
   *    not of the module.
   *
   * A derivation nothing renders is a derivation nobody has to keep correct.
   * The playground is the real consumer: it seals with the frozen spine, then
   * derives from the artifact that seal produced.
   *
   * The second half is the part that is easy to lose. `sealWithRelations` has
   * a SHARPER answer for a doubled edge -- WRL_DUPLICATE_RELATION_KEY, where
   * the spine says WRL_CONTROLLER_CONFLICT -- and a page that adopted the
   * derived view by switching entry points would silently change V1's frozen
   * error surface for every visitor. Better diagnostics are a reason to
   * propose a spine version, not a reason to ship a different one quietly. So
   * the page is required to import the derivation and required NOT to import
   * the verdict. */
  {
    const page = readFileSync(join(ROOT, "playground.html"), "utf8");
    const importsKernel = /import\s+\*\s+as\s+\w+\s+from\s+["']\.\/relation-identity\.js["']/
      .test(page);
    const derives = page.includes("deriveRelations(");
    const rendersRoles = page.includes('id="out-relations"');
    ok("relation/the-derived-view-has-a-consumer",
       importsKernel && derives && rendersRoles,
       `playground.html ${importsKernel ? "imports" : "does not import"} the ` +
       `kernel, ${derives ? "calls" : "never calls"} deriveRelations, and ` +
       `${rendersRoles ? "has" : "has no"} panel to put it in. A derived view ` +
       `with no consumer is a view no one finds out is wrong.`);

    /* The same requirement applied to the newer derivation, for the same
     * reason. §D8.5's law is the one on this page most likely to be nodded at
     * and not believed -- "of course ids move when you re-seal" reads as a
     * technicality until you watch every id below change because you edited a
     * rotor lane. So the correspondence is rendered against the pinned fixture
     * rather than described. */
    ok("relation/migration/the-correspondence-has-a-consumer",
       page.includes("deriveLegacyEdgeCorrespondence(") &&
       page.includes('id="out-corr"'),
       `playground.html ${page.includes("deriveLegacyEdgeCorrespondence(")
          ? "has no panel for" : "never calls"} the correspondence. §D8.5's ` +
       `map is the one derivation on this page whose whole point is that a ` +
       `reader disbelieves it until they see it move.`);

    ok("relation/the-consumer-keeps-the-frozen-verdict",
       !page.includes("sealWithRelations") && page.includes("W.sealWorld("),
       `playground.html ${page.includes("sealWithRelations")
          ? "reaches for sealWithRelations" : "no longer calls W.sealWorld"}. ` +
       `The page's verdict is V1's, including the controller-count answer to ` +
       `a doubled edge; the derived layer may describe a sealed world and may ` +
       `not decide whether it sealed.`);
  }

  /* -- and one property of the FILES, not the values.
   *
   * This suite runs in Node, so it can only ever prove that the kernel works
   * in Node -- yet the entire premise of this site is that its spine runs in a
   * browser, unbundled, straight off the served path. That claim had no check
   * at all, for `wrl.js` either: it was true because both modules happened to
   * be written without Node built-ins, and "happens to be" is the state every
   * other defect on this page started from. One `import { createHash } from
   * "node:crypto"` -- the obvious way to write a digest -- would leave all 741
   * checks green and every page on the site broken.
   *
   * So the module graph is walked from each shipped entry point and every
   * import is required to be relative. The graph is walked rather than the two
   * files scanned, because the failure would arrive in whatever the kernel
   * imports NEXT, not in what it imports today. */
  {
    const seen = new Set();
    const offenders = [];
    const walk = (rel) => {
      if (seen.has(rel)) return;
      seen.add(rel);
      const src = readFileSync(join(ROOT, rel), "utf8");
      for (const m of src.matchAll(/\bfrom\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']/g)) {
        const spec = m[1] ?? m[2];
        if (spec.startsWith("./") || spec.startsWith("../")) walk(spec.replace(/^\.\//, ""));
        else offenders.push(`${rel} imports "${spec}"`);
      }
      /* the CommonJS globals a bundler would paper over and a browser will not */
      for (const g of ["require(", "__dirname", "__filename", "process.env"])
        if (src.includes(g)) offenders.push(`${rel} uses ${g}`);
    };
    for (const entry of ["wrl.js", "relation-identity.js"]) walk(entry);

    ok("portability/shipped-modules-load-in-a-browser",
       seen.size >= 2 && offenders.length === 0,
       offenders.length
         ? offenders.join("; ") + `. A served module may only import other ` +
           `served modules; anything else is a page that 404s or throws on load.`
         : `the module graph walk reached ${seen.size} file(s), so it did not ` +
           `reach both entry points`);
  }
}

/* ======================================= 21b. the part boundary wears a badge
 *
 * Part I is normative and Part II is draft, and the page says so in two
 * vocabularies: `<span class="frozen">` for a settled status, `<span
 * class="draft">` for an unsettled one. Nothing enforced the boundary between
 * them, and it took about ten minutes to breach: §D8's implementation note
 * was given a `frozen` badge reading EXECUTABLE, because the code really does
 * run. Rendered, it landed at the end of a column of FROZEN / NORMATIVE /
 * APPROVED and read as a peer of them.
 *
 * It is not one. Running is a fact about an implementation; frozen is a claim
 * about a specification, and §D8 is a draft whose design is still being
 * argued. That is the register's own two-axis lesson arriving in a second
 * place -- surface availability and executable verification are independent
 * there, and settledness and executability are independent here. The badge
 * vocabulary had quietly collapsed them, so a section could earn a
 * settled-looking mark by shipping code. */
{
  const spec = readFileSync(join(ROOT, "spec.html"), "utf8");
  const boundary = spec.indexOf('<h2 id="part2"');
  ok("parts/boundary-is-locatable", boundary > 0,
     "spec.html has no #part2 heading, so Part I and Part II cannot be told apart");

  if (boundary > 0) {
    const partTwo = spec.slice(boundary);
    const badged = [...partTwo.matchAll(/<h([234])\s+id="([^"]+)"[^>]*>([^]*?)<\/h\1>/g)]
      .filter((m) => /<span class="frozen">/.test(m[3]))
      .map((m) => m[2]);
    ok("parts/draft-sections-wear-no-settled-badge", badged.length === 0,
       `Part II section(s) [${badged.join(", ")}] carry a class="frozen" ` +
       `status badge. Part II is draft; a badge in the settled vocabulary ` +
       `there is read as a claim the section has not earned. Use ` +
       `class="draft" -- an implementation that runs does not settle the ` +
       `design it implements.`);
  }
}

/* ===================================================== 22. the identity stack
 *
 * The stack block names every identity these sections mint, and the sentence
 * above it counts them. That sentence went stale the moment a seventh name was
 * added -- it still read "Six", and no check noticed, because a count in prose
 * is invisible to every instrument on this page. Reviewers noticed instead,
 * which is the expensive way to find it.
 *
 * A number stated in prose about a block directly beneath it is exactly the
 * kind of claim that can be held against the block. */
{
  const spec = readFileSync(join(ROOT, "spec.html"), "utf8");

  const NUMBER = new Map([
    ["one", 1], ["two", 2], ["three", 3], ["four", 4], ["five", 5],
    ["six", 6], ["seven", 7], ["eight", 8], ["nine", 9], ["ten", 10],
  ]);

  const block = spec.match(/<pre class="code" data-identity-stack><code>(.*?)<\/code><\/pre>/s);
  ok("stack/block-is-present", !!block,
     `no <pre data-identity-stack> block in spec.html. The identity stack is ` +
     `the one place the seven names are gathered; without it each rule ` +
     `introduces a name in isolation and nothing says how they compose.`);

  if (block) {
    /* every non-blank line names one layer, and may cite a frozen section it
     * was borrowed from rather than minted in */
    const layers = block[1].trim().split("\n")
      .map((l) => l.trim()).filter(Boolean)
      .map((l) => ({
        name: l.split(/\s{2,}/)[0],
        frozenIn: (l.match(/;\s*(§\S+)\s+frozen\s*$/) || [])[1],
      }));
    const names = layers.map((l) => l.name);
    const borrowed = layers.filter((l) => l.frozenIn);
    const minted = layers.filter((l) => !l.frozenIn);

    const unique = new Set(names);
    ok("stack/every-name-appears-once", unique.size === names.length,
       `the identity stack lists a name twice. Each line is supposed to ` +
       `answer a question none of the others can.`);

    /* every name has to be one this page really uses, not a summary that
     * quietly renames what the rules declared. This is the check that found
     * AcceptanceReceipt: a CamelCase record coined in the summary for
     * something §8 already owns and spells differently. */
    const undeclared = names.filter(
      (n) => !new RegExp(`\\b${n}\\b`).test(spec.slice(0, block.index)));
    ok("stack/names-were-introduced-before-the-stack", undeclared.length === 0,
       `identity stack name(s) [${undeclared.join(", ")}] appear nowhere ` +
       `earlier in spec.html. The stack is a summary of what the sections ` +
       `established; a name that debuts in the summary was never argued for.`);

    /* the two counts in the prose, held against the block. Both are needed:
     * the total alone would have been satisfied by writing "seven", which is
     * the repair that would have hidden the real defect. */
    const lead = spec.slice(0, block.index);
    const newCount = lead.match(/only <b>(\w+)<\/b> of them are new/);
    const frozenCount = lead.match(/other\s*\n?<b>(\w+)<\/b> are frozen/);
    ok("stack/prose-states-both-counts",
       !!newCount && NUMBER.has(newCount[1].toLowerCase()) &&
       !!frozenCount && NUMBER.has(frozenCount[1].toLowerCase()),
       `the sentence above the identity stack no longer states both a count ` +
       `of new layers and a count of frozen ones. It once stated a single ` +
       `number, and that number was wrong for four rounds because nothing ` +
       `could read it.`);

    if (newCount && frozenCount &&
        NUMBER.has(newCount[1].toLowerCase()) &&
        NUMBER.has(frozenCount[1].toLowerCase())) {
      const claimedNew = NUMBER.get(newCount[1].toLowerCase());
      const claimedFrozen = NUMBER.get(frozenCount[1].toLowerCase());
      ok("stack/new-count-matches-the-block", claimedNew === minted.length,
         `the prose says ${newCount[1]} (${claimedNew}) layers are new; the ` +
         `block marks ${minted.length} as minted here ` +
         `[${minted.map((l) => l.name).join(", ")}].`);
      ok("stack/frozen-count-matches-the-block",
         claimedFrozen === borrowed.length,
         `the prose says ${frozenCount[1]} (${claimedFrozen}) layers are ` +
         `frozen; the block marks ${borrowed.length} ` +
         `[${borrowed.map((l) => `${l.name} ${l.frozenIn}`).join(", ")}]. ` +
         `Claiming to have minted a frozen layer is the draft asserting ` +
         `authority it does not have.`);
    }

    /* a borrowed layer has to cite a section this page really froze. Without
     * this, "frozen" is a word a draft can write beside anything it would
     * rather not have to defend.
     *
     * The badge class is NOT the test. `class="frozen"` is the wrapper for
     * every status badge on this page, and it also carries "corrected",
     * "normative", "recorded" and "status" -- so keying on the class would
     * have accepted §14 and §16 as frozen. The badge's own text is the claim. */
    for (const l of borrowed) {
      const num = l.frozenIn.replace("§", "");
      const heading = spec.match(new RegExp(`<h2 id="s${num}">[^]*?</h2>`));
      const badge = heading &&
        (heading[0].match(/<span class="frozen">([^<]*)</) || [])[1];
      ok(`stack/${l.name.replace(/\s+/g, "-")}-cites-a-frozen-section`,
         !!badge && /^frozen\b/.test(badge.trim()),
         `the identity stack says "${l.name}" is frozen in ${l.frozenIn}, but ` +
         `spec.html ${!heading ? `has no ${l.frozenIn} heading`
            : badge ? `badges ${l.frozenIn} "${badge.trim()}", which is not frozen`
                    : `gives ${l.frozenIn} no status badge at all`}. ` +
         `A draft citing a frozen authority has to be citing a real one.`);
    }
  }
}

/* ============================================ 23. the pending-battery register
 *
 * Most of §D8 and §D9 cannot be executed yet -- and an unexecutable rule is the
 * one kind this page has repeatedly shown it will reinterpret rather than break
 * loudly. The register names the properties that would settle each rule. These
 * checks keep it from becoming decoration: a row has to name a rule that is
 * really stated, names have to be unique, and a row that claims to run has to
 * name a check that really ran.
 *
 * A row carries two INDEPENDENT axes, because "not yet written" and "not yet
 * possible" are different facts, and collapsing them misdirects the next
 * milestone:
 *
 *   data-pending-stage    which layer the property lives at
 *   data-pending-status   whether a check for it runs today
 *
 * Every row once read `awaiting-surface`, one word carrying both -- which
 * asserted that nothing here was testable until syntax landed. That is false
 * for the whole `model` layer, whose identities are determined by structure
 * that is already sealed.
 *
 * This block is last on purpose. `ran` is only complete once every other check
 * has been called, so an earlier placement would let a genuine executable claim
 * read as a phantom. */
{
  const spec = readFileSync(join(ROOT, "spec.html"), "utf8");

  /* a ratchet, not a threshold. Model-layer properties are the ones nothing
   * external blocks, so the only reason one stays awaiting is that it has not
   * been written. Settling one lowers this number; nothing else may raise it
   * without a deliberate edit here.
   *
   * It reached zero when the relation identity kernel landed, which is the
   * useful state: a NEW model-layer row now has to arrive executable. That is
   * not severity for its own sake. The model layer is defined as the layer
   * with no external blocker, so a model row that says `awaiting` is saying
   * "not written yet" in language that sounds like "not possible yet" -- and
   * that substitution is the thing this whole register exists to prevent.
   *
   * THE NAME CARRIES ITS SCOPE, and the scope is narrower than the old name
   * implied. The cap read zero, and green, while the kernel's endpoint model
   * disagreed with §D8 on four separate counts -- roles held port names,
   * endpoint order was semantic, terminals were not unique, orientation
   * admitted an invented value. None of those were rows, so the ratchet had
   * nothing to catch them with. It was doing its job exactly: enforcing zero
   * debt among REGISTERED model properties. The repair for that is not a
   * looser cap, it is a wider census -- §D8.7's rows now register the endpoint
   * obligations, and this constant will earn the shorter name back when a
   * census proves every applicable model obligation is registered rather than
   * merely every registered one settled. */
  const REGISTERED_MODEL_DEBT_CAP = 0;

  /* the whole row, not just its open tag: the printed layer cell has to be
   * readable, so that what a reader sees can be held against what the suite
   * reads */
  const rows = [...spec.matchAll(/<tr\b([^>]*data-pending-law[^>]*)>(.*?)<\/tr>/gs)]
    .map((m) => ({ attrs: m[1], body: m[2] }))
    .map(({ attrs, body }) => ({
      law: (attrs.match(/data-pending-law="([^"]*)"/) || [])[1],
      rule: (attrs.match(/data-pending-for="([^"]*)"/) || [])[1],
      status: (attrs.match(/data-pending-status="([^"]*)"/) || [])[1],
      stage: (attrs.match(/data-pending-stage="([^"]*)"/) || [])[1],
      check: (attrs.match(/data-pending-check="([^"]*)"/) || [])[1],
      printed: ((body.match(/<td class="stage">(.*?)<\/td>/s) || [])[1] || "")
        .replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim(),
    }));

  ok("pending/register-is-not-vacuous", rows.length > 0,
     `no rows carry data-pending-law. Either the register was deleted or this ` +
     `reader stopped matching it; both leave every unexecutable draft rule ` +
     `with no stated way to ever settle it.`);

  const dupes = rows.map((r) => r.law)
    .filter((l, i, a) => a.indexOf(l) !== i);
  ok("pending/property-names-are-unique", dupes.length === 0,
     `pending propert(ies) [${[...new Set(dupes)].join(", ")}] are registered ` +
     `more than once. A name is an identity here too.`);

  /* the rules the spec really states -- same source the rule index uses, so
   * the two cannot drift apart */
  const statedRules = new Set(
    [...spec.matchAll(/<b>Draft rule (D\d+\.\d+)\b/g)].map((m) => m[1]));

  const phantom = rows.filter((r) => !statedRules.has(r.rule));
  ok("pending/properties-name-a-stated-rule", phantom.length === 0,
     `pending propert(ies) [${phantom.map((r) => `${r.law} -> ${r.rule}`)
       .join(", ")}] name a rule spec.html does not state. A property that ` +
     `falsifies nothing is a wish.`);

  const KNOWN_STATUS = new Set(["awaiting", "executable"]);
  const badStatus = rows.filter((r) => !KNOWN_STATUS.has(r.status));
  ok("pending/statuses-are-known", badStatus.length === 0,
     `pending propert(ies) [${badStatus.map((r) => `${r.law}=${r.status}`)
       .join(", ")}] declare a status outside ` +
     `{${[...KNOWN_STATUS].join(", ")}}. An invented status is one nobody ` +
     `has to honour.`);

  /* the second axis. A missing stage fails here too, because `undefined` is
   * not in the set -- a row with no declared layer is a row that can drift
   * into whichever layer is convenient later. */
  const KNOWN_STAGE = new Set(["model", "surface", "runtime", "film"]);
  const badStage = rows.filter((r) => !KNOWN_STAGE.has(r.stage));
  ok("pending/stages-are-known", badStage.length === 0,
     `pending propert(ies) [${badStage.map(
       (r) => `${r.law}=${r.stage === undefined ? "(none)" : r.stage}`)
       .join(", ")}] declare a stage outside ` +
     `{${[...KNOWN_STAGE].join(", ")}}. The stage is what says whether a ` +
     `property is blocked on syntax or merely unwritten, and the two need ` +
     `very different next moves.`);

  /* a `model` property is provable from sealed structure alone, so it can
   * never be excused by the absence of a surface. This is the check that keeps
   * the axis split honest rather than decorative: without it, `model` would
   * just be a nicer-sounding label for the same indefinite wait. */
  const modelDebt = rows.filter(
    (r) => r.stage === "model" && r.status === "awaiting");
  ok("pending/model-debt-does-not-grow",
     modelDebt.length <= REGISTERED_MODEL_DEBT_CAP,
     `${modelDebt.length} model-layer propert(ies) are still awaiting ` +
     `[${modelDebt.map((r) => r.law).join(", ")}], above the recorded cap of ` +
     `${REGISTERED_MODEL_DEBT_CAP}. A model property needs no new syntax to settle, so a ` +
     `growing count here is not a blocked queue, it is a deferral. Lower the ` +
     `cap when you settle one; raising it is the change worth arguing about.`);

  /* THE row that matters. A register is only worth writing if it cannot mark
   * itself green, and "executable" is the claim that would be tempting to make
   * early -- when a surface half-lands and a property looks nearly covered. */
  const unbacked = rows.filter(
    (r) => r.status === "executable" && !ran.has(r.check));
  ok("pending/executable-properties-name-a-check-that-ran", unbacked.length === 0,
     `pending propert(ies) [${unbacked.map((r) => `${r.law} -> ` +
       `${r.check || "(no data-pending-check)"}`).join(", ")}] are marked ` +
     `executable but name no check that ran in this suite. That is the ` +
     `register claiming coverage it does not have, which is the one failure ` +
     `mode a register introduces that the page did not already have.`);

  /* and the converse: a row that names a live check has no business still
   * claiming it is waiting for a surface */
  const understated = rows.filter(
    (r) => r.status === "awaiting" && r.check && ran.has(r.check));
  ok("pending/awaiting-properties-name-no-live-check", understated.length === 0,
     `pending propert(ies) [${understated.map((r) => r.law).join(", ")}] say ` +
     `they are awaiting while naming a check that already runs. The register ` +
     `would then understate coverage, and nobody re-reads a row that looks ` +
     `unfinished.`);

  /* the table is read by two audiences and only one of them parses attributes.
   * If the printed cell and the machine-readable pair ever disagree, the page
   * is telling a reader something the suite is not enforcing -- which is the
   * shape of every defect the last three rounds turned up. */
  const misprinted = rows.filter(
    (r) => r.printed !== `${r.stage} · ${r.status}`);
  ok("pending/printed-layer-matches-attributes", misprinted.length === 0,
     `pending propert(ies) [${misprinted.map(
       (r) => `${r.law}: prints "${r.printed}", declares ` +
              `"${r.stage} · ${r.status}"`).join("; ")}] print a layer and ` +
     `status that disagree with their attributes. A reader trusts the cell; ` +
     `the suite trusts the attribute; only one of them can be right.`);

  /* every draft rule minted in the identity sections has to be reachable from
   * the register. This is the census direction -- a subset check cannot catch
   * a rule that shipped with no test story at all. */
  const IDENTITY_RULES = [...statedRules].filter((r) => /^D[89]\./.test(r));
  const covered = new Set(rows.map((r) => r.rule));
  const untested = IDENTITY_RULES.filter((r) => !covered.has(r));
  ok("pending/every-identity-rule-has-a-property", untested.length === 0,
     `identity rule(s) [${untested.join(", ")}] are stated but no pending ` +
     `property names them, so nothing on this page says what would settle ` +
     `them. Draft rules without a falsifier are the ones that get ` +
     `reinterpreted rather than broken.`);
}

/* ==================================================================== report */

console.log(`\n  ${pass} passed, ${fail} failed ` +
            `(${annotated} annotated doc blocks of ${blocks} swept, ` +
            `${cited.size}/${REGISTRY.size} capabilities cited)`);
console.log(`  not-current: ${notCurrentWorlds} complete world(s), ` +
            `${notCurrentFragments} fragment(s) -- a fragment's non-acceptance ` +
            `is weak evidence, and needs a fixture context to become a positive ` +
            `test when its capability ships\n`);
if (fail) {
  for (const f of failures) console.log(`  FAIL  ${f}`);
  console.log("");
  process.exit(1);
}

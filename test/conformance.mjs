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

    /* one mutation per field, each the smallest change that is still a change */
    const MUTATE = {
      domain:      (r) => ({ ...r, domain: "other.profile.v1" }),
      kind:        (r) => ({ ...r, kind: "SocketControl",
                             endpoints: [{ terminal: r.endpoints[0].terminal, role: "socket" },
                                         { terminal: r.endpoints[1].terminal, role: "pose" }] }),
      endpoints:   (r) => ({ ...r, endpoints: [{ ...r.endpoints[0], terminal: "zz" },
                                               r.endpoints[1]] }),
      orientation: (r) => ({ ...r, orientation: "undirected" }),
      texture:     (r) => ({ ...r, texture: "braided" }),
      attributes:  (r) => ({ ...r, attributes: { weight: 1 } }),
      policy:      (r) => ({ ...r, policy: "other.rules.v1" }),
    };

    /* the declared partition. Changing it is a semantic decision and should
     * read like one -- which is why it is written out here rather than
     * inferred from whatever the code happens to do today. */
    const NAMES        = ["kind", "endpoints"];
    const FREE         = ["domain", "policy"];
    const UNPROJECTED  = ["orientation", "texture", "attributes"];

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

  /* -- the two allocation variants that have no V1 source. §D8's preimage
   *    block names three, and a module that could mint all three would be
   *    quietly asserting a surface and a grant machinery that do not exist. */
  {
    const unmintable = s.ALLOCATION_VARIANTS.filter(
      (v) => !s.MINTABLE_VARIANTS.includes(v));
    const results = [];
    for (const variant of unmintable) {
      try {
        await s.relationIdFromAllocation({ variant, world_id: sealed.starter.semanticId,
                                           relation_name: "n", grant_id: "g",
                                           local_counter: 0 });
        results.push(`${variant} minted`);
      } catch (e) {
        if (e.code !== "WRL_UNWRITABLE_ALLOCATION")
          results.push(`${variant} refused as ${e.code}`);
      }
    }
    ok("relation/unwritable-variants-are-refused",
       unmintable.length === 2 && results.length === 0,
       results.length ? results.join("; ")
         : `expected exactly two unmintable variants, found ${unmintable.length}`);
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
    const ids = (k) => k.derived.relations.map((r) => r.relation_id).join(",");
    ok("relation/reordering-the-source-moves-nothing",
       other.ok && other.semanticId === sealed.starter.semanticId &&
       ids(other) === ids(sealed.starter),
       other.ok
         ? `a reordered source sealed to ${other.semanticId} and listed its ` +
           `relations differently; a derivation that reads writing order is ` +
           `not a derivation from the seal`
         : `the reordered source was refused: ${other.code}`);
  }

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
   * that substitution is the thing this whole register exists to prevent. */
  const MODEL_DEBT_CAP = 0;

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
  ok("pending/model-debt-does-not-grow", modelDebt.length <= MODEL_DEBT_CAP,
     `${modelDebt.length} model-layer propert(ies) are still awaiting ` +
     `[${modelDebt.map((r) => r.law).join(", ")}], above the recorded cap of ` +
     `${MODEL_DEBT_CAP}. A model property needs no new syntax to settle, so a ` +
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

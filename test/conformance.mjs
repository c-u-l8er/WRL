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

  /* EXISTENCE IS NOT IDENTITY -- the same lesson as `stated-ids-are-unique`,
   * one level down, and learned the same way: by shipping the bug. C.3 gave
   * §D8.18's heading an id §D8.8 already held. The check above asks only
   * whether the anchor is *defined*, so it passed; so did every register row
   * naming it. A sidebar entry and nine rows silently resolved to a section
   * about something else, and the suite said 877 passed. A browser resolves a
   * repeated id to the first one, which means the *older* section wins and the
   * new writing is the part that disappears -- the failure mode is invisible
   * to whoever just wrote the thing being hidden. */
  const anchors = [...spec.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
  const collided = dupes(anchors);
  ok("rules/anchors-are-unique", collided.length === 0,
     `spec.html defines anchor(s) [${collided.join(", ")}] more than once. An ` +
     `anchor is an identity, and a browser resolves a repeat to the first ` +
     `definition -- so every later citation lands on the earlier section and ` +
     `nothing anywhere reports it. Rename the newer one.`);
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

/* The playground's examples are the only sources on this site that a reader
 * actually EXECUTES, and each one is a claim: the button says "An illegal
 * rewire", so that source had better be rejected, and rejected for that reason.
 * A demo that quietly seals is worse than no demo, because the reader concludes
 * the language does not check the thing the button just promised it checks.
 * These live in a JS object literal rather than a `<pre>`, so the block sweep
 * above cannot see them; they get their own pass.
 *
 * Every example goes through `admitWorldSource`, which is THE PAGE'S OWN
 * DISPATCH (§D8.17) rather than a second copy of it. That matters twice over:
 * the V2 examples could not be checked by `sealWorld` at all, and — more to
 * the point — a sweep that chose the parser itself could not catch the page
 * choosing a different one. The expectation table says only what each button
 * promises; which parser reads it is the module's answer, checked here. */
{
  const text = readFileSync(join(ROOT, "playground.html"), "utf8");
  const v2pg = await import("../relation-v2.js");
  const open = text.indexOf("const EXAMPLES = {");
  ok("playground/examples-found", open !== -1,
     "could not locate the EXAMPLES table in playground.html");

  if (open !== -1) {
    const close = text.indexOf("\n};", open);
    const literal = text.slice(open + "const EXAMPLES = ".length, close + 2);
    /* evaluated with the module passed in, because two entries are the module's
       own exported fixtures rather than inline text */
    const EX = new Function("W", "return " + literal)(W);

    /* what each button PROMISES, and which family the SOURCE puts it in. An
       example with no entry here fails: adding a demo to the page is adding a
       claim to the page. */
    const expected = {
      starter:  { family: "v1", seal: W.STARTER_WORLD_SEMANTIC_ID },
      demo:     { family: "v1", seal: W.DEMO_WORLD_SEMANTIC_ID },
      /* the twin and the shuffle are the whole argument for canonical bytes:
         different spellings, one id, and it is the pinned fixture's id */
      twin:     { family: "v1", seal: W.DEMO_WORLD_SEMANTIC_ID },
      shuffled: { family: "v1", seal: W.DEMO_WORLD_SEMANTIC_ID },
      repl:     { family: "v1", seal: "sem-769b11b7e47db6485dd49b4da03dc3cf996aecb23a3ce53bd72a2b6c0f00cbe5" },
      empty:    { family: "v1", seal: "sem-b5bdc908d2ce549a46fc8ae95d39c34e1deb245e282075730e5436097433fae6" },
      conflict: { family: "v1", reject: "WRL_CONTROLLER_CONFLICT" },
      scenario: { family: "v1", reject: "WRL_WORLD_SOURCE_HAS_SCENARIO" },
      typo:     { family: "v1", reject: "WRL_SUGAR_MALFORMED" },
      remap:    { family: "v1", reject: "WRL_DUPLICATE_ID" },
      /* IR 2.0. `badir` is the one that matters most: it is a fine V1 world
         with one broken declaration, so a page that fell back would seal it
         and print an id. The family assertion is what says it did not. */
      named:    { family: "v2",
                  seal: "sem-9a491fe3a718d8c7262458812c9c220c0bf4157fc2155616f99bcde44263b019" },
      unnamed:  { family: "v2", reject: "WRL_MISSING_RELATION_NAME" },
      badir:    { family: "v2", reject: "WRL_UNSUPPORTED_IR_VERSION" },
    };

    for (const [name, source] of Object.entries(EX)) {
      const want = expected[name];
      if (!want) {
        ok(`playground/${name}`, false,
           `this example is offered to readers but states no outcome here`);
        continue;
      }
      const src = source.endsWith("\n") ? source : source + "\n";
      const r = await v2pg.admitWorldSource(src);
      if (!ok(`playground/${name}-family`, r.family === want.family,
              `admitted as ${r.family}, want ${want.family}` +
              (r.ok ? "" : ` (${r.code})`))) continue;
      const got = r.ok ? (r.family === "v2" ? r.semanticWorldId : r.semanticId)
                       : null;
      if (want.seal) {
        if (!r.ok) { ok(`playground/${name}`, false,
                        `rejected ${r.code}: ${r.message}`); continue; }
        if (ok(`playground/${name}`, got === want.seal,
               `got  ${got}\n      want ${want.seal}`))
          verified.set(want.seal, `playground example '${name}'`);
      } else {
        if (r.ok) { ok(`playground/${name}`, false,
                       `sealed ${got}; expected ${want.reject}`); continue; }
        ok(`playground/${name}`, r.code === want.reject,
           `got ${r.code} ("${r.message}"); want ${want.reject}`);
      }
    }

    for (const name of Object.keys(expected)) {
      ok(`playground/${name}-exists`, name in EX,
         `an outcome is stated for '${name}' but the page no longer offers it`);
    }

    /* the page must not grow a control that decides the encoding. A selector
       may put starter TEXT in the editor; one that reinterprets text already
       there makes a world's id a function of the interface. */
    ok("playground/no-encoding-switch",
       !/data-(ir|encoding|family)\s*=/.test(text) &&
       !/<select\b/.test(text),
       "playground.html has grown a control that looks like an encoding " +
       "selector; §D8.17 says the source decides, and only the source");

    /* -- C.2. The two operations are OPERATIONS.
     *
     * Both of them seal. An import mints a world `sem-` and with it every
     * `rel-` under that world; an adoption mints another set. Run either one
     * on keystroke and a two-second edit mints a dozen real sealed worlds,
     * every one of them a legitimate id that something downstream may already
     * have written down -- and a page cannot un-mint an id by deciding it did
     * not mean it. So each is called from exactly one place, and the listener
     * that DOES fire without user intent calls neither.
     *
     * This is a textual guard on the published page, like
     * `no-encoding-switch`, and it is stated that way rather than dressed up:
     * what it can prove is that no automatic path reaches the operations, and
     * that is the half of the ruling that is about wiring. The half about
     * arithmetic is the round trip below. */
    {
      const mig = text.split("V2.migrateV1ToV2(").length - 1;
      const ado = text.split("V2.adoptLegacyRelations(").length - 1;
      const at = text.indexOf('src.addEventListener("input"');
      const body = at === -1 ? "" : text.slice(at, text.indexOf("\n});", at));
      const clicked = /addEventListener\("click"/.test(text) &&
        /id === "btn-import"/.test(text) && /id === "btn-adopt"/.test(text);
      ok("playground/migration/operations-are-not-consequences",
         mig === 1 && ado === 1 && at !== -1 &&
         !/migrateV1ToV2|adoptLegacyRelations/.test(body) && clicked,
         `migrateV1ToV2 is called ${mig} time(s), adoptLegacyRelations ` +
         `${ado} time(s), the input listener ` +
         `${/migrateV1ToV2|adoptLegacyRelations/.test(body) ? "REACHES ONE" :
            "reaches neither"}, and both are dispatched from a click: ` +
         `${clicked}. Ruling 1 says neither operation is automatic on editor ` +
         `change, and both of them mint sealed ids`);

      /* and the page holds no copy of the selector shape. `{kind, src, dst}`
         written out here is a list that keeps working for a while after the
         library's changes and then stops. */
      ok("playground/migration/the-selector-is-not-restated",
         /LEGACY_EDGE_ADOPTION_FIELDS\s*\n?\s*\.filter/.test(text),
         "the playground should derive its adoption selector from " +
         "LEGACY_EDGE_ADOPTION_FIELDS rather than restating the field list");
    }

    /* -- C.3. The runtime boundary is crossed through the envelope.
     *
     * A raw downgrade is not wrong, it is MUTE: it hands over a `sem-` with
     * nowhere to say that the id is not the world's. §D8.18 clause 1 is only
     * worth stating if the surfaces that show a projection go through the
     * thing that states it, so the page must call the envelope and must not
     * keep a second way of getting there.
     *
     * Both arms, and the same call in each: a page that asked only for V2
     * would be treating law 7's coincident case as a V2 feature the V1 arm
     * happens not to need, which is exactly the habit totality removes. */
    {
      const env = text.split("V2.deriveRuntimeProjection(").length - 1;
      ok("playground/the-projection-comes-from-the-envelope",
         env === 2 && !/runnableV1Artifact/.test(text) &&
         /R\.worldIdOfArtifact/.test(text) === false,
         `the page calls deriveRuntimeProjection ${env} time(s) and should ` +
         `call it twice -- once per family -- while holding no raw ` +
         `downgrade and sealing no execution artifact of its own. A surface ` +
         `that computed the view id itself would be free to label it ` +
         `anything, which is the failure §D8.18 exists to close`);
    }

    /* -- C.2. And the workflow itself, computed the way the page computes it.
     *
     * This is the closing law of the migration path and nothing else states
     * it: a migrated world is unwritable, ONE adoption makes it writable, and
     * the text the formatter then produces re-admits to the very world it was
     * written from. Without the last step the page could show an id that
     * nothing could get back to.
     *
     * The example swept is the page's own `demo`, which is the pinned
     * fixture -- so the last assertion is the sharpest one available: after
     * import, adoption, formatting and re-admission, the V1 EXECUTION VIEW of
     * the resulting V2 world is the pinned fixture's id, unmoved. The world
     * changed identity three times and what it runs as never moved once. */
    {
      const Rk = await import("../relation-identity.js");
      const held = await v2pg.admitWorldSource(
        EX.demo.endsWith("\n") ? EX.demo : EX.demo + "\n");
      const migrated = v2pg.migrateV1ToV2(held.artifact);
      const migratedId = await v2pg.v2WorldIdOfArtifact(migrated);

      const codeOf = async (f) => {
        try { await f(); return null; } catch (e) { return e.code || "?"; }
      };
      const unwritable = await codeOf(() => v2pg.formatNamedWorld(migrated));

      /* the selector, built the way the page builds it: from the constant */
      const fields = v2pg.LEGACY_EDGE_ADOPTION_FIELDS
        .filter((k) => k !== "relation_name");
      const assign = migrated.relations.map((rel, i) => {
        const a = { relation_name: `r${i}` };
        for (const k of fields) a[k] = rel.identity_seed[k];
        return a;
      });

      const partial = await codeOf(
        () => v2pg.adoptLegacyRelations(migrated, assign.slice(1)));
      const { artifact: adopted } =
        await v2pg.adoptLegacyRelations(migrated, assign);
      const adoptedId = await v2pg.v2WorldIdOfArtifact(adopted);
      const written = v2pg.formatNamedWorld(adopted);
      const back = await v2pg.admitWorldSource(written);
      const exec = await Rk.worldIdOfArtifact(v2pg.runnableV1Artifact(adopted));

      ok("playground/migration/import-adopt-round-trip",
         migratedId !== held.semanticId &&
         unwritable === "WRL_UNWRITABLE_SEED" &&
         partial === "WRL_INCOMPLETE_ADOPTION" &&
         adoptedId !== migratedId &&
         back.ok === true && back.family === "v2" &&
         back.semanticWorldId === adoptedId &&
         exec === W.DEMO_WORLD_SEMANTIC_ID,
         `import moves the id (${migratedId !== held.semanticId}), the ` +
         `migrated world will not write (${unwritable}), a short assignment ` +
         `is refused (${partial}), adoption moves it again ` +
         `(${adoptedId !== migratedId}), and the text the formatter produced ` +
         `re-admits to ${back.ok ? back.semanticWorldId : back.code} — want ` +
         `${adoptedId}. Its V1 execution view is ${exec}, and the fixture ` +
         `this all started from is ${W.DEMO_WORLD_SEMANTIC_ID}`);
    }
  }
}

/* Markdown too -- README.md prints a world and an id, and is the first thing
 * anyone reads on the repository page.
 *
 * The sweep DISPATCHES ON THE SOURCE'S OWN DECLARATION, for the reason the
 * playground has to: a V2 world and a V1 world are different bytes read by
 * different parsers, and a documentation sweep that assumed V1 would either
 * refuse a correct V2 example or -- worse -- fall back and print the id of a
 * world the reader was not shown. Documenting an encoding is a use of it. */
{
  const md = readFileSync(join(ROOT, "README.md"), "utf8");
  const v2doc = await import("../relation-v2.js");
  const FENCE = /```[a-z]*\n([\s\S]*?)```/g;
  let m, i = 0, worlds = 0, v2worlds = 0;
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
    if (!/^[ \t]*ir\s/m.test(m[1])) { await expectSeal(`doc/README#${i}`, m[1], claimed[1]); continue; }

    v2worlds++;
    const r = await v2doc.parseNamedWorld(m[1]);
    if (!r.ok) { ok(`doc/README#${i}`, false, `rejected ${r.code}: ${r.message}`); continue; }
    const id = await v2doc.v2WorldIdOfArtifact(r.artifact);
    if (ok(`doc/README#${i}`, id === claimed[1],
           `got  ${id}\n      want ${claimed[1]}`))
      /* so the id-literal sweep below accepts it: a V2 world id is a `sem-`
         like any other, and it is produced by this build. */
      verified.set(id, `README block ${i} (ir 2.0)`);
  }
  ok("doc/README-has-a-world", worlds > 0, "the README should show a world");
  ok("doc/README-shows-both-encodings", v2worlds > 0,
     "the README describes Semantic IR 2.0 but shows no V2 world, so the " +
     "encoding it documents is the one thing on the page nothing checks");
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
    /* `"a.sig_out"` is this battery's SHORTHAND, not the model's encoding. A
     * terminal is `{ object_id, port }`; writing that out at forty call sites
     * would bury the property each specimen is actually about. The shorthand
     * is expanded here, once, and check 1 below asserts the record form on the
     * derived relations rather than on anything this helper built -- so the
     * convenience cannot be what makes the check pass. */
    const term = (packed) => {
      const [object_id, port] = packed.split(".");
      return { object_id, port };
    };
    const endpoint = (packed, role) => ({ terminal: term(packed), role });
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

    /* 1. terminals are PORTS, not objects, and they are RECORDS, not packed
     *    strings. `p0` is an object; the terminal a relation reaches is
     *    `{ object_id: "p0", port: "sig_out" }`, and the port half has to be
     *    the one the kind names or the projection's inverse is a guess.
     *
     *    Both halves are asserted together because they fail together. The
     *    packed spelling `"p0.sig_out"` was the V1 edge's own habit surviving
     *    into the model meant to outlive it, and it only reads as unambiguous
     *    while every object id and port happens to be `\w+`. */
    {
      const wrong = rels.filter((r) => {
        const ports = W.EDGE_PORTS[r.revision.kind];
        const src = r.revision.endpoints.find((e) => e.role === "source");
        const dst = r.revision.endpoints.find((e) => e.role === "target");
        const is = (e, object_id, port) =>
          e && e.terminal && typeof e.terminal === "object" &&
          W.serializeArtifact(Object.keys(e.terminal).sort()) ===
            W.serializeArtifact([...s.TERMINAL_FIELDS].sort()) &&
          e.terminal.object_id === object_id && e.terminal.port === port;
        return !is(src, r.allocation.src, ports[0]) ||
               !is(dst, r.allocation.dst, ports[1]);
      });
      ok("relation/terminals-are-port-qualified",
         rels.length > 0 && wrong.length === 0,
         wrong.length
           ? `${wrong.length} derived relation(s) name an object where §D8 ` +
             `names a terminal, or pack one into a string where §D8 names a ` +
             `{ ${s.TERMINAL_FIELDS.join(", ")} } record, e.g. ` +
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
      const seq = (r, k) => r
        ? r.endpoints.map((e) => k === "terminal"
            ? s.formatTerminal(e.terminal) : e[k]).join(",")
        : "(refused)";
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
                             endpoints: [
                               { terminal: { object_id: "sp", port: "socket" },
                                 role: "source" },
                               { terminal: { object_id: "ob", port: "pose" },
                                 role: "target" }] }),
      endpoints:   (r) => ({ ...r, endpoints: [{ ...r.endpoints[0],
                                                 terminal: { object_id: "zz", port: "sig_out" } },
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
     * inferred from whatever the code happens to do today.
     *
     * The third class was called `unprojected` on the reading that V1 says
     * NOTHING about those four fields. It says exactly one thing about each --
     * signal, directed, solid, {} -- and this contract restores all four on
     * import. What V1 lacks is an independently writable representation for any
     * OTHER value, which is a fact about representability rather than about
     * silence. `V1-fixed` names that; `unprojected` invited the wrong reading
     * of the same observation. */
    const NAMES     = ["kind", "endpoints"];
    const FREE      = ["policy"];
    const V1_FIXED  = ["domain", "orientation", "texture", "attributes"];

    const observed = {};
    for (const f of s.REVISION_FIELDS) {
      if (!MUTATE[f]) { observed[f] = "unmutated"; continue; }
      try {
        observed[f] = (await idOf(MUTATE[f](base))) === baseId ? "free" : "names";
      } catch { observed[f] = "V1-fixed"; }
    }

    const expected = Object.fromEntries([
      ...NAMES.map((f) => [f, "names"]),
      ...FREE.map((f) => [f, "free"]),
      ...V1_FIXED.map((f) => [f, "V1-fixed"]),
    ]);

    const declared = [...NAMES, ...FREE, ...V1_FIXED];
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

    /* -- and the other half of the same claim, which the partition alone
     *    cannot make: each V1-fixed field is pinned to a SPECIFIC value.
     *
     * The partition observes that mutating one of these four fields makes the
     * revision unprojectable. That is compatible with V1 being silent about
     * them, and it is compatible with the adapter having no opinion at all --
     * a projection that refused every value would pass it. What distinguishes
     * "fixed" from "absent" is that exactly one value survives, the same one
     * every time, and that the derived revision already carries it. Asserted
     * against the derived relations rather than against a constant list, so a
     * kernel that changed its mind about `solid` fails here rather than
     * quietly reclassifying a field. */
    const V1_FIXED_VALUE = {
      domain: "signal", orientation: "directed", texture: "solid",
    };
    const derived = Object.values(sealed).flatMap((k) => k.derived.relations);
    const offV = derived.flatMap((r) =>
      Object.entries(V1_FIXED_VALUE)
        .filter(([f, v]) => r.revision[f] !== v)
        .map(([f, v]) => `${f} is ${JSON.stringify(r.revision[f])}, not ${v}`));
    const offA = derived.filter(
      (r) => W.serializeArtifact(r.revision.attributes) !== "{}");

    /* the pin has to bite: an alternative value for the same field must be
     * refused by the projection, not merely differ from the one derived */
    const alt = { domain: "electrical", orientation: "acausal",
                  texture: "async" };
    const unpinned = [];
    for (const [f, v] of Object.entries(alt)) {
      const rev = f === "orientation"
        ? { ...base, orientation: "acausal", texture: undefined,
            endpoints: base.endpoints.map((e) => ({ ...e, role: "terminal" })) }
        : { ...base, [f]: v };
      if (f === "orientation") delete rev.texture;
      try { s.projectRelationRevisionToV1Edge(rev); unpinned.push(f); }
      catch { /* refused, as a pinned field must be */ }
    }

    ok("relation/each-V1-fixed-field-is-pinned-to-one-value",
       offV.length === 0 && offA.length === 0 && unpinned.length === 0 &&
       V1_FIXED.every((f) => f in V1_FIXED_VALUE || f === "attributes"),
       offV.length || offA.length
         ? `a derived revision disagrees with the value V1 fixes: ` +
           `${offV.join("; ")}${offA.length ? `; ${offA.length} carried ` +
           `non-empty attributes` : ""}`
         : `[${unpinned.join(", ")}] projected under an alternative value. A ` +
           `field V1 merely omits and a field V1 pins to one value are ` +
           `different claims, and only the second licenses restoring it on ` +
           `import`);
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

    /* and the list is GLOBALLY true, not true of the file it sits in. B.4
     * shipped a surface that emits `named-initial` seeds while this list still
     * read `[]`, and nothing noticed, because V2 stated its own answer locally
     * and never consulted this one. So the law is stated the way the defect
     * would have been caught: build the allocation the shipped surface emits,
     * and ask the global authority to admit it. */
    const authored = refusal(s.assertAuthorableAllocation,
      { variant: "named-initial", world_id: world,
        relation_name: "clock_feed" });
    /* the encoding-scoped lists are shares of it, never supersets */
    const v2Authorable = (await import("../relation-v2.js"))
      .V2_AUTHORABLE_SEED_VARIANTS;
    const shares =
      v2Authorable.every((v) => s.AUTHORABLE_VARIANTS.includes(v)) &&
      s.V1_AUTHORABLE_SEED_VARIANTS.every(
        (v) => s.AUTHORABLE_VARIANTS.includes(v));

    ok("relation/unwritable-variants-are-refused",
       results.length === 0 && authored === null && shares &&
       s.IMPORTABLE_VARIANTS.length === 1 &&
       s.AUTHORABLE_VARIANTS.length === 1 &&
       s.V1_AUTHORABLE_SEED_VARIANTS.length === 0 &&
       s.ALLOCATION_VARIANTS.length === 3,
       results.join("; ") ||
       `the authorities are ${s.ALLOCATION_VARIANTS.length} known / ` +
       `${s.IMPORTABLE_VARIANTS.length} importable / ` +
       `${s.AUTHORABLE_VARIANTS.length} authorable in general ` +
       `[${s.AUTHORABLE_VARIANTS.join(", ")}], of which V1 can spell ` +
       `${s.V1_AUTHORABLE_SEED_VARIANTS.length} and V2 ` +
       `${v2Authorable.length}; the shipped surface's own allocation is ` +
       `admitted: ${authored === null}, and every encoding's list is a share ` +
       `of the global one: ${shares}`);
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

  /* -- and admission is by the whole tuple, not by the version alone.
   *
   * 0.1.2 gated `ir_version` and let the other two coordinates through: an
   * artifact could declare an undeclared rulepack under a frozen profile and
   * still be read as a recognised V1 relation source, because the rulepack was
   * admitted for being a nonempty string. That is not what "policy is free"
   * licenses. The partition says a revision may CHANGE its rulepack without
   * moving `relation_id`; admission asks which sealed artifact families this
   * adapter knows how to interpret at all. The rulepack is copied into
   * `revision.policy`, so an unrecognised one is sealed into revision identity
   * rather than merely ignored. */
  {
    const base = sealed.starter.artifact;
    const fam = s.V1_RELATION_SOURCE_FAMILIES[base.ir_version];
    const refuse = (artifact) => {
      try { s.assertV1Artifact(artifact); return null; }
      catch (e) { return e.code; }
    };
    const swapped = {
      ...base,
      semantic_policies: { ...base.semantic_policies,
                           rulepack_id: "someone.elses.rules.v1" },
    };
    const dropped = {
      ...base,
      semantic_policies: { ...base.semantic_policies, rulepack_id: undefined },
    };
    const foreign = { ...base, profile_id: "forge.world.core.v2" };

    /* Every declared family must agree with what the spine actually seals,
     * so the table cannot be satisfied by a value no artifact carries. */
    const tableMatchesSeal = Object.values(sealed).every((k) => {
      const f = s.V1_RELATION_SOURCE_FAMILIES[k.artifact.ir_version];
      return f && f.profile_id === k.artifact.profile_id &&
             f.rulepack_id === k.artifact.semantic_policies.rulepack_id;
    });

    ok("relation/binding/admission-is-the-whole-source-tuple",
       refuse(base) === null &&
       refuse(swapped) === "WRL_UNSUPPORTED_RULEPACK" &&
       refuse(dropped) === "WRL_UNSUPPORTED_RULEPACK" &&
       refuse(foreign) === "WRL_UNSUPPORTED_PROFILE" &&
       tableMatchesSeal,
       `a foreign rulepack answered ${refuse(swapped)}, an absent one ` +
       `${refuse(dropped)} and a foreign profile ${refuse(foreign)}; the ` +
       `declared family for ${base.ir_version} is ${JSON.stringify(fam)}. ` +
       `An adapter that admits any nonempty rulepack under a frozen profile ` +
       `elevates an undeclared policy family into a recognised relation ` +
       `source, and then copies it into every revision it mints.`);
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
      families: W.serializeArtifact(s.V1_RELATION_SOURCE_FAMILIES),
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
    tamper(() => {
      s.V1_RELATION_SOURCE_FAMILIES["1.0"].rulepack_id = "someone.elses.rules.v1";
    });
    tamper(() => { s.V1_RELATION_SOURCE_FAMILIES["9.9"] = { profile_id: "x" }; });

    /* an undeclared rulepack was inadmissible before the tamper, and the
     * tamper's whole point was to declare it */
    let admitted = null;
    try {
      const a = sealed.starter.artifact;
      s.assertV1Artifact({
        ...a,
        semantic_policies: { ...a.semantic_policies,
                             rulepack_id: "someone.elses.rules.v1" },
      });
      admitted = "accepted";
    } catch (e) { admitted = e.code; }

    /* a peer endpoint on a directed relation was illegal before the tamper,
     * and the tamper's whole point was to make it legal */
    let widened = null;
    try {
      s.canonicalizeRelationRevision({
        ...sealed.starter.derived.relations[0].revision,
        endpoints: [
          { terminal: { object_id: "p0", port: "sig_out" }, role: "source" },
          { terminal: { object_id: "r0", port: "sig_in" }, role: "peer" }],
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
      families: W.serializeArtifact(s.V1_RELATION_SOURCE_FAMILIES),
    };

    const moved = Object.keys(before).filter((k) => before[k] !== after[k]);
    ok("relation/immutability/the-canon-cannot-be-moved-from-outside",
       moved.length === 0 && widened === "WRL_ENDPOINT_ROLE_ILLEGAL" &&
       admitted === "WRL_UNSUPPORTED_RULEPACK",
       moved.length
         ? `a consumer moved ${moved.join(", ")} by mutating an exported ` +
           `table. A canonical sort key that a caller can reverse is not a ` +
           `canonical form -- every revision_id this module mints would move ` +
           `without the file that documents the order changing`
         : `after widening ORIENTATION_ROLES.directed.admits, a peer endpoint ` +
           `on a directed relation was ${widened}; after redeclaring family ` +
           `1.0's rulepack, a foreign one was ${admitted}. Role legality and ` +
           `source admission both have to be the module's, not the caller's`);
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
          endpoints: [
            { terminal: { object_id: edge.src, port: ports[0] }, role: "source" },
            { terminal: { object_id: edge.dst, port: ports[1] }, role: "target" }],
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
    for (const entry of ["wrl.js", "relation-identity.js", "relation-v2.js"])
      walk(entry);

    ok("portability/shipped-modules-load-in-a-browser",
       seen.size >= 3 && offenders.length === 0,
       offenders.length
         ? offenders.join("; ") + `. A served module may only import other ` +
           `served modules; anything else is a page that 404s or throws on load.`
         : `the module graph walk reached ${seen.size} file(s), so it did not ` +
           `reach every entry point`);
  }
}

/* ================================================= 21c. the V2 encoding, B.1
 *
 * §D8.8's projection makes a V1 `edges` array READABLE as relations, and the
 * register calls the four fields it cannot vary `V1-fixed` -- one value, no
 * alternative spelling. V2 is where the alternatives become writable, and this
 * slice is its schema and its canonical bytes. Nothing here hashes: identity
 * derivation is B.2, held separate so that a moved id has one candidate cause.
 *
 * The specimens are built by hand rather than by a migration, because the
 * migration is B.3 and a schema tested only through its own producer is a
 * schema tested against itself. */
{
  const s = await import("../relation-identity.js");
  const v2 = await import("../relation-v2.js");

  const refuse = (fn) => {
    try { fn(); return null; } catch (e) { return e.code || String(e); }
  };
  /* the same, for the operations that hash -- a rejected promise is a
   * refusal, and `refuse` would report one as a pass */
  const refuseAsync = async (fn) => {
    try { await fn(); return null; } catch (e) { return e.code || String(e); }
  };

  /* one legal V2 world, assembled from the demo world's objects and a relation
   * per demo edge -- same terminals, same revision model, native seeds */
  const demo = await s.sealWithRelations(W.DEMO_WORLD);
  const named = (n) => ({ variant: "named-initial", relation_name: n });
  const baseRelations = demo.ok
    ? demo.artifact.edges.map((e, i) => ({
        identity_seed: named(`r${i}`),
        revision: s.edgeToRelationRevision(demo.artifact, e),
      }))
    : [];
  const world = () => ({
    ir_version: v2.V2_IR_VERSION,
    profile_id: demo.artifact.profile_id,
    semantic_policies: { ...demo.artifact.semantic_policies },
    schemas: demo.artifact.schemas,
    objects: demo.artifact.objects,
    relations: baseRelations.map((r) => ({ ...r })),
  });

  ok("relation/v2/specimen-is-buildable", demo.ok && baseRelations.length > 1,
     demo.ok ? `the demo world contributed ${baseRelations.length} relation(s), ` +
               `so ordering and uniqueness prove nothing`
             : `the demo world did not seal: ${demo.code}`);

  if (demo.ok && baseRelations.length > 1) {

  /* -- §4. `relations` REPLACES `edges`, in both directions.
   *
   * The one-directional version of this rule is the dangerous one. If only V2
   * refused a legacy key, a V1 artifact could grow a `relations` array that a
   * V1 reader ignores and a V2 reader believes, and the two readers would
   * disagree about the world's topology while agreeing about its bytes. */
  {
    const v2WithEdges = { ...world(), edges: demo.artifact.edges };
    const v1WithRelations = { ...demo.artifact, relations: baseRelations };

    const both = [
      refuse(() => v2.assertV2Artifact(world())),
      refuse(() => s.assertV1Artifact(demo.artifact)),
    ];
    const cross = [
      refuse(() => v2.assertV2Artifact(v2WithEdges)),
      refuse(() => s.assertV1Artifact(v1WithRelations)),
    ];

    ok("relation/v2/relations-replace-edges",
       both[0] === null && both[1] === null &&
       cross[0] === "WRL_LEGACY_EDGES_IN_V2" &&
       cross[1] === "WRL_RELATIONS_IN_V1",
       `clean V2 -> ${both[0]}, clean V1 -> ${both[1]}, V2+edges -> ` +
       `${cross[0]} (want WRL_LEGACY_EDGES_IN_V2), V1+relations -> ` +
       `${cross[1]} (want WRL_RELATIONS_IN_V1). Replacement is a two-sided ` +
       `rule: an encoding that merely ignores the other's topology key admits ` +
       `a world whose meaning depends on which reader opens it`);
  }

  /* -- the tuple gate, one version along. A.4 established for V1 that
   *    admission is `(ir_version, profile_id, rulepack_id)` and that each
   *    coordinate answers with its own code. V2 inherits the shape rather
   *    than re-deciding it, and the table is checked against what it admits. */
  {
    const bad = (patch) => refuse(() => v2.assertV2Artifact({ ...world(), ...patch }));
    const version = bad({ ir_version: "1.0" });
    const profile = bad({ profile_id: "forge.world.core.v9" });
    const rulepack = bad({ semantic_policies: { ...demo.artifact.semantic_policies,
                                                rulepack_id: "forge.other.rules.v1" } });

    /* AND the declared table has to agree with the artifact the encoder
     * actually admits, or the gate is checking a constant nobody publishes */
    const declared = v2.V2_RELATION_SOURCE_FAMILIES[v2.V2_IR_VERSION];
    const agrees = declared &&
      declared.profile_id === demo.artifact.profile_id &&
      declared.rulepack_id === demo.artifact.semantic_policies.rulepack_id;

    ok("relation/v2/binding/admission-is-the-whole-source-tuple",
       version === "WRL_UNSUPPORTED_IR_VERSION" &&
       profile === "WRL_UNSUPPORTED_PROFILE" &&
       rulepack === "WRL_UNSUPPORTED_RULEPACK" && agrees,
       `version -> ${version}, profile -> ${profile}, rulepack -> ` +
       `${rulepack}, table agrees with the sealed world: ${!!agrees}`);
  }

  /* -- §5. A SEED is an allocation minus its world coordinate, and the minus
   *    is the whole reason the word is `seed`.
   *
   * Checked as an equation over the two tables rather than by reading either:
   * seed fields ∪ {world_id} must be exactly the allocation's fields, for
   * every seeded variant. A variant that gained a field in one table and not
   * the other would still round-trip through its own producer. */
  {
    const off = [];
    for (const variant of v2.V2_INITIAL_SEED_VARIANTS) {
      const seedPlus = [...v2.V2_SEED_FIELDS[variant], "world_id"].sort();
      const alloc = [...s.ALLOCATION_FIELDS[variant]].sort();
      if (W.serializeArtifact(seedPlus) !== W.serializeArtifact(alloc))
        off.push(`${variant}: seed+world_id is {${seedPlus}}, the allocation ` +
                 `is {${alloc}}`);
    }
    const carried = refuse(() => v2.validateIdentitySeed(
      { ...named("a"), world_id: demo.semanticId }));

    ok("relation/v2/a-seed-is-an-allocation-without-its-world",
       off.length === 0 && carried === "WRL_BAD_IDENTITY_SEED",
       off.length ? off.join("; ")
       : `a seed carrying a world_id was ${carried}, not refused. The world ` +
         `id is the hash of the bytes the seed sits in, so a stored copy is ` +
         `either a value that does not exist yet or another world's`);
  }

  /* -- §6. `granted` is runtime-only, and its absence from initial bytes is
   *    the statement. A grant is drawn from an authority that does not exist
   *    at period 0. */
  {
    const seeded = v2.V2_INITIAL_SEED_VARIANTS.includes("granted");
    const code = refuse(() => v2.validateIdentitySeed(
      { variant: "granted", grant_id: "g0", local_counter: 0 }));
    ok("relation/v2/granted-is-not-seeded-into-initial-bytes",
       !seeded && code === "WRL_UNWRITABLE_SEED",
       seeded ? `'granted' is listed in V2_INITIAL_SEED_VARIANTS`
              : `a granted seed was ${code}, want WRL_UNWRITABLE_SEED`);
  }

  /* -- §6/§9. An unnamed relation is an ERROR, never a fallback.
   *
   * The tempting repair is the one this refuses: seeing no name, mint a
   * `legacy-edge` seed from the endpoints. That would make two independently
   * authored relations over the same two ports the same relation, which is
   * exactly the collapse §D8.1's preimages exist to prevent -- and it would
   * happen silently, on the author's behalf. */
  {
    const missing = refuse(() => v2.validateIdentitySeed({ variant: "named-initial" }));
    const empty = refuse(() => v2.validateIdentitySeed({ ...named("") }));
    const fellBack = refuse(() => {
      const seed = v2.canonicalizeSeed({ variant: "named-initial" });
      if (seed.variant !== "named-initial") throw new Error("FELL_BACK");
      throw new Error("ACCEPTED_UNNAMED");
    });
    ok("relation/v2/an-unnamed-relation-is-refused-not-defaulted",
       missing === "WRL_MISSING_RELATION_NAME" &&
       empty === "WRL_MISSING_RELATION_NAME" &&
       fellBack === "WRL_MISSING_RELATION_NAME",
       `absent name -> ${missing}, empty name -> ${empty}, through ` +
       `canonicalizeSeed -> ${fellBack}. All three want ` +
       `WRL_MISSING_RELATION_NAME; a missing key reported as a field-set ` +
       `mismatch reads as a schema typo rather than as the one thing a V2 ` +
       `author must supply`);
  }

  /* -- §5. Three ids are derived, and a relation record stores none of them.
   *    Stored, each would be a second source of truth for a hash -- and the
   *    stored copy is the one a reader trusts, which is how a forged id gets
   *    believed. */
  {
    const forged = {
      world_id: demo.semanticId,
      relation_id: "rel-" + "0".repeat(64),
      revision_id: "rev-" + "0".repeat(64),
    };
    const got = Object.entries(forged).map(([k, v]) =>
      `${k}:${refuse(() => v2.validateV2Relation({ ...baseRelations[0], [k]: v }))}`);
    ok("relation/v2/no-derived-id-is-stored",
       got.every((g) => g.endsWith(":WRL_BAD_V2_ARTIFACT")),
       `${got.join(", ")} -- each wants WRL_BAD_V2_ARTIFACT`);
  }

  /* -- §5. `relations` sorts by canonical seed bytes, so the array's order is
   *    not in the author's hands. An array's order IS in its bytes, so an
   *    unordered set has to have its order decided here or it is decided by
   *    whoever typed the world. */
  {
    const forward = v2.serializeV2Artifact(world());
    const reversed = v2.serializeV2Artifact(
      { ...world(), relations: world().relations.reverse() });
    const order = v2.canonicalizeV2Artifact(world()).relations
      .map((r) => W.serializeArtifact(r.identity_seed));
    const sorted = [...order].sort();

    ok("relation/v2/relations-sort-by-seed-bytes",
       forward === reversed &&
       W.serializeArtifact(order) === W.serializeArtifact(sorted),
       forward === reversed
         ? `the canonical order is ${order.join(" ")}, and sorted it is ` +
           `${sorted.join(" ")}`
         : `reversing the relations array moved the canonical bytes, so the ` +
           `world's identity would depend on the order its author typed`);
  }

  /* -- a seed names at most one relation. Two relations under one seed expand
   *    to one allocation and therefore one `relation_id`, so the world cannot
   *    say which of the two a later revision revises -- the V1
   *    duplicate-edge-key defect, arriving through a field the author now
   *    controls directly. */
  {
    const dup = world();
    dup.relations[1] = { ...dup.relations[1],
                         identity_seed: { ...dup.relations[0].identity_seed } };
    ok("relation/v2/a-seed-names-at-most-one-relation",
       refuse(() => v2.canonicalizeV2Artifact(dup)) ===
         "WRL_DUPLICATE_RELATION_SEED",
       `two relations under one seed were ` +
       `${refuse(() => v2.canonicalizeV2Artifact(dup))}, want ` +
       `WRL_DUPLICATE_RELATION_SEED`);
  }

  /* -- §6. Authorship is a fourth authority, separate from admissibility. A
   *    `legacy-edge` seed is legal in V2 BYTES and illegal from an AUTHOR:
   *    it records that a relation arrived through the migration and kept the
   *    id its V1 world minted, and writing one by hand claims a provenance
   *    that did not happen. */
  {
    const legacy = { variant: "legacy-edge", kind: "SignalWire",
                     src: "p0", dst: "r0" };
    ok("relation/v2/an-authoring-surface-writes-only-named-seeds",
       refuse(() => v2.validateIdentitySeed(legacy)) === null &&
       refuse(() => v2.assertAuthorableSeed(legacy)) === "WRL_UNWRITABLE_SEED" &&
       refuse(() => v2.assertAuthorableSeed(named("a"))) === null,
       `admissible: ${refuse(() => v2.validateIdentitySeed(legacy))}, ` +
       `authorable: ${refuse(() => v2.assertAuthorableSeed(legacy))}, ` +
       `named authorable: ${refuse(() => v2.assertAuthorableSeed(named("a")))}`);
  }

  /* -- §D8.3, across the boundary it exists to make checkable. The same
   *    relation structure in two worlds yields the same `revision_id`. That
   *    law would stop holding at exactly the V1 -> V2 migration if the two
   *    families encoded a terminal differently, which is why B.1a lifted V1's
   *    packed `p0.sig_out` into the record form BEFORE this slice. */
  {
    const off = [];
    for (const edge of demo.artifact.edges) {
      const fromV1 = s.canonicalizeRelationRevision(
        s.edgeToRelationRevision(demo.artifact, edge));
      const inV2 = v2.canonicalizeV2Relation({
        identity_seed: named("x"),
        revision: s.edgeToRelationRevision(demo.artifact, edge),
      }).revision;
      if (W.serializeArtifact(fromV1) !== W.serializeArtifact(inV2))
        off.push(`${edge.kind} ${edge.src}->${edge.dst}`);
    }
    ok("relation/v2/the-revision-model-is-shared-with-V1", off.length === 0,
       `${off.length} revision(s) canonicalise differently inside a V2 ` +
       `relation than they do standing alone, e.g. ${off[0]}. A revision is ` +
       `standalone under §D8.3, so a family-dependent canonical form would ` +
       `mean the same wire had two revision ids on either side of a migration`);
  }

  /* -- the same immutability the kernel's tables have, for the same reason:
   *    reversing an exported list from outside would move canonical bytes
   *    from a file that documents the order as normative. */
  {
    const before = {
      seeds: W.serializeArtifact(v2.V2_INITIAL_SEED_VARIANTS),
      fields: W.serializeArtifact(v2.V2_SEED_FIELDS),
      families: W.serializeArtifact(v2.V2_RELATION_SOURCE_FAMILIES),
      authorable: W.serializeArtifact(v2.V2_AUTHORABLE_SEED_VARIANTS),
      record: W.serializeArtifact(v2.V2_RELATION_FIELDS),
    };
    try { v2.V2_INITIAL_SEED_VARIANTS.push("granted"); } catch {}
    try { v2.V2_AUTHORABLE_SEED_VARIANTS.push("legacy-edge"); } catch {}
    try { v2.V2_SEED_FIELDS["named-initial"].push("world_id"); } catch {}
    try { v2.V2_RELATION_SOURCE_FAMILIES["2.0"].profile_id = "x"; } catch {}
    try { v2.V2_RELATION_FIELDS.push("relation_id"); } catch {}
    const after = {
      seeds: W.serializeArtifact(v2.V2_INITIAL_SEED_VARIANTS),
      fields: W.serializeArtifact(v2.V2_SEED_FIELDS),
      families: W.serializeArtifact(v2.V2_RELATION_SOURCE_FAMILIES),
      authorable: W.serializeArtifact(v2.V2_AUTHORABLE_SEED_VARIANTS),
      record: W.serializeArtifact(v2.V2_RELATION_FIELDS),
    };
    /* and the consequence, not just the bytes: a granted seed is still refused */
    const still = refuse(() => v2.validateIdentitySeed(
      { variant: "granted", grant_id: "g0", local_counter: 0 }));
    ok("relation/v2/immutability/the-V2-canon-cannot-be-moved-from-outside",
       W.serializeArtifact(before) === W.serializeArtifact(after) &&
       still === "WRL_UNWRITABLE_SEED",
       `before ${W.serializeArtifact(before)}\n      after  ` +
       `${W.serializeArtifact(after)}\n      granted seed still ${still}`);
  }

  /* -- §D8.14: THE MUTATION BATTERY. An invalid world mints no `sem-`.
   *
   * This is the check the V2 encoder did not have, and the omission was not
   * visible from anything the encoder did. It validated the tuple, the
   * arrays, the relation record shape and the generic revision vocabulary --
   * every one of them a check about the ENCODING -- and then sealed. Nothing
   * asked whether the thing being sealed was a legal world under the profile
   * it named, so an object with role `Alien`, a terminal on an object called
   * `ghost`, a port called `made_up` and a domain called `banana` all came
   * back with well-formed ids. An id that names an impossible world is worse
   * than a refusal: it exists, it is stable, it compares, and every consumer
   * downstream believes it.
   *
   * The gate does not re-list the registries. It DERIVES the V1 world from
   * the V2 one and hands it to the frozen `graphToIr`, so each refusal below
   * carries the profile's own code, and a profile that later widens widens
   * both encodings at once. That is why the codes here are V1 codes.
   *
   * Every mutation is applied to a world that seals, so a refusal is
   * attributable to the mutation and nothing else. */
  {
    const mint = async (build) => {
      let w;
      try { w = build(); } catch (e) { return `BUILD:${e.code || e}`; }
      try { return await v2.v2WorldIdOfArtifact(w); }
      catch (e) { return e.code || String(e); }
    };
    const rel = (i) => JSON.parse(JSON.stringify(world().relations[i]));
    const withRel = (i, r) => {
      const w = world();
      w.relations = w.relations.map((x, j) => (j === i ? r : x));
      return w;
    };
    /* the relation whose target is a signal-wire controller, cloned under a
     * second name: two well-formed V2 relations onto one controller input */
    const sig = world().relations.findIndex(
      (r) => r.revision.kind === "SignalWire");
    /* the profile checks a Pulser's clock and checks nothing about a Door's
     * config, so an invalid config has to be an invalid PULSER config -- an
     * unknown key on a Door is legal V1 and the gate says so */
    const pulser = world().objects.findIndex((o) => o.role === "Pulser");

    const legal = await mint(() => world());

    const cases = {
      "an unknown object role": () => {
        const w = world();
        w.objects = w.objects.map(
          (o, i) => (i === 0 ? { ...o, role: "Alien" } : o));
        return w;
      },
      "a duplicate object id": () => {
        const w = world();
        w.objects = [...w.objects, { ...w.objects[0] }];
        return w;
      },
      "a terminal on an object that does not exist": () => {
        const r = rel(0);
        r.revision.endpoints = r.revision.endpoints.map(
          (e) => (e.role === "source"
            ? { ...e, terminal: { ...e.terminal, object_id: "ghost" } } : e));
        return withRel(0, r);
      },
      "an undeclared domain": () => {
        const r = rel(0);
        r.revision.domain = "banana";
        return withRel(0, r);
      },
      "an undeclared kind": () => {
        const r = rel(0);
        r.revision.kind = "WarpTunnel";
        return withRel(0, r);
      },
      "an illegal port": () => {
        const r = rel(0);
        r.revision.endpoints = r.revision.endpoints.map(
          (e) => (e.role === "source"
            ? { ...e, terminal: { ...e.terminal, port: "made_up" } } : e));
        return withRel(0, r);
      },
      "a controller-conflicting relation set": () => {
        const w = world();
        const clone = JSON.parse(JSON.stringify(w.relations[sig]));
        clone.identity_seed = { variant: "named-initial",
                                relation_name: "second_controller" };
        w.relations = [...w.relations, clone];
        return w;
      },
      "an invalid static_config": () => {
        const w = world();
        w.objects = w.objects.map(
          (o, i) => (i === pulser ? { ...o, static_config: {} } : o));
        return w;
      },
    };

    const got = {};
    for (const [what, build] of Object.entries(cases))
      got[what] = await mint(build);

    const minted = Object.entries(got)
      .filter(([, r]) => typeof r === "string" && r.startsWith("sem-"));

    ok("relation/v2/world/an-invalid-world-mints-no-id",
       typeof legal === "string" && legal.startsWith("sem-") &&
       minted.length === 0 && Object.keys(got).length === 8,
       `the unmutated world seals (${typeof legal === "string" &&
         legal.startsWith("sem-")}), and ${Object.keys(got).length} ` +
       `mutations of it seal none:\n      ` +
       Object.entries(got).map(([k, r]) => `${k} -> ${r}`).join("\n      ") +
       (minted.length
         ? `\n      MINTED ANYWAY: ${minted.map(([k]) => k).join(", ")}`
         : ""));
  }

  /* -- and the gate DELEGATES rather than re-listing.
   *
   * Evidence rather than assertion: the refusals above carry the FROZEN
   * spine's codes, not a parallel V2 vocabulary. A gate with its own registry
   * would answer with its own codes, and would then be a second opinion about
   * what a legal world is -- free to drift from the profile it claims to
   * enforce, and drifting silently, because nothing compares two registries
   * that never meet. */
  {
    const codes = new Set();
    const build = [
      () => { const w = world();
              w.objects = w.objects.map((o, i) =>
                (i === 0 ? { ...o, role: "Alien" } : o)); return w; },
      () => { const w = world();
              w.objects = [...w.objects, { ...w.objects[0] }]; return w; },
    ];
    for (const b of build)
      codes.add(await refuseAsync(() => v2.v2WorldIdOfArtifact(b())));

    const spineCodes = Object.keys(W.CODES);
    const v2Codes = Object.keys(v2.RELATION_V2_CODES);
    const fromSpine = [...codes].every((c) => spineCodes.includes(c));
    const notV2 = [...codes].every((c) => !v2Codes.includes(c));

    ok("relation/v2/world/the-world-gate-delegates-to-the-profile",
       codes.size === 2 && fromSpine && notV2,
       `[${[...codes].join(", ")}] -- every one of them a code the FROZEN ` +
       `spine defines (${fromSpine}) and none of them a V2 code ` +
       `(${notV2}). The V2 gate derives the V1 world and asks ` +
       `graphToIr; it holds no registry of its own to drift`);
  }

  }

  /* ============================================= 21d. V2 identity, B.2
   *
   * Everything above decides bytes. This decides ids, and the order is the
   * dependency graph §5 of the ruling fixes:
   *
   *     canonicalise -> world_id -> expand seed -> relation_id -> revision_id
   *
   * Two of those arrows are the ones an implementation is tempted to skip, and
   * both skips produce ids that look right. Deriving from a non-canonical
   * artifact gives two spellings of one world two sets of relations; believing
   * a caller's `world_id` gives a forged seal real-looking relations. V1
   * shipped the second and `worldIdOfArtifact` was the repair; the checks
   * below are what stops V2 re-earning it. */
  if (demo.ok && baseRelations.length > 1) {

  const idsByName = (view) => {
    const m = new Map();
    for (const r of view.relations)
      m.set(r.identity_seed.relation_name,
            { rel: r.relation_id, rev: r.revision_id });
    return m;
  };

  const base = await v2.deriveV2Relations(world());

  /* -- canonicalisation happens FIRST, so byte-equal worlds derive one answer.
   *
   * Written in reverse and with the objects shuffled: neither array's written
   * order is in the canonical bytes, so neither may reach an id. If derivation
   * ran before canonicalisation this passes for `objects` -- which the world id
   * covers either way -- and fails for `relations`, whose reordering would
   * change the bytes being hashed. */
  {
    const scrambled = world();
    scrambled.relations = scrambled.relations.slice().reverse();
    scrambled.objects = scrambled.objects.slice().reverse();
    const other = await v2.deriveV2Relations(scrambled);

    ok("relation/v2/identity/derivation-follows-the-canonical-bytes",
       other.world_id === base.world_id &&
       W.serializeArtifact(other.relations) ===
       W.serializeArtifact(base.relations),
       `written order reversed -> world ${other.world_id} vs ` +
       `${base.world_id}; relation views ` +
       (W.serializeArtifact(other.relations) ===
        W.serializeArtifact(base.relations) ? "identical" : "DIFFER") +
       `. An id derived before canonicalisation is an id of how a world was ` +
       `typed rather than of the world`);
  }

  /* -- the seal is recomputed, never believed. §D8.5's repair, inherited.
   *
   * The failure this prevents is quiet: a real artifact handed a forged
   * `sem-000…0` mints relation ids under the forgery and returns them without
   * complaint, so the module's central claim -- that relation identity comes
   * from the seal -- would hold only of callers already telling the truth. */
  {
    const forged = "sem-" + "0".repeat(64);
    let honest = null, lie = null;
    try { honest = await v2.deriveV2Relations(world(), base.world_id); }
    catch (e) { honest = e.code || String(e); }
    try { await v2.deriveV2Relations(world(), forged); lie = "ACCEPTED"; }
    catch (e) { lie = e.code || String(e); }

    /* and the consequence: no allocation was ever built under the forgery */
    const underForgery = base.relations
      .filter((r) => r.allocation.world_id === forged).length;

    ok("relation/v2/identity/the-seal-is-recomputed-not-believed",
       honest && honest.world_id === base.world_id &&
       lie === "WRL_SEMANTIC_ID_MISMATCH" && underForgery === 0,
       `a truthful claim -> ${honest && honest.world_id}, a forged one -> ` +
       `${lie} (want WRL_SEMANTIC_ID_MISMATCH), allocations minted under the ` +
       `forgery: ${underForgery}. A function with two independent sources of ` +
       `truth about one hash has no source of truth`);
  }

  /* -- a seed plus its world is an allocation §D8.1 ACCEPTS -- checked against
   *    the kernel's own constructor and its own validator, not a local one.
   *
   * If `expandSeed` and `namedInitialAllocation` ever disagreed, the
   * disagreement would surface as a `rel-` id that exists and is wrong, which
   * no round trip through this module can see. */
  {
    const seed = base.relations[0].identity_seed;
    const mine = v2.expandSeed(base.world_id, seed);
    const theirs = s.namedInitialAllocation(base.world_id, seed.relation_name);
    const sameBytes =
      W.serializeArtifact(mine) === W.serializeArtifact(theirs);
    const sameId =
      await s.relationIdFromAllocation(theirs) === base.relations[0].relation_id;

    /* the kernel is the gate, so its rules bind here: a world id that is not a
     * sem- id cannot be smuggled in through the expansion */
    const notASeal = refuse(() => v2.expandSeed("world-1", seed));

    ok("relation/v2/identity/a-seed-expands-into-a-D8.1-allocation",
       sameBytes && sameId && notASeal === "WRL_BAD_ALLOCATION",
       `expansion vs §D8.1's constructor: ${sameBytes ? "same bytes" : "DIFFER"}` +
       `, derived rel- matches the kernel's: ${sameId}, a non-sem world id -> ` +
       `${notASeal}`);
  }

  /* -- the encoding is IN the world id. §7 of the ruling, as a consequence
   *    rather than as an extra rule.
   *
   * The same topology written in the two encodings is two byte strings and
   * therefore two worlds. That is why a V2 -> V1 downgrade produces a NEW
   * artifact with its own `sem-`, and why nothing here preserves an id across
   * an encoding change. */
  {
    const wellFormed = /^sem-[0-9a-f]{64}$/.test(base.world_id);
    ok("relation/v2/identity/the-encoding-is-in-the-world-id",
       wellFormed && base.world_id !== demo.semanticId,
       `V2 world ${base.world_id} vs the V1 world of the same topology ` +
       `${demo.semanticId}; well-formed: ${wellFormed}. A shared prefix says ` +
       `both name a sealed world; a shared VALUE would say the encoding is ` +
       `not in the bytes`);
  }

  /* -- §D8.5, arriving in V2: a relation id is WORLD-scoped.
   *
   * Edit one relation and every relation's `rel-` moves, because the world id
   * moved and the world id is in every allocation. Only the edited relation's
   * `rev-` moves, because a revision is standalone (§D8.3).
   *
   * That asymmetry is not an inconvenience to be engineered away -- it is the
   * reason a migration has to be an explicit claim someone carries rather than
   * an id that happens to survive.
   *
   * The perturbation is a REWIRE -- one relation's source terminal moved from
   * one Pulser to the other -- and it used to be `attributes: { note: ... }`.
   * B.6's world gate refuses that world, correctly: `forge.world.core.v1`
   * declares no attribute vocabulary, so a relation carrying one is not a
   * world this profile defines and no `sem-` should exist for it. A law about
   * identity has to be perturbed by something the profile ADMITS, or it is
   * measuring the id of a world that cannot be built. */
  {
    const edited = world();
    const rel0 = edited.relations[0];
    edited.relations[0] = {
      identity_seed: rel0.identity_seed,
      revision: { ...rel0.revision,
                  endpoints: rel0.revision.endpoints.map((e) =>
                    e.role === "source"
                      ? { ...e, terminal: { ...e.terminal, object_id: "p1" } }
                      : e) },
    };
    const after = await v2.deriveV2Relations(edited);

    const b = idsByName(base), a = idsByName(after);
    const touched = base.relations[0].identity_seed.relation_name;
    let relMoved = 0, revMoved = [];
    for (const [name, ids] of b) {
      if (a.get(name).rel !== ids.rel) relMoved++;
      if (a.get(name).rev !== ids.rev) revMoved.push(name);
    }

    ok("relation/v2/identity/a-relation-id-is-world-scoped",
       after.world_id !== base.world_id &&
       relMoved === b.size &&
       revMoved.length === 1 && revMoved[0] === touched,
       `one relation edited: ${relMoved}/${b.size} rel- ids moved (want all ` +
       `-- the world id is in every allocation), rev- ids moved for ` +
       `[${revMoved.join(", ")}] (want [${touched}] only -- a revision is ` +
       `standalone under §D8.3)`);
  }

  /* -- and the other half of that pair: a `rev-` is world-INDEPENDENT.
   *
   * Two worlds whose relations differ only in NAME hold the same structures,
   * so every `rev-` recurs and no `rel-` does. Compared as multisets, because
   * renaming re-sorts the canonical array -- position is not identity here. */
  {
    const renamed = world();
    renamed.relations = renamed.relations.map((r, i) => ({
      identity_seed: { variant: "named-initial", relation_name: `zz${i}` },
      revision: r.revision,
    }));
    const other = await v2.deriveV2Relations(renamed);

    const bag = (v, k) => v.relations.map((r) => r[k]).sort();
    const revsMatch = W.serializeArtifact(bag(other, "revision_id")) ===
                      W.serializeArtifact(bag(base, "revision_id"));
    const shared = bag(other, "relation_id")
      .filter((id) => bag(base, "relation_id").includes(id));

    ok("relation/v2/identity/a-revision-id-is-world-independent",
       revsMatch && shared.length === 0 &&
       other.world_id !== base.world_id,
       `renaming every relation: rev- multiset ` +
       `${revsMatch ? "recurs exactly" : "CHANGED"}, ${shared.length} rel- ` +
       `id(s) shared (want 0). A revision names a structure and a relation ` +
       `names a thing in a world, so exactly one of the two should survive ` +
       `being renamed`);
  }

  /* -- derivation is a pure READ. Nothing it computes is written back.
   *
   * A derivation that memoised an id into the artifact would move the artifact
   * that produced it, so the second call would derive from different bytes.
   * The `DERIVED_NEVER_STORED` refusal is the door; this is the room. */
  {
    const w = world();
    const before = W.serializeArtifact(w);
    await v2.deriveV2Relations(w);
    const after = W.serializeArtifact(w);

    const leaked = v2.serializeV2Artifact(w);
    const carries = ["rel-", "rev-", "world_id"]
      .filter((needle) => leaked.includes(needle));

    ok("relation/v2/identity/derivation-writes-nothing-back",
       before === after && carries.length === 0,
       before === after
         ? `canonical bytes carry [${carries.join(", ")}] after a derivation`
         : `the artifact was mutated by deriving from it`);
  }

  /* -- one pair per relation, both well formed, all distinct.
   *
   * The counting check is the boring one and it catches the loud failures: a
   * relation silently dropped, an id that is a stringified object, two
   * relations collapsing onto one allocation past the duplicate-seed gate. */
  {
    const rels = base.relations;
    const shaped = rels.every((r) =>
      /^rel-[0-9a-f]{64}$/.test(r.relation_id) &&
      /^rev-[0-9a-f]{64}$/.test(r.revision_id));
    const distinct = new Set(rels.map((r) => r.relation_id)).size;

    ok("relation/v2/identity/every-relation-gets-exactly-one-pair",
       rels.length === baseRelations.length && shaped &&
       distinct === rels.length &&
       base.seedsInArtifactBytes === true && base.idsInArtifactBytes === false,
       `${rels.length}/${baseRelations.length} relations, well-formed ids: ` +
       `${shaped}, distinct rel- ids: ${distinct}/${rels.length}, seeds in ` +
       `bytes: ${base.seedsInArtifactBytes}, ids in bytes: ` +
       `${base.idsInArtifactBytes}`);
  }

  }

  /* ============================================== 21e. the migration, B.3
   *
   * The claim this slice must NOT make is that a migrated relation keeps its
   * id. It cannot: the world id moved, and the world id is in every
   * allocation. What survives is the `rev-`, because a revision is standalone
   * -- so the structure crosses intact and the name does not, and "these two
   * are the same relation" stays a claim someone carries rather than a fact
   * the bytes show.
   *
   * Every check below is written against that asymmetry rather than around
   * it. The tempting alternative -- a migration that mints a `named-initial`
   * seed per edge so the ids look stable -- is tested for and refused. */
  if (demo.ok && baseRelations.length > 1) {

  const v1 = demo.artifact;
  const migrated = v2.migrateV1ToV2(v1);

  /* -- the migration mints the variant that records "never named", and the
   *    authority that stops it minting the other one is checked at the same
   *    boundary rather than assumed from the output. */
  {
    const variants = [...new Set(
      migrated.relations.map((r) => r.identity_seed.variant))];
    const invented = refuse(() => v2.assertImportableSeed(
      { variant: "named-initial", relation_name: "sig0" }));
    /* and the reverse: what a migration may mint, an author may not */
    const authored = refuse(() => v2.assertAuthorableSeed(
      migrated.relations[0].identity_seed));

    ok("relation/v2/migration/an-import-mints-only-unnamed-seeds",
       W.serializeArtifact(variants) === W.serializeArtifact(["legacy-edge"]) &&
       invented === "WRL_UNWRITABLE_SEED" &&
       authored === "WRL_UNWRITABLE_SEED",
       `migrated seed variants [${variants.join(", ")}], a name minted by the ` +
       `importer -> ${invented}, a legacy seed offered by an author -> ` +
       `${authored}. A migration that named every relation it touched would ` +
       `make an import look like authorship, and would collide with the first ` +
       `author who later writes that name deliberately`);
  }

  /* -- nothing but the encoding moved. Every key the migration does not own
   *    passes through byte-identically.
   *
   * A migration that also normalised `objects`, or reached into `schemas`,
   * would make the world differ from its source for reasons unrelated to the
   * change being made -- and then no test could attribute a moved id to the
   * migration rather than to the tidying. */
  {
    const owned = new Set(["ir_version", "edges", "relations"]);
    const drift = Object.keys(v1)
      .filter((k) => !owned.has(k))
      .filter((k) => W.serializeArtifact(v1[k]) !==
                     W.serializeArtifact(migrated[k]));
    const keys = new Set(Object.keys(migrated));

    ok("relation/v2/migration/only-the-encoding-moves",
       drift.length === 0 && !keys.has("edges") && keys.has("relations") &&
       migrated.ir_version === v2.V2_IR_VERSION,
       drift.length ? `key(s) [${drift.join(", ")}] changed, and the migration ` +
                      `does not own them`
                    : `edges present: ${keys.has("edges")}, relations present: ` +
                      `${keys.has("relations")}, version ${migrated.ir_version}`);
  }

  /* -- §D8.5, as the migration's central and least comfortable property:
   *    every `rev-` survives and no `rel-` does. */
  {
    const before = await s.deriveRelations(v1);
    const after = await v2.deriveV2Relations(migrated);

    const bag = (v, k) => v.relations.map((r) => r[k]).sort();
    const revsSurvive = W.serializeArtifact(bag(after, "revision_id")) ===
                        W.serializeArtifact(bag(before, "revision_id"));
    const relsShared = bag(after, "relation_id")
      .filter((id) => bag(before, "relation_id").includes(id));

    ok("relation/v2/migration/structure-survives-and-identity-does-not",
       revsSurvive && relsShared.length === 0 &&
       after.world_id !== before.world_id,
       `rev- multiset ${revsSurvive ? "recurs exactly" : "CHANGED"}, ` +
       `${relsShared.length} rel- id(s) shared (want 0), world ` +
       `${before.world_id} -> ${after.world_id}. A migration that reported a ` +
       `preserved rel- would be claiming the thing §D8.5 exists to deny`);
  }

  /* -- so the claim is carried by a CORRESPONDENCE, verified by the kernel's
   *    existing checker rather than by a second one written for V2.
   *
   * §D8.5 asks for one checkable claim, not one per encoding pair. If the
   * cross-family correspondence needed its own verifier, the rule would have
   * an exception exactly where migrations actually happen. */
  {
    const sealedV1 = { artifact: v1, semanticId: demo.semanticId };
    const semV2 = await v2.v2WorldIdOfArtifact(migrated);
    const sealedV2 = { artifact: migrated, semanticId: semV2 };
    const corr = await v2.migrationCorrespondence(sealedV1, sealedV2);

    const facts = s.candidateImportedFacts(corr);
    const honest = refuse(() => s.checkRelationImported(facts, corr));
    const tampered = refuse(() => s.checkRelationImported(
      [{ ...facts[0], to_relation: "rel-" + "0".repeat(64) }], corr));

    ok("relation/v2/migration/the-claim-is-checked-by-the-kernels-own-checker",
       corr.pairs.length === v1.edges.length &&
       corr.dropped.length === 0 && corr.added.length === 0 &&
       corr.identityPreserved === false &&
       honest === null && tampered === "WRL_UNVERIFIED_IMPORT",
       `${corr.pairs.length}/${v1.edges.length} paired, ${corr.dropped.length} ` +
       `dropped, ${corr.added.length} added, identityPreserved ` +
       `${corr.identityPreserved} (want false), candidate facts -> ${honest}, ` +
       `a forged to_relation -> ${tampered}`);
  }

  /* -- the round trip returns the original BYTES, not merely the original
   *    relations.
   *
   * This check was twice weaker than this, and both times because of a bug in
   * `downgradeV2ToV1` rather than anything inherent to the two encodings. It
   * first read "returns the original bytes", failed, and was weakened to a
   * multiset comparison under the explanation that V1 leaves edge order to the
   * author. That was false -- `canonicalizeGraph` sorts. It was then weakened
   * again under a better but still wrong explanation: that the two encodings
   * sort by DIFFERENT keys and so cannot both be right about one sequence.
   *
   * The premise is true and the conclusion did not follow. Both encodings do
   * sort, and by different keys, but a downgrade writes the key of the
   * encoding it is WRITING -- and the version that did not was producing a V1
   * artifact in V2's order: valid against every field rule, correct as a set,
   * and carrying a `sem-` that no seal of that world could ever produce. The
   * permutation was never the encodings disagreeing where an observer could
   * see it. It was one line of missing normalisation.
   *
   * So the check is back to the strong form, and the moral is kept with it: a
   * failing check is a claim about the world only after the code it is
   * checking has been ruled out, and an explanation that makes a failure feel
   * inevitable is the most expensive kind to accept. */
  {
    const back = v2.downgradeV2ToV1(migrated, v1.ir_version);
    const again = v2.downgradeV2ToV1(
      v2.migrateV1ToV2(back), back.ir_version);
    const exact = W.serializeArtifact(back) === W.serializeArtifact(v1);

    /* the target version is chosen, not remembered -- V2 records no
     * provenance, so a downgrade that guessed would be inventing one */
    const guessed = refuse(() => v2.downgradeV2ToV1(migrated, "3.0"));

    ok("relation/v2/migration/the-round-trip-returns-the-original-bytes",
       exact && back.edges.length === v1.edges.length &&
       W.serializeArtifact(again) === W.serializeArtifact(back) &&
       guessed === "WRL_UNSUPPORTED_IR_VERSION",
       `V1 -> V2 -> V1 is byte-exact: ${exact} (${back.edges.length}/` +
       `${v1.edges.length} edges), second pass is a fixed point: ` +
       `${W.serializeArtifact(again) === W.serializeArtifact(back)}, ` +
       `an unnamed target version -> ${guessed}`);
  }

  /* -- the two encodings sort by DIFFERENT keys, and that is invisible from
   *    outside, because a downgrade writes the key of the encoding it writes.
   *
   * Neither side is careless with order. Sealing a V1 source with its lines
   * reversed produces the same `edges` array, because `canonicalizeGraph`
   * sorts them; `relations` is sorted too. They just disagree about the key:
   *
   *   V1 sorts `edges` by the tuple it stores them as: `(kind, src, dst)`.
   *   V2 sorts `relations` by canonical `identity_seed` bytes -- key-sorted
   *   JSON -- so a `legacy-edge` seed compares on `dst`, then `kind`, then
   *   `src`, then `variant`.
   *
   * Two total orders over the same set, neither one authored. An order is
   * canonical only WITHIN an encoding, so the disagreement is real and
   * unavoidable INSIDE V2 -- and it must not survive the boundary, because a
   * V1 artifact carrying V2's order is one whose `sem-` no seal could produce.
   *
   * Four things are pinned. That each side really is sorted by its own key
   * (so this is a disagreement, not a mess). That the keys really do disagree
   * on this world -- without which every claim here is vacuous. That the
   * downgrade nevertheless lands in V1's order, so V1 -> V2 -> V1 preserves
   * the `sem-`. And that the V2 world's own id still differs from both, which
   * is §7 and is true for the ordinary reason: different bytes.
   *
   * The vacuity guard is the load-bearing one. Delete `disagree` and this
   * check passes just as well against an encoding that never reordered
   * anything, i.e. against exactly the world in which the bug it was written
   * for could not have happened. */
  {
    const back = v2.downgradeV2ToV1(migrated, v1.ir_version);
    const semV2 = await v2.v2WorldIdOfArtifact(migrated);
    const semBack = await s.worldIdOfArtifact(back);

    /* each side is sorted -- by its own key, not by nothing */
    const byTuple = (a, b) => W.serializeArtifact([a.kind, a.src, a.dst])
      .localeCompare(W.serializeArtifact([b.kind, b.src, b.dst]));
    const v1Sorted = W.serializeArtifact(v1.edges) ===
      W.serializeArtifact(v1.edges.slice().sort(byTuple));
    const seedOrder = migrated.relations.map((r) => v2.seedKey(r.identity_seed));
    const v2Sorted = W.serializeArtifact(seedOrder) ===
                     W.serializeArtifact(seedOrder.slice().sort());

    /* the keys really do disagree about THIS world: reading the relations off
     * in V2's order gives a sequence V1 would never have written */
    const asStored = migrated.relations.map(
      (r) => s.projectRelationRevisionToV1Edge(r.revision));
    const disagree = W.serializeArtifact(asStored) !==
                     W.serializeArtifact(v1.edges);

    /* ...and the downgrade lands in V1's order anyway, so the `sem-` returns */
    const restored = W.serializeArtifact(back.edges) ===
                     W.serializeArtifact(v1.edges) &&
                     semBack === demo.semanticId;

    ok("relation/v2/migration/the-two-encodings-sort-by-different-keys",
       v1Sorted && v2Sorted && disagree && restored &&
       semV2 !== demo.semanticId && semV2 !== semBack,
       `V1 sorted by (kind, src, dst): ${v1Sorted}, V2 sorted by seed bytes: ` +
       `${v2Sorted}, the two keys disagree here: ${disagree}, and the ` +
       `downgrade lands in V1's order so the sem- returns: ${restored} ` +
       `(${semBack.slice(0, 12)}… == ${demo.semanticId.slice(0, 12)}…). The ` +
       `V2 world keeps an id of its own (${semV2.slice(0, 12)}…) for the ` +
       `ordinary reason: different bytes`);
  }

  /* -- a NAMED relation added to a migrated world has no legacy counterpart,
   *    and the correspondence says `added` rather than inventing a pairing.
   *
   * §D8.5's "silence is not continuity", from the other direction: a relation
   * with no V1 preimage is not a relation the V1 world quietly also had. */
  {
    /* The added relation is a REAL new wire -- a spare Door, and the second
     * Pulser's signal retargeted onto it -- rather than a second copy of an
     * existing revision. Copying one used to be enough, because nothing
     * checked the world; B.6 refuses it as `WRL_CONTROLLER_CONFLICT`, which is
     * what a duplicated wire actually is. */
    const spare = {
      object_id: "d1", role: "Door", static_config: {},
      state_schema_ref: "state.door.v1", ports: W.objectPorts("Door"),
    };
    const onto = migrated.relations.find(
      (r) => s.projectRelationRevisionToV1Edge(r.revision).dst === "d0");
    const grown = { ...migrated, objects: [...migrated.objects, spare],
      relations: [
      ...migrated.relations,
      { identity_seed: { variant: "named-initial", relation_name: "fresh" },
        revision: { ...onto.revision,
                    endpoints: onto.revision.endpoints.map((e) =>
                      e.role === "target"
                        ? { ...e, terminal: { ...e.terminal, object_id: "d1" } }
                        : e) } }] };
    const semGrown = await v2.v2WorldIdOfArtifact(grown);
    const corr = await v2.migrationCorrespondence(
      { artifact: v1, semanticId: demo.semanticId },
      { artifact: grown, semanticId: semGrown });

    ok("relation/v2/migration/a-named-relation-has-no-legacy-counterpart",
       corr.pairs.length === v1.edges.length && corr.added.length === 1 &&
       corr.dropped.length === 0,
       `${corr.pairs.length} paired, ${corr.added.length} added (want 1), ` +
       `${corr.dropped.length} dropped. A named relation has no legacy key, ` +
       `so pairing it would mean pairing on something other than a preimage`);
  }

  /* -- and the correspondence recomputes both seals. A sealed-LOOKING record
   *    carrying a forged id is refused on either side. */
  {
    const forged = "sem-" + "0".repeat(64);
    const semV2 = await v2.v2WorldIdOfArtifact(migrated);
    let left = null, right = null;
    try {
      await v2.migrationCorrespondence(
        { artifact: v1, semanticId: forged },
        { artifact: migrated, semanticId: semV2 });
      left = "ACCEPTED";
    } catch (e) { left = e.code || String(e); }
    try {
      await v2.migrationCorrespondence(
        { artifact: v1, semanticId: demo.semanticId },
        { artifact: migrated, semanticId: forged });
      right = "ACCEPTED";
    } catch (e) { right = e.code || String(e); }

    ok("relation/v2/migration/both-seals-are-recomputed",
       left === "WRL_SEMANTIC_ID_MISMATCH" &&
       right === "WRL_SEMANTIC_ID_MISMATCH",
       `a forged V1 seal -> ${left}, a forged V2 seal -> ${right}. A ` +
       `migration is exactly where a caller holds two worlds and is best ` +
       `placed to be wrong about one of them`);
  }

  /* -- §D8.16: adoption is the way OUT of the state a migration leaves a
   *    world in, and it is one ACT rather than a fix-up.
   *
   * Without it the migration is a one-way door out of the language: a
   * migrated world runs, seals and compares, and can never again be handed to
   * an author as text. With it, the limit is a step someone takes.
   *
   * Four things are checked together because they only mean anything
   * together. The structure does not move -- every `rev-` recurs, since a
   * revision is standalone and a name is not in it. The identity moves
   * entirely -- the seeds changed, so the bytes changed, so the world `sem-`
   * moved, so EVERY `rel-` is new including the ones nobody adopted. The
   * names are the caller's. And the formatter, which refuses a migrated
   * world, accepts an adopted one -- which is the whole point of the
   * operation, stated as a difference in behaviour rather than a claim. */
  {
    const assign = migrated.relations.map((r, i) => {
      const e = s.projectRelationRevisionToV1Edge(r.revision);
      return { kind: e.kind, src: e.src, dst: e.dst,
               relation_name: `adopted_${i}` };
    });
    const { artifact: adopted, correspondence: corr } =
      await v2.adoptLegacyRelations(migrated, assign);

    const before = await v2.deriveV2Relations(migrated);
    const after = await v2.deriveV2Relations(adopted);

    const revs = (v) => W.serializeArtifact(
      v.relations.map((r) => r.revision_id).sort());
    const structureKept = revs(before) === revs(after);
    const worldMoved = corr.from_world !== corr.to_world;
    const beforeIds = new Set(before.relations.map((r) => r.relation_id));
    const allMoved = after.relations.every((r) => !beforeIds.has(r.relation_id));
    const allNamed = adopted.relations.every(
      (r) => r.identity_seed.variant === "named-initial");
    /* the names are the ones supplied, and no others exist */
    const namesGiven = W.serializeArtifact(
      adopted.relations.map((r) => r.identity_seed.relation_name).sort()) ===
      W.serializeArtifact(assign.map((a) => a.relation_name).sort());

    /* the formatter refuses the migrated world and accepts the adopted one */
    const beforeFmt = refuse(() => v2.formatNamedWorld(migrated));
    let afterFmt = null;
    try { afterFmt = v2.formatNamedWorld(adopted); }
    catch (e) { afterFmt = null; }

    ok("relation/v2/adoption/adoption-names-a-migrated-world",
       structureKept && worldMoved && allMoved && allNamed && namesGiven &&
       corr.revisionsPreserved === true && corr.identityPreserved === false &&
       corr.pairs.length === migrated.relations.length &&
       corr.pairs.every((p) => p.adopted === true) &&
       beforeFmt === "WRL_UNWRITABLE_SEED" && typeof afterFmt === "string",
       `every rev- recurs: ${structureKept}, the world id moves: ` +
       `${worldMoved}, every rel- is new: ${allMoved}, every seed is now ` +
       `named-initial: ${allNamed}, and the names are exactly the ones ` +
       `supplied: ${namesGiven}. The formatter refuses the migrated world ` +
       `(${beforeFmt}) and writes the adopted one ` +
       `(${typeof afterFmt === "string" ? "accepted" : "refused"}). A ` +
       `migration is a one-way door out of the language without this`);
  }

  /* -- and the names are SUPPLIED. Every way of not supplying one is refused,
   *    and none of them falls back to deriving one.
   *
   * A generated name would make the formatter's forbidden move legal by
   * moving it one function to the left, and would then be indistinguishable
   * in the bytes from a name an author chose -- which is the confusion
   * `legacy-edge` exists to prevent. */
  {
    const one = s.projectRelationRevisionToV1Edge(migrated.relations[0].revision);
    const sel = { kind: one.kind, src: one.src, dst: one.dst };
    const at = (a) => refuseAsync(() => v2.adoptLegacyRelations(migrated, a));

    /* every legacy selector in this world, so a case can be exhaustive in
     * everything except the one mistake it is testing. Since C.0 made adoption
     * atomic, a case that names a SUBSET is refused for being a subset, and
     * would never reach the rule it meant to exercise. */
    const every = migrated.relations.map((r) => {
      const e = s.projectRelationRevisionToV1Edge(r.revision);
      return { kind: e.kind, src: e.src, dst: e.dst };
    });
    const namedBy = (f) => every.map((x, i) => ({ ...x, relation_name: f(i) }));

    const nothing = await at([]);
    /* an absent key and a present-but-empty one are different mistakes and
     * get different answers: one assignment is the wrong SHAPE, the other is
     * the right shape declining to supply the one thing adoption is for */
    const omitted = await at([sel]);
    const nameless = await at([{ ...sel, relation_name: undefined }]);
    const notAName = await at([{ ...sel, relation_name: "not a name" }]);
    const unknown  = await at([{ kind: one.kind, src: "ghost", dst: one.dst,
                                 relation_name: "g" }]);
    const twice = await at([{ ...sel, relation_name: "a" },
                            { ...sel, relation_name: "b" }]);
    /* exhaustive, and two of the names are the same one -- so this reaches the
     * ENCODER, which is where a repeated name has always been refused */
    const collide = migrated.relations.length > 1
      ? await at(namedBy((i) => (i < 2 ? "same" : `n${i}`)))
      : "WRL_DUPLICATE_RELATION_SEED";
    const stray = await at([{ ...sel, relation_name: "a", note: "hi" }]);

    ok("relation/v2/adoption/a-name-is-supplied-never-generated",
       nothing === "WRL_INCOMPLETE_ADOPTION" &&
       omitted === "WRL_BAD_V2_ARTIFACT" &&
       nameless === "WRL_MISSING_RELATION_NAME" &&
       notAName === "WRL_BAD_RELATION_NAME" &&
       unknown === "WRL_UNKNOWN_RELATION" &&
       twice === "WRL_DUPLICATE_ADOPTION" &&
       collide === "WRL_DUPLICATE_RELATION_SEED" &&
       stray === "WRL_BAD_V2_ARTIFACT",
       `adopting nothing -> ${nothing}, an omitted name key -> ${omitted}, ` +
       `an empty name -> ${nameless}, a non-identifier -> ${notAName}, a ` +
       `relation this world does not have -> ${unknown}, one relation ` +
       `adopted twice -> ${twice}, two relations under one name -> ` +
       `${collide}, an unrecognised assignment key -> ${stray}. None of the ` +
       `eight produces a name`);
  }

  /* -- adoption is ATOMIC: one act, or none. C.0.
   *
   * B.6 allowed a partial adoption and registered "a partly adopted world is
   * still unwritable" as a law. Every word of that was true and it was the
   * wrong thing to permit, which is a distinction the register is not built
   * to make -- a passing check does not ask whether the behaviour it pins
   * should exist.
   *
   * What a partial adoption actually did: SEAL. The half-named world is a
   * real world with a real `sem-`, every `rel-` in it re-minted -- including
   * the relations nobody touched, because §D8.5 scopes them to a world id
   * that just moved -- and no surface can write it. Adopting the rest moves
   * every id a second time. So naming four relations two at a time minted two
   * throwaway worlds whose ids are indistinguishable from wanted ones, and
   * left a caller who stopped halfway with an artifact that runs, seals,
   * compares, and cannot be edited.
   *
   * The distinction that dissolves it: collecting names is EDITOR work and
   * editor state is not sealed. So the refusal is not a restriction on what a
   * caller may want -- it is a statement about where the seal goes.
   *
   * Three things, and the third is the one that makes it a law rather than a
   * preference: the partial is refused, the exhaustive one succeeds, and the
   * refused partial left NOTHING behind. */
  if (migrated.relations.length > 1) {
    const every = migrated.relations.map((r) => {
      const e = s.projectRelationRevisionToV1Edge(r.revision);
      return { kind: e.kind, src: e.src, dst: e.dst };
    });
    const beforeBytes = W.serializeArtifact(migrated);

    const partial = await refuseAsync(() => v2.adoptLegacyRelations(migrated,
      [{ ...every[0], relation_name: "only_one" }]));

    /* the same call minus the mistake: exhaustive, and it writes */
    const { artifact: whole } = await v2.adoptLegacyRelations(migrated,
      every.map((x, i) => ({ ...x, relation_name: `whole_${i}` })));
    const written = (() => {
      try { return typeof v2.formatNamedWorld(whole) === "string"; }
      catch { return false; }
    })();
    const allNamed = whole.relations.every(
      (r) => r.identity_seed.variant === "named-initial");

    /* nothing was minted on the way through the refusal, and the world the
     * caller passed in is untouched -- an adoption that throws must not have
     * been half-applied to its argument */
    const argumentIntact = W.serializeArtifact(migrated) === beforeBytes;

    /* and an adopted world is not re-adoptable: every relation has a name */
    const again = await refuseAsync(() => v2.adoptLegacyRelations(whole,
      [{ ...every[0], relation_name: "twice" }]));

    ok("relation/v2/adoption/adoption-is-atomic-or-refused",
       partial === "WRL_INCOMPLETE_ADOPTION" && written && allNamed &&
       argumentIntact && again === "WRL_UNKNOWN_RELATION",
       `adopting 1 of ${every.length} -> ${partial}, and the argument was ` +
       `left byte-identical: ${argumentIntact}. All ${every.length} at once ` +
       `-> every seed named-initial: ${allNamed}, formatter writes it: ` +
       `${written}. Re-adopting an already-named relation -> ${again}. ` +
       `A migrated world takes exactly one adoption to become writable, and ` +
       `a partial one would have sealed an unwritable world and re-minted ` +
       `every id in it twice`);
  }

  }

  /* ================================================ 21f. the surface, B.4
   *
   * §9: `[clock_feed]: [p0] --sig--> [r0]`. A V2 source is a V1 source whose
   * route lines carry a name, and that is the whole language change.
   *
   * The load-bearing check in this section is the PAIRING one. Everything
   * else here is a refusal that fires loudly the first time it is wrong; a
   * mis-attached name is silent -- the world seals, every id is well-formed,
   * and every one of them is wrong. So it is tested against a world whose
   * authored order, parsed order and V2 order are three DIFFERENT orders,
   * which is the arrangement an index-based zip passes only by luck. */
  if (demo.ok) {

  /* §D8.15: a V2 world declares its encoding on the line after the profile.
   * The names are attached FIRST, off the V1 line indices, so `n9` stays the
   * name of the line that was line 9 of the world these tests talk about. */
  const withIr = (src, v = "2.0") => {
    const l = src.split("\n");
    l.splice(1, 0, `ir ${v}`);
    return l.join("\n");
  };
  /* what a LINE-PRESERVING header stripper leaves behind: the V1 text with a
   * blank line where the declaration was, so every reported line number is
   * still a line number in the text the author wrote */
  const blankIrLine = (src) => {
    const l = src.split("\n");
    l.splice(1, 0, "");
    return l.join("\n");
  };
  /* names chosen so the sorted-by-name V2 order disagrees with both the
   * authored order and the canonical `(kind, src, dst)` one */
  const NAMED_DEMO = withIr(W.DEMO_WORLD.split("\n")
    .map((l, i) => (/-->/.test(l) ? `[n${i}]: ${l}` : l)).join("\n"));
  const parsed = await v2.parseNamedWorld(NAMED_DEMO);
  const bad = async (src) => {
    const r = await v2.parseNamedWorld(src);
    return r.ok ? "ACCEPTED" : `${r.code}@${r.line}`;
  };

  /* -- V2 adds an encoding declaration and names, and touches nothing else.
   *
   * The evidence is that stripping both returns the V1 source it was written
   * over -- byte for byte once the header line is accounted for -- and that
   * the artifact the spine validated is the artifact the V1 parser produces
   * from that source. A surface that also normalised whitespace, or
   * re-ordered declarations, would be a second parser agreeing with `wrl.js`
   * today.
   *
   * Both strippers are LINE-PRESERVING, which is why the comparison is
   * against the V1 source with a blank line where the header was rather than
   * against the V1 source itself: every line number a diagnostic reports is a
   * line number in the text the author wrote, and a stripper that deleted its
   * line would shift every one of them. */
  {
    const stripped = v2.stripRelationNames(v2.stripIrHeader(NAMED_DEMO).source);
    const v1seal = await W.sealWorld(W.DEMO_WORLD);
    const blanked = blankIrLine(W.DEMO_WORLD);

    const bytesBack = stripped.source === blanked;
    const sameArtifact =
      W.serializeArtifact(parsed.v1) === W.serializeArtifact(v1seal.artifact);

    ok("relation/v2/surface/a-name-is-the-only-thing-v2-adds",
       parsed.ok === true && bytesBack && sameArtifact &&
       stripped.source.split("\n").length === NAMED_DEMO.split("\n").length,
       parsed.ok
         ? `stripping the header and the names returns the V1 source with the ` +
           `header line blanked, byte-for-byte: ${bytesBack}, line count ` +
           `preserved, and the validated artifact is the one the V1 parser ` +
           `produces from the unheadered V1 source: ${sameArtifact}`
         : `the named demo world did not parse: ${parsed.code}`);
  }

  /* -- §D8.15: a world says which encoding it is written in, and the reason
   *    is that otherwise SOME WORLDS HAVE TWO IDS.
   *
   * This is not a style rule. Take a route-free source -- a profile line and
   * nothing else -- and hand it to both parsers. Both accept. They produce
   * two DIFFERENT valid artifacts with two different `sem-` ids, and there is
   * nothing in the text that says which one those bytes mean. The id of a
   * world would then depend on which function a caller happened to reach for,
   * which is the one thing an identity spine may not permit.
   *
   * With the header the text decides, and the two ids belong to two texts. */
  {
    const bare = "profile forge.world.core.v1\n";
    const asV1 = await W.sealWorld(bare);
    const asV2 = await v2.parseNamedWorld(withIr(bare));
    const v2id = asV2.ok ? await v2.v2WorldIdOfArtifact(asV2.artifact) : null;
    /* and the SAME bytes, unheadered, are no longer a V2 world at all */
    const undeclared = await v2.parseNamedWorld(bare);

    ok("relation/v2/source/an-encoding-is-declared-not-assumed",
       asV1.ok === true && asV2.ok === true &&
       typeof v2id === "string" && v2id !== asV1.semanticId &&
       undeclared.ok === false &&
       undeclared.code === "WRL_MISSING_IR_HEADER",
       `the same route-free text seals to ${asV1.semanticId} as V1 and ` +
       `${v2id} as V2 -- two valid worlds, two ids, one byte string -- so ` +
       `the undeclared source is refused: ${undeclared.code}. A world's id ` +
       `may not depend on which parser the caller reached for`);
  }

  /* -- and every way of getting the declaration wrong has its own answer.
   *
   * Modelled on the profile header's checks line for line, because it is the
   * same shape of mistake: an author writes one declaration, in one place, in
   * one spelling, and each of the four ways of failing that is a different
   * thing to tell them. `stripIrHeader` asks `validateProfileHeader` where
   * the block starts rather than counting lines itself, so `profile` staying
   * first is one rule and not two. */
  {
    const at = (src) => v2.stripRelationNames && (() => {
      try { v2.stripIrHeader(src); return "ACCEPTED"; }
      catch (e) { return e.code || String(e); }
    })();
    const lines = NAMED_DEMO.split("\n");

    const missing = at(W.DEMO_WORLD);
    const twice = at([lines[0], "ir 2.0", "ir 2.0", ...lines.slice(2)]
      .join("\n"));
    const bald = at([lines[0], "ir", ...lines.slice(2)].join("\n"));
    const wordy = at([lines[0], "ir 2.0 please", ...lines.slice(2)].join("\n"));
    const future = at(withIr(W.DEMO_WORLD, "3.0"));
    /* declared, but not FIRST: an object comes between it and the profile */
    const late = at([lines[0], "[orb:zz]{pose}", "ir 2.0", ...lines.slice(2)]
      .join("\n"));
    /* the profile's own rule still fires, and from the profile's own checker */
    const noProfile = at("ir 2.0\n");
    /* a comment is not a declaration, in either direction */
    const commented = at([lines[0], "; ir 2.0", "ir 2.0", ...lines.slice(2)]
      .join("\n"));

    ok("relation/v2/source/one-declaration-in-one-place-in-one-spelling",
       missing === "WRL_MISSING_IR_HEADER" &&
       twice === "WRL_DUPLICATE_IR_HEADER" &&
       bald === "WRL_MALFORMED_IR_HEADER" &&
       wordy === "WRL_MALFORMED_IR_HEADER" &&
       future === "WRL_UNSUPPORTED_IR_VERSION" &&
       late === "WRL_MISSING_IR_HEADER" &&
       noProfile === "WRL_MISSING_PROFILE" &&
       commented === "ACCEPTED",
       `absent -> ${missing}, declared twice -> ${twice}, no version -> ` +
       `${bald}, more than a version -> ${wordy}, a version this surface ` +
       `does not read -> ${future}, declared after something else -> ` +
       `${late}, no profile at all -> ${noProfile} (raised by the FROZEN ` +
       `profile checker, not a second copy of it), and a commented-out ` +
       `declaration is not one -> ${commented}`);
  }

  /* -- §9: an unnamed route under native V2 is an error, never a name
   *    derived from the endpoints.
   *
   * Deriving one would be worse than convenient: a relation named after its
   * terminals is re-minted the moment an object is renamed, so the identity
   * would track the spelling of something else. The line reported is the
   * AUTHORED one, which matters because names are stripped before the spine
   * ever sees the text. */
  {
    const unnamed = await v2.parseNamedWorld(withIr(W.DEMO_WORLD));
    const routeLine = withIr(W.DEMO_WORLD).split("\n")
      .findIndex((l) => /-->/.test(l)) + 1;
    /* the same source under the V1 parser is simply a world -- "native V2" is
     * a fact about which parser was asked, not about the text */
    const asV1 = await W.sealWorld(W.DEMO_WORLD);

    ok("relation/v2/surface/every-route-must-be-named",
       unnamed.ok === false &&
       unnamed.code === "WRL_MISSING_RELATION_NAME" &&
       unnamed.line === routeLine && asV1.ok === true,
       `an unnamed route -> ${unnamed.code} at line ${unnamed.line} ` +
       `(authored line ${routeLine}), while the same source under the V1 ` +
       `parser seals fine: ${asV1.ok}. A name is never derived from the ` +
       `endpoints -- that would re-mint the relation whenever an object is ` +
       `renamed`);
  }

  /* -- a name is an identifier, and a bad one is diagnosed AS a bad name.
   *
   * The prefix is detected loosely and judged afterwards on purpose. A tight
   * `\w+` bracket match would let `[clock-feed]:` fall through to the core
   * parser, which would report a malformed route and send the author to look
   * at the arrow. */
  {
    const hyphen = await bad(NAMED_DEMO.replace("[n9]:", "[clock-feed]:"));
    const spaced = await bad(NAMED_DEMO.replace("[n9]:", "[clock feed]:"));
    const digit  = await bad(NAMED_DEMO.replace("[n9]:", "[0feed]:"));
    const empty  = await bad(NAMED_DEMO.replace("[n9]:", "[]:"));
    const got = [hyphen, spaced, digit, empty];

    ok("relation/v2/surface/a-name-is-an-identifier",
       got.every((g) => g.startsWith("WRL_BAD_RELATION_NAME@")),
       `[clock-feed] -> ${hyphen}, [clock feed] -> ${spaced}, [0feed] -> ` +
       `${digit}, [] -> ${empty}. Each wants WRL_BAD_RELATION_NAME at the ` +
       `authored line; a name that could not be written back out ` +
       `unambiguously is an id that cannot be re-derived`);
  }

  /* -- a name denotes exactly one relation, and zero and many are the same
   *    fault.
   *
   * The `many` case is the one that matters, because it is reachable by
   * accident: sugar expands one authored line into several routes, and a
   * single name over all of them would make one id out of several. */
  {
    const fanout = `profile forge.world.core.v1
ir 2.0

[pulser:p0](every 2){sig_out}
[relay:r0]{sig_in, sig_out}
[door:d0]{sig_in}
[spinner:sp](w=16, n=8, rotor=quarter_turn_z, configurable){sig_in, socket}
[orb:ob]{pose}

[fan]: [pulser:p0] --sig--> {[relay:r0], [door:d0]}
[spin]: [relay:r0] --sig--> [spinner:sp]
[hold]: [spinner:sp] --socket--> [orb:ob]
`;
    const many = await bad(fanout);
    const none = await bad(
      NAMED_DEMO.replace("[pulser:p0]", "[oops]: [pulser:p0]"));

    ok("relation/v2/surface/a-name-denotes-exactly-one-relation",
       many === "WRL_AMBIGUOUS_RELATION_NAME@10" &&
       none.startsWith("WRL_AMBIGUOUS_RELATION_NAME@"),
       `one name over a two-way fan-out -> ${many}, a name on a declaration ` +
       `-> ${none}. Both are the same fault -- the name fails to denote -- ` +
       `so they share a code, and the fan-out case is reported at the line ` +
       `the author wrote rather than at an expanded one`);
  }

  /* -- THE ONE THAT MATTERS. The pairing follows provenance, never order.
   *
   * Three orders disagree in this world. Authored: p0, r0, sp, p1. Parsed:
   * `canonicalizeGraph` sorts by `(kind, src, dst)`, giving p0, p1, r0, sp.
   * V2: sorted by seed bytes, which for a named seed is sorted by NAME,
   * giving n10, n11, n12, n9. An index-based re-attach passes only when those
   * agree, and here no two of them do.
   *
   * So each name is checked against the endpoints of the line that WROTE it,
   * read back out of the source text. That is the only formulation that
   * cannot be satisfied by a lucky ordering. */
  {
    const wrote = new Map();
    for (const line of NAMED_DEMO.split("\n")) {
      const m = /^\[(\w+)\]:\s*\[\w+:(\w+)\]\s*--\w+-->\s*\[\w+:(\w+)\]/.exec(line);
      if (m) wrote.set(m[1], `${m[2]}->${m[3]}`);
    }

    const landed = new Map(parsed.ok ? parsed.artifact.relations.map((r) => {
      const src = r.revision.endpoints.find((e) => e.role === "source");
      const dst = r.revision.endpoints.find((e) => e.role === "target");
      return [r.identity_seed.relation_name,
              `${src.terminal.object_id}->${dst.terminal.object_id}`];
    }) : []);

    const authored = [...wrote.keys()];
    const v2order = parsed.ok
      ? parsed.artifact.relations.map((r) => r.identity_seed.relation_name) : [];
    const parseOrder = parsed.ok
      ? parsed.v1.edges.map((e) => `${e.src}->${e.dst}`) : [];
    const authoredPairs = [...wrote.values()];

    const everyNameLanded = authored.length > 1 &&
      authored.every((n) => landed.get(n) === wrote.get(n));
    /* and the three orders really do disagree, so this was not luck */
    const ordersDiffer =
      W.serializeArtifact(v2order) !== W.serializeArtifact(authored) &&
      W.serializeArtifact(parseOrder) !== W.serializeArtifact(authoredPairs);

    ok("relation/v2/surface/the-pairing-follows-provenance-not-line-order",
       everyNameLanded && ordersDiffer && landed.size === wrote.size,
       `${wrote.size} names, each on the relation its own line wrote: ` +
       `${everyNameLanded}. Authored [${authored.join(", ")}], V2 order ` +
       `[${v2order.join(", ")}], parsed order [${parseOrder.join(", ")}] vs ` +
       `authored routes [${authoredPairs.join(", ")}] -- three orders that ` +
       `disagree: ${ordersDiffer}. A zip by line index passes this only by ` +
       `luck, and a mis-attached name seals silently`);
  }

  /* -- a repeated name is a repeated SEED, and it is the ENCODER that says so.
   *
   * The surface deliberately carries no duplicate-name rule of its own: a
   * second rule about the same fact can disagree with the first, and the
   * encoder's is the one that decides bytes. This check exists because the
   * first spelling of the pairing keyed its map by NAME, so a duplicate
   * quietly overwrote its predecessor, one relation came out unnamed, and the
   * collision was reported as a missing name somewhere else entirely. A
   * surface that de-duplicates its input cannot hand the encoder the
   * collision the encoder exists to refuse. */
  {
    const dup = await bad(NAMED_DEMO.replace("[n11]:", "[n10]:"));
    const codes = Object.keys(v2.RELATION_V2_CODES);

    ok("relation/v2/surface/a-repeated-name-is-a-repeated-seed",
       dup.startsWith("WRL_DUPLICATE_RELATION_SEED") &&
       !codes.some((c) => /DUPLICATE_RELATION_NAME/.test(c)),
       `two routes under one name -> ${dup}, and no separate ` +
       `WRL_DUPLICATE_RELATION_NAME code exists: ` +
       `${!codes.some((c) => /DUPLICATE_RELATION_NAME/.test(c))}. The ` +
       `surface passes the collision down rather than answering it twice`);
  }

  /* -- renaming a relation moves its identity and nothing else.
   *
   * This is what naming BUYS, stated as a difference: the structure is
   * byte-identical -- every `rev-` recurs, because §D8.3 makes a revision
   * standalone and a name is not in it -- while the `rel-` moves, and so does
   * the world. If a rename moved a `rev-` the name would have leaked into the
   * revision; if it did not move a `rel-`, the name would not be the
   * preimage. */
  {
    const renamed = await v2.parseNamedWorld(
      NAMED_DEMO.replace("[n9]:", "[clock_feed]:"));

    const before = await v2.deriveV2Relations(parsed.artifact);
    const after  = await v2.deriveV2Relations(renamed.artifact);

    const revs = (v) => W.serializeArtifact(
      v.relations.map((r) => r.revision_id).sort());
    const rels = (v) => new Set(v.relations.map((r) => r.relation_id));

    const structureKept = revs(before) === revs(after);
    const worldMoved = before.world_id !== after.world_id;
    const allMoved = [...rels(after)].every((id) => !rels(before).has(id));

    ok("relation/v2/surface/renaming-moves-identity-and-nothing-else",
       renamed.ok === true && structureKept && worldMoved && allMoved,
       `every rev- recurs: ${structureKept}, the world id moves: ` +
       `${worldMoved}, and no rel- survives: ${allMoved}. A rename that moved ` +
       `a rev- would mean the name leaked into the revision; one that moved ` +
       `no rel- would mean the name is not the preimage. Every rel- moves ` +
       `rather than just the renamed one because the world id is in every ` +
       `allocation (D8.10 clause 5)`);
  }

  /* -- the same authored name, in two worlds, is two relations. §D8.5, and
   *    the half of it that was registered `surface · awaiting`. B.7.
   *
   * The row said the arithmetic was settled and the surface half untestable,
   * "because there is no syntax for naming a relation". There has been since
   * B.4. The row was true when it was written and nobody re-read it once the
   * syntax landed -- which is the ordinary way a register goes stale, and
   * exactly what a register is for.
   *
   * The check needs a vacuity guard more than most, because the obvious
   * spelling proves nothing. Two worlds with different names would of course
   * derive different `rel-`s, and that is not §D8.5 -- it is just seeds being
   * preimages. What §D8.5 says is that the SAME name is a different relation
   * in a different world, so the two worlds must carry BYTE-IDENTICAL seeds
   * and differ somewhere else entirely.
   *
   * So the second world changes a pulser's clock, which touches no route.
   * That leaves the sharpest possible form of the law standing: every seed is
   * identical, every `rev-` recurs -- the revisions really are the same
   * structure -- and every `rel-` still moves, because the only thing that
   * changed is the world the name is scoped to. If a `rel-` survived here, a
   * name would be a global identifier and two authors could collide across
   * worlds that never met. */
  {
    const other = await v2.parseNamedWorld(
      NAMED_DEMO.replace("(every 2)", "(every 3)"));

    const a = await v2.deriveV2Relations(parsed.artifact);
    const b = await v2.deriveV2Relations(other.artifact);

    const seeds = (art) => W.serializeArtifact(
      art.relations.map((r) => v2.seedKey(r.identity_seed)).sort());
    const names = (art) => art.relations
      .map((r) => r.identity_seed.relation_name).sort();

    /* the guard: same names, and in fact the same seed bytes */
    const sameSeeds = other.ok &&
      seeds(parsed.artifact) === seeds(other.artifact);
    const nameCount = other.ok ? names(other.artifact).length : 0;

    const worldMoved = other.ok && a.world_id !== b.world_id;
    const bIds = new Set(b.relations.map((r) => r.relation_id));
    const allMoved = other.ok &&
      a.relations.every((r) => !bIds.has(r.relation_id));
    /* and the structure genuinely did not move -- no route was touched */
    const revs = (v) => W.serializeArtifact(
      v.relations.map((r) => r.revision_id).sort());
    const sameRevisions = other.ok && revs(a) === revs(b);

    ok("relation/v2/surface/the-same-authored-name-is-world-scoped",
       other.ok === true && sameSeeds && nameCount === 4 && worldMoved &&
       allMoved && sameRevisions,
       `two authored worlds carry the same ${nameCount} names with ` +
       `byte-identical seeds: ${sameSeeds}, and the same revisions: ` +
       `${sameRevisions}. Their world ids differ: ${worldMoved}, and not one ` +
       `rel- survives: ${allMoved}. A name is scoped to the world that ` +
       `minted it -- same name, same structure, different world, different ` +
       `relation -- so no migration is implied between two worlds that ` +
       `happen to have chosen the same words`);
  }

  /* -- the surface mints only what an author may write.
   *
   * Checked from the OUTPUT rather than from the constant, because the
   * constant is what the code was written against and the output is what it
   * did. The mirror of 21e's importer check: what a migration may mint, an
   * author may not, and the reverse. */
  {
    const variants = parsed.ok
      ? [...new Set(parsed.artifact.relations.map((r) =>
          r.identity_seed.variant))] : [];
    const allAuthorable = parsed.ok && parsed.artifact.relations.every((r) => {
      try { v2.assertAuthorableSeed(r.identity_seed); return true; }
      catch { return false; }
    });
    const legacy = refuse(() => v2.assertAuthorableSeed(
      { variant: "legacy-edge", kind: "SignalWire", src: "p0", dst: "r0" }));

    ok("relation/v2/surface/an-author-cannot-write-a-legacy-seed",
       W.serializeArtifact(variants) ===
         W.serializeArtifact(["named-initial"]) &&
       allAuthorable && legacy === "WRL_UNWRITABLE_SEED",
       `the surface minted [${variants.join(", ")}], every seed passes the ` +
       `authoring gate: ${allAuthorable}, and an author offering a legacy ` +
       `seed -> ${legacy}. legacy-edge records that a relation was never ` +
       `named, which is a fact about an import and not something an author ` +
       `can assert about a relation they are writing`);
  }

  /* ================================================ 21g. the closure, B.5
   *
   * The formatter, the round trip, and what a V2 world is FOR.
   *
   * Two of these checks are about worlds the surface CANNOT write. They are
   * the interesting ones, because a formatter's characteristic failure is not
   * refusing -- it is emitting text that its own parser reads back as
   * something else. `formatCore` has that scar already. Both unwritable cases
   * are refused with a code rather than approximated. */
  if (parsed.ok) {

  const formatted = v2.formatNamedWorld(parsed.artifact);
  const reparsed = await v2.parseNamedWorld(formatted);
  const bytes = (a) => v2.serializeV2Artifact(a);

  /* -- format -> parse -> format is a fixed point, and identity does not move.
   *
   * This is the law that makes the surface a surface rather than a lossy
   * view: the text is enough to reconstruct the world exactly, not merely
   * something that looks like it. */
  {
    const idBefore = await v2.v2WorldIdOfArtifact(parsed.artifact);
    const idAfter = reparsed.ok
      ? await v2.v2WorldIdOfArtifact(reparsed.artifact) : null;
    const twice = reparsed.ok ? v2.formatNamedWorld(reparsed.artifact) : null;

    ok("relation/v2/format/the-round-trip-is-a-fixed-point",
       reparsed.ok === true &&
       bytes(reparsed.artifact) === bytes(parsed.artifact) &&
       idBefore === idAfter && twice === formatted,
       reparsed.ok
         ? `canonical bytes recur: ` +
           `${bytes(reparsed.artifact) === bytes(parsed.artifact)}, the world ` +
           `id is unmoved: ${idBefore === idAfter}, and a second format is ` +
           `byte-identical: ${twice === formatted}`
         : `the formatted source did not parse back: ${reparsed.code}`);
  }

  /* -- the formatter does not know the arrow.
   *
   * Proved behaviourally rather than by grepping the module for `-->`: strip
   * the names off the V2 output and what is left is byte-for-byte what the
   * FROZEN formatter emits for the same graph. The V2 side contributes name
   * prefixes and nothing else, so there is no second copy of the route syntax
   * to drift out of step with the frozen one. */
  {
    const g = new W.WrlGraph();
    g.profile = parsed.v1.profile_id;
    g.nodes = parsed.v1.objects.map(
      (o) => [o.role, o.object_id, o.static_config]);
    g.edges = parsed.artifact.relations.map((r) => {
      const src = r.revision.endpoints.find((e) => e.role === "source");
      const dst = r.revision.endpoints.find((e) => e.role === "target");
      return [r.revision.kind, src.terminal.object_id, dst.terminal.object_id];
    });
    const frozen = blankIrLine(W.formatCore(g));
    const stripped = v2.stripRelationNames(v2.stripIrHeader(formatted).source);

    ok("relation/v2/format/the-formatter-does-not-know-the-arrow",
       stripped.source === frozen && stripped.names.size ===
         parsed.artifact.relations.length,
       `names and encoding removed from the V2 output leave the frozen ` +
       `formatter's own text: ${stripped.source === frozen}, and ` +
       `${stripped.names.size}/${parsed.artifact.relations.length} names came ` +
       `off. The V2 side contributes prefixes only, so there is no second ` +
       `copy of the route syntax to drift`);
  }

  /* -- a migrated world has no source form, and says so.
   *
   * The honest consequence of §9 requiring a name: a migration produces a
   * world that runs, seals and compares, but is not authorable text until
   * someone names its relations. FLAGGED for review. The alternative -- the
   * formatter minting names -- is precisely what §D8.1 forbids, so the limit
   * is real and the refusal is the only correct behaviour for a surface that
   * cannot write it. */
  {
    const migrated = v2.migrateV1ToV2(parsed.v1);
    const written = refuse(() => v2.formatNamedWorld(migrated));
    /* and it is only the SURFACE that cannot take it -- the world itself is
     * fine, and derives its ids like any other */
    const derived = await v2.deriveV2Relations(migrated);

    ok("relation/v2/format/a-migrated-world-has-no-source-form",
       written === "WRL_UNWRITABLE_SEED" &&
       derived.relations.length === parsed.v1.edges.length,
       `writing a migrated world -> ${written}, while the world itself still ` +
       `derives ${derived.relations.length} relations normally. The limit is ` +
       `in the surface, not in the world: a formatter that minted the missing ` +
       `names would be deriving identity`);
  }

  /* -- two relations over the same terminals: refused by the PROFILE, and not
   *    for want of a way to write them.
   *
   * This check used to be called `parallel-relations-have-no-source-form`, and
   * it asserted that the world "validates and derives two distinct ids" while
   * the surface refused to write it -- as though the multigraph existed and
   * only the text were missing. Both halves were wrong. The world does not
   * validate: `forge.world.core.v1` admits one signal-wire input per object,
   * so a second relation onto the same terminals is a controller conflict and
   * always was; it only "validated" because the V2 gate never looked at the
   * world. And the text is not missing: `[n1]:` and `[twin]:` on two otherwise
   * identical route lines are two distinct, unambiguous lines, which the name
   * stripper reads back as two names on two lines.
   *
   * So the debt is reclassified, and the reclassification is the point. It is
   * not "V2 source cannot represent parallel relations". It is "no profile in
   * this build permits them yet". The first is a property of the encoding and
   * would be permanent; the second is a row that clears when a profile ships
   * a controller law that admits more than one. */
  {
    const twin = { ...parsed.artifact, relations: [
      ...parsed.artifact.relations,
      { identity_seed: { variant: "named-initial", relation_name: "twin" },
        revision: parsed.artifact.relations[0].revision }] };
    const refused = refuse(() => v2.assertV2Artifact(twin));

    /* the same world as TEXT: the first route line, written twice under two
     * names. The stripper reads two names on two lines -- the source form is
     * there -- and the frozen spine refuses the world for the same reason the
     * V2 gate just did, which is what makes it one law rather than two. */
    const lines = formatted.split("\n");
    const routeAt = lines.findIndex((l) => /-->/.test(l));
    const route = lines[routeAt].replace(/^\s*\[[^\]]*\]:\s*/, "");
    const twinSource = [...lines.slice(0, routeAt + 1),
                        `[twin]: ${route}`,
                        ...lines.slice(routeAt + 1)].join("\n");
    const spelled = v2.stripRelationNames(twinSource).names;
    const twoNames = spelled.get(routeAt + 1) === lines[routeAt]
      .replace(/^\s*\[([^\]]*)\]:[\s\S]*$/, "$1") &&
      spelled.get(routeAt + 2) === "twin";
    /* the code only: a controller conflict is reported against the OBJECT that
     * has two controllers, so it has a locator and no line -- there is no one
     * line to blame when the defect is that two of them agree */
    const asText = (await v2.parseNamedWorld(twinSource)).code;

    ok("relation/v2/profile/parallel-relations-are-not-permitted-yet",
       refused === "WRL_CONTROLLER_CONFLICT" && twoNames &&
       asText === "WRL_CONTROLLER_CONFLICT",
       `the artifact -> ${refused}, the same world as source -> ${asText}, ` +
       `and the two route lines carry two distinct names: ${twoNames}. A ` +
       `profile that admits one controller refuses a second relation onto it ` +
       `in whichever encoding it arrives; nothing here is a limit of the text`);
  }

  /* -- formatting is normalisation, never a gate.
   *
   * `formatCore`'s own law, inherited: an unformatted world seals to the same
   * id as a formatted one. Checked here through BOTH encodings, because the
   * V2 formatter reaches the text by a different route than the V1 one and
   * could have picked up a difference on the way. */
  {
    const sameV2 = await v2.v2WorldIdOfArtifact(parsed.artifact) ===
      (reparsed.ok ? await v2.v2WorldIdOfArtifact(reparsed.artifact) : null);
    /* the V1 world underneath is the demo world, formatted or not. Both
     * strippers run, and the header stripper is why the pinned V1 id is still
     * reachable at all: it blanks its line rather than deleting it, so the
     * text the frozen parser gets differs from `DEMO_WORLD` by whitespace
     * only -- and whitespace is not in the artifact. */
    const v1seal = await W.sealWorld(
      v2.stripRelationNames(v2.stripIrHeader(formatted).source).source);
    const sameV1 = v1seal.ok && v1seal.semanticId === demo.semanticId;

    ok("relation/v2/format/formatting-moves-no-identity",
       sameV2 && sameV1,
       `the V2 world id survives formatting: ${sameV2}, and the V1 world ` +
       `underneath still seals to the pinned demo id: ${sameV1}. An ` +
       `unformatted world seals to the same id as a formatted one, in both ` +
       `encodings`);
  }

  /* -- routes come out in V2's order, not V1's.
   *
   * Route order in the source decides nothing -- the spine sorts it -- so the
   * formatter emitting the order this encoding's own bytes are in is the
   * choice that restates nothing. A V2 formatter that reproduced V1's
   * `(kind, src, dst)` order would be carrying a second copy of a sort key
   * that already caused one wrong diagnosis. */
  {
    const emitted = [...v2.stripRelationNames(formatted).names.values()];
    const inBytes = parsed.artifact.relations.map(
      (r) => r.identity_seed.relation_name);
    const v1order = parsed.v1.edges.map((e) => e.src);
    const emittedSrc = formatted.split("\n")
      .map((l) => /^\[\w+\]:\s*\[(\w+)\]/.exec(l)).filter(Boolean).map((m) => m[1]);

    ok("relation/v2/format/routes-come-out-in-the-encodings-own-order",
       W.serializeArtifact(emitted) === W.serializeArtifact(inBytes) &&
       W.serializeArtifact(emittedSrc) !== W.serializeArtifact(v1order),
       `emitted [${emitted.join(", ")}] matches the canonical byte order ` +
       `[${inBytes.join(", ")}], and differs from V1's route order ` +
       `[${v1order.join(", ")}] vs [${emittedSrc.join(", ")}]. Source route ` +
       `order decides nothing, so the formatter restates no sort key`);
  }

  /* -- a V2 world runs as the V1 world the spine validated.
   *
   * The consumer side, and the point of the whole encoding: V2 changes how
   * topology is WRITTEN, not what a world IS, so nothing downstream of the
   * seal learns a second encoding.
   *
   * The strong form is available and so it is the one used: not "the same
   * relations" but the same BYTES, and therefore the pinned demo `sem-`. The
   * weak form -- a multiset comparison plus a key-by-key check of everything
   * except `edges` -- is what this check said while `downgradeV2ToV1` was
   * emitting V1 edges in V2's order, and it passed the whole time. A
   * comparison that excludes the field a bug lives in is not a weaker check,
   * it is a check of something else. */
  {
    const runnable = v2.runnableV1Artifact(parsed.artifact);
    const exact = W.serializeArtifact(runnable) ===
                  W.serializeArtifact(parsed.v1);
    const sem = await s.worldIdOfArtifact(runnable);

    ok("relation/v2/consumer/a-v2-world-runs-as-the-v1-world-it-validated",
       exact && sem === demo.semanticId &&
       s.V1_IR_VERSIONS.includes(runnable.ir_version),
       `byte-identical to the V1 artifact the spine validated: ${exact}, and ` +
       `it seals to ${sem.slice(0, 16)}… -- the pinned demo world -- at ` +
       `ir_version ${JSON.stringify(runnable.ir_version)}. Nothing downstream ` +
       `of the seal has to learn a second encoding`);
  }

  /* -- and the V2 route ends at exactly the world the V1 route ends at.
   *
   * The strongest available form: the V1 artifact reached by writing names
   * over the demo world seals to the PINNED demo `sem-`. If the surface had
   * perturbed anything at all -- a config, an order, a port projection --
   * this is where it would show, against an id that has not moved in six
   * slices. */
  {
    const viaV2 = await s.worldIdOfArtifact(parsed.v1);

    ok("relation/v2/consumer/naming-a-world-does-not-change-the-world",
       viaV2 === demo.semanticId,
       `the V1 world underneath the named source is ${viaV2.slice(0, 16)}…, ` +
       `and the pinned demo world is ${demo.semanticId.slice(0, 16)}… -- ` +
       `${viaV2 === demo.semanticId ? "the same" : "DIFFERENT"}. Naming ` +
       `relations adds identity to relations; it changes nothing about the ` +
       `world they are in`);
  }

  }

  /* ============================================== 21h. admission, C.1
   *
   * Every check above calls the parser it means. A TOOL cannot: it holds a
   * textarea and does not know which encoding the person typing is in. §D8.17
   * is the rule that lets it find out without guessing, and these are the two
   * ways of getting that wrong -- deciding from outside the source, and being
   * helpful about a source that got its declaration wrong. */
  if (parsed.ok) {

  const admitted = await v2.admitWorldSource(NAMED_DEMO);
  const plain = await v2.admitWorldSource(W.DEMO_WORLD);

  /* -- the source decides, and it is the only thing that does.
   *
   * One function, two encodings, and the discriminator comes out of the text.
   * The strong form is available here because both worlds are PINNED: the V1
   * bytes admit to the frozen demo id, the V2 bytes admit to the V2 world id
   * the encoding checks above already fixed, and no argument, flag or mode was
   * passed to either call. */
  {
    const v2id = await v2.v2WorldIdOfArtifact(parsed.artifact);

    ok("relation/v2/admission/the-source-decides-which-parser-reads-it",
       plain.ok === true && plain.family === "v1" &&
       plain.declared === false && plain.semanticId === demo.semanticId &&
       admitted.ok === true && admitted.family === "v2" &&
       admitted.declared === true && admitted.irVersion === "2.0" &&
       admitted.semanticWorldId === v2id && v2id !== demo.semanticId,
       `undeclared bytes admit as ${plain.family} to ` +
       `${String(plain.semanticId).slice(0, 16)}…; the same world with ` +
       `'ir 2.0' and names admits as ${admitted.family} to ` +
       `${String(admitted.semanticWorldId).slice(0, 16)}…. Two encodings, two ` +
       `worlds, one entry point, and nothing outside the text was consulted`);
  }

  /* -- the V1 arm is the frozen verdict, not a reshaping of it.
   *
   * `sealWorld`'s result is a published shape with consumers. An admission
   * that renamed `semanticId`, or dropped `graph`, or wrapped the whole thing
   * one level down, would force every existing reader to learn which of two
   * things it was holding -- for worlds where NOTHING changed. So the V1 arm
   * is that object with two keys added, and this compares it key by key
   * against a direct seal rather than spot-checking the id. */
  {
    const direct = await W.sealWorld(W.DEMO_WORLD);
    const extra = new Set(["family", "declared"]);
    const missing = Object.keys(direct).filter((k) => !(k in plain));
    const added = Object.keys(plain).filter(
      (k) => !(k in direct) && !extra.has(k));
    const differs = Object.keys(direct).filter(
      (k) => W.serializeArtifact(fmt(direct[k])) !==
             W.serializeArtifact(fmt(plain[k])));

    /* and a REFUSED V1 source stays a refused V1 source: same code, same line */
    const broken = "profile forge.world.core.v1\n\n[orb:ob]{pose}\n" +
                   "[orb:ob]{pose}\n";
    const viaAdmission = await v2.admitWorldSource(broken);
    const viaSeal = await W.sealWorld(broken);

    ok("relation/v2/admission/the-v1-arm-is-the-frozen-verdict-unchanged",
       missing.length === 0 && added.length === 0 && differs.length === 0 &&
       viaAdmission.ok === false && viaAdmission.family === "v1" &&
       viaAdmission.code === viaSeal.code &&
       viaAdmission.line === viaSeal.line,
       `keys missing: [${missing.join(", ")}], keys added beyond ` +
       `family/declared: [${added.join(", ")}], values differing: ` +
       `[${differs.join(", ")}]; a refused world reports ` +
       `${viaAdmission.code}@${viaAdmission.line} through admission and ` +
       `${viaSeal.code}@${viaSeal.line} through the seal`);
  }

  /* -- a declared encoding is never retried under the other one.
   *
   * The tempting bug, and the reason it is tempting: a source whose `ir` line
   * is wrong is usually a perfectly good world otherwise, so a fallback would
   * have plenty to seal. What it would print is the id of a world in an
   * encoding its author did not write.
   *
   * The second half is what makes the refusal necessary rather than merely
   * tidy. The frozen parser has no `ir` rule, so it answers a broken
   * declaration with `WRL_UNSUPPORTED_FEATURE` pointed at the declaration --
   * a diagnostic that tells an author to delete the one line in the file that
   * was doing its job. Admission has to refuse in the V2 vocabulary, and it
   * does: four malformed declarations, four V2 header codes, and V1 never
   * consulted. */
  {
    const hdr = (h) => `profile forge.world.core.v1\n${h}\n\n[orb:ob]{pose}\n`;
    const cases = [["ir", "WRL_MALFORMED_IR_HEADER"],
                   ["ir 2.0 2.0", "WRL_MALFORMED_IR_HEADER"],
                   ["ir 3.0", "WRL_UNSUPPORTED_IR_VERSION"],
                   ["ir 2.0\nir 2.0", "WRL_DUPLICATE_IR_HEADER"]];
    const got = [];
    for (const [h] of cases) {
      const r = await v2.admitWorldSource(hdr(h));
      got.push(r.ok ? "ACCEPTED" : `${r.family}:${r.code}`);
    }
    /* the misplaced one is its own case: the declaration is present, so it is
     * a V2 question, and it is answered by the V2 parser */
    const late = await v2.admitWorldSource(
      "profile forge.world.core.v1\n\n[orb:ob]{pose}\nir 2.0\n");
    /* what V1 says about every one of them, if anyone let it speak */
    const v1says = await W.sealWorld(hdr("ir 3.0"));

    ok("relation/v2/admission/a-declared-encoding-never-falls-back",
       got.join("|") === cases.map(([, c]) => `v2:${c}`).join("|") &&
       late.ok === false && late.family === "v2" &&
       v1says.ok === false && v1says.code === "WRL_UNSUPPORTED_FEATURE",
       `${got.join(", ")}; misplaced: ${late.family}:${late.code}. None ` +
       `sealed, and none was handed to V1 -- which would have called the ` +
       `encoding declaration itself ${v1says.code}`);
  }

  /* -- the world id and the execution view id are two different things.
   *
   * The display law, checked as arithmetic. A V2 world has its own `sem-`,
   * derived from V2 bytes; its V1 execution projection has another, derived
   * from V1 bytes; and a page that showed one of them under the other's label
   * would be telling a reader that the identity scope of their world is the
   * projection someone runs.
   *
   * The projection is exact, and `denamedV1Artifact` is what "exact" is
   * measured against -- the frozen spine's own reading of the same text with
   * the names taken off. Both facts land on the pinned demo id, which is the
   * sharpest available end for this chain: the V2 world is a NEW world, and
   * the thing it runs as is the world that has not moved in six slices. */
  {
    const projection = v2.runnableV1Artifact(admitted.artifact);
    const exact = W.serializeArtifact(projection) ===
                  W.serializeArtifact(admitted.denamedV1Artifact);
    const executionViewId = await s.worldIdOfArtifact(projection);

    ok("relation/v2/admission/the-world-id-is-not-the-execution-view-id",
       exact && executionViewId === demo.semanticId &&
       admitted.semanticWorldId !== executionViewId,
       `the projection is byte-exact against the seal the spine already ` +
       `performed: ${exact}; it seals to ${executionViewId.slice(0, 16)}… ` +
       `-- the pinned demo world -- while the V2 world this text names is ` +
       `${String(admitted.semanticWorldId).slice(0, 16)}…. Two ids, two ` +
       `meanings; the second is proof of an execution view, not the scope ` +
       `any relation in this world is allocated in`);
  }

  /* ============================================ 21i. the projection, C.3
   *
   * §D8.17 clause 5 says the two ids are different claims. §D8.18 is what a
   * consumer is handed so that it cannot fail to notice -- and every check
   * below is really the same check twice, in the two encodings, because the
   * envelope being TOTAL is law 7 rather than a convenience.
   *
   * The danger this rule addresses is not a wrong number. Every id in play is
   * correct. It is that the RIGHT number for the projected bytes is also a
   * perfectly serviceable-looking world id, so a runtime handed only an
   * artifact will scope durable things to it and never be told otherwise. */
  {
    const pv1 = await v2.deriveRuntimeProjection(demo.artifact);
    const pv2 = await v2.deriveRuntimeProjection(parsed.artifact);
    const edgeKey = (e) => W.serializeArtifact(e);

    /* -- 1. the world id is the world, in both encodings and from one call
     *
     * No family argument is passed to either call, and neither result needs
     * reading to find out which encoding it came from before the world's own
     * id can be named. That is the whole of clause 1: `semantic_world_id`
     * means the world unconditionally, so a consumer holding a projection has
     * no branch to get wrong. And the id is RECOMPUTED, not believed -- the
     * same defect `deriveRelations` was corrected for, arriving at a boundary
     * where a caller is far more likely to have an id in hand. */
    {
      const forged = await refuseAsync(
        () => v2.deriveRuntimeProjection(parsed.artifact, "sem-" + "0".repeat(64)));
      ok("relation/v2/projection/the-world-id-is-authoritative-in-both-encodings",
         pv1.semantic_world_id === demo.semanticId &&
         pv2.semantic_world_id === admitted.semanticWorldId &&
         pv1.derived === true && pv1.canonical === false &&
         pv1.inArtifactBytes === false &&
         pv2.derived === true && pv2.canonical === false &&
         pv2.inArtifactBytes === false &&
         forged === "WRL_SEMANTIC_ID_MISMATCH",
         `one function, no family argument, and the world's own id in both ` +
         `arms: V1 ${pv1.semantic_world_id.slice(0, 16)}… vs pinned ` +
         `${demo.semanticId.slice(0, 16)}…, V2 ` +
         `${pv2.semantic_world_id.slice(0, 16)}… vs admitted ` +
         `${String(admitted.semanticWorldId).slice(0, 16)}…; a forged claim ` +
         `answered ${forged}. A projection that believed a caller's id would ` +
         `mint every binding under whatever it was told`);
    }

    /* -- 2. the execution view id names the projected bytes and nothing else
     *
     * It is computed by the SAME function a runtime would use on what it was
     * handed, which is the point: a runtime that seals its input gets this
     * value back and can tell it apart from the world's. */
    {
      const recomputed = await s.worldIdOfArtifact(pv2.execution_artifact);
      ok("relation/v2/projection/the-execution-view-id-names-only-projected-bytes",
         pv2.execution_view_id === recomputed &&
         pv2.execution_view_id === demo.semanticId &&
         pv2.execution_view_id !== pv2.semantic_world_id,
         `the view id must be the frozen spine's own reading of ` +
         `execution_artifact (${pv2.execution_view_id === recomputed}), land ` +
         `on the pinned demo world, and differ from the world id. It is the ` +
         `id of a VIEW; naming the world with it is the failure this rule ` +
         `exists to make impossible to reach by accident`);
    }

    /* -- 3. a runtime executes the execution artifact
     *
     * The encoding stops here. What comes out is a V1 artifact in the frozen
     * family, carrying `edges` and no `relations`, byte-equal to the spine's
     * own reading of the same world -- so nothing downstream of this boundary
     * learns a second encoding, which is the entire claim V2 makes about its
     * own blast radius. */
    {
      const ex = pv2.execution_artifact;
      const spineOwn = W.serializeArtifact(admitted.denamedV1Artifact) ===
                       W.serializeArtifact(ex);
      ok("relation/v2/projection/a-runtime-executes-the-execution-artifact",
         s.V1_IR_VERSIONS.includes(ex.ir_version) &&
         Array.isArray(ex.edges) && !("relations" in ex) && spineOwn &&
         !("edges" in pv2.semantic_artifact) &&
         Array.isArray(pv2.semantic_artifact.relations),
         `the execution artifact is ir_version ${JSON.stringify(ex.ir_version)}, ` +
         `edges: ${Array.isArray(ex.edges)}, relations key: ` +
         `${"relations" in ex}, byte-equal to the spine's own reading: ` +
         `${spineOwn}. A runtime handed V2 bytes would be a second encoding ` +
         `crossing a boundary V2 promised not to cross`);
    }

    /* -- 4. an observation names the relation, not the edge
     *
     * The sharp form: run the SAME topology through both scopes. The V1
     * projection's relations and the V2 world's relations describe the same
     * four edges, and they share every `rev-` -- structure did not move. Not
     * one `rel-` is shared, because identity did. A runtime reporting against
     * an edge therefore cannot name a relation by re-deriving one from what
     * it ran; it has to be told, and `legacy_edge` is the telling. */
    {
      const viewRels = await s.deriveRelations(pv2.execution_artifact,
                                               pv2.execution_view_id);
      const byEdge = new Map(viewRels.relations.map(
        (r) => [edgeKey(s.projectRelationRevisionToV1Edge(r.revision)), r]));
      const ids = new Set(viewRels.relations.map((r) => r.relation_id));

      const joins = pv2.relation_bindings.every(
        (b) => byEdge.has(edgeKey(b.legacy_edge)));
      const revsRecur = pv2.relation_bindings.every(
        (b) => byEdge.get(edgeKey(b.legacy_edge)).revision_id === b.revision_id);
      const idsDiffer = pv2.relation_bindings.every(
        (b) => !ids.has(b.relation_id));

      ok("relation/v2/projection/an-observation-names-the-relation-not-the-edge",
         pv2.relation_bindings.length === viewRels.relations.length &&
         joins && revsRecur && idsDiffer,
         `every binding joins to the projected world by its legacy edge ` +
         `(${joins}), shares that edge's revision id (${revsRecur}), and ` +
         `shares NONE of its relation ids (${idsDiffer}). Structure is the ` +
         `same world; identity is not. An observation keyed by an edge lifts ` +
         `back through legacy_edge, and re-deriving a relation from the ` +
         `edge alone would name one that belongs to the view`);
    }

    /* -- 5. the execution view id is not a world scope
     *
     * Stated as a prohibition in §D8.18 clause 5, and the way to check a
     * prohibition is to do the forbidden thing and show the result is
     * elsewhere. Every seed in this world, expanded under the VIEW id, mints
     * an id that appears in no binding -- so a consumer that scoped an
     * allocation to the view would produce relation ids belonging to nothing
     * the world knows about, silently and with correct arithmetic. */
    {
      const wrong = [];
      for (const rel of pv2.semantic_artifact.relations)
        wrong.push(await s.relationIdFromAllocation(
          v2.expandSeed(pv2.execution_view_id, rel.identity_seed)));
      const held = new Set(pv2.relation_bindings.map((b) => b.relation_id));
      const right = [];
      for (const rel of pv2.semantic_artifact.relations)
        right.push(await s.relationIdFromAllocation(
          v2.expandSeed(pv2.semantic_world_id, rel.identity_seed)));

      ok("relation/v2/projection/the-execution-view-id-is-not-a-world-scope",
         wrong.length > 0 && wrong.every((id) => !held.has(id)) &&
         right.every((id) => held.has(id)) &&
         /execution_view_id/.test(pv2.note) && /grant/.test(pv2.note),
         `expanding this world's own seeds under the view id mints ` +
         `${wrong.length} relation id(s), none of which this world holds; ` +
         `under the world id it mints exactly the ones it does. Both ` +
         `computations are correct, which is why the rule has to be a ` +
         `prohibition rather than a validation -- nothing about the wrong ` +
         `one looks wrong`);
    }

    /* -- 6. every binding is independently recomputable
     *
     * From the semantic artifact ALONE, in both encodings, positionally
     * against that artifact's own topology list. And the binding carries
     * exactly three fields: a projection that shipped its own preimages
     * would be offering a check against itself, so the narrowness of the
     * record is part of the law rather than a tidiness preference. */
    {
      const own2 = await v2.deriveV2Relations(pv2.semantic_artifact);
      const own1 = await s.deriveRelations(pv1.semantic_artifact);
      const same = (bindings, rels) =>
        bindings.length === rels.length &&
        bindings.every((b, i) => b.relation_id === rels[i].relation_id &&
                                 b.revision_id === rels[i].revision_id);
      const fields = pv2.relation_bindings.every(
        (b) => W.serializeArtifact(Object.keys(b).sort()) ===
               W.serializeArtifact([...v2.RUNTIME_BINDING_FIELDS].sort()));

      ok("relation/v2/projection/every-binding-is-independently-recomputable",
         same(pv2.relation_bindings, own2.relations) &&
         same(pv1.relation_bindings, own1.relations) && fields,
         `a consumer recomputing from the semantic artifact alone must get ` +
         `the envelope's own answer, in both encodings, and the binding must ` +
         `carry no preimage to check itself against (${fields}). Fields ` +
         `seen: ${Object.keys(pv2.relation_bindings[0] || {}).join(", ")}`);
    }

    /* -- 7. a V1-native world is the degenerate coincident case */
    {
      ok("relation/v2/projection/a-v1-native-world-is-the-coincident-case",
         pv1.coincident === true &&
         pv1.execution_view_id === pv1.semantic_world_id &&
         pv1.execution_view_id === demo.semanticId &&
         W.serializeArtifact(pv1.execution_artifact) ===
           W.serializeArtifact(pv1.semantic_artifact) &&
         pv2.coincident === false,
         `a V1 world runs as itself, so its two ids coincide and the ` +
         `envelope says so (${pv1.coincident}); the V2 world's do not ` +
         `(${pv2.coincident}). Totality is what lets clause 1 be stated ` +
         `without an "unless" -- an envelope that existed only for V2 would ` +
         `leave every V1 caller passing bare artifacts around`);
    }

    /* -- the ordering trap, which is the mistake a CAREFUL consumer makes
     *
     * Both lists are canonically ordered and neither ordering is wrong. They
     * are ordered by different keys -- V2 by seed bytes, V1 by edge -- so
     * index `i` names two different relations. Joining on the index produces
     * a total, plausible, entirely mis-attributed mapping, and the pinned
     * demo world is one where it happens. */
    {
      const misaligned = pv2.relation_bindings.some(
        (b, i) => edgeKey(b.legacy_edge) !== edgeKey(pv2.execution_artifact.edges[i]));
      const joins = pv2.relation_bindings.every((b) =>
        pv2.execution_artifact.edges.some(
          (e) => edgeKey(e) === edgeKey(b.legacy_edge)));
      ok("relation/v2/projection/bindings-are-not-positional-against-the-edges",
         misaligned && joins &&
         pv2.relation_bindings.length === pv2.execution_artifact.edges.length,
         `the two lists hold the same edges (${joins}) in different orders ` +
         `(${misaligned}). A consumer joining on index would mis-attribute ` +
         `every observation in this world -- which is why the binding ` +
         `carries the edge, and why the rule says so in the same breath as ` +
         `it says the bindings are positional against the SEMANTIC artifact`);
    }

    /* ======================================= 21j. the projection crosses, C.4
     *
     * Everything above holds inside one process, where the envelope is an
     * object a caller received from a function it called. A runtime is on the
     * far side of something, and over there every field is equally a claim --
     * including the flags that say DERIVED and NOT CANONICAL, which a sender
     * could set either way and which prove nothing about the bytes they
     * travelled with.
     *
     * So the wire record carries no flags and no prose, and the receiver
     * ESTABLISHES what the envelope merely asserted. */
    {
      const wire2 = v2.serializeRuntimeProjection(pv2);
      const wire1 = v2.serializeRuntimeProjection(pv1);
      const back2 = await v2.verifyRuntimeProjection(wire2);
      const back1 = await v2.verifyRuntimeProjection(wire1);

      /* The round trip returns the envelope, rebuilt on this side. `derived`
       * and the rest are back not because they were transmitted but because
       * this side derived them. */
      ok("relation/v2/projection/a-transmitted-projection-round-trips",
         back2.semantic_world_id === pv2.semantic_world_id &&
         back2.execution_view_id === pv2.execution_view_id &&
         back1.semantic_world_id === pv1.semantic_world_id &&
         back1.coincident === true && back2.coincident === false &&
         W.serializeArtifact(back2.relation_bindings) ===
           W.serializeArtifact(pv2.relation_bindings) &&
         W.serializeArtifact(back2.execution_artifact) ===
           W.serializeArtifact(pv2.execution_artifact) &&
         back2.derived === true && back2.canonical === false &&
         back2.inArtifactBytes === false,
         `both encodings serialise, cross, and come back as the same ` +
         `envelope -- with the execution artifact and the coincidence REBUILT ` +
         `rather than transmitted, so what a receiver ends up holding is what ` +
         `it derived and never what it was told`);

      /* The record is exactly five fields, and the two that would have made a
       * receiver's job easier are the two that are missing. */
      const rec2 = JSON.parse(wire2);
      ok("relation/v2/projection/the-wire-record-carries-no-unverifiable-field",
         W.serializeArtifact(Object.keys(rec2).sort()) ===
           W.serializeArtifact([...v2.RUNTIME_PROJECTION_FIELDS].sort()) &&
         !("execution_artifact" in rec2) && !("coincident" in rec2) &&
         !("derived" in rec2) && !("canonical" in rec2) &&
         !("inArtifactBytes" in rec2) && !("note" in rec2),
         `the wire record is exactly ${v2.RUNTIME_PROJECTION_FIELDS.join(", ")}. ` +
         `The flags are gone because on a wire they are two bytes a sender ` +
         `chooses; the prose is gone for the same reason; and the execution ` +
         `artifact is gone because carrying it would let one message pair one ` +
         `world's semantics with another world's bytes to run, which omitting ` +
         `it makes unrepresentable rather than merely detectable`);

      /* A sender that projected a different world claims a view id that does
       * not recompute. This is the message the omission above forces a liar
       * to send instead.
       *
       * The value put in the field is this world's OWN world id, because that
       * is not a hypothetical corruption -- it is precisely the mute
       * downgrade's mistake, written down. A sender that sealed the bytes it
       * was about to run and filed the answer as the world would emit exactly
       * this record, with two real ids in it and the wrong one in each field.
       *
       * (The first draft here used the pinned V1 demo's view id, and the
       * check failed by not refusing: in this fixture the V2 world's
       * execution view IS the pinned demo, so the swap was a no-op. Worth
       * keeping in the record -- a negative test whose two values coincide
       * passes by asserting nothing.) */
      const swapped = JSON.parse(wire2);
      swapped.execution_view_id = pv2.semantic_world_id;
      const badView = await refuseAsync(
        () => v2.verifyRuntimeProjection(JSON.stringify(swapped)));

      const bentBindings = JSON.parse(wire2);
      bentBindings.relation_bindings = [...bentBindings.relation_bindings].reverse();
      const badBind = await refuseAsync(
        () => v2.verifyRuntimeProjection(JSON.stringify(bentBindings)));

      const lyingWorld = JSON.parse(wire2);
      lyingWorld.semantic_world_id = "sem-" + "0".repeat(64);
      const badWorld = await refuseAsync(
        () => v2.verifyRuntimeProjection(JSON.stringify(lyingWorld)));

      ok("relation/v2/projection/a-claim-that-does-not-recompute-is-refused",
         badView === "WRL_PROJECTION_MISMATCH" &&
         badBind === "WRL_PROJECTION_MISMATCH" &&
         badWorld === "WRL_SEMANTIC_ID_MISMATCH",
         `[${badView} / ${badBind} / ${badWorld}] ` +
         `a swapped view id and a reordered binding list are each ` +
         `WRL_PROJECTION_MISMATCH, and a lying world id is the DERIVER's own ` +
         `WRL_SEMANTIC_ID_MISMATCH rather than a second implementation of the ` +
         `same comparison. The reordering matters most: it is the tamper that ` +
         `changes no id anywhere and is caught only because the order of the ` +
         `bindings is itself derived`);

      /* Shape, before any of that. An unknown key is refused rather than
       * ignored, because a field this side cannot check is a field the far
       * side may be relying on. */
      const extra = JSON.parse(wire2);
      extra.execution_artifact = pv2.execution_artifact;
      const dropped = JSON.parse(wire2);
      delete dropped.relation_bindings;
      const oldVersion = JSON.parse(wire2);
      oldVersion.projection_version = "wrl.projection.0";

      /* `extra` goes over as an OBJECT rather than as bytes, and not to dodge
       * anything: a V1 artifact can hold a BigInt, `JSON.stringify` refuses
       * those outright, and the spine's own serializer is the only thing here
       * that renders one. So the execution artifact is a value that cannot be
       * expressed in the message at all without going through the very
       * serializer this record was built to avoid needing -- which is a
       * sharper version of the reason it is omitted than the one I wrote. */
      const codes = [
        await refuseAsync(() => v2.verifyRuntimeProjection(extra)),
        await refuseAsync(() => v2.verifyRuntimeProjection(JSON.stringify(dropped))),
        await refuseAsync(() => v2.verifyRuntimeProjection(JSON.stringify(oldVersion))),
        await refuseAsync(() => v2.verifyRuntimeProjection("{not json")),
        await refuseAsync(() => v2.verifyRuntimeProjection("[]")),
      ];
      ok("relation/v2/projection/a-malformed-projection-is-refused-as-one",
         codes.every((c) => c === "WRL_BAD_PROJECTION"),
         `an extra key, a missing key, an unknown version, unparseable bytes ` +
         `and an array are all WRL_BAD_PROJECTION (${codes.join(", ")}). The ` +
         `extra key is the interesting one: it is the execution artifact, ` +
         `offered back as a convenience, and refusing it is what keeps the ` +
         `omission a rule rather than a default`);

      /* Two senders holding the same world transmit the same bytes. Without
       * this a receiver could not compare two messages at all, and C.5's
       * cross-implementation comparison would have nothing to compare. */
      const again = v2.serializeRuntimeProjection(
        await v2.deriveRuntimeProjection(parsed.artifact));
      ok("relation/v2/projection/the-wire-form-is-canonical",
         again === wire2 && wire2 === W.serializeArtifact(JSON.parse(wire2)),
         `the same world serialises to the same bytes twice, and those bytes ` +
         `are already canonical under the spine's own serializer -- so a ` +
         `transmitted projection can be compared, hashed and diffed by a ` +
         `party that cannot parse WRL at all`);

      /* -- The committed vectors.
       *
       * Everything above proves this implementation agrees with itself. A
       * second implementation, in another language, in another repository,
       * cannot run any of it -- and the whole reason D8.19 ships claims that
       * recompute is so that two implementations can be made to disagree out
       * loud. That needs bytes, sitting in a file, that both can be held to.
       *
       * `test/projection-vectors.json` is that file. Each vector is a SOURCE
       * and the canonical wire bytes its projection serialises to. No vector
       * states its encoding, and that is not an omission: D8.17 says the
       * source decides, so an implementation that needed to be told the
       * family here would already be failing a different rule.
       *
       * This check is what stops the file going stale. It is a golden file,
       * so it is exactly as useful as it is untrue-able: the moment the wire
       * form moves, this goes red, and a downstream consumer pinned to these
       * bytes finds out here rather than in production. */
      {
        const vpath = join(ROOT, "test", "projection-vectors.json");
        let vdoc = null, vecOk = false, detail = "the file is missing";
        if (existsSync(vpath)) {
          vdoc = JSON.parse(readFileSync(vpath, "utf8"));
          const results = [];
          for (const vec of vdoc.vectors) {
            /* A stale vector must be a NAMED red, never a stack trace -- the
             * same rule this battery already learned about a broken module.
             * `verifyRuntimeProjection` REFUSES a vector that no longer
             * recomputes, which is it working, and an uncaught refusal here
             * would take the whole suite down instead of reporting one file. */
            try {
              const a = await v2.admitWorldSource(vec.source);
              if (!a.ok) { results.push(`${vec.name}: refused ${a.code}`); continue; }
              const id = a.family === "v2" ? a.semanticWorldId : a.semanticId;
              const wire = v2.serializeRuntimeProjection(
                await v2.deriveRuntimeProjection(a.artifact, id));
              if (wire !== vec.wire) results.push(`${vec.name}: bytes moved`);
              /* and the vector is round-trippable by a receiver, not just
               * reproducible by a sender */
              const back = await v2.verifyRuntimeProjection(vec.wire);
              if (back.semantic_world_id !== id)
                results.push(`${vec.name}: does not verify to its own world`);
            } catch (e) {
              results.push(`${vec.name}: ${e.code || e.message}`);
            }
          }
          /* The corpus must span the axes an implementation can differ on:
           * both encodings, and -- since C.4.1 -- a lane no ordinary JSON
           * reader can hold. A vector set without that last one is precisely
           * the set that let the exactness defect ship. */
          vecOk = vdoc.vector_version === "wrl.projection-vectors.1" &&
                  vdoc.vectors.length >= 4 && results.length === 0 &&
                  vdoc.vectors.some((v) => /^ir 2\.0$/m.test(v.source)) &&
                  vdoc.vectors.some((v) => !/^ir /m.test(v.source)) &&
                  vdoc.vectors.some((v) => v.wire.includes("9223372036854775807"));
          detail = results.length ? results.join("; ")
                                  : `${vdoc.vectors.length} vectors reproduce`;
        }
        ok("relation/v2/projection/the-committed-vectors-still-reproduce",
           vecOk,
           `${detail}. The vector file is the only artifact in this repository ` +
           `an implementation that cannot run JavaScript can be held to, and ` +
           `it covers both encodings because a receiver that only ever saw V2 ` +
           `would never exercise the coincident case`);
      }

      /* -- The committed NEGATIVE corpus (C.5.4).
       *
       * The positive vectors prove two implementations can AGREE. They cannot
       * prove either one is checking: a verifier that returned its input
       * unread would reproduce every vector above. That takes bytes which must
       * be REFUSED, and it takes them in a file, for the same reason -- these
       * cases were previously fifteen Python lambdas on a Forge branch, which
       * made "Forge refuses a reordered binding" and "the browser refuses a
       * reordered binding" two similar claims about two records instead of one
       * claim about one record.
       *
       * Each vector is a complete tampered record stored as FINAL BYTES rather
       * than as an edit recipe. That is deliberate: a recipe that silently
       * matches nothing is the broken fixture that has cost this work three
       * times, most recently a duplicate-key tamper that searched for
       * `{"projection_version"` on a wire whose keys are sorted. Bytes cannot
       * fail to apply -- but a stored literal can still equal its base, so the
       * first thing checked here is that every vector actually differs from
       * the honest record it was made from. A negative test that passes while
       * asserting nothing is the failure mode this whole block exists against.
       *
       * On the refusal CODE: the file records what the reference verifier
       * produced. Whether a code is normative -- whether an implementation
       * that refuses correctly but names it differently is conformant -- is
       * open, so the REFUSAL is asserted and code agreement is only reported.
       * That way this block yields evidence for the ruling instead of
       * presuming it. */
      {
        const npath = join(ROOT, "test", "projection-negative-vectors.json");
        let negOk = false, detail = "the file is missing", agree = 0, total = 0;
        const bpath = join(ROOT, "test", "projection-vectors.json");
        if (existsSync(npath) && existsSync(bpath)) {
          const ndoc = JSON.parse(readFileSync(npath, "utf8"));
          /* The bases come from the POSITIVE file, so a tamper is checked
           * against the honest bytes as committed rather than against a copy
           * carried alongside it -- two copies of a base is how a corpus
           * starts describing a record nobody sends. */
          const bases = Object.fromEntries(
            JSON.parse(readFileSync(bpath, "utf8"))
              .vectors.map((v) => [v.name, v.wire]));
          const problems = [], disagreed = [];
          for (const vec of ndoc.vectors) {
            total++;
            /* THE FIXTURE GATE, before the verdict. */
            if (bases[vec.base] === undefined) {
              problems.push(`${vec.name}: unknown base ${vec.base}`); continue;
            }
            if (vec.wire === bases[vec.base]) {
              problems.push(`${vec.name}: BROKEN FIXTURE, equals its base`);
              continue;
            }
            const code = await refuseAsync(
              () => v2.verifyRuntimeProjection(vec.wire));
            if (code === null) { problems.push(`${vec.name}: ADMITTED`); continue; }
            if (vec.refusal_codes.includes(code)) agree++;
            else disagreed.push(`${vec.name}: ${code} vs ${vec.refusal_codes}`);
          }
          /* The corpus must reach the cases that are easy to not have: the
           * tamper that moves no identifier, and the rounding attempt that is
           * the C.4.1 defect turned into a test. */
          negOk = ndoc.vector_set === "wrl.projection-negative-vectors.1" &&
                  problems.length === 0 && total >= 12 &&
                  ndoc.vectors.some((v) => v.name === "reordered-relation-bindings") &&
                  ndoc.vectors.some((v) => v.name === "an-unsafe-integer-rounded");
          detail = problems.length
            ? problems.join("; ")
            : `${total} tampers refused, ${agree}/${total} in the same ` +
              `vocabulary as Forge` +
              (disagreed.length ? ` (${disagreed.join("; ")})` : "");
        }
        ok("relation/v2/projection/the-negative-corpus-is-refused",
           negOk,
           `${detail}. A positive vector proves a verifier can agree; only a ` +
           `refused one proves it is looking, and these are the same bytes ` +
           `the Python verifier is held to`);
      }

      /* The serializer takes an envelope and not an artifact, so there is one
       * route to the wire and it runs through the deriver. */
      const notEnvelope = await refuseAsync(
        () => v2.serializeRuntimeProjection(parsed.artifact));
      ok("relation/v2/projection/only-a-derived-envelope-reaches-the-wire",
         notEnvelope === "WRL_BAD_PROJECTION",
         `handing the serializer a bare artifact is refused. If it derived ` +
         `the projection itself it would be a second route to the wire, and ` +
         `the two routes could disagree about a world while both looked right`);

      /* 21k -- C.4.1, THE WIRE READS ITS OWN BYTES EXACTLY.
       *
       * These four checks all failed to exist before C.4.1, and the reason is
       * instructive: every one of them needs a world the three original
       * vectors did not contain. The wire was total over the corpus that
       * tested it, which is not the same claim as total over the domain. */
      {
        /* A frozen V1 world may carry a rotor lane of 2^63-1: lanes are the
         * one artifact scalar `wrl.js` leaves unbounded, and it holds them as
         * BigInt precisely so they stay exact. */
        const bigSrc = W.DEMO_WORLD.replace(
          "[spinner:sp](w=16, n=8, rotor=quarter_turn_z, configurable)",
          "[spinner:sp](w=64, n=8, rotor=9223372036854775807.1.2." +
          "9223372036854775806, configurable)");
        const ba = await v2.admitWorldSource(bigSrc);
        const bid = ba.ok ? ba.semanticId : null;
        const bp = ba.ok ? await v2.deriveRuntimeProjection(ba.artifact, bid)
                         : null;
        const bwire = bp ? v2.serializeRuntimeProjection(bp) : "";

        let survived = null;
        try {
          const back = await v2.verifyRuntimeProjection(bwire);
          survived = back.semantic_world_id === bid;
        } catch (e) { survived = e.code || e.message; }

        /* what the old reader did, kept as the contrast rather than described */
        const rounded = JSON.parse('{"v":9223372036854775807}').v;

        ok("relation/v2/projection/an-exact-integer-survives-the-wire",
           ba.ok === true &&
           bwire.includes("9223372036854775807") && survived === true &&
           rounded === 9223372036854776000,
           `a 2^63-1 rotor lane is emitted exactly and read back exactly ` +
           `(${survived}). JSON.parse renders that same token as ${rounded}, ` +
           `so a receiver using it refuses a legal world -- and refuses it in ` +
           `the wrong vocabulary, reporting a range error about a number the ` +
           `world never contained`);

        /* Duplicate keys. JSON.parse keeps the last silently, so two records
         * with different bytes and different meanings read as one object. */
        const dupKey = bwire.replace(
          '"projection_version":', '"projection_version":"x","projection_version":');
        /* A fraction is not in the artifact domain at all. */
        const fraction = bwire.replace('"projection_version"',
                                       '"pv_x":1.5,"projection_version"');
        /* Lexical variants of a valid record: canonical bytes have no space,
         * and their keys are sorted. */
        const spaced = "{ " + bwire.slice(1);

        const codes = {
          dup: await refuseAsync(() => v2.verifyRuntimeProjection(dupKey)),
          frac: await refuseAsync(() => v2.verifyRuntimeProjection(fraction)),
          space: await refuseAsync(() => v2.verifyRuntimeProjection(spaced)),
          trail: await refuseAsync(() => v2.verifyRuntimeProjection(bwire + " ")),
          zero: await refuseAsync(
            () => v2.verifyRuntimeProjection('{"projection_version":-0}')),
        };
        ok("relation/v2/projection/a-noncanonical-record-is-not-the-record",
           Object.values(codes).every((c) => c === "WRL_BAD_PROJECTION"),
           `duplicate keys, a fraction, leading whitespace, trailing bytes ` +
           `and -0 are each refused as WRL_BAD_PROJECTION (${
             Object.entries(codes).map(([k, c]) => `${k}=${c}`).join(" ")}). ` +
           `A wire that claims its bytes are canonical cannot also accept ` +
           `lexical variants of them: the two statements are not compatible`);

        /* The canonical-form gate is the one that does not need to enumerate.
         * Re-ordering keys produces a record that parses fine, means exactly
         * the same thing, and is still not this record. */
        const shuffled = (() => {
          const o = JSON.parse(bwire);
          return "{" + Object.keys(o).reverse().map((k) =>
            JSON.stringify(k) + ":" + JSON.stringify(o[k])).join(",") + "}";
        })();
        ok("relation/v2/projection/canonical-form-is-checked-not-assumed",
           await refuseAsync(() => v2.verifyRuntimeProjection(shuffled)) ===
             "WRL_BAD_PROJECTION" && shuffled !== bwire,
           `a key-reordered record denotes the same value and is still ` +
           `refused. This is the gate that covers the variants no one thought ` +
           `to name: re-rendering what the bytes denote must return the bytes`);

        /* And the reader must not have become strict by becoming wrong: the
         * pinned worlds still verify, and still to the ids they always had. */
        const pinnedBack = await v2.verifyRuntimeProjection(
          v2.serializeRuntimeProjection(pv1));
        ok("relation/v2/projection/exact-reading-moves-no-pinned-id",
           pinnedBack.semantic_world_id === pv1.semantic_world_id &&
           pinnedBack.execution_view_id === pv1.execution_view_id &&
           pinnedBack.coincident === true,
           `the pinned V1 world round-trips through the exact reader to the ` +
           `same two ids. A reader that fixed the 64-bit case by changing how ` +
           `ordinary integers are read would have moved every id in the repo`);
      }
    }
  }

  }

  }
}

/* values off a sealed world include a `WrlGraph` and a `Map`, neither of which
 * the canonical serializer takes; compared through a stable rendering instead,
 * since the point is that admission passed the SAME object through */
function fmt(v) {
  if (v instanceof Map) return [...v.entries()].map(([k, x]) => [String(k), fmt(x)]);
  if (v && typeof v === "object") return String(JSON.stringify(v, (k, x) =>
    typeof x === "bigint" ? x.toString() : x));
  return typeof v === "bigint" ? v.toString() : v ?? null;
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

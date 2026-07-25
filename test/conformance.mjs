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

function ok(name, cond, detail) {
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
  for (const row of table[1].matchAll(/<tr ([^>]*data-capability[^>]*)>/g)) {
    const a = row[1];
    out.set(ATTR(a, "data-capability"), {
      tier: ATTR(a, "data-tier"),
      impl: ATTR(a, "data-implementation"),
      stages: (ATTR(a, "data-stages") || "")
        .split(",").map((s) => s.trim()).filter(Boolean),
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
const STAGES = ["tokenize", "parse", "type", "lower", "seal", "execute"];

/* A partial capability must PROVE its claim. Each probe is a source whose
 * treatment demonstrates the stages the registry says work: the toolchain must
 * reject it, with a located diagnostic (proof the earlier stages ran) and a
 * code that names the stage that refused (proof the later ones did not). A
 * registry row that says "partial" without a probe is an unchecked assertion,
 * which is the whole defect being corrected. */
const STAGE_PROBES = {
  "async-route": { texture: "~~sig~~>", through: ["tokenize", "parse"] },
  "verified-route": { texture: "==sig==>", through: ["tokenize", "parse"] },
};
const probeSource = (texture) =>
  `profile forge.world.core.v1\n` +
  `[pulser:p0](every 2){sig_out}\n` +
  `[relay:r0]{sig_in, sig_out}\n` +
  `[p0] ${texture} [r0]\n`;

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
    if (probe) {
      const res = await W.sealWorld(probeSource(probe.texture));
      ok(`caps/${cap}-stage-probe`,
         !res.ok && res.code === "WRL_UNSUPPORTED_FEATURE" && res.line > 0,
         `the probe for "${cap}" should parse far enough to be LOCATED and then ` +
         `be refused by lowering; got ok=${res.ok} code=${res.code} line=${res.line}`);
      ok(`caps/${cap}-stages-match-probe`,
         r.stages.join(",") === probe.through.join(","),
         `registry says stages "${r.stages.join(",")}" but the probe demonstrates ` +
         `"${probe.through.join(",")}"`);
    }
  } else {
    ok(`caps/${cap}-no-stray-stages`, r.stages.length === 0,
       `only a partial capability may name stages; "${cap}" is ${r.impl}`);
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
       * let `data-requires` carry the reason. When the capability ships, the
       * block starts sealing and this goes red. */
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

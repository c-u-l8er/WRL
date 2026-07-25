/* wrl.js -- WallRiderLang Core 0.1.2 identity spine, ported to the browser.
 *
 * A faithful re-implementation of the Forge front-half:
 *
 *     WRL Core source
 *       -> desugarCore        (wrl_sugar.py, sugar.v2)
 *       -> parseWrlCore       (wrl_ir.py, the STRICT world mouth)
 *       -> canonicalizeGraph  (wrl_canonical.py)
 *       -> graphToIr          (Forge Semantic IR v1)
 *       -> serializeArtifact  (deterministic canonical bytes)
 *       -> semanticArtifactId (sem- + sha256)
 *
 * The reference implementation's canonical bytes are
 * `json.dumps(obj, sort_keys=True, separators=(",", ":"))`, and every value in
 * a sealed artifact is an ASCII string, an integer, a boolean, or a list/object
 * of those. So a recursive key-sorted JSON.stringify reproduces them EXACTLY,
 * and WebCrypto SHA-256 reproduces the id.
 *
 * Ground truth (checked against the Python spine):
 *   the demo world seals to
 *   sem-8ae91fe9cbc5fd086ce4356d587c403211e5c7b2b3ebdd316496367429ecfe4a
 *
 * This is the SEMANTIC half only. Lowering to a backend, compiling to
 * interaction-calculus terms, and reducing to a Film all live in TRVM.
 */

export const IR_VERSION = "1.0";
export const IR_VERSION_V1_1 = "1.1";
export const PROFILE_ID = "forge.world.core.v1";
export const RULEPACK_ID = "forge.world.core.rules.v1";
export const ADMIT_POLICY_ID = "admit_candidate_min_firstreceipt_v1";
export const MAILBOX_ADMIT_POLICY_ID = "admit_mailbox_deliver_all_v1";
export const FILM_SCHEMA_ID = "film.v0.7";
export const FILM_SCHEMA_ID_MAILBOX = "film.v0.7.mailbox.v1";
export const NUMERIC_POLICY_IDS = ["POLICY_FORGE"];
export const SUGAR_VERSION = "sugar.v2";

export const ROLE_IDS = ["Pulser", "Relay", "Door", "Spinner", "Orb", "Mailbox"];
export const MAILBOX_ROLE = "Mailbox";
export const EDGE_KINDS = ["SignalWire", "SocketControl"];

/* per-role port signatures (frozen) */
export const PORTS = {
  Pulser:  { out: ["sig_out"], in: [] },
  Relay:   { out: ["sig_out"], in: ["sig_in"] },
  Door:    { out: [],          in: ["sig_in"] },
  Spinner: { out: ["socket"],  in: ["sig_in"] },
  Orb:     { out: [],          in: ["pose"] },
  Mailbox: { out: [],          in: [] },
};

export const EDGE_PORTS = {
  SignalWire:    ["sig_out", "sig_in"],
  SocketControl: ["socket", "pose"],
};

export const ROLE_CONFIG_SCHEMA = {
  Pulser:  { surface_keys: ["mode", "period", "phase", "epoch"],
             static_config_keys: ["clock"] },
  Relay:   { surface_keys: [], static_config_keys: [] },
  Door:    { surface_keys: [], static_config_keys: [] },
  Spinner: { surface_keys: ["w", "n", "rotor", "configurable"],
             static_config_keys: ["w", "n", "rotor", "configurable"] },
  Orb:     { surface_keys: [], static_config_keys: [] },
  Mailbox: { surface_keys: ["w", "cap"], static_config_keys: ["w", "cap"] },
};

export const MAILBOX_WIDTH_MAX = 32;

/* ------------------------------------------------------------ error codes */
export const CODES = {
  WRL_DUPLICATE_ID: "a second object claims an id already declared",
  WRL_UNKNOWN_ENDPOINT: "an edge names an object that was never declared",
  WRL_ILLEGAL_PORT_PAIR: "an edge asks for a port the role does not have",
  WRL_CONTROLLER_CONFLICT: "two controllers reach the same input port",
  WRL_CLOCK_RANGE: "a pulser clock is outside its legal range",
  WRL_NUMERIC_RANGE: "a numeric field is outside its legal range",
  WRL_EPOCH_RANGE: "an epoch index is outside the declared run",
  WRL_UNSUPPORTED_FEATURE: "the construct is outside frozen Semantic IR v1",
  WRL_UNSEALED_POLICY: "a semantic policy id is null or empty",
  WRL_MALFORMED_ARTIFACT: "the artifact record has the wrong shape",
  WRL_PORT_SIGNATURE: "a {ports} group does not match the frozen signature",
  WRL_BAD_LOWERING_PROFILE: "a backend lowering profile is half-specified",
  WRL_SEALED_IMMUTABLE: "something tried to write to a sealed object",
  WRL_UNKNOWN_ARTIFACT_FIELD: "a sealed record carries an unknown field",
  WRL_WORLD_SOURCE_HAS_SCENARIO: "run inputs appeared in world source",
  WRL_SUGAR_MALFORMED: "a sugared spelling could not be expanded",
};

export class WrlError extends Error {
  constructor(code, message, opts = {}) {
    super(`[${code}] ${message}`);
    this.name = "WrlError";
    this.code = code;
    this.detail = message;
    this.line = opts.line ?? null;
    this.locator = opts.locator ?? null;
    this.fieldPath = opts.fieldPath ?? null;
  }
}

function fail(code, message, opts) {
  throw new WrlError(code, message, opts);
}

/* ============================================================ VALUE SUGAR */

/* The frozen EXACT named-rotor table. Each entry is a pure function of the
 * spinner's fractional width n; all four are exact at ANY n because their
 * quaternion components are 0 or 1 (unit = 1 << n). */
export const NAMED_ROTOR_TABLE = {
  identity:  (n) => [1n << BigInt(n), 0n, 0n, 0n],
  reverse_x: (n) => [0n, 1n << BigInt(n), 0n, 0n],
  reverse_y: (n) => [0n, 0n, 1n << BigInt(n), 0n],
  reverse_z: (n) => [0n, 0n, 0n, 1n << BigInt(n)],
};

export const NAMED_ROTOR_RNE_SYM_POLICY = "forge_named_rotor_rne_sym_v1";

/* integer square root over BigInt (Newton), so the projection below never
 * touches a float. */
function isqrtBig(v) {
  if (v < 2n) return v;
  let x = v, y = (x + 1n) / 2n;
  while (y < x) { x = y; y = (x + v / x) / 2n; }
  return x;
}

/* round(2^n / sqrt(2)) by EXACT integer arithmetic. With U = 2^n:
 *   q0 = floor(U/sqrt(2)) = isqrt(2*U*U) // 2
 *   round up iff 2*U*U > 4*q0^2 + 4*q0 + 1
 * so q4 = 11, q8 = 181, q16 = 46341. */
export function roundUOverSqrt2(n) {
  const u = 1n << BigInt(n);
  const twoUU = 2n * u * u;
  const q0 = isqrtBig(twoUU) / 2n;
  return twoUU > 4n * q0 * q0 + 4n * q0 + 1n ? q0 + 1n : q0;
}

/* The forge_named_rotor_rne_sym_v1 projection of a 90-degree turn about z:
 * (q,0,0,q), each lane rounded INDEPENDENTLY to nearest, NO residual
 * redistribution, canonical sign scalar > 0. Because the value depends on n,
 * the SemanticArtifactID is geometry-dependent: the same name at a different
 * spinner n lowers to a different rotor and hence a different id. */
export const NAMED_ROTOR_POLICY_TABLE = {
  quarter_turn_z: [NAMED_ROTOR_RNE_SYM_POLICY, (n) => {
    const q = roundUOverSqrt2(n);
    return [q, 0n, 0n, q];
  }],
};

export const ROTOR_TABLE_NAMES = Object.keys(NAMED_ROTOR_TABLE);
export const POLICY_ROTOR_NAMES = Object.keys(NAMED_ROTOR_POLICY_TABLE);
export const ALL_ROTOR_NAMES = [...ROTOR_TABLE_NAMES, ...POLICY_ROTOR_NAMES];

export const CLOCK_SUGAR_FORMS = ["every K", "every K, phase P", "once at E"];

export function namedRotor(name, n) {
  if (name in NAMED_ROTOR_TABLE) return NAMED_ROTOR_TABLE[name](n);
  if (name in NAMED_ROTOR_POLICY_TABLE) return NAMED_ROTOR_POLICY_TABLE[name][1](n);
  fail("WRL_UNSUPPORTED_FEATURE",
    `named rotor '${name}' not in the accepted vocabulary ` +
    `[${ALL_ROTOR_NAMES.slice().sort().join(", ")}]`);
}

/** The build-provenance policy governing a named rotor, or null when exact.
 *  The policy id is provenance only -- it never enters the artifact bytes. */
export function namedRotorPolicy(name) {
  if (name in NAMED_ROTOR_TABLE) return null;
  if (name in NAMED_ROTOR_POLICY_TABLE) return NAMED_ROTOR_POLICY_TABLE[name][0];
  fail("WRL_UNSUPPORTED_FEATURE",
    `named rotor '${name}' not in the accepted vocabulary`);
}

/* ======================================================= STRUCTURAL SUGAR */

export const REPLICATION_BASE = 0;
export const REPLICATION_MAX = 1024;
export const FANOUT_MAX = 1024;
export const EXPANSION_MAX_LINES = 65536;
const MAX_COUNT_DIGITS = 9;

const REPL_DECL_RE = /^\s*\[(\w+):(\w+)\*(\d+)\]\s*(.*)$/;
const REPL_REF_RE  = /^((?:\w+:)?)(\w+)\*(\d+)$/;
const FANOUT_RE    = /^\s*\[([^\]]+)\]\s*--(\w+)-->\s*\{([^}]*)\}\s*$/;
const EDGE_SUGAR_RE = /^\s*\[([^\]]+)\]\s*--(\w+)-->\s*\[([^\]]+)\]\s*$/;

function checkedCount(digits, where) {
  if (digits.length > MAX_COUNT_DIGITS) {
    fail("WRL_NUMERIC_RANGE",
      `replication count in '${where}' has ${digits.length} digits; ` +
      `the maximum is ${REPLICATION_MAX}`);
  }
  const n = parseInt(digits, 10);
  if (n < 1) fail("WRL_NUMERIC_RANGE", `replication count must be >= 1, got '${where}'`);
  if (n > REPLICATION_MAX) {
    fail("WRL_NUMERIC_RANGE",
      `replication count ${n} in '${where}' exceeds REPLICATION_MAX=` +
      `${REPLICATION_MAX}; write the members explicitly if a group this ` +
      `large is intended`);
  }
  return n;
}

const member = (prefix, base, i) => `${prefix}${base}${REPLICATION_BASE + i}`;

function replParts(endpoint) {
  const m = REPL_REF_RE.exec(endpoint.trim());
  if (!m) return null;
  return [m[1], m[2], checkedCount(m[3], endpoint.trim())];
}

function desugarDeclReplication(code) {
  const m = REPL_DECL_RE.exec(code);
  if (!m) return null;
  const [, role, base, digits, tail] = m;
  const n = checkedCount(digits, code.trim());
  const out = [];
  for (let i = 0; i < n; i++) out.push(`[${role}:${member("", base, i)}]${tail}`);
  return out;
}

function desugarEdgeReplication(code) {
  const m = EDGE_SUGAR_RE.exec(code);
  if (!m) return null;
  const [, src, tag, dst] = m;
  const rs = replParts(src), rd = replParts(dst);
  if (rs === null && rd === null) return null;
  const out = [];
  if (rs !== null && rd !== null) {
    if (rs[2] !== rd[2]) {
      fail("WRL_NUMERIC_RANGE",
        `positional replication needs equal counts, got ${rs[2]} and ` +
        `${rd[2]} in '${code.trim()}'`);
    }
    for (let i = 0; i < rs[2]; i++) {
      out.push(`[${member(rs[0], rs[1], i)}] --${tag}--> [${member(rd[0], rd[1], i)}]`);
    }
    return out;
  }
  if (rs !== null) {
    for (let i = 0; i < rs[2]; i++) {
      out.push(`[${member(rs[0], rs[1], i)}] --${tag}--> [${dst.trim()}]`);
    }
    return out;
  }
  for (let i = 0; i < rd[2]; i++) {
    out.push(`[${src.trim()}] --${tag}--> [${member(rd[0], rd[1], i)}]`);
  }
  return out;
}

function desugarFanout(code) {
  const m = FANOUT_RE.exec(code);
  if (!m) return null;
  const [, src, tag, body] = m;
  const members = body.split(",").map((t) => t.trim()).filter(Boolean);
  if (!members.length) {
    fail("WRL_UNSUPPORTED_FEATURE", `empty fan-out group in '${code.trim()}'`);
  }
  if (members.length > FANOUT_MAX) {
    fail("WRL_NUMERIC_RANGE",
      `fan-out group in '${code.trim()}' has ${members.length} members; ` +
      `the maximum is ${FANOUT_MAX}`);
  }
  return members.map((tok) => {
    if (!(tok.startsWith("[") && tok.endsWith("]"))) {
      fail("WRL_UNSUPPORTED_FEATURE",
        `fan-out member '${tok}' must be a bracketed endpoint`);
    }
    return `[${src.trim()}] --${tag}--> [${tok.slice(1, -1).trim()}]`;
  });
}

function desugarStructural(code) {
  if (!code.trim()) return [code];
  if (code.includes("-->")) {
    const fan = desugarFanout(code);
    if (fan !== null) {
      const out = [];
      for (const ln of fan) {
        const rep = desugarEdgeReplication(ln);
        (rep || [ln]).forEach((x) => out.push(x));
        if (out.length > EXPANSION_MAX_LINES) {
          fail("WRL_NUMERIC_RANGE",
            `fan-out x replication in '${code.trim()}' exceeds ` +
            `EXPANSION_MAX_LINES=${EXPANSION_MAX_LINES}`);
        }
      }
      return out;
    }
    return desugarEdgeReplication(code) || [code];
  }
  return desugarDeclReplication(code) || [code];
}

/* ------------------------------------------------------------ value pass */
const ROTOR_NAME_RE = /rotor=([A-Za-z_]\w*)/;
const N_RE = /\bn=(\d+)/;
const PAREN_RE = /\(([^)]*)\)/;

function desugarClock(body) {
  if (body.includes("mode=") || body.includes("period=") || body.includes("epoch=")) {
    return null;
  }
  const toks = body.replace(/,/g, " ").split(/\s+/).filter(Boolean);
  if (!toks.length) return null;
  if (toks[0] === "every") {
    const period = parseInt(toks[1], 10);
    if (!Number.isFinite(period)) {
      fail("WRL_SUGAR_MALFORMED", `'every' needs a period: '(${body})'`);
    }
    let phase = 0;
    const pi = toks.indexOf("phase");
    if (pi >= 0) {
      phase = parseInt(toks[pi + 1], 10);
      if (!Number.isFinite(phase)) {
        fail("WRL_SUGAR_MALFORMED", `'phase' needs a value: '(${body})'`);
      }
    }
    return `mode=periodic, period=${period}, phase=${phase}`;
  }
  if (toks[0] === "once" && toks[1] === "at") {
    const e = parseInt(toks[2], 10);
    if (!Number.isFinite(e)) {
      fail("WRL_SUGAR_MALFORMED", `'once at' needs an epoch: '(${body})'`);
    }
    return `mode=once, epoch=${e}`;
  }
  return null;
}

function desugarCode(code) {
  const mrot = ROTOR_NAME_RE.exec(code);
  if (mrot) {
    const mn = N_RE.exec(code);
    if (mn === null) {
      fail("WRL_UNSUPPORTED_FEATURE",
        `named rotor '${mrot[1]}' needs the spinner fractional width n on ` +
        `the same declaration`);
    }
    const lanes = namedRotor(mrot[1], parseInt(mn[1], 10));
    code = code.slice(0, mrot.index) + "rotor=" + lanes.join(".") +
           code.slice(mrot.index + mrot[0].length);
  }
  if (code.trimStart().startsWith("[pulser:")) {
    const mg = PAREN_RE.exec(code);
    if (mg) {
      const next = desugarClock(mg[1]);
      if (next !== null) {
        code = code.slice(0, mg.index) + "(" + next + ")" +
               code.slice(mg.index + mg[0].length);
      }
    }
  }
  return code;
}

/**
 * WRL Core source with sugar -> canonical WRL Core source.
 *
 * Returns `{ text, origins }`. `origins` is the generated-line -> authored-line
 * sidecar (a PRESENTATION sidecar: it is not hashed, enters no artifact, and
 * discarding it changes no identity).
 *
 * THE LAW: there is no sugar-specific identity. Desugaring is not exempt from
 * identity -- it is upstream of it. A sugared program and its explicit twin
 * lower to identical canonical bytes because the sugar is gone before a graph
 * exists.
 */
export function desugarCoreMapped(src) {
  const out = [], origins = [];
  const lines = src.split("\n");
  if (src.endsWith("\n")) lines.pop();
  lines.forEach((raw, idx) => {
    const srcLineNo = idx + 1;
    const semi = raw.indexOf(";");
    const code = semi === -1 ? raw : raw.slice(0, semi);
    const tail = semi === -1 ? "" : raw.slice(semi);
    let expansion;
    try {
      expansion = desugarStructural(desugarCode(code));
    } catch (e) {
      if (e instanceof WrlError && e.line === null) e.line = srcLineNo;
      throw e;
    }
    if (out.length + expansion.length > EXPANSION_MAX_LINES) {
      fail("WRL_NUMERIC_RANGE",
        `desugaring this source would emit more than ` +
        `EXPANSION_MAX_LINES=${EXPANSION_MAX_LINES} lines`, { line: srcLineNo });
    }
    const expanded = expansion.length > 1;
    expansion.forEach((line, i) => {
      /* line 0 keeps the ORIGINAL slot's layout and (per decision D-c) its
       * inline comment; members 1..N-1 are newly minted. */
      out.push(i === 0 ? line + tail : line.replace(/\s+$/, ""));
      origins.push({
        emittedLine: out.length, sourceLine: srcLineNo, sourceText: raw,
        expanded, memberIndex: i, memberCount: expansion.length,
        emittedText: out[out.length - 1],
      });
    });
  });
  const text = out.join("\n") + (src.endsWith("\n") ? "\n" : "");
  return { text, origins };
}

/** The text-only face of `desugarCoreMapped`. Idempotent; a no-op on
 *  already-explicit source. */
export function desugarCore(src) {
  return desugarCoreMapped(src).text;
}

/* ============================================================ CORE PARSER */

const NODE_RE  = /^\[(\w+):(\w+)\]\s*(\([^)]*\))?\s*(\{[^}]*\})?$/;
const EDGE_RE  = /^\[(?:\w+:)?(\w+)\]\s*--(\w+)-->\s*\[(?:\w+:)?(\w+)\]$/;
const EPOCH_RE = /^\[epoch:(\d+)\]\s*(.*)$/;

const ROLE_TOKEN = { pulser: "Pulser", relay: "Relay", door: "Door",
                     spinner: "Spinner", orb: "Orb" };
const EDGE_TAG = { sig: "SignalWire", socket: "SocketControl" };

const RUN_INPUT_PERIODS = "periods ";
const RUN_INPUT_CLAIM = "[epoch:";

function isRunInputLine(line) {
  return line.startsWith(RUN_INPUT_PERIODS) || line.startsWith(RUN_INPUT_CLAIM);
}

/** Every (1-based line number, stripped line) carrying ScenarioV1 syntax. */
export function runInputLines(text) {
  const out = [];
  text.split("\n").forEach((raw, i) => {
    const line = raw.split(";")[0].trim();
    if (isRunInputLine(line)) out.push([i + 1, line]);
  });
  return out;
}

/** A combined pre-v0.4-0 document -> `{ world, runInputs }`. The split is
 *  LEXICAL and layout-preserving, so no identity can move across it. */
export function splitLegacyDocument(text) {
  const world = [], runs = [];
  for (const raw of text.split("\n")) {
    (isRunInputLine(raw.split(";")[0].trim()) ? runs : world).push(raw);
  }
  return { world: world.join("\n"), runInputs: runs.join("\n") };
}

function parenKv(group) {
  const kv = {}, flags = new Set();
  if (!group) return { kv, flags };
  const body = group.trim().slice(1, -1).trim();
  if (!body) return { kv, flags };
  for (let item of body.split(",")) {
    item = item.trim();
    if (!item) continue;
    const eq = item.indexOf("=");
    if (eq !== -1) kv[item.slice(0, eq).trim()] = item.slice(eq + 1).trim();
    else flags.add(item);
  }
  return { kv, flags };
}

function portsSet(group) {
  return new Set(group.trim().slice(1, -1).split(",")
    .map((t) => t.trim()).filter(Boolean));
}

/** The full frozen port SET of a role. */
export function portProjection(role) {
  return new Set([...PORTS[role].in, ...PORTS[role].out]);
}

/** A `{ports}` brace group is a CHECKED projection of the role's frozen ports:
 *  it must reveal the signature exactly. `{}` or a bogus token is rejected --
 *  visible source is never silently ignored. */
export function validatePortProjection(role, tokens, opts) {
  const want = [...portProjection(role)].sort();
  const got = [...tokens].sort();
  if (want.join(",") !== got.join(",")) {
    fail("WRL_PORT_SIGNATURE",
      `${role} ports [${got.join(", ")}] do not match the frozen signature ` +
      `[${want.join(", ")}]`, opts);
  }
}

function rotorDots(tok, opts) {
  const parts = tok.split(".");
  if (parts.length !== 4) {
    fail("WRL_NUMERIC_RANGE", `rotor must have 4 lanes, got '${tok}'`, opts);
  }
  return parts.map((x) => {
    const v = parseInt(x, 10);
    if (!Number.isFinite(v)) {
      fail("WRL_NUMERIC_RANGE", `rotor lanes must be integers: '${tok}'`, opts);
    }
    return v;
  });
}

function intField(kv, key, opts) {
  const v = parseInt(kv[key], 10);
  if (!Number.isFinite(v)) {
    fail("WRL_NUMERIC_RANGE", `'${key}' must be an integer, got '${kv[key]}'`, opts);
  }
  return v;
}

/** A canonical WRL graph. `periods`/`batches` are RUN INPUTS -- they never
 *  enter the SemanticArtifactID. */
export class WrlGraph {
  constructor() {
    this.profile = PROFILE_ID;
    this.periods = 0;
    this.nodes = [];   // [role, name, config]
    this.edges = [];   // [kind, src, dst]
    this.batches = [];
  }
}

/**
 * STRICT WRL Core WORLD source -> canonical WRL graph.
 *
 * RUN INPUTS ARE NOT WORLD SOURCE. A `periods N` line or an `[epoch:N]` claim
 * is refused with WRL_WORLD_SOURCE_HAS_SCENARIO; they belong to ScenarioV1.
 * Use `parseWrlLegacyDocument` to read a pre-v0.4-0 combined document.
 *
 * Lexical law: comments are `;` (full-line or inline). `#` is reserved for
 * content identity and is NEVER a comment marker.
 */
export function parseWrlCore(text) {
  const offenders = runInputLines(text);
  if (offenders.length) {
    const [n, line] = offenders[0];
    fail("WRL_WORLD_SOURCE_HAS_SCENARIO",
      `run inputs are not world source: line ${n}, '${line}' -- run inputs ` +
      `live in ScenarioV1 (the v0.4-0 document boundary)`, { line: n });
  }
  return parseCorePermissive(text);
}

/** COMPATIBILITY PATH -- a pre-v0.4-0 COMBINED document. A migration bridge,
 *  not the normative surface. */
export function parseWrlLegacyDocument(text) {
  return parseCorePermissive(text);
}

function addClaim(g, epoch, wid, seq, body, opts) {
  if (!(epoch >= 1 && epoch <= g.periods)) {
    fail("WRL_EPOCH_RANGE",
      `epoch ${epoch} out of range [1, ${g.periods}]`, opts);
  }
  const op = body[0];
  let payload;
  if (op === "SetRotor") payload = ["SetRotor", body[1], rotorDots(body[2], opts)];
  else if (op === "ResetFault") payload = ["ResetFault", body[1]];
  else {
    fail("WRL_UNSUPPORTED_FEATURE",
      `claim op '${op}' (only SetRotor|ResetFault in IR v1)`, opts);
  }
  g.batches[epoch - 1].push({ writer_id: wid, sequence: seq, payload });
}

function parseCorePermissive(text) {
  const g = new WrlGraph();
  text.split("\n").forEach((raw, idx) => {
    const opts = { line: idx + 1 };
    const line = raw.split(";")[0].trim();
    if (!line) return;

    if (line.startsWith("profile ")) { g.profile = line.split(/\s+/)[1]; return; }
    if (line.startsWith("periods ")) {
      g.periods = parseInt(line.split(/\s+/)[1], 10);
      g.batches = Array.from({ length: g.periods }, () => []);
      return;
    }

    const me = EPOCH_RE.exec(line);
    if (me) {
      const epoch = parseInt(me[1], 10);
      let body = me[2].split(/\s+/).filter(Boolean);
      let wid = null, seq = null;
      const wm = /@(\d+),(\d+)/.exec(me[2]);
      if (wm) {
        wid = parseInt(wm[1], 10); seq = parseInt(wm[2], 10);
        body = body.filter((b) => !b.startsWith("@"));
      }
      addClaim(g, epoch, wid, seq, body, opts);
      return;
    }

    if (line.includes("-->")) {
      const m = EDGE_RE.exec(line);
      if (!m) fail("WRL_UNSUPPORTED_FEATURE", `bad edge notation '${line}'`, opts);
      const [, src, tag, dst] = m;
      if (!(tag in EDGE_TAG)) {
        fail("WRL_UNSUPPORTED_FEATURE",
          `edge tag '${tag}' (only sig|socket in IR v1)`, opts);
      }
      g.edges.push([EDGE_TAG[tag], src, dst]);
      return;
    }

    if (line.includes("~~") || line.includes("!!") || line.includes("==")) {
      fail("WRL_UNSUPPORTED_FEATURE",
        `route texture in '${line}': async ~~ / fault !! / verified == are ` +
        `transition classes, not IR v1 edges`, opts);
    }

    const m = NODE_RE.exec(line);
    if (!m) fail("WRL_UNSUPPORTED_FEATURE", `unrecognized WRL notation '${line}'`, opts);
    const rtok = m[1], name = m[2];
    if (!(rtok in ROLE_TOKEN)) {
      fail("WRL_UNSUPPORTED_FEATURE",
        `role '${rtok}' not in the frozen v1 surface registry ` +
        `[${Object.keys(ROLE_TOKEN).join(", ")}]`, opts);
    }
    const role = ROLE_TOKEN[rtok];
    if (m[4] !== undefined) validatePortProjection(role, portsSet(m[4]), opts);
    const { kv, flags } = parenKv(m[3]);

    if (role === "Pulser") {
      const mode = kv.mode ?? "periodic";
      let clock;
      if (mode === "periodic") {
        clock = ["periodic", intField(kv, "period", opts), intField(kv, "phase", opts)];
      } else if (mode === "once") {
        clock = ["once", intField(kv, "epoch", opts)];
      } else {
        fail("WRL_UNSUPPORTED_FEATURE",
          `pulser clock mode '${mode}' (only periodic|once)`, opts);
      }
      g.nodes.push(["Pulser", name, { clock }]);
    } else if (role === "Spinner") {
      g.nodes.push(["Spinner", name, {
        w: "w" in kv ? intField(kv, "w", opts) : null,
        n: "n" in kv ? intField(kv, "n", opts) : null,
        rotor: "rotor" in kv ? rotorDots(kv.rotor, opts) : null,
        configurable: flags.has("configurable") || kv.configurable === "true",
      }]);
    } else {
      g.nodes.push([role, name, {}]);
    }
    /* remember where each node was authored, for diagnostics only */
    g.nodes[g.nodes.length - 1].line = opts.line;
  });
  return g;
}

/* ============================================================= VALIDATION */

const IDENT_OK = /^[A-Za-z0-9_]+$/;

/** Typed structural validation against the frozen IR v1 registries. The IR
 *  validator -- not the runtime -- owns these errors. */
export function validateGraph(g) {
  if (g.profile !== PROFILE_ID) {
    fail("WRL_UNSUPPORTED_FEATURE",
      `unknown profile '${g.profile}'; this compiler only serves ${PROFILE_ID}`);
  }

  const roleOf = new Map();
  for (const node of g.nodes) {
    const [role, name, cfg] = node;
    const opts = { line: node.line ?? null, locator: `object ${name}` };
    if (!ROLE_IDS.includes(role)) {
      fail("WRL_UNSUPPORTED_FEATURE",
        `role '${role}' not in the frozen v1 registry`, { ...opts, fieldPath: "role" });
    }
    if (roleOf.has(name)) {
      fail("WRL_DUPLICATE_ID", `duplicate object id '${name}'`, opts);
    }
    if (!name || !IDENT_OK.test(name) || name.includes("__")) {
      fail("WRL_UNSUPPORTED_FEATURE",
        `bad object id '${name}' (alnum/_ only, no '__')`,
        { ...opts, fieldPath: "object_id" });
    }
    roleOf.set(name, role);
    validateConfig(role, name, cfg, opts);
  }

  const sigIn = new Map(), socketIn = new Map();
  for (const [kind, s, d] of g.edges) {
    const opts = { locator: `edge ${kind}:${s}->${d}` };
    if (!EDGE_KINDS.includes(kind)) {
      fail("WRL_UNSUPPORTED_FEATURE", `edge kind '${kind}' not in frozen v1 edges`, opts);
    }
    if (!roleOf.has(s)) fail("WRL_UNKNOWN_ENDPOINT", `edge source '${s}' not declared`, opts);
    if (!roleOf.has(d)) fail("WRL_UNKNOWN_ENDPOINT", `edge destination '${d}' not declared`, opts);
    const [outPort, inPort] = EDGE_PORTS[kind];
    if (!PORTS[roleOf.get(s)].out.includes(outPort)) {
      fail("WRL_ILLEGAL_PORT_PAIR",
        `${s} (${roleOf.get(s)}) has no out-port ${outPort} for a ${kind}`, opts);
    }
    if (!PORTS[roleOf.get(d)].in.includes(inPort)) {
      fail("WRL_ILLEGAL_PORT_PAIR",
        `${d} (${roleOf.get(d)}) has no in-port ${inPort} for a ${kind}`, opts);
    }
    const bucket = kind === "SignalWire" ? sigIn : socketIn;
    bucket.set(d, (bucket.get(d) || 0) + 1);
  }
  for (const [d, c] of sigIn) {
    if (c > 1) {
      fail("WRL_CONTROLLER_CONFLICT",
        `${d} has ${c} signal-wire inputs (a node admits one)`,
        { locator: `object ${d}` });
    }
  }
  for (const [d, c] of socketIn) {
    if (c > 1) {
      fail("WRL_CONTROLLER_CONFLICT",
        `${d} has ${c} controllers (an orb admits one)`, { locator: `object ${d}` });
    }
  }

  if (!Number.isInteger(g.periods) || g.periods < 0) {
    fail("WRL_EPOCH_RANGE", "periods must be a non-negative integer");
  }
  return g;
}

function validateConfig(role, name, cfg, opts) {
  if (role === "Pulser") {
    const clock = cfg.clock;
    if (!Array.isArray(clock) || !clock.length) {
      fail("WRL_CLOCK_RANGE", `pulser ${name}: missing clock`,
        { ...opts, fieldPath: "static_config.clock" });
    }
    if (clock[0] === "periodic") {
      const [, p, ph] = clock;
      if (!(Number.isInteger(p) && p >= 1)) {
        fail("WRL_CLOCK_RANGE", `pulser ${name}: period >= 1`,
          { ...opts, fieldPath: "static_config.clock" });
      }
      if (!(Number.isInteger(ph) && ph >= 0 && ph < p)) {
        fail("WRL_CLOCK_RANGE", `pulser ${name}: phase in [0, period)`,
          { ...opts, fieldPath: "static_config.clock" });
      }
    } else if (clock[0] === "once") {
      if (!(Number.isInteger(clock[1]) && clock[1] >= 0)) {
        fail("WRL_CLOCK_RANGE", `pulser ${name}: once epoch >= 0`,
          { ...opts, fieldPath: "static_config.clock" });
      }
    } else {
      fail("WRL_UNSUPPORTED_FEATURE",
        `pulser ${name}: clock mode '${clock[0]}' (only periodic|once)`, opts);
    }
  } else if (role === "Spinner") {
    for (const key of ["w", "n", "rotor"]) {
      if (cfg[key] === null || cfg[key] === undefined) {
        fail("WRL_UNSUPPORTED_FEATURE", `spinner ${name}: missing '${key}'`,
          { ...opts, fieldPath: `static_config.${key}` });
      }
    }
    const w = cfg.w, n = cfg.n;
    if (!(Number.isInteger(w) && w > 0 && Number.isInteger(n) && n >= 0 && n <= w)) {
      fail("WRL_NUMERIC_RANGE", `spinner ${name}: bad lane geometry`,
        { ...opts, fieldPath: "static_config.n" });
    }
    if (cfg.rotor.length !== 4) {
      fail("WRL_NUMERIC_RANGE", `spinner ${name}: rotor must have 4 lanes`,
        { ...opts, fieldPath: "static_config.rotor" });
    }
    const lim = 2 ** w;
    if (!cfg.rotor.every((v) => v >= 0 && v < lim)) {
      fail("WRL_NUMERIC_RANGE", `spinner ${name}: rotor lanes out of [0, 2^${w})`,
        { ...opts, fieldPath: "static_config.rotor" });
    }
  } else if (role === MAILBOX_ROLE) {
    for (const key of ["w", "cap"]) {
      if (cfg[key] === null || cfg[key] === undefined) {
        fail("WRL_UNSUPPORTED_FEATURE", `mailbox ${name}: missing '${key}'`,
          { ...opts, fieldPath: `static_config.${key}` });
      }
    }
    if (!(Number.isInteger(cfg.w) && cfg.w >= 1 && cfg.w <= MAILBOX_WIDTH_MAX)) {
      fail("WRL_NUMERIC_RANGE",
        `mailbox ${name}: body width must be in 1..${MAILBOX_WIDTH_MAX}`, opts);
    }
    if (!(Number.isInteger(cfg.cap) && cfg.cap >= 1)) {
      fail("WRL_NUMERIC_RANGE", `mailbox ${name}: capacity must be >= 1`, opts);
    }
  }
}

/* ========================================================= CANONICALIZE */

function cmp(a, b) { return a < b ? -1 : a > b ? 1 : 0; }

function canonConfig(role, cfg) {
  const out = {};
  for (const k of Object.keys(cfg)) {
    if (k.startsWith("_")) continue;   /* diagnostics-only fields never hash */
    out[k] = cfg[k];
  }
  if (role === "Spinner" && cfg.rotor != null) {
    out.rotor = cfg.rotor.map((v) => Number(v));
    out.configurable = Boolean(cfg.configurable);
  }
  return out;
}

/** An order-independent canonical graph: objects sorted IDENTITY-FIRST by
 *  (object_id, role), edges by (kind, src, dst). Declaration order and surface
 *  syntax no longer affect the bytes. */
export function canonicalizeGraph(g) {
  const cg = new WrlGraph();
  cg.profile = g.profile;
  cg.periods = g.periods;
  cg.nodes = g.nodes
    .map((node) => {
      const out = [node[0], node[1], canonConfig(node[0], node[2])];
      out.line = node.line ?? null;
      return out;
    })
    .sort((a, b) => cmp(a[1], b[1]) || cmp(a[0], b[0]));
  cg.edges = g.edges.slice()
    .sort((a, b) => cmp(a[0], b[0]) || cmp(a[1], b[1]) || cmp(a[2], b[2]));
  cg.batches = g.batches.map((b) => b.slice());
  return cg;
}

/* ========================================================== GRAPH -> IR */

/** The frozen NON-EMPTY port groups of a role. An empty group is OMITTED --
 *  a Door carries `{"in":["sig_in"]}` and no "out" key at all. */
export function objectPorts(role) {
  const out = {};
  for (const k of ["out", "in"]) {
    if (PORTS[role][k].length) out[k] = PORTS[role][k].slice();
  }
  return out;
}

/** The four role-derived semantic identity fields, decided together so they
 *  cannot drift apart. */
export function semanticSurfaceForRoles(roles) {
  const hasMailbox = roles.includes(MAILBOX_ROLE);
  return {
    ir_version: hasMailbox ? IR_VERSION_V1_1 : IR_VERSION,
    runtime_state_schema: hasMailbox ? "RuntimeStateV1_1" : "RuntimeStateV1",
    admit_policy_id: hasMailbox ? MAILBOX_ADMIT_POLICY_ID : ADMIT_POLICY_ID,
    film_schema_id: hasMailbox ? FILM_SCHEMA_ID_MAILBOX : FILM_SCHEMA_ID,
  };
}

export function schemasForRoles(roles) {
  return {
    runtime_state_schema: semanticSurfaceForRoles(roles).runtime_state_schema,
    epoch_input_schema: "EpochInputV1",
    observable_schema: "EpochResultV1",
  };
}

/** Canonical WRL graph -> ForgeSemanticArtifactV1, the STATIC artifact ONLY.
 *  Run inputs are NOT part of it. */
export function graphToIr(g) {
  validateGraph(g);
  const objects = g.nodes
    .slice()
    .sort((a, b) => cmp(a[1], b[1]) || cmp(a[0], b[0]))
    .map(([role, name, cfg]) => ({
      object_id: name,
      role,
      static_config: canonConfig(role, cfg),
      state_schema_ref: `state.${role.toLowerCase()}.v1`,
      ports: objectPorts(role),
    }));
  const edges = g.edges
    .slice()
    .sort((a, b) => cmp(a[0], b[0]) || cmp(a[1], b[1]) || cmp(a[2], b[2]))
    .map(([kind, src, dst]) => ({ kind, src, dst }));
  const roles = g.nodes.map((n) => n[0]);
  const surface = semanticSurfaceForRoles(roles);
  return {
    ir_version: surface.ir_version,
    profile_id: g.profile,
    semantic_policies: {
      rulepack_id: RULEPACK_ID,
      numeric_policy_ids: NUMERIC_POLICY_IDS.slice(),
      admit_policy_id: surface.admit_policy_id,
      film_schema_id: surface.film_schema_id,
    },
    schemas: schemasForRoles(roles),
    objects,
    edges,
  };
}

/* ===================================================== SERIALIZE / IDENTITY */

/* Python: json.dumps(obj, sort_keys=True, separators=(",", ":")).
 * Every value here is an ASCII string, an integer, a boolean, or a container
 * of those, so a recursive key-sorted JSON.stringify is byte-identical. */
function canonicalJson(value) {
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  if (value !== null && typeof value === "object") {
    return "{" + Object.keys(value).sort().map(
      (k) => JSON.stringify(k) + ":" + canonicalJson(value[k])).join(",") + "}";
  }
  return JSON.stringify(value);
}

/** Deterministic canonical bytes of the STATIC semantic artifact. */
export function serializeArtifact(artifact) {
  return canonicalJson(artifact);
}

async function sha256Hex(text) {
  const buf = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * SemanticArtifactID = "sem-" + sha256(canonical artifact bytes).
 *
 * A pure function of the frozen semantic graph and NOTHING of the backend
 * encoding, the run plan, or the claim batches. Swapping one-hot for binary
 * counters moves the BackendArtifactID and leaves this fixed.
 */
export async function semanticArtifactId(artifact) {
  return "sem-" + await sha256Hex(serializeArtifact(artifact));
}

/**
 * The whole pipeline: sugared WRL Core world source -> a sealed result.
 *
 * Returns `{ ok, source, desugared, graph, artifact, bytes, semanticId,
 *            origins, sugared }` on success, or
 *         `{ ok: false, code, message, line }` on a typed rejection.
 */
export async function sealWorld(source) {
  try {
    const { text: desugared, origins } = desugarCoreMapped(source);
    const graph = canonicalizeGraph(parseWrlCore(desugared));
    const artifact = graphToIr(graph);
    const bytes = serializeArtifact(artifact);
    const semanticId = "sem-" + await sha256Hex(bytes);
    return { ok: true, source, desugared, origins, graph, artifact, bytes,
             semanticId, sugared: desugared !== source };
  } catch (e) {
    if (e instanceof WrlError) {
      return { ok: false, code: e.code, message: e.detail, line: e.line,
               locator: e.locator, fieldPath: e.fieldPath };
    }
    return { ok: false, code: "WRL_MALFORMED_ARTIFACT", message: String(e),
             line: null };
  }
}

/* ============================================================== FORMATTER */

const ROLE_SURFACE = { Pulser: "pulser", Relay: "relay", Door: "door",
                       Spinner: "spinner", Orb: "orb", Mailbox: "mailbox" };
const EDGE_SURFACE = { SignalWire: "sig", SocketControl: "socket" };

function surfaceConfig(role, cfg) {
  if (role === "Pulser") {
    const c = cfg.clock;
    return c[0] === "periodic"
      ? `(mode=periodic, period=${c[1]}, phase=${c[2]})`
      : `(mode=once, epoch=${c[1]})`;
  }
  if (role === "Spinner") {
    const bits = [`w=${cfg.w}`, `n=${cfg.n}`, `rotor=${cfg.rotor.join(".")}`];
    if (cfg.configurable) bits.push("configurable");
    return `(${bits.join(", ")})`;
  }
  if (role === MAILBOX_ROLE) return `(w=${cfg.w}, cap=${cfg.cap})`;
  return "";
}

/**
 * Canonical WRL Core world source from a canonical graph.
 *
 * The formatter emits the EXPLICIT numeric surface: sugar washes out here
 * exactly as declaration order and whitespace do. Formatting is normalization,
 * never a compiler gate -- an unformatted world seals to the same id.
 */
export function formatCore(g) {
  const out = [`profile ${g.profile}`, ""];
  for (const [role, name, cfg] of g.nodes) {
    const ports = [...portProjection(role)].sort().join(", ");
    out.push(`[${ROLE_SURFACE[role]}:${name}]${surfaceConfig(role, cfg)}` +
             (ports ? `{${ports}}` : ""));
  }
  if (g.edges.length) out.push("");
  for (const [kind, s, d] of g.edges) {
    out.push(`[${s}] --${EDGE_SURFACE[kind]}--> [${d}]`);
  }
  return out.join("\n") + "\n";
}

/* ============================================================ THE DEMO WORLD */

/** The pinned Forge Spinner Bench demo world. Seals to
 *  sem-8ae91fe9cbc5fd086ce4356d587c403211e5c7b2b3ebdd316496367429ecfe4a --
 *  the id every WRL/TRVM battery folds against. */
export const DEMO_WORLD = `profile forge.world.core.v1

[pulser:p0](every 2){sig_out}
[relay:r0]{sig_in, sig_out}
[spinner:sp](w=16, n=8, rotor=quarter_turn_z, configurable){sig_in, socket}
[orb:ob]{pose}
[pulser:p1](once at 1){sig_out}
[door:d0]{sig_in}

[pulser:p0] --sig--> [relay:r0]
[relay:r0] --sig--> [spinner:sp]
[spinner:sp] --socket--> [orb:ob]
[pulser:p1] --sig--> [door:d0]
`;

export const DEMO_WORLD_SEMANTIC_ID =
  "sem-8ae91fe9cbc5fd086ce4356d587c403211e5c7b2b3ebdd316496367429ecfe4a";

/** A self-check: re-seal the demo world and confirm it reproduces the frozen
 *  id. Returns `{ ok, semanticId, expected }`. */
export async function selfCheck() {
  const r = await sealWorld(DEMO_WORLD);
  return {
    ok: r.ok && r.semanticId === DEMO_WORLD_SEMANTIC_ID,
    semanticId: r.ok ? r.semanticId : null,
    expected: DEMO_WORLD_SEMANTIC_ID,
    error: r.ok ? null : r,
  };
}

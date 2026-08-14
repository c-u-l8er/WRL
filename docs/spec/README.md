# WallRiderLang — spec index

**WRL is an executable topology language whose meaning is a hash.**

This file is the *index* to the WRL specification. It is not the specification.
The normative text is [`spec.html`](../../spec.html) **Part I — WRL Core 0.1.2,
the frozen family extract**; where this page and that page disagree, that page
wins. Part II of the same document is a non-normative design draft and binds
nothing.

## Where each thing lives

| Artifact | What it is | Status |
|---|---|---|
| [`spec.html`](../../spec.html) Part I | **WRL Core 0.1.2** — the normative frozen family extract | **normative** |
| [`spec.html`](../../spec.html) Part II | design draft, stated in the spec's own language | non-normative |
| [`reference.html`](../../reference.html) | every table: grammar, roles, ports, edges, clocks, rotors, sugar bounds, diagnostic codes, pinned policy ids, stability tiers | normative tables |
| [`draft.html`](../../draft.html) | the authored full-language design, Parts II–VI, each section marked Core / Experimental / Proposed | **not built** |
| [`direction.html`](../../direction.html) | what the language is *for*, the honest scorecard, and the dependency-ordered list of what is missing | argument |
| [`guide.html`](../../guide.html) · [`learn.html`](../../learn.html) | the language guide and the 20-minute tutorial | teaching |
| [`playground.html`](../../playground.html) | live browser playground that computes real `SemanticArtifactID`s | executable |

The reference implementation of the identity spine lives in this repository as
[`wrl.js`](../../wrl.js); the runtime that *executes* what WRL denotes lives in
[TRVM Forge](../../../TRVM/forge).

## What is frozen

Freezing a **family** means the set of members is closed and each member's
meaning-role is settled. It does **not** freeze exact glyphs, argument grammars,
sugar, or edge-case rules. Read
[the stability tier table](../../reference.html#tiers) before building on
anything.

| Thing | State |
|---|---|
| WRL Core | **0.1.2 — frozen** (families only) |
| Forge Semantic IR 1.x | **frozen** (`forge.world.core.v1`) |
| Forge Semantic IR 2.0 | **draft — implemented** ([`relation-v2.js`](../../relation-v2.js)); named relations over the *same* profile, both pinned ids unmoved |
| §D8 relation model | **draft** — the period-0 arithmetic runs; §D8.4, §D8.6 and all of §D9 do not |
| Surface sugar | `sugar.v2` — implemented, battery green, identity-equivalent, **not frozen** |
| Route texture `--` | surface-grounded |
| Route textures `~~` `==` `!!` | partial — the notation is frozen, the surface construct is not writable |

## The writable surface, in full

A world document opens with exactly one `profile <id>` line (comments and blank
lines may precede it; nothing else may). A profile-only document is legal — it
is the **empty world**, and it seals.

```
profile-line ::= "profile" WS profile-id
declaration  ::= "[" role ":" id "]" [ config ] [ ports ]
edge         ::= "[" [ role ":" ] id "]" "--" edge-tag "-->" "[" [ role ":" ] id "]"

config       ::= "(" [ config-item ( "," config-item )* ] ")"
ports        ::= "{" [ port ( "," port )* ] "}"
config-item  ::= key "=" value | clock-sugar | "configurable"

role         ::= "pulser" | "relay" | "door" | "spinner" | "orb"
edge-tag     ::= "sig" | "socket"
id           ::= WORD   ; [A-Za-z0-9_]+, and MUST NOT contain "__"
comment      ::= ";" ANY*
```

Five roles, two edge kinds, one grounded texture. That is the whole language you
can type today.

### Roles and their frozen port signatures

| Role | Canonical | out | in |
|---|---|---|---|
| `pulser` | `Pulser` | `sig_out` | — |
| `relay` | `Relay` | `sig_out` | `sig_in` |
| `door` | `Door` | — | `sig_in` |
| `spinner` | `Spinner` | `socket` | `sig_in` |
| `orb` | `Orb` | — | `pose` |
| — none — | `Mailbox` | — | — |

`Mailbox` has **no surface spelling**. It is IR/runtime-grounded — it exists in
the canonical IR and the runtime honours it — but WRL source cannot declare it
and the formatter cannot emit it. It is therefore not a sixth writable role, and
its presence does not mean the async route texture was promoted.

The `{…}` group on a declaration is *checked against* the port table, not
defined by it. The state schema reference is derived, never written:
`state.<role lowercased>.v1`.

### Edge kinds

| Surface tag | Canonical kind | Source port | Destination port | Legal sources | Legal destinations |
|---|---|---|---|---|---|
| `--sig-->` | `SignalWire` | `sig_out` | `sig_in` | Pulser, Relay | Relay, Door, Spinner |
| `--socket-->` | `SocketControl` | `socket` | `pose` | Spinner | Orb |

**At most one edge may land on any input port.** Fan-out is unrestricted;
fan-in is `WRL_CONTROLLER_CONFLICT`.

## Rules that exist because identity is a hash

Every rule below is there because the alternative would make a world's `sem-`
id depend on something a reader cannot see.

- **`#` is not a comment marker.** In the core surface the only comment marker is
  `;`. `#` belongs to the identity family and is *preserved* by the parser
  rather than discarded.
- **A double underscore is reserved.** `[relay:a__b]` is rejected with
  `WRL_UNSUPPORTED_FEATURE` even though it matches `[A-Za-z0-9_]+`. The sequence
  is reserved for compiler-generated names so a lowered identifier can never
  collide with one you wrote.
- **Every group is a set, and a set has no repeats.** A `{ports}` group naming
  the same port twice is `WRL_PORT_SIGNATURE`; a `(config)` group setting the
  same key twice is `WRL_DUPLICATE_CONFIG_KEY`. Neither is last-one-wins,
  because silently keeping one of them would make the id depend on which.
- **A role prefix on an edge endpoint is optional but checked.** `[relay:r0]`
  and `[r0]` seal identically, but writing `[door:r0]` when `r0` was declared a
  relay is `WRL_ROLE_PREFIX_MISMATCH`. The prefix never affects the id; it would
  be worth nothing if it could lie.
- **Empty groups are omitted, not emptied.** In the canonical artifact a Door
  carries `{"in":["sig_in"]}` with *no* `"out"` key. Emitting `"out":[]`
  produces different bytes and therefore a different `sem-` id.
- **The profile line is required, singular and first.** Omitting it is
  `WRL_MISSING_PROFILE`, repeating it is `WRL_DUPLICATE_PROFILE`, and writing it
  with trailing tokens or no id at all is `WRL_MALFORMED_PROFILE`.

The full diagnostic-code table is
[`reference.html#codes`](../../reference.html#codes). Every rejection carries a
typed `WRL_*` code; no raw exception escapes.

## Identity

```
desugar → parse → validate → canonicalize → serialize → SHA-256
```

That pipeline produces the **`SemanticArtifactID`** (`sem-`) — sorted-key JSON
with no incidental whitespace, empty port groups omitted rather than emitted,
spinner configuration normalized to its typed form, hashed with SHA-256.
`wrl.js` is a faithful browser port of it and reproduces the reference
implementation's canonical bytes exactly, so the id the playground shows is the
id the toolchain would produce. It deliberately stops at the seal: it does not
lower to a backend, compile interaction-calculus terms, or reduce films — those
belong to [the runtime](../../../TRVM).

Two worlds are pinned and asserted on every change by
[`test/conformance.mjs`](../../test/conformance.mjs):

| World | Id |
|---|---|
| the **starter world** — pulser, relay, spinner, orb; what the tutorial builds | `sem-67e954cfe3115166b49388366df3f062a46572ba2baf53380f1520f4050b60ae` |
| the **pinned conformance fixture** — six objects; what the toolchain's test batteries assert against | `sem-8ae91fe9…fe4a` |

### Semantic IR 2.0

A second **encoding** of the same worlds, not a second world model. A V2 source
carries a required `ir 2.0` header — nothing else decides which parser reads it,
because *an encoding a reader has to guess is an identity a reader gets to
choose*. A V2 world stores `relations` where V1 stored `edges`, each an
`{ identity_seed, revision }` pair. No `world_id`, no `rel-`, no `rev-` appears
in the bytes, because all three are *derived* from them.

`profile_id` does **not** move. Both pinned fixtures still seal to the same
`sem-` they always did. `migrateV1ToV2` imports, `downgradeV2ToV1` projects
back, and V1 → V2 → V1 is byte-exact. An imported world's relations carry
`legacy-edge` seeds recording that they crossed the migration *without ever
being named*; `adoptLegacyRelations` is how someone supplies the names, in one
exhaustive act, and nothing derives a name from the endpoints.

§D8 and Semantic IR 2.0 are both **drafts**. An implementation that runs does
not settle the design it implements.

## What is missing, in dependency order

The next gated deliverable is the `~~` async route, which requires a canonical
logical route declaration *distinct from* the structural edge declaration — an
async message does not settle within the period, so it cannot be an ordinary
edge.

After that, in dependency order and not in order of appeal. The capability names
in backticks are registry ids, and the test suite fails if this list disagrees
with [`direction.html#ladder`](../../direction.html#ladder):

1. Typed ports and message schemas — `typed-ports`
2. `~~` async route and mailbox surface — `async-route`
3. Profile *mechanism* (`ProfileSchemaV1`) — `profile-mechanism`
4. Attributed relations and resolved terminals — `attributed-relations`, `resolved-terminals`
5. Behaviours — `behaviours`, `collections`, `expression-notation`, `generics-traits`, `numerics`, `resources`
6. `==` verified route — `merge-routes`, `verified-route`
7. Supervision floor and `!!` — `supervision`
8. Dynamic topology — `dynamic-topology`
9. Effect adapters and the solver wall — `acausal-relations`, `effect-walls`, `migration`, `podium`
10. Derive boundary and checkers — `derives`, `ffi`, `metaprogramming`, `modules`, `reflection`, `testing`
11. Production domain profiles — `domain-profiles`

Every aspirational code block in the published pages is **asserted by the test
suite to be rejected** by today's toolchain, and each names the
[promotion capabilities](../../reference.html#capabilities) it waits on. The
suite parses the published capability table as its registry and checks the claim
in both directions: every named requirement must be a registered capability, and
every registered capability must be required by at least one snippet. That turns
the draft into a roadmap dependency graph rather than inert prose.

## Reading order

1. [`learn.html`](../../learn.html) — build one world from an empty file, then watch its identity move
2. [`reference.html#tiers`](../../reference.html#tiers) — see how little of the language you can type today
3. [`spec.html`](../../spec.html) Part I — the normative text
4. [`direction.html`](../../direction.html) — the argument for why the narrow surface is on a strong foundation

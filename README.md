# WallRiderLang

**An executable topology language whose meaning is a hash.**

This repository is the WallRiderLang (WRL) documentation site: the language
guide, the tutorial, the reference tables, the Core 0.1.2 spec, the direction
document, and a browser playground that computes real `SemanticArtifactID`s.

A WRL program is a network of **durable identities** connected by **textured
routes** and separated by **boundaries**. The name is literal — programs are made
of *riders*, identities in motion along routes, and *walls*, the boundaries that
gate, commit and seal what they do. The whole network is one content address, and
every run of it is a film that replays exactly.

```
profile forge.world.core.v1

[pulser:p0](every 2){sig_out}
[relay:r0]{sig_in, sig_out}
[spinner:sp](w=16, n=8, rotor=quarter_turn_z, configurable){sig_in, socket}
[orb:ob]{pose}

[p0] --sig--> [r0]
[r0] --sig--> [sp]
[sp] --socket--> [ob]
```

seals to

```
sem-67e954cfe3115166b49388366df3f062a46572ba2baf53380f1520f4050b60ae
```

on every host, forever.

That four-object world is the **starter world**, and it is what the tutorial
builds. A second, larger world — the **pinned conformance fixture**,
`sem-8ae91fe9…fe4a` — carries six objects and is what the toolchain's test
batteries assert against. Both are example buttons in the playground, and both
are checked on every change by [`test/conformance.mjs`](test/conformance.mjs).

## The pages

| Page | What it is |
|---|---|
| `index.html` | The landing page — what the language is and why it has this shape |
| `learn.html` | **WRL in 20 minutes** — build one world from an empty file, then watch its identity move |
| `guide.html` | The complete language guide, in the order the language was designed |
| `draft.html` | **The authored full-language draft** — Parts II–VI of the original design, each section marked Core / Experimental / Proposed |
| `reference.html` | Every table: grammar, roles, ports, edges, clocks, rotors, sugar bounds, diagnostic codes, pinned policy ids, stability tiers |
| `spec.html` | **WRL Core 0.1.2** — Part I the normative frozen family extract, Part II a non-normative design draft |
| `direction.html` | What the language is *for*, the honest scorecard, and the dependency-ordered list of what is missing |
| `playground.html` | A live browser playground that seals worlds and shows the real id |

## What this is, and what it is not

Three different things get called "WRL", and confusing them produces either an
unfairly bad review or an unearned good one:

1. **WRL Core 0.1.2, the writable surface.** Five roles, one texture, no
   behaviours. Its actor surface is narrow, and the frozen extract says so
   (§14, §14b).
2. **The authored design.** A serious actor model — mailboxes with capacity and
   overflow policy, behaviour blocks, capability walls, deterministic
   supervision, verified live-state migration, content-addressed message
   compatibility. Forty-six sections, written down, tier-marked, **not built**.
   Published in full at [`draft.html`](draft.html). It is a substantial design,
   not a finished one: placement, partitions, fairness, lifecycle and operations
   semantics remain genuinely open, and answering them may move the draft.
3. **The topology direction.** [`direction.html`](direction.html). It goes past
   what conventional actor runtimes model, because it is about giving
   *relationships* domain meaning rather than giving processes better plumbing.

Judged as a general actor runtime, (1) is far behind Erlang/OTP and will not
catch up by imitating it. Anyone choosing a language today to keep a million
lightweight processes alive should choose Erlang or Elixir. But the part that
*is* built is the part actor systems find hardest — deterministic replay,
canonical ordering, a within-period fixpoint, content-addressed identity — so
the shape is a **narrow surface on a strong foundation**, not a weak system.
`direction.html` scores it five separate ways rather than once, because a single
number describes nothing.

Read [`draft.html`](draft.html) to learn what WRL is *designed* to be; read
[`reference.html#tiers`](reference.html#tiers) to see how little of it you can
type today. The gap is the point, and it is stated rather than hidden.

What the language is actually good at today is describing a **network of
identities** precisely enough that the description is a hash and the run is a
film. The direction that follows from taking *that* seriously:

> WallRiderLang is an **executable topology language**: a notation in which
> physical, computational, communication, authority, fault and economic networks
> can be described **over the same durable identities**, checked before they run,
> and replayed exactly after they do.

That is an argument, not an achievement. [`direction.html`](direction.html)
makes the case, scores where the language actually is today, orders the eleven
things that have to be built, and lists the conditions under which the whole
thesis would be wrong. [`spec.html` Part II](spec.html#part2) states the same
thing in the spec's own language, non-normatively.

Every aspirational code block on those pages is **asserted by the test suite to
be rejected** by today's toolchain, and each one names the
[promotion capabilities](reference.html#capabilities) it waits on:

```html
<pre class="code" data-not-current data-requires="behaviours,typed-ports,async-route">
```

The suite parses the published capability table as its registry — not a parallel
constant, because a registry that can drift from the page documenting it is not
a registry — and checks the claim in both directions. Every named requirement
must be a registered capability, and **every registered capability must be
required by at least one snippet**, so a capability cannot be invented in a
footnote or quietly abandoned. That turns the draft into a **roadmap dependency
graph** rather than inert prose.

Each capability carries two independent axes, because "is this idea settled?"
and "can the toolchain do it?" are different questions:

| Axis | Values | Means |
| --- | --- | --- |
| **Meaning** | `settled` · `drafted` · `sketched` | how firm the design is |
| **Toolchain** | `shipped` · `partial` · `unshipped` | how far a real run gets |

`partial` is measured, not asserted, and every stage name is a **function that
exists**. `async-route` and `verified-route` declare `data-stages="desugar"`
`data-refused-at="parse"`, and the suite *runs* both: `desugarCore` must return,
`parseWrlCore` must throw `WRL_UNSUPPORTED_FEATURE`. A separate probe pairs the
texture with a line of genuine nonsense and requires the nonsense to say
"unrecognized" while the texture does not — so *recognition* is demonstrated
rather than claimed.

This vocabulary has been wrong twice, which is why it is now executable. It said
"refused at lowering" (there is no lowering step for these textures) and then
said `tokenize` completes (**there is no tokenizer** — `parseWrlCore` splits on
newlines and dispatches on regular expressions). Both survived review because the
claim lived in prose and a matching constant, which could agree with each other
and with nothing else. Naming a stage now requires putting a real function behind
it.

**What promotion does and does not do automatically.** An earlier version of
this file claimed that when a capability ships its snippets "start sealing and
the assertions go red". That was not true, and is worth stating rather than
quietly deleting. Most aspirational blocks are *fragments*, not complete worlds;
they carry no `profile` line, so they fail with `WRL_MISSING_PROFILE` both
before and after their capability ships, and nothing changes colour. The real
trip-wire is on the **registry row**: mark a capability `shipped` while any
block still lists it in `data-requires`, and the suite fails that capability by
name. Promotion is a one-line human edit that then forces every citing document
to be corrected.

Paired spellings are a **registered future equivalence claim**, not an
executable obligation. Two blocks tagged
`data-equivalent-future="rider-behavior-01"` — one a behaviour block, one the
drawn routes it should canonicalize to — are checked today for being a
well-formed pair that waits on the same prerequisites. Whether they truly
produce the same `sem-` id cannot be checked until `behaviours` exists; the tag
records the claim so it can be tested then, and so it cannot be forgotten.

## The playground is not a mock

`wrl.js` is a faithful browser port of the WRL identity spine:

```
desugar → parse → validate → canonicalize → serialize → SHA-256
```

It reproduces the reference implementation's canonical bytes exactly — sorted-key
JSON with no incidental whitespace, empty port groups omitted rather than
emitted, spinner configuration normalized to its typed form — and hashes them
with WebCrypto. Paste a world into the playground and the `sem-` id you see is
the id the toolchain would produce.

It deliberately stops at the seal. It does not lower to a backend, compile
interaction-calculus terms, or reduce films — those belong to the runtime.

### `relation-identity.js` — a derived view, one layer above

`relation-identity.js` implements the executable part of
[§D8](spec.html#d8-kernel): relation and revision identity for the relations
that are already present when a world seals. V1 artifacts carry no authored
relation name, so a period-0 relation's name **is** its frozen
`(kind, src, dst)` edge key — which means the whole thing derives from worlds
that seal today, and needs no new syntax.

It imports `wrl.js`; `wrl.js` does not import it. That direction is the
guarantee rather than a convention: the spine cannot reach the derived view, so
no `rel-` or `rev-` value can enter a `sem-` preimage. The suite asserts that
both pinned fixtures seal **byte-identically** through it, because a value
marked *non-canonical* is a claim and byte equality is a fact.

§D8 itself is still a draft. An implementation that runs does not settle the
design it implements — §D8.4, §D8.6 and all of §D9 stay unexecuted rather than
quietly reclassified.

Run the self-check from a console:

```js
import * as W from "./wrl.js";
await W.selfCheck();   // re-seals the pinned demo world, asserts the frozen id
```

### `relation-v2.js` — Semantic IR 2.0, where a relation has a name

`relation-identity.js` derives a relation's identity from the edge key a V1
world already has. That works, and it means a relation's name is
`(kind, src, dst)` — so renaming an object renames the relation, and two routes
between the same pair are one relation. **Semantic IR 2.0** is the encoding
where an author writes the name instead:

```
profile forge.world.core.v1
ir 2.0

[pulser:p0](every 2){sig_out}
[relay:r0]{sig_in, sig_out}

[clock_feed]: [pulser:p0] --sig--> [relay:r0]
```

```
sem-9a491fe3a718d8c7262458812c9c220c0bf4157fc2155616f99bcde44263b019
```

That id is checked by the same sweep that checks the V1 worlds above, and it is
read by the **V2** parser because the source says `ir 2.0` — nothing else
decides that, here or anywhere. The header is required, and an encoding a
reader has to guess is an identity a reader gets to choose. A V2
world stores `relations` where V1 stored `edges`, each one an
`{ identity_seed, revision }` pair; no `world_id`, no `rel-`, no `rev-` is in
the bytes, because all three are *derived* from them.

`profile_id` does **not** move. V2 is a second encoding of the same worlds, not
a second world model, and both pinned fixtures still seal to the same `sem-`
they always did. A V1 world imports (`migrateV1ToV2`), a V2 world projects back
(`downgradeV2ToV1`), and V1 → V2 → V1 is byte-exact.

An imported world's relations carry `legacy-edge` seeds, which record that they
crossed the migration *without ever being named* — a fact, not a gap, and one
no surface may write. `adoptLegacyRelations` is how someone supplies the names,
in one exhaustive act; nothing derives a name from the endpoints.

§D8 and Semantic IR 2.0 are both **drafts**, and an implementation that runs
does not settle the design it implements.

## Viewing locally

Static files, no build step. `wrl.js` is an ES module, so open it over HTTP
rather than `file://`:

```
python3 -m http.server 8080
```

then visit <http://localhost:8080/>.

## Status

| Thing | State |
|---|---|
| WRL Core | **0.1.2 — frozen** (families only) |
| Forge Semantic IR 1.x | **frozen** (`forge.world.core.v1`) |
| Forge Semantic IR 2.0 | **draft — implemented**, [`relation-v2.js`](relation-v2.js); named relations over the *same* profile, both pinned ids unmoved |
| §D8 relation model | **draft** — the period-0 arithmetic runs; §D8.4, §D8.6 and all of §D9 do not |
| Surface sugar | `sugar.v2` — implemented, battery green, identity-equivalent, **not frozen** |
| Route texture `--` | surface-grounded |
| Route textures `~~` `==` `!!` | partial — the notation is frozen, the surface construct is not writable |

Freezing a *family* means the set of members is closed and each member's
meaning-role is settled. It does not freeze exact glyphs, argument grammars,
sugar, or edge-case rules. Read
[the stability tier table](reference.html#tiers) before you build on anything.

The next gated deliverable is the `~~` async route, which requires a canonical
logical route declaration *distinct from* the structural edge declaration — an
async message does not settle within the period, so it cannot be an ordinary
edge.

After that, in dependency order and not in order of appeal. This list is
**checked against [`direction.html#ladder`](direction.html#ladder)** — the
capability names in backticks are the registry ids, and the suite fails if a
step here disagrees with the step recorded there:

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

An earlier version of this paragraph was a prose arrow chain. It put dynamic
topology *before* supervision — the exact inversion the ladder had already been
corrected for — and omitted step 3 entirely. Prose that restates a machine-read
table will drift from it, so this copy is now read by the same check.

The argued next primitive is **not another actor feature**. It is broadening the
runtime's third entity from a binary directed `Edge` to a general `Relation`:
a **stable relation identity** whose value is a content-addressed **revision**
carrying role-bearing endpoints, an orientation, a domain and typed attributes,
with today's route as its simplest specialisation — the case is
[`spec.html#d8`](spec.html#d8), and the rules for changing a topology at runtime
are [`spec.html#d9`](spec.html#d9). The smallest thing worth building first is
not the fleet demo everyone wants; it is the
[resolved digital bus](direction.html#demo-bus), because every case in it has an
answer hardware engineers settled decades ago, so it can fail recognisably.

## Related

WRL is the authoring language of **TRVM Forge**. The runtime, the fixed-point
numeric core, the ADMIT acceptance reducer and the film serialization live
there; this repository documents the language that denotes them.

## License

Apache License 2.0 — see [LICENSE](LICENSE).

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
| `reference.html` | Every table: grammar, roles, ports, edges, clocks, rotors, sugar bounds, diagnostic codes, pinned policy ids, stability tiers |
| `spec.html` | **WRL Core 0.1.2** — Part I the normative frozen family extract, Part II a non-normative design draft |
| `direction.html` | What the language is *for*, the honest scorecard, and the dependency-ordered list of what is missing |
| `playground.html` | A live browser playground that seals worlds and shows the real id |

## What this is, and what it is not

Judged as an **actor language** — spawnable processes, mailboxes, behaviour
loops, supervision trees — WRL is weak, and it will not catch up to Erlang/OTP by
imitating Erlang/OTP. It has no runtime-spawnable process, no user-written
behaviour, no supervision floor, and no writable mailbox. The spec says so
(§14, §14b); the site says so on every page.

What it is actually good at is describing a **network of identities** precisely
enough that the description is a hash and the run is a film. The direction that
follows from taking *that* seriously:

> WallRiderLang is an **executable topology language**: a notation in which
> physical, computational, communication, authority, fault and economic networks
> can be described **over the same durable identities**, checked before they run,
> and replayed exactly after they do.

That is an argument, not an achievement. [`direction.html`](direction.html)
makes the case, scores where the language actually is today, orders the ten
things that have to be built, and lists the conditions under which the whole
thesis would be wrong. [`spec.html` Part II](spec.html#part2) states the same
thing in the spec's own language, non-normatively.

Every aspirational code block on those pages is marked `data-future` and is
**asserted by the test suite to be rejected** by today's toolchain with
`WRL_UNSUPPORTED_FEATURE`. When one of those constructs ships, the test goes red
and the document has to be corrected — the docs cannot quietly claim less than
the implementation any more than they can claim more.

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

Run the self-check from a console:

```js
import * as W from "./wrl.js";
await W.selfCheck();   // re-seals the pinned demo world, asserts the frozen id
```

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
| Forge Semantic IR | **v1 — frozen** (`forge.world.core.v1`) |
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

After that, in dependency order and not in order of appeal: typed ports →
attributed relations → behaviours → `==` verified routes → dynamic topology →
a supervision floor and `!!` → effect adapters → derives with checkers → domain
profiles. The full ladder, with the gate each step must pass, is in
[`direction.html#ladder`](direction.html#ladder).

## Related

WRL is the authoring language of **TRVM Forge**. The runtime, the fixed-point
numeric core, the ADMIT acceptance reducer and the film serialization live
there; this repository documents the language that denotes them.

## License

Apache License 2.0 — see [LICENSE](LICENSE).

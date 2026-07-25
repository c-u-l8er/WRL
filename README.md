# WallRiderLang

**A spatial actor language whose meaning is a graph.**

This repository is the WallRiderLang (WRL) documentation site: the language
guide, the tutorial, the reference tables, the frozen Core 0.1.2 spec, and a
browser playground that computes real `SemanticArtifactID`s.

A WRL program is a graph of **durable identities** connected by **textured
routes** and separated by **boundaries**. The name is literal — programs are made
of *riders*, identities in motion along routes, and *walls*, the boundaries that
gate, commit and seal what they do.

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
sem-8ae91fe9cbc5fd086ce4356d587c403211e5c7b2b3ebdd316496367429ecfe4a
```

on every host, forever.

## The pages

| Page | What it is |
|---|---|
| `index.html` | The landing page — what the language is and why it has this shape |
| `learn.html` | **WRL in 20 minutes** — build one world from an empty file, then watch its identity move |
| `guide.html` | The complete language guide, in the order the language was designed |
| `reference.html` | Every table: grammar, roles, ports, edges, clocks, rotors, sugar bounds, diagnostic codes, pinned policy ids, stability tiers |
| `spec.html` | The normative **WRL Core 0.1.2** frozen family extract |
| `playground.html` | A live browser playground that seals worlds and shows the real id |

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

## Related

WRL is the authoring language of **TRVM Forge**. The runtime, the fixed-point
numeric core, the ADMIT acceptance reducer and the film serialization live
there; this repository documents the language that denotes them.

## License

Apache License 2.0 — see [LICENSE](LICENSE).

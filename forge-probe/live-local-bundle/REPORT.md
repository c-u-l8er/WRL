# Live-local conformance report

## Claim

The portability and identity claim for the frozen-Core conformance fixture
has been advanced from `in_tree` to `live_local`.

The fixture's `sem-8ae91fe9cbc5fd086ce4356d587c403211e5c7b2b3ebdd316496367429ecfe4a`
identity is verified by two independent implementations — `wrl.js` under Node
and the Forge Python WRL spine — each exercised in a separate OS process on a
developer machine.

`live_deployed` has not been reached. No deployed target was exercised; no
remote credentials were used; no retention service received a certificate.

## Evidence

- **Contract**: `contract.json` defines the execution and certificate schema.
- **Fixture**: `fixture.json` is the pinned-fixture vector extracted from
  `test/projection-vectors.json`, digest-pinned in the contract.
- **Certificate**: `certificates/certificate.json` records, for each
  implementation: name, repository revision, implementation-file digest, host
  fingerprint, child process ID, computed SemanticArtifactID, verification
  result, expected identifier, and identifier discrepancy.
- **Verifier**: `verify.mjs` checks the certificate against the contract and
  fixture without reading repository files.
- **Runner**: `run-on-host` re-executes the fixture against both implementations
  on any host where they are available.

## Settling command

```
npm run conformance:certificate:verify
```

or, for the self-contained bundle copied outside the repository:

```
tmpdir=$(mktemp -d) && cp -R forge-probe/live-local-bundle "$tmpdir/bundle" && \
  (cd "$tmpdir" && node bundle/verify.mjs bundle)
```

DOCTRINE:
advanced — the portability and identity claim for the frozen-Core fixture
moved from `in_tree` to `live_local`. The evidence is the certificate in
`certificates/certificate.json`, verified by `verify.mjs`, which records two
separate-process runs against real implementations with agreeing identifiers.
`live_deployed` has not been reached.

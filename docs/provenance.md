# Project Origin and Release Verification

[한국어](provenance.ko.md)

## Official Project

AEGIS Agent Ops Personal is maintained and published by **aegisintelmetry**.
The project's declared copyright notice is `Copyright (c) 2026 aegisintelmetry`.
Third-party components and community contributions retain their applicable notices.
This statement does not claim authorship of third-party dependencies.

- Official source: https://github.com/aegisintelmetry/agent-ops-public-preview
- Official releases: https://github.com/aegisintelmetry/agent-ops-public-preview/releases
- Contact: contact@aegistelemetry.com

The publisher identifier is not a verification of a legal entity or a registered trademark.
No such registration or ownership-chain certification is asserted here.

## Evidence and Its Limits

The public history begins with the selected 0.5.4 product snapshot:

```text
commit: f29a2a3e67d0fd0d2860a4d737d03c8387047909
tree:   490976a1742a1c0714c353039509179e8710baa7
```

The maintainer compared this tree with the corresponding private product snapshot
and found the tree IDs identical. The private-to-public commit mapping is retained
privately; readers cannot independently verify the private side from this repository.
Private operational source and its earlier history are not published.
See [public history](public-history.md).

`source-import.json` is a historical extraction inventory. Its old paths and hashes
are not a manifest of the current release, a list of included operational code,
or a cryptographic signature. Commit metadata and hashes alone do not prove legal
authorship, identity, or an independently certified creation date.

## Verify the 0.5.10 Preview Installer

Download only from the official release and compare the exact file:

```powershell
Get-FileHash -Algorithm SHA256 .\AEGIS-Agent-Ops-Setup-0.5.10-preview.exe
Get-AuthenticodeSignature .\AEGIS-Agent-Ops-Setup-0.5.10-preview.exe
```

Expected SHA-256:

```text
9e0fcbc07add5237ed015f0008e848b33aaa72f0723369da333530c5ece40399
```

File size: **133447546 bytes**. Local file hashing and the GitHub release asset
digest matched during this check. Authenticode status was **NotSigned**.
A matching checksum establishes byte equality with this reference, not publisher
identity, safety, reproducible builds, or resistance to a compromised publisher account.

The current release has no verified build attestation in this document. Do not
interpret successful CI as proof that the downloadable installer was built by CI.

## Signing and Evidence Policy

Signing is not enabled by this documentation change. Before describing future
releases as signed, maintainers must:

1. Select a signing identity and keep private keys outside Git.
2. Publish the public-key fingerprint through an authenticated maintainer channel.
3. Sign new release tags and verify them from a clean checkout; never rewrite old history to imply earlier signing.
4. Publish artifact checksums and the actual build source commit, workflow run, and dependency lockfiles.
5. Verify any build attestation and Windows signing certificate separately; a signed Git tag is not an Authenticode signature.
6. Preserve original private development records and backup evidence without publishing customer data, credentials, or operational source.

Legal ownership records and independent timestamping, if required, are separate
from this technical release-verification process.

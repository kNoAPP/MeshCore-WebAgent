# Identity Derivation from a Recovery Phrase

> Status: **Frozen** · Implements
> [#358](https://github.com/kNoAPP/MeshCore-Desktop/issues/358),
> [#363](https://github.com/kNoAPP/MeshCore-Desktop/issues/363) and
> [#359](https://github.com/kNoAPP/MeshCore-Desktop/issues/359) · Epic
> [#353](https://github.com/kNoAPP/MeshCore-Desktop/issues/353)
>
> This document is a contract. It says how a BIP-39 recovery phrase becomes
> MeshCore radio identities. Another client that follows it should derive the
> same identities byte for byte, working from this page alone. **Nothing here
> may change.** A different path, skip rule or expansion would derive different
> keys, and every identity already minted from a phrase would be lost for good.
> A new scheme would need its own path, and this one would still have to be
> supported.

Reference implementation: [`lib/identity/seed.ts`](../lib/identity/seed.ts)
(primary identity, expansion, validity check). Sub-identities (§5) are not
currently implemented in this app; their last implementation is
`lib/identity/subIdentity.ts` and `lib/identity/slip10.ts` in the git history.

## 1. Phrase to BIP-39 seed

Standard
[BIP-39](https://github.com/bitcoin/bips/blob/master/bip-0039.mediawiki) with
the English wordlist:

- The phrase has 12, 15, 18, 21 or 24 words, and its checksum is validated. A
  phrase that fails the checksum is rejected. It is never stretched into a seed.
- The phrase is NFKD-normalized, lowercased, and joined with single spaces.
- `seed = PBKDF2-HMAC-SHA512(phrase, "mnemonic", 2048 iterations, 64 bytes)`. No
  BIP-39 passphrase is used: the salt is always the bare `"mnemonic"`.

## 2. Expansion: 32-byte Ed25519 seed to MeshCore private key

MeshCore stores the _expanded_ Ed25519 private key, exactly as
`ed25519_create_keypair` in the firmware's
[`lib/ed25519/keypair.c`](https://github.com/meshcore-dev/MeshCore/blob/main/lib/ed25519/keypair.c)
produces it:

```
prv = SHA-512(seed32)          // 64 bytes
prv[0]  &= 248
prv[31] &= 63
prv[31] |= 64
pub = scalarmult_base(prv[0..32], little-endian)
```

`prv` is the 64-byte payload that `CMD_IMPORT_PRIVATE_KEY` takes. `pub` is the
public key the radio reports after the import.

The expansion is one-way. A radio holds `prv`, never `seed32`, so no identity a
radio generated for itself can be given a phrase after the fact.

**Worked example ([RFC 8032](https://www.rfc-editor.org/rfc/rfc8032#section-7.1)
§7.1, test 1):**

| Value    | Hex                                                                                                                                |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `seed32` | `9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60`                                                                 |
| `prv`    | `307c83864f2833cb427a2ef1c00a013cfdff2768d980c0a3a520f006904de94f9b4f0afe280b746a778684e75442502057b7473a03f08f96f5a38e9287e01f8f` |
| `pub`    | `d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a`                                                                 |

## 3. Validity: the reserved public keys

The firmware's `LocalIdentity::validatePrivateKey`
([`src/Identity.cpp`](https://github.com/meshcore-dev/MeshCore/blob/main/src/Identity.cpp))
refuses any key whose public key starts with `0x00` or `0xFF`. The radio answers
`ERR_CODE_ILLEGAL_ARG`. That happens for about 2 keys in 256. An identity with a
reserved public key can never be used, so the scheme below defines exactly what
happens when a derivation lands on one.

## 4. The primary identity

A phrase's **primary identity** uses the first 32 bytes of the BIP-39 seed as
`seed32`, expanded as in §2. It sits on no derivation path.

If the primary identity's public key is reserved, the phrase has no primary
identity and is rejected. A client that generates phrases must discard such a
phrase and draw a new one. That applies to about 1 phrase in 128.

## 5. Sub-identities

Sub-identities are any number of unlinkable identities from the same phrase,
derived with
[SLIP-0010](https://github.com/satoshilabs/slips/blob/master/slip-0010.md) over
the `ed25519` curve.

> This app does not mint sub-identities today. The scheme stays frozen so that
> any identity already minted from a phrase can be derived again when the
> feature returns.

### Path

```
m / 77698372' / 0' / index'
```

| Level    | Value      | Meaning                                                                                                  |
| -------- | ---------- | -------------------------------------------------------------------------------------------------------- |
| purpose  | `77698372` | `"MESH"` as the decimal ASCII codes 77 69 83 72, the same convention BIP-85 uses for its purpose number. |
| branch   | `0`        | Radio identities. Every other value is reserved and must never produce a radio identity.                 |
| identity | `index`    | `0` to `2^31 - 1`, subject to the skip rule below.                                                       |

Every level is hardened. The 32-byte SLIP-0010 private key at the leaf is
`seed32` for the expansion in §2. The primary identity (§4) is not on this path;
it is an independent key, unlinkable to any sub-identity.

### SLIP-0010 for Ed25519, in brief

```
I = HMAC-SHA512(key = "ed25519 seed", data = bip39_seed)    // master
k = I[0..32], c = I[32..64]

child(k, c, i):                                             // hardened only
I = HMAC-SHA512(key = c, data = 0x00 || k || ser32(i + 2^31))
k = I[0..32], c = I[32..64]
```

`ser32` is 4 bytes, big-endian. For example, the purpose level serializes as
`84a19544`.

### Hardened only, by design

Ed25519 has no non-hardened derivation, so SLIP-0010 defines none, and there is
no extended public key. Nothing short of the seed can list a user's
sub-identities or connect two of them. That unlinkability is the reason for the
scheme. **Do not add a watch-only or xpub-style export.**

### The skip rule

If the key at `index` has a reserved public key (§3), that index is skipped and
`index + 1` is tried, and so on until an index yields an importable key.
Equivalently:

- The **n-th sub-identity** (counting from 0) is the n-th importable index,
  counting up from 0.
- To mint the next one, start from the previous one's `index + 1`.
- Store the **raw index** that was used. Re-deriving from a stored index returns
  the same identity, since that index was importable.

The skip rule never changes which identity an index derives. It only decides
which indices are used.

## 6. Worked example

Phrase:
`abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about`

| Step                        | Hex                                                                                                                                |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| BIP-39 seed                 | `5eb00bbddcf069084889a8ab9155568165f5c453ccb85e70811aaed6f6da5fc19a5ac40b389cd370d086206dec8aa6c43daea6690f20ad3d8d48b2d2ce9e38e4` |
| `m` key                     | `560f9f3c94558b6551928bb781cf6092c6b8800b4fc544af2c9444ed126d51aa`                                                                 |
| `m` chain code              | `ddfa71109701bbf7c126c8c7ab5880b0dec3d167a8fe6afa7a9597df0bbee72b`                                                                 |
| `m/77698372'` key           | `d7ad1ffa5039781dc0f8c2b212348dabda2b7b76c6f558ecf6de84238308db76`                                                                 |
| `m/77698372'` chain code    | `c5a03f6202c72c247ca78397fd336d5366f77174306935086f129f858fdddc9f`                                                                 |
| `m/77698372'/0'` key        | `990b8ae0b0fe1d206855acc6c31a15e1dcd674e85b611aa883d0410c9d2ad6ba`                                                                 |
| `m/77698372'/0'` chain code | `d284034c27f4774058d17911310e264863a3719075d2cf3cfca568c82cd1024b`                                                                 |

Sub-identities:

| Index | `seed32` (leaf key)                                                | `pub`                                                              |
| ----- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `0'`  | `e95c02cd82f9cead4afd402b9ea09d591ca375dec7912d9a230d92104eef163d` | `3eeac8082f07e4ea4cece9df295af2e23f496f2870d333e9528e7bb32cfab8f3` |
| `1'`  | `4bfa1cd1adea1c9c10d272be45db66031eee438baf4efe8ccf7318dddea158b8` | `44af119d76d8f21ab0837c4b4964b7865323db11054b3a22f6b6603ada577432` |
| `2'`  | `2ea3f02171bb70dc7b6045c1b9ff28ee0f15fe5d943572164a2e89536c521b32` | `fcaca485f309c6cfb45d53cdef97bd26649103e5ec57174cc4675d5b988df679` |
| `81'` | `e33a9029f20c8dda6c4c31202dfed70863aac6830a5f58ea9e81769ca1685e49` | `00b890067f1527c45b8b0c1ac22a47b6a18f690ef5b65edeba7900bc0e22eccc` |
| `82'` | `099d27bd7b65e69f14020dad03d40564ff8a4ceb6540bd1ebfdd177ebf47a9da` | `e65386e7781cfb79e7ea0bacf7c6e1c7c9fcb81379c84c889fa7953280e81eb1` |

Index `81'` is the first reserved index for this phrase: its public key starts
with `0x00`. Deriving from `81` skips it and returns index `82`. No lower index
is reserved, so sub-identity number 81 (counting from 0) sits at index `82`.

The expanded private key for index `0'` is:

```
88c602c811fa282945bda7fb39a75174ed6656412bcc5428c782ce0a639cc764
34eb722390425ae6b494348f9e3a06ccc27e0db804b90982afe23b7b8f1e7a74
```

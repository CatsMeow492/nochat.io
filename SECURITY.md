# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| main branch | Yes |
| Tagged releases | Yes |

---

## Threat Model

### What nochat.io Protects Against

#### Server Compromise
- **Threat:** Attacker gains access to the server or database
- **Mitigation:** Zero-trust architecture - server stores only encrypted blobs
- **Result:** Attacker sees opaque ciphertext, cannot read message content

#### Man-in-the-Middle Attacks
- **Threat:** Network attacker intercepts communication
- **Mitigation:** E2EE with ECDH key exchange + AES-256-GCM
- **Result:** Attacker cannot decrypt messages without private keys

#### Message Tampering
- **Threat:** Attacker modifies encrypted messages
- **Mitigation:** AES-256-GCM authenticated encryption (AEAD)
- **Result:** Tampered messages fail authentication and are rejected

#### Replay Attacks
- **Threat:** Attacker resends captured messages
- **Mitigation:** Unique 12-byte random nonce per message
- **Result:** Replayed messages are detectable (nonce reuse)

#### Key Compromise (Past Messages)
- **Threat:** Attacker obtains current session key
- **Mitigation:** Session keys derived per-peer via HKDF
- **Result:** Compromise of one session key doesn't affect other peers

### What nochat.io Does NOT Protect Against

#### Client/Device Compromise
- **Threat:** Attacker has full access to user's device
- **Impact:** Private keys stored in IndexedDB are accessible
- **Reality:** If the attacker controls the device, they control the keys

#### Metadata Analysis
- **Threat:** Server can observe who communicates with whom and when
- **Impact:** Communication patterns are visible to server operator
- **Note:** Sealed sender (metadata protection) is prepared but not deployed

#### Traffic Analysis
- **Threat:** Network observer can analyze message sizes and timing
- **Impact:** May infer communication patterns
- **Note:** Message padding is prepared but not deployed

#### Key Material Extraction via Side Channels
- **Threat:** Timing attacks, cache attacks on cryptographic operations
- **Impact:** May leak key material
- **Reality:** Web Crypto API implementations vary by browser

#### Quantum Attacks (Current)
- **Threat:** Future quantum computers breaking P-256 ECDH/ECDSA
- **Impact:** Current implementation is not quantum-resistant
- **Note:** Post-quantum primitives are prepared (Kyber/Dilithium) but not active

### Trust Assumptions

1. **Client device is not compromised**
   - Private keys are stored in IndexedDB
   - Browser must not be malicious

2. **Browser/WebCrypto implementation is correct**
   - We rely on the browser's Web Crypto API
   - CSPRNG for nonce generation is trusted

3. **TLS is secure**
   - Initial key bundle fetch happens over HTTPS
   - TLS protects the transport layer

4. **User verifies identity out-of-band (optional)**
   - Key fingerprints are available for verification
   - Users should compare fingerprints to detect MITM

---

## Cryptographic Details

### Current Implementation

| Component | Algorithm | Standard |
|-----------|-----------|----------|
| Key Exchange | P-256 ECDH | NIST FIPS 186-4 |
| Signatures | P-256 ECDSA | NIST FIPS 186-4 |
| Encryption | AES-256-GCM | NIST SP 800-38D |
| Key Derivation | HKDF-SHA256 | RFC 5869 |
| Random Generation | Web Crypto CSPRNG | - |

### Key Sizes

| Key | Size | Security Level |
|-----|------|----------------|
| P-256 Private Key | 256 bits | ~128-bit security |
| P-256 Public Key | 65 bytes (uncompressed) | - |
| AES-256 Key | 256 bits | 256-bit security |
| AES-GCM Nonce | 96 bits (12 bytes) | Per-message random |
| AES-GCM Auth Tag | 128 bits (16 bytes) | Message authentication |

### Nonce Generation

- Each message uses a fresh 12-byte (96-bit) nonce
- Generated via `crypto.getRandomValues()` (Web Crypto CSPRNG)
- Prepended to ciphertext before Base64 encoding

### Key Derivation

```
salt = SHA-256("nochat-session-" + sorted(userId1, userId2))
info = "nochat-e2ee-v2"
sessionKey = HKDF-SHA-256(ecdhSharedSecret, salt, info, 32)
```

For full cryptographic inventory, see [docs/crypto-inventory.md](./docs/crypto-inventory.md).

---

## Reporting a Vulnerability

### Responsible Disclosure

If you discover a security vulnerability in nochat.io, please report it responsibly:

1. **Do NOT** create a public GitHub issue
2. **Email:** security@nochat.io (or contact the maintainers privately)
3. **Include:**
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

### Response Timeline

| Action | Target Time |
|--------|-------------|
| Initial acknowledgment | 48 hours |
| Severity assessment | 7 days |
| Fix development | Varies by severity |
| Public disclosure | After fix deployed |

### Severity Classification

| Severity | Description | Example |
|----------|-------------|---------|
| Critical | Key compromise, RCE | Extracting private keys from server |
| High | Authentication bypass | Session token leakage |
| Medium | Information disclosure | Metadata leakage |
| Low | Defense-in-depth bypass | Missing rate limiting |

---

## Security Audits

### Completed Audits

None yet. We welcome security researchers to review our implementation.

### Planned Audits

1. Cryptographic implementation review
2. Web application penetration testing
3. Infrastructure security assessment

### Self-Assessment

This codebase includes:
- [x] E2EE with authenticated encryption
- [x] Key derivation using HKDF
- [x] Per-message random nonces
- [x] Zero-trust server architecture
- [ ] Per-message forward secrecy (planned: Double Ratchet)
- [ ] Post-quantum resistance (planned: Kyber/Dilithium)
- [ ] Metadata protection (planned: Sealed Sender)

---

## Security Recommendations for Users

1. **Verify key fingerprints** for sensitive conversations
2. **Use a secure device** - encryption can't protect against compromised endpoints
3. **Enable browser security features** - keep your browser updated
4. **Use strong authentication** - protect your account credentials
5. **Log out on shared devices** - clear session tokens when done

---

## Known Limitations

### Current Limitations

1. **Session key reuse:** Same session key used for all messages with a peer
   - Impact: Compromise of one message reveals key for all messages in session
   - Planned: Double Ratchet for per-message keys

2. **No signature on messages:** Messages are authenticated but not signed
   - Impact: Cannot prove sender identity to third parties
   - Planned: Identity key signatures on ciphertext

3. **Classical cryptography only:** P-256 is not quantum-resistant
   - Impact: Future quantum computers could decrypt
   - Planned: Hybrid Kyber + X25519 key exchange

4. **Metadata visible to server:** Server sees who talks to whom
   - Impact: Communication graph is not private
   - Planned: Sealed sender for metadata protection

### Intentional Trade-offs

1. **Web Crypto API vs. WASM:** We use native Web Crypto for better performance and simpler audit surface, at the cost of not having PQC in the active path yet.

2. **IndexedDB for key storage:** Keys are accessible to any code running in the origin. This is the standard approach for web-based E2EE.

3. **No hardware-backed keys:** WebAuthn could provide hardware-protected keys, but adds complexity.

---

## Changelog

| Date | Change |
|------|--------|
| December 2024 | Initial security documentation |
| December 2024 | Crypto inventory audit completed |

# Hacker News "Show HN" Post Draft

## Title (max ~80 chars)
```
Show HN: NoChat – E2EE messaging and video calls, no phone number required
```

## Post Body

```
Hi HN,

I built NoChat because I was frustrated that every "private" messaging app still requires a phone number to sign up. That's a privacy leak before you even send your first message.

NoChat is end-to-end encrypted messaging and video calling that only needs an email (or nothing at all - you can use it anonymously).

Key features:
- E2EE for all messages and video calls (P-256 ECDH + AES-256-GCM)
- No phone number required
- Cross-platform: Web, Android, iOS, macOS, Windows, Linux
- Open source (MIT): https://github.com/kindlyrobotics/nochat
- Free forever - no ads, no tracking, no premium tier

The crypto is implemented client-side using Web Crypto API. The server uses a zero-knowledge architecture - it only sees encrypted blobs and can never read your messages.

Tech stack: Go backend, React/TypeScript frontend, PostgreSQL, Redis, WebRTC for video.

Try it: https://nochat.io

Would love feedback, especially on:
1. The onboarding flow
2. Cross-device sync experience
3. Any crypto concerns

Thanks for checking it out!
```

---

## Posting Tips

### Best times to post on HN:
- **Weekdays**: 8-10 AM EST (when US wakes up)
- **Avoid**: Weekends, holidays, major news days

### HN Guidelines for Show HN:
- Must be something you made that others can try
- Should be interesting to hackers
- Be ready to answer questions in comments
- Don't ask for upvotes

### Expected questions to prepare for:
1. **Why not use Signal/Matrix/etc?** → Signal requires phone number. Matrix is complex to self-host. We wanted simple + private.
2. **Why not use established crypto libraries?** → We use Web Crypto API which is browser-native and audited.
3. **What about metadata?** → Sealed sender is on the roadmap.
4. **How do you make money?** → Currently bootstrapped/hobby project. May explore donations or optional paid features for businesses later.
5. **Why MIT license?** → Maximum adoption. We want privacy tools to be accessible.

### After posting:
- Stay online for first 2-3 hours to answer comments
- Be humble and technical in responses
- Thank people for feedback, even critical
- Don't be defensive about criticism

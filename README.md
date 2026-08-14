# Verifiable Delay Functions

## What It Is

This demo implements a **Verifiable Delay Function (VDF)**: a function whose evaluation
requires a prescribed amount of *sequential* work that no amount of parallelism can shorten,
yet whose result comes with a short proof anyone can check almost instantly. It is built from
**repeated modular squaring** — computing `y = x^(2^T) mod N` in an RSA group of unknown
order — paired with the **Wesolowski short proof** (a Fiat–Shamir prime challenge derived
with WebCrypto SHA-256). The security model is a public-coin, no-secret one: there is no
shared key, and verification needs nothing private — its hardness rests on the assumption
that the factorization of `N` (and hence the group's order) is unknown. In this demo that
assumption is deliberately *not* met: `P` and `Q` ship in the public page bundle so the
trapdoor exhibit can use them, and the honest evaluator and verifier are honest by
construction — their code never reads the factors — not because the factors are secret. The
modulus here is a deliberately small 512-bit toy value so thousands of squarings run visibly
in the browser; it is for teaching, not for protecting anything real. The Wesolowski proof is
tiny but not free to make: this simple prover performs a second exponentiation of roughly
another `T` group operations to generate `π` (the page measures and prints that cost), where
production provers generate it far more efficiently.

## When to Use It

- **Decentralized randomness beacons** — applied to input many parties generated together,
  the delay blunts grinding and last-revealer advantage; unbiasability still needs the
  surrounding commit-and-combine protocol.
- **Blockchain leader election / consensus** — helps derive the next proposer from a seed no
  participant could predict in time to bias, with a proof every node verifies cheaply — one
  component inside a larger protocol of seed generation, eligibility rules and consensus.
- **Fair lotteries and sealed-bid auctions** — commit first, then reveal a verifiably-delayed
  outcome that was fixed before anyone could react to it.
- **Anti front-running in decentralized systems** — enforce a mandatory, publicly-checkable
  delay before transactions are ordered or revealed.
- **When NOT to use it:** to keep a secret or send a message into the future — that is a
  *time-lock puzzle*, which has the delay but no fast public proof. A VDF's point is public
  verifiability, not confidentiality; if you only need privacy, you do not need a VDF.

## Live Demo

**https://systemslibrarian.github.io/crypto-lab-vdf/**

Choose an input `x` and a difficulty `T` (the number of sequential squaring steps), then watch
the exact squaring count advance — including a control that *simulates* splitting the same `x`
and `T` across four "workers" (real arithmetic, one thread, no Web Workers and no timing):
chained, they still spend every one of the T squarings and reproduce `y` exactly; started
together, their critical path is a quarter as deep and they land on a *different* number,
which is why the shortcut is not one. The Verify panel then checks the short proof at a cost
that does not grow with `T`, and prints that cost against the evaluation's — including at the
low difficulties where the verifier's fixed cost is the *larger* of the two, which is exactly
the point: the gap opens only once `T` outgrows it. Tamper buttons flip a bit of the output or
proof so you can see verification fail-closed. A clearly-labeled "reveal the trapdoor" section
shows how knowing `N`'s secret factors turns the delay from linear in `T` into a constant —
exactly what a VDF assumes no one can do. There is no encryption/decryption here; the
operation is evaluate-and-verify.

## How to Run Locally

```bash
git clone https://github.com/systemslibrarian/crypto-lab-vdf
cd crypto-lab-vdf
npm install
npm run dev
```

No environment variables are required. Run `npm test` for the cryptographic test suite, and
`npm run test:e2e` for the browser suites: `e2e/a11y.spec.ts` (WCAG A/AA in both themes) and
`e2e/claims.spec.ts`, which drives the built page and checks every on-screen claim against
values the page computed — the step count the difficulty control asked for, the eval/verify
cost tiles stating the direction their own two numbers show at five difficulties spanning
both regimes, the trapdoor headline stating the speed its own two op counts show at both ends
of the slider, both tamper paths reaching a rejection that names its cause, a pre-check
rejection printing no cost comparison at all, the four-worker exhibit's own arithmetic and its
zero Web Worker constructions, and every result retiring when its input changes — including
mid-run. Both claims suites are deployment gates. Any
uncaught page exception fails the run.

## Part of the Crypto-Lab Suite

> One of 170+ live browser demos at
> [systemslibrarian.github.io/crypto-lab](https://systemslibrarian.github.io/crypto-lab/)
> — spanning Atbash (600 BCE) through NIST FIPS 203/204/205 (2024).

---

*"Whether you eat or drink, or whatever you do, do all to the glory of God." — 1 Corinthians 10:31*

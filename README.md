# Verifiable Delay Functions

## What It Is

This demo implements a **Verifiable Delay Function (VDF)**: a function whose evaluation
requires a prescribed amount of *sequential* work that no amount of parallelism can shorten,
yet whose result comes with a short proof anyone can check almost instantly. It is built from
**repeated modular squaring** — computing `y = x^(2^T) mod N` in an RSA group of unknown
order — paired with the **Wesolowski short proof** (a Fiat–Shamir prime challenge derived
with WebCrypto SHA-256). The security model is a public-coin, no-secret one: there is no
shared key, and verification needs nothing private — its hardness rests on the assumption
that the factorization of `N` (and hence the group's order) is unknown. The modulus here is a
deliberately small 512-bit toy value so thousands of squarings run visibly in the browser; it
is for teaching, not for protecting anything real.

## When to Use It

- **Decentralized randomness beacons** — a VDF imposes a delay no participant can shortcut,
  so no one can grind or bias the output after seeing others' contributions.
- **Blockchain leader election / consensus** — pick the next proposer from a value that could
  not have been predicted or skewed in advance, with a proof every node verifies cheaply.
- **Fair lotteries and sealed-bid auctions** — commit first, then reveal a verifiably-delayed
  outcome that nobody could have front-run.
- **Anti front-running in decentralized systems** — enforce a mandatory, publicly-checkable
  delay before transactions are ordered or revealed.
- **When NOT to use it:** to keep a secret or send a message into the future — that is a
  *time-lock puzzle*, which has the delay but no fast public proof. A VDF's point is public
  verifiability, not confidentiality; if you only need privacy, you do not need a VDF.

## Live Demo

**https://systemslibrarian.github.io/crypto-lab-vdf/**

Choose an input `x` and a difficulty `T` (the number of sequential squaring steps), then watch
the work accrue one squaring at a time — including a control that shows extra "workers" do
*not* speed it up. The Verify panel then checks the short proof in a handful of operations and
shows the eval-vs-verify cost gap, with Tamper buttons that flip a bit of the output or proof
so you can see verification fail-closed. A clearly-labeled "reveal the trapdoor" section shows
how knowing `N`'s secret factors collapses the whole delay — exactly what a VDF assumes no one
can do. There is no encryption/decryption here; the operation is evaluate-and-verify.

## How to Run Locally

```bash
git clone https://github.com/systemslibrarian/crypto-lab-vdf
cd crypto-lab-vdf
npm install
npm run dev
```

No environment variables are required. Run `npm test` for the cryptographic test suite.

## Part of the Crypto-Lab Suite

> One of 60+ live browser demos at
> [systemslibrarian.github.io/crypto-lab](https://systemslibrarian.github.io/crypto-lab/)
> — spanning Atbash (600 BCE) through NIST FIPS 203/204/205 (2024).

---

*"Whether you eat or drink, or whatever you do, do all to the glory of God." — 1 Corinthians 10:31*

# Web3 Transaction Security Assistant (MetaMask Snap)

A security assistant that intercepts Ethereum transactions **before** they are
signed, classifies their risk with a deterministic rule engine, and explains the
operation in natural language using a **locally executed** language model.

The goal is to reduce *blind signing*: users frequently approve operations
without understanding the permissions they grant, especially unlimited ERC-20
approvals and global ERC-721 permissions.

> This repository is the English edition of the project. The analysis pipeline,
> risk scale and evaluation harness are identical to the original version.

## Architecture

| Id | Service | Port | Responsibility |
|----|---------|------|----------------|
| S1 | Test DApp | `8000` | Snap installation, monitoring dashboard, manual reports |
| S2 | Snap dev server | `8080` | Serves the Snap to MetaMask Flask |
| S3 | Analysis backend | `3000` | Normalisation, decoding, rules, persistence, verdict |
| S4 | Local AI service (Ollama) | `11434` | Complementary review and explanations |

The Snap stays deliberately thin: it intercepts the transaction via
`onTransaction`, forwards it to the backend and renders the returned insight
inside MetaMask. All analysis logic lives in the backend.

## Risk scale

Risk is an **ordinal scale**, not a probability. Each recognised pattern has a
fixed score, ordered by how much control over the user's assets it grants.

| Pattern | Level | Score | Action |
|---------|-------|-------|--------|
| `setApprovalForAll(operator, true)` | `HIGH` | 95 | `REVIEW` |
| `approve` with `MaxUint256` | `HIGH` | 90 | `REVIEW` |
| Undecoded contract interaction | `MEDIUM` | 50 | `REVIEW` |
| `approve` with a limited amount | `LOW` | 20 | `ALLOW` |
| Simple transfer | `LOW` | 10 | `ALLOW` |
| Revocation (`approve` 0 / `setApprovalForAll` false) | `LOW` | 5 | `ALLOW` |

Known-address labels then adjust the score: `scam`/`blacklist` `+50` (forces
`HIGH`), `warning`/`suspicious` `+25`, `trusted`/`test_contract` `-10`. The
result is clamped to `[0, 100]`. A trust label lowers the score but can never
lower an already established risk level.

## The deterministic engine has priority

The language model never decides the risk. It may add context or raise caution
on ambiguous cases, but it cannot lower a risk the rules established. Every
generated explanation passes through a **semantic guard** that discards text
contradicting the verified facts — for example, an explanation claiming an
unlimited approval when the analysed amount is limited.

## Requirements

- Node.js 20.11.1 and npm 10.2.4
- MetaMask Flask
- [Ollama](https://ollama.com) with the `llama3.2` model
- An RPC endpoint for the Sepolia test network

## Running the project

```bash
# 1. Install dependencies
yarn install
cd backend && npm install && cd ..

# 2. Pull the local model
ollama pull llama3.2

# 3. Start the services (each in its own terminal)
cd backend && node server.js      # S3 - analysis backend
yarn workspace snap start         # S2 - Snap dev server
yarn workspace site start         # S1 - test DApp
```

Then open <http://localhost:8000>, install the Snap from the dashboard and
select the Sepolia network in MetaMask Flask.

## Tests

```bash
cd backend && npm test
```

Covers selector decoding, risk classification, the semantic guard against
invented token permissions, and history persistence.

## Evaluation

`evaluation/` contains the reproducible harness. The reported run comprises 80
controlled observations across eight cases, reaching 91.25 % accuracy, 100 %
precision and 81.08 % recall. The seven false negatives correspond to
extraordinarily high approvals that differ from `MaxUint256`, which bounds the
current rule coverage.

```bash
cd backend && npm run evaluation:matrix
```

## Scope

The assistant is a decision aid, not a security guarantee. It does not audit
contract source code, cannot protect against a compromised device or leaked
private key, and does not replace the user's judgement. Address labels come from
external datasets that may be incomplete or outdated, so they are treated as
context rather than proof.

## License

See `LICENSE.APACHE2` and `LICENSE.MIT0`.

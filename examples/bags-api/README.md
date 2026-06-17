# Example: Bags API token launch

A complete, committed Brainblast run. This is the golden output you can expect from
`/brainblast requirements.md` against a real integration target.

The input was a short [`requirements.md`](requirements.md): *"Launch a Solana token via
the Bags API and earn creator fees."* The run produced every artifact in the workflow:

| File | Step | What it shows |
|---|---|---|
| [`requirements.md`](requirements.md) | input | The spec Brainblast was given |
| [`component-inventory.md`](component-inventory.md) | 1 | Every external system found |
| [`research-plan.md`](research-plan.md) | 2 | The exact source URLs checked |
| [`components/bags-api.md`](components/bags-api.md) | 3 | Facts / assumptions / inferences / risks / resolved questions, each with a source |
| [`coverage-review.md`](coverage-review.md) | 4 | Proof every component was covered for auth, version, limits, breaking changes, risk |
| [`requirements-rereview.md`](requirements-rereview.md) | 5 | Wrong assumptions and immutable decisions found in the original spec |
| [`final-report.md`](final-report.md) | 6 | The handoff a coding agent reads before writing any code |

## The headline catch

From [`components/bags-api.md`](components/bags-api.md):

> **CRITICAL — Revenue at risk if missed:**
> Fee sharing BPS must sum to 10,000 and the creator must be explicitly included. An agent
> that builds the fee share config without the creator wallet in the array will deploy a
> token where the creator earns zero fees forever. This cannot be corrected after launch.

An agent coding straight from the one-line requirement would have shipped a token that
silently pays its creator nothing, permanently. That is the class of failure Brainblast
exists to catch: invisible, irreversible, and not caught by any test.

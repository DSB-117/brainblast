# Roadmap

v0.1.0 ships the core workflow and a trustworthy first run. These are the planned
upgrades beyond it, roughly in priority order. The first is the strategic one — a
stable machine-readable schema is what other tools and CI gates build against.

## Planned

- **Machine-readable `report.json`.** A structured emission alongside the markdown:
  components, each risk with a severity field, each pre-coding decision. Lets CI gate a
  build ("fail if any unresolved CRITICAL") instead of parsing prose. This is the
  defensible surface — integrations target a stable schema, not free text.

- **Incremental / cached runs.** Key research by component + version, diff against the
  last run, re-research only what changed. Today every run starts from scratch, which
  undercuts the promise that research is not repeated.

- **Provenance and freshness.** Capture fetch timestamp and page last-modified per fact;
  attach a confidence level and a "may be stale after N days" marker so the report is
  auditable over time.

- **Two-source rule for CRITICAL claims.** Require two independent sources before any
  CRITICAL risk is asserted. The product is trust; a second source on the scariest
  claims buys a lot of it.

- **Bounded runtime.** A per-component source/time budget so a large spec cannot produce
  a runaway, expensive run. "Never leave a question open" needs a ceiling.

- **Coverage as an enforced linter.** Promote the Step 4 checklist from a self-graded
  convention to a script that asserts every Fact has a URL and every component has
  auth / version / limits / risk sections. (`scripts/validate.sh` is the seed of this.)

- **Auto-seed the inventory from the repo.** Read `package.json`, `requirements.txt`,
  `Cargo.toml`, lockfiles, and committed OpenAPI specs to seed components — more reliable
  than inferring from prose, and OpenAPI parsing beats scraping HTML.

- **Parallel research / sub-agent fan-out.** For specs with many components, fan out
  instead of the strictly sequential loop. This tool runs *first*, so its latency is felt
  directly.

- **Non-interactive `--ci` mode.** Never calls `AskUserQuestion`; picks sensible defaults
  and runs end-to-end for pipelines.

## Measuring it

The real proof is catch-rate. The plan is to dogfood Brainblast against 10–20 real specs
and measure precision (how often is a flagged CRITICAL actually real?) and false-negative
rate on known traps (like the Bags fee-config catch) before promoting it widely.

# Brainblast seed dataset — Verified Trap Instances (VTIs)

**Stage 0 artifact** of [`ROADMAP-TRAINING-DATA.md`](../../ROADMAP-TRAINING-DATA.md).
This is the first, fully-owned slice of the training-data platform: machine-verified
`error → fix → proof` records, one per bundled rule pack.

## Files
- **`seed-vti.jsonl`** — one VTI per line (feed-native NDJSON; the same shape the
  Stage 4 real-time feed streams). Conforms to [`schema/vti.schema.json`](../../schema/vti.schema.json).
- **`manifest.json`** — counts, class distribution, and the per-pack RED→GREEN
  proof log for this generation.

## What a record is
Each VTI pairs a **vulnerable** snippet (the trap) with a **fixed** snippet (the
correction), plus the checker's fail/pass detail, the source-doc URL, the
producing pack, and a **RED→GREEN proof**: Brainblast's own checker fails on the
vulnerable code and passes on the fixed code. That proof is what makes the data
*reward-gradable* — the property scraped code lacks.

## Provenance & license
- **`license: synthetic-owned`**, **`consentScope: owned`** for every record —
  produced entirely from Brainblast's own `packs/*/fixtures`, so there is **zero
  third-party consent obligation**. Contributor-sourced data (Stage 2) must live
  in a **separate** dataset directory and never mix into this lot.

## Regenerate
```sh
cd packages/core && npm run gen:vti
```
The generator (`packages/core/scripts/gen-vti.ts`) emits a record only when the
pack proves RED→GREEN through the **same gate** as `brainblast pack validate`.

## Validate against the schema
```sh
python3 - <<'PY'
import json, importlib.util
spec = importlib.util.spec_from_file_location("vr", "scripts/validate_reports.py")
vr = importlib.util.module_from_spec(spec); spec.loader.exec_module(vr)
schema = json.load(open("schema/vti.schema.json"))
for line in open("datasets/seed/seed-vti.jsonl"):
    line=line.strip()
    if line:
        errs = vr.builtin_validate(schema, json.loads(line))
        assert not errs, errs
print("all VTIs valid")
PY
```

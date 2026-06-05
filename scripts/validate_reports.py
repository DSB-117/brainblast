#!/usr/bin/env python3
"""Validate Brainblast report.json files against schema/report.schema.json.

Usage: validate_reports.py <schema.json> <report.json> [<report.json> ...]

Uses the `jsonschema` package for a full Draft-07 check when it is installed;
otherwise falls back to a small built-in validator that interprets the same
committed schema (so there is nothing to keep in sync). Either way it runs a
riskTotals == summed-severities cross-check. Exits non-zero on any failure.
"""
import json
import sys


def load(path):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def builtin_validate(schema, data, path="$"):
    """Minimal validator for the subset of JSON Schema this contract uses:
    type, enum, const, required, properties, additionalProperties:false,
    items, minimum. Returns a list of error strings."""
    errs = []
    t = schema.get("type")
    if t is not None:
        types = t if isinstance(t, list) else [t]
        ok = any(_type_ok(x, data) for x in types)
        if not ok:
            errs.append(f"{path}: expected type {t}, got {type(data).__name__}")
            return errs
    if "const" in schema and data != schema["const"]:
        errs.append(f"{path}: must equal {schema['const']!r}, got {data!r}")
    if "enum" in schema and data not in schema["enum"]:
        errs.append(f"{path}: {data!r} not in {schema['enum']}")
    if "minimum" in schema and isinstance(data, (int, float)) and data < schema["minimum"]:
        errs.append(f"{path}: {data} < minimum {schema['minimum']}")
    if isinstance(data, dict) and ("properties" in schema or "required" in schema):
        props = schema.get("properties", {})
        for key in schema.get("required", []):
            if key not in data:
                errs.append(f"{path}: missing required key '{key}'")
        if schema.get("additionalProperties") is False:
            for key in data:
                if key not in props:
                    errs.append(f"{path}: unexpected key '{key}'")
        for key, val in data.items():
            if key in props:
                errs += builtin_validate(props[key], val, f"{path}.{key}")
    if isinstance(data, list) and "items" in schema:
        for i, item in enumerate(data):
            errs += builtin_validate(schema["items"], item, f"{path}[{i}]")
    return errs


def _type_ok(jtype, data):
    if jtype == "null":
        return data is None
    if jtype == "object":
        return isinstance(data, dict)
    if jtype == "array":
        return isinstance(data, list)
    if jtype == "string":
        return isinstance(data, str)
    if jtype == "integer":
        return isinstance(data, int) and not isinstance(data, bool)
    if jtype == "number":
        return isinstance(data, (int, float)) and not isinstance(data, bool)
    if jtype == "boolean":
        return isinstance(data, bool)
    return True


def cross_check(data):
    sums = {"critical": 0, "high": 0, "medium": 0, "low": 0}
    for comp in data.get("components", []):
        for risk in comp.get("risks", []):
            sev = risk.get("severity")
            if sev in sums:
                sums[sev] += 1
    totals = data.get("riskTotals")
    if totals != sums:
        return [f"riskTotals {totals} != summed component risks {sums}"]
    return []


def main(argv):
    schema = load(argv[1])
    reports = argv[2:]
    if not reports:
        print("no report.json files to validate", file=sys.stderr)
        return 1

    try:
        import jsonschema
        jsonschema.Draft7Validator.check_schema(schema)
        validator = jsonschema.Draft7Validator(schema)
        try:
            from importlib.metadata import version
            ver = version("jsonschema")
        except Exception:  # noqa: BLE001
            ver = "?"
        engine = f"jsonschema {ver}"
    except ImportError:
        validator = None
        engine = "built-in fallback (jsonschema not installed)"

    print(f"      report.json validator: {engine}")
    failed = False
    for path in reports:
        try:
            data = load(path)
        except Exception as exc:  # noqa: BLE001
            print(f"      FAIL {path}: not parseable JSON — {exc}")
            failed = True
            continue
        if validator is not None:
            errs = [f"{list(e.path)}: {e.message}" for e in validator.iter_errors(data)]
        else:
            errs = builtin_validate(schema, data)
        errs += cross_check(data)
        if errs:
            failed = True
            print(f"      FAIL {path}")
            for e in errs:
                print(f"        - {e}")
        else:
            print(f"      ok   {path}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))

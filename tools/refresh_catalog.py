#!/usr/bin/env python3
"""Save a NEW, dated public SIMBAD snapshot; never overwrite a previous snapshot."""
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from catalog import query_catalog


def main():
    output = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("artifacts") / (
        "catalog-snapshot-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + ".json")
    if output.exists():
        raise SystemExit(f"Refusing to overwrite {output}")
    queries, stars = [], {}
    for ra, dec, radius in [(56.75, 24.1167, 5), (83.8, -3, 12), (10.6847, 41.2688, 3)]:
        result = query_catalog(ra, dec, radius, 120, 9)
        queries.append({k: v for k, v in result.items() if k != "objects"})
        for star in result["objects"]:
            stars[star["id"]] = star
    output.parent.mkdir(parents=True, exist_ok=True)
    result = {"objects": list(stars.values()), "frame": "ICRS",
              "source": "SIMBAD / CDS", "license": "ODbL 1.0",
              "retrieved_at": datetime.now(timezone.utc).isoformat(), "queries": queries}
    output.write_text(json.dumps(result, indent=2, ensure_ascii=False)+"\n")
    print(f"Wrote {len(stars)} real catalogue objects to {output}")

if __name__ == "__main__":
    main()

"""Bounded SIMBAD TAP queries; catalogue coordinates are ICRS, not image pixels."""
from __future__ import annotations
import json
import math
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

ENDPOINT = "https://simbad.cds.unistra.fr/simbad/sim-tap/sync"
MAX_BYTES = 4_000_000


def number(value, name, low, high):
    if isinstance(value, bool):
        raise ValueError(f"{name} must be a number")
    try:
        result = float(value)
    except (ValueError, TypeError):
        raise ValueError(f"{name} must be a number") from None
    if not math.isfinite(result) or not low <= result <= high:
        raise ValueError(f"{name} must be between {low} and {high}")
    return result


def optional_number(value):
    try:
        value = float(value)
        return value if math.isfinite(value) else None
    except (ValueError, TypeError):
        return None


def separation(ra1, dec1, ra2, dec2):
    r1, d1, r2, d2 = map(math.radians, (ra1, dec1, ra2, dec2))
    h = math.sin((d2-d1)/2)**2 + math.cos(d1)*math.cos(d2)*math.sin((r2-r1)/2)**2
    return math.degrees(2*math.asin(math.sqrt(min(1, max(0, h)))))


def query_catalog(ra, dec, radius=5, limit=300, mag_limit=12):
    ra = number(ra, "ra", 0, 360) % 360
    dec = number(dec, "dec", -90, 90)
    radius = number(radius, "radius", 0.01, 15)
    limit = int(number(limit, "limit", 1, 500))
    mag_limit = number(mag_limit, "mag_limit", -2, 20)
    query = f"""SELECT TOP {limit} b.main_id, b.ra, b.dec, b.otype, b.sp_type,
    f.V AS mag_v, f.B AS mag_b
    FROM basic AS b LEFT JOIN allfluxes AS f ON b.oid = f.oidref
    WHERE 1=CONTAINS(POINT('ICRS', b.ra, b.dec),
                    CIRCLE('ICRS', {ra:.8f}, {dec:.8f}, {radius:.8f}))
      AND (f.V <= {mag_limit:.3f} OR f.V IS NULL)
    ORDER BY f.V ASC"""
    data = urlencode({"request": "doQuery", "lang": "adql", "format": "json", "query": query}).encode()
    request = Request(ENDPOINT, data=data, headers={
        "User-Agent": "Ephemeris-Stargaze/0.1 (interactive artistic sonification)",
        "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json"})
    with urlopen(request, timeout=20) as response:
        raw = response.read(MAX_BYTES + 1)
    if len(raw) > MAX_BYTES:
        raise ValueError("Catalogue response is too large")
    payload = json.loads(raw)
    keys = [m["name"].lower() for m in payload["metadata"]]
    objects = []
    seen = set()
    for row in payload["data"]:
        item = dict(zip(keys, row))
        name = str(item.get("main_id", "")).strip()
        r, d = optional_number(item.get("ra")), optional_number(item.get("dec"))
        if not name or name in seen or r is None or d is None or not -90 <= d <= 90:
            continue
        seen.add(name)
        v, b = optional_number(item.get("mag_v")), optional_number(item.get("mag_b"))
        objects.append({"id": name, "name": name, "ra": r % 360, "dec": d,
                        "mag_v": v, "bv": b-v if b is not None and v is not None else None,
                        "spectral_type": item.get("sp_type") or None,
                        "type": item.get("otype") or None, "source": "SIMBAD"})
    return {"objects": objects, "source": "SIMBAD TAP", "frame": "ICRS",
            "coordinate_note": "Catalogue positions; no proper-motion propagation. Not telescope-pointing astrometry.",
            "retrieved_at": datetime.now(timezone.utc).isoformat(), "endpoint": ENDPOINT,
            "query": query, "center": [ra, dec], "radius_deg": radius,
            "limit": limit, "possibly_truncated": len(payload["data"]) >= limit}


class CatalogService:
    """Small in-memory cache; a bundled, provenance-labelled fallback is always local."""
    def __init__(self, seed_path: Path):
        self.seed_path = seed_path
        self.cache = {}

    def get(self, ra, dec, radius=5, limit=300, mag_limit=12):
        ra = number(ra, "ra", 0, 360) % 360
        dec = number(dec, "dec", -90, 90)
        radius = number(radius, "radius", 0.01, 15)
        limit = int(number(limit, "limit", 1, 500))
        mag_limit = number(mag_limit, "mag_limit", -2, 20)
        key = (round(ra, 5), round(dec, 5), round(radius, 4), limit, mag_limit)
        cached = self.cache.get(key)
        if cached and time.monotonic()-cached[0] < 900:
            return dict(cached[1], cached=True)
        try:
            result = query_catalog(ra, dec, radius, limit, mag_limit)
            if len(self.cache) >= 16:
                self.cache.pop(next(iter(self.cache)))
            self.cache[key] = (time.monotonic(), result)
            return result
        except Exception as exc:
            if cached:
                return dict(cached[1], stale=True, warning=f"Live lookup unavailable ({type(exc).__name__}); cached data.")
            seed = json.loads(self.seed_path.read_text())
            objects = [s for s in seed["objects"]
                       if separation(ra, dec, s["ra"], s["dec"]) <= radius
                       and (s.get("mag_v") is None or s["mag_v"] <= mag_limit)]
            return {"objects": objects[:limit], "source": "Bundled SIMBAD snapshot (limited fields)",
                    "frame": "ICRS", "retrieved_at": seed.get("retrieved_at"),
                    "center": [ra, dec], "radius_deg": radius, "fallback": True,
                    "warning": f"Live lookup unavailable ({type(exc).__name__}). The snapshot is not an all-sky catalogue."}

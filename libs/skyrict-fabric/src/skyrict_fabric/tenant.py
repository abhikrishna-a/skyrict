"""Deterministic tenant-scoped surrogate key generation.

Every Silver and Gold table in the Skyrict medallion uses composite primary
keys ``(tenant_id, id)``.  Gold tables collapse this to a single ``*_key``
UUID-v5 surrogate that is deterministic from ``(tenant_id, natural_key)``.

This keeps tenant isolation cheap: a single UUID embeds both the tenant
boundary and the natural identity, so Gold foreign keys never leak across
tenants.
"""

from __future__ import annotations

import uuid
from typing import Any

__all__ = ["SKYRCT_NS", "make_date_key", "make_tenant_key"]

# Fixed namespace UUID for deterministic v5 generation.
SKYRCT_NS = uuid.UUID("a1b2c3d4-e5f6-7890-abcd-ef1234567890")


def make_tenant_key(tenant_id: uuid.UUID, natural_key: Any) -> uuid.UUID:
    """Deterministic UUID-v5 from ``(tenant_id, natural_key)``.

    The seed is ``"{tenant_id}::{str(natural_key)}"`` so the result is fully
    reproducible and tenant-isolated -- different tenants with the same
    natural key produce different surrogate keys.
    """
    if isinstance(natural_key, uuid.UUID):
        nk_str = str(natural_key)
    elif isinstance(natural_key, int):
        nk_str = f"int:{natural_key}"
    else:
        nk_str = str(natural_key)
    seed = f"{tenant_id!s}::{nk_str}"
    return uuid.uuid5(SKYRCT_NS, seed)


def make_date_key(d: Any) -> int:
    """Convert a ``date``/``datetime`` to a ``YYYYMMDD`` integer.

    Returns ``0`` for ``None`` or unparseable values.  The integer form is
    compact, sortable, and matches the ``dim_date.date_key`` convention.
    """
    if d is None:
        return 0
    if hasattr(d, "year") and hasattr(d, "month") and hasattr(d, "day"):
        return int(d.year * 10000 + d.month * 100 + d.day)
    return 0

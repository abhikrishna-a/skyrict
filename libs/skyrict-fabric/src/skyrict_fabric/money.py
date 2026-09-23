"""Currency-aware money helpers for medallion transforms.

All monetary values in the Skyrict data platform are stored as NUMERIC(18,4).
This module enforces that convention at the Python boundary so transforms never
accidentally introduce floats or unlabelled amounts into Silver/Gold layers.
"""

from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

__all__ = ["coalesce_currency", "quantize_money", "validate_money"]


def validate_money(value: Decimal | int | float | str | None, column_name: str) -> Decimal:
    """Validate and normalize a money value to NUMERIC(18,4).

    Returns ``Decimal("0")`` for ``None`` (NULL-safe).  Raises ``ValueError``
    for non-finite or unparseable values.  Never returns a float.
    """
    if value is None:
        return Decimal("0")
    try:
        d = Decimal(str(value))
    except (InvalidOperation, ValueError) as exc:
        raise ValueError(f"Invalid money value for {column_name}: {value!r}") from exc
    if not d.is_finite():
        raise ValueError(f"Non-finite money value for {column_name}: {value!r}")
    return d.quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)


def coalesce_currency(currency: str | None, default: str = "USD") -> str:
    """Return a non-empty uppercase currency code, falling back to *default*.

    Guarantees the Gold convention that every money column has a labelled
    currency companion -- never ``None``, never empty.
    """
    if not currency or not str(currency).strip():
        return default
    return str(currency).strip().upper()


def quantize_money(value: Decimal) -> Decimal:
    """Quantize to NUMERIC(18,4) with half-up rounding."""
    return value.quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)

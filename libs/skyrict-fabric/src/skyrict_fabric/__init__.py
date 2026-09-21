"""Skyrict Fabric -- medallion ETL carrier (Bronze + Silver + Gold).

Bronze: incremental high-water-mark extraction (SKY-117).
Silver: validated, typed, cleaned transforms from Bronze sources.
Gold: star-schema dimensions and facts from Silver.
"""

from __future__ import annotations

from skyrict_fabric.watermark import (
    ExtractMode,
    WatermarkState,
    advance_watermark,
    build_incremental_clause,
)

__all__ = [
    "ExtractMode",
    "WatermarkState",
    "advance_watermark",
    "build_incremental_clause",
]

__version__ = "0.2.0"

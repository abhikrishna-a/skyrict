"""Tests for deterministic tenant-scoped surrogate key generation."""
from __future__ import annotations

import uuid
from datetime import date, datetime

from skyrict_fabric.tenant import make_date_key, make_tenant_key

TENANT_A = uuid.UUID("11111111-1111-1111-1111-111111111111")
TENANT_B = uuid.UUID("22222222-2222-2222-2222-222222222222")
NATURAL = uuid.UUID("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")

class TestMakeTenantKey:
    def test_deterministic(self) -> None:
        k1 = make_tenant_key(TENANT_A, NATURAL)
        k2 = make_tenant_key(TENANT_A, NATURAL)
        assert k1 == k2
    def test_tenant_isolation(self) -> None:
        k1 = make_tenant_key(TENANT_A, NATURAL)
        k2 = make_tenant_key(TENANT_B, NATURAL)
        assert k1 != k2
    def test_different_natural_keys(self) -> None:
        k1 = make_tenant_key(TENANT_A, uuid.UUID("11111111-0000-0000-0000-000000000001"))
        k2 = make_tenant_key(TENANT_A, uuid.UUID("11111111-0000-0000-0000-000000000002"))
        assert k1 != k2
    def test_uuid5_namespace(self) -> None:
        key = make_tenant_key(TENANT_A, NATURAL)
        assert key.version == 5
    def test_int_natural_key(self) -> None:
        k = make_tenant_key(TENANT_A, 42)
        assert isinstance(k, uuid.UUID)
        assert k.version == 5
    def test_string_natural_key(self) -> None:
        k = make_tenant_key(TENANT_A, "hello")
        assert isinstance(k, uuid.UUID)
    def test_returns_uuid(self) -> None:
        key = make_tenant_key(TENANT_A, NATURAL)
        assert isinstance(key, uuid.UUID)

class TestMakeDateKey:
    def test_from_date(self) -> None:
        assert make_date_key(date(2026, 9, 21)) == 20260921
    def test_from_datetime(self) -> None:
        assert make_date_key(datetime(2026, 1, 15, 10, 30)) == 20260115
    def test_none_returns_zero(self) -> None:
        assert make_date_key(None) == 0
    def test_month_boundary(self) -> None:
        assert make_date_key(date(2026, 12, 31)) == 20261231
    def test_leap_year(self) -> None:
        assert make_date_key(date(2024, 2, 29)) == 20240229
    def test_returns_int(self) -> None:
        result = make_date_key(date(2026, 1, 1))
        assert isinstance(result, int)

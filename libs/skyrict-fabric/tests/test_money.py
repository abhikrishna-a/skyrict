"""Tests for currency-aware money helpers."""
from __future__ import annotations

from decimal import Decimal

import pytest

from skyrict_fabric.money import coalesce_currency, quantize_money, validate_money


class TestValidateMoney:
    def test_normalizes_decimal(self) -> None:
        assert validate_money("1250.56789", "amount") == Decimal("1250.5679")
    def test_none_returns_zero(self) -> None:
        assert validate_money(None, "amount") == Decimal("0")
    def test_int_converts(self) -> None:
        assert validate_money(42, "x") == Decimal("42.0000")
    def test_float_converts(self) -> None:
        result = validate_money(3.14, "x")
        assert isinstance(result, Decimal)
        assert result == Decimal("3.1400")
    def test_string_normalizes(self) -> None:
        assert validate_money("100", "x") == Decimal("100.0000")
    def test_rejects_nan(self) -> None:
        with pytest.raises(ValueError, match="Non-finite"):
            validate_money(float("nan"), "x")
    def test_rejects_inf(self) -> None:
        with pytest.raises(ValueError, match="Non-finite"):
            validate_money(float("inf"), "x")
    def test_rejects_garbage(self) -> None:
        with pytest.raises(ValueError, match="Invalid money"):
            validate_money("not-a-number", "x")
    def test_negative_value(self) -> None:
        assert validate_money("-50.5", "x") == Decimal("-50.5000")

class TestCoalesceCurrency:
    def test_none_returns_usd(self) -> None:
        assert coalesce_currency(None) == "USD"
    def test_empty_returns_usd(self) -> None:
        assert coalesce_currency("") == "USD"
    def test_normalizes_uppercase(self) -> None:
        assert coalesce_currency("eur") == "EUR"
    def test_custom_default(self) -> None:
        assert coalesce_currency(None, "GBP") == "GBP"
    def test_whitespace_trimmed(self) -> None:
        assert coalesce_currency("  gbp  ") == "GBP"

class TestQuantizeMoney:
    def test_rounds_to_4_places(self) -> None:
        assert quantize_money(Decimal("1.23456")) == Decimal("1.2346")
    def test_already_quantized(self) -> None:
        assert quantize_money(Decimal("1.0000")) == Decimal("1.0000")
    def test_returns_decimal(self) -> None:
        result = quantize_money(Decimal("42"))
        assert isinstance(result, Decimal)

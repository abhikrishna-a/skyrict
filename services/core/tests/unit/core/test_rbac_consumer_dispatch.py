"""Unit tests for ``handle_event`` dispatch - no database required.

Phase 1 has no broker consumer loop, so ``handle_event`` is invoked directly
by CLI runs, tests, and the future Kafka consumer. These tests pin the
dispatch contract for the ``identity.rbac.role_updated`` envelope without
touching Postgres: ``provision_tenant_rbac`` is patched and the exact
argument payload is asserted.
"""

from __future__ import annotations

from typing import TYPE_CHECKING
from unittest.mock import AsyncMock

from core.events.consumers import handle_event
from core.events.consumers.rbac import RbacProvisionResult
from skyrict_events.schemas import RbacRoleUpdated, RoleGrant

if TYPE_CHECKING:
    import pytest


class TestRbacRoleUpdatedDispatch:
    async def test_dispatches_role_to_provision_tenant_rbac(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        mock = AsyncMock(return_value=RbacProvisionResult())
        monkeypatch.setattr("core.events.consumers.provision_tenant_rbac", mock)
        event = RbacRoleUpdated(
            tenant_id="t-1",
            role=RoleGrant(
                role_id="r-1",
                role_name="ops_custom",
                permissions=["erp.finance.read", "erp.ai.invoke"],
                is_system_role=False,
            ),
        )

        result = await handle_event(event.to_dict())

        assert result is not None
        call = mock.await_args
        assert call is not None
        assert call.kwargs["tenant_id"] == "t-1"
        grants = call.kwargs["role_grants"]
        assert len(grants) == 1
        assert grants[0]["role_id"] == "r-1"
        assert grants[0]["role_name"] == "ops_custom"
        assert grants[0]["permissions"] == ["erp.finance.read", "erp.ai.invoke"]
        assert grants[0]["is_system_role"] is False
        assert grants[0]["user_id"] is None  # definition-only: no user grant
        assert grants[0]["scope_id"] is None

    async def test_unknown_event_type_not_dispatched(self, monkeypatch: pytest.MonkeyPatch) -> None:
        mock = AsyncMock()
        monkeypatch.setattr("core.events.consumers.provision_tenant_rbac", mock)

        result = await handle_event({"event_type": "unrelated.event", "tenant_id": "t-1"})

        assert result is None
        mock.assert_not_awaited()

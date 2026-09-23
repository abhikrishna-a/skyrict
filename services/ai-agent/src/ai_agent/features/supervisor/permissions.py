"""Caller-grant scoping for the supervisor's module leaves (SKY-60 authz).

Every module leaf the supervisor can delegate to is gated on the caller's
effective grants resolved from ``core_roles``/``core_user_roles`` through
``PermissionRepository`` - the same source the SKY-59 runtime uses. ``agents:read``
only shows the shell page; chat data access follows the ERP permission the
module's core reads already require:

  * inventory_monitor -> ``erp.inventory.read``
  * hr_copilot        -> ``erp.hr.ai.read``  (aggregate AI endpoints)
  * crm_assistant     -> ``erp.crm.read``
  * finance_assistant -> ``erp.finance.read``
  * sales_coach       -> ``erp.ai.coaching.read``
  * audit_guardian    -> ``erp.ai.guardian.read``

The supervisor general answer is deliberately NOT in this map: any chat caller
holds ``erp.ai.invoke`` (the core proxy edge) and the general answer reads no
module data.
"""

from __future__ import annotations

from ai_agent.features.supervisor.schemas import (
    AGENT_AUDIT_GUARDIAN,
    AGENT_CRM,
    AGENT_DISPLAY_NAMES,
    AGENT_FINANCE,
    AGENT_HR,
    AGENT_INVENTORY,
    AGENT_SALES_COACH,
)
from ai_agent.graphs.security import (
    PERM_AI_COACHING_READ,
    PERM_AI_GUARDIAN_READ,
    PERM_CRM_READ,
    PERM_FINANCE_READ,
    PERM_HR_AI_READ,
    PERM_INVENTORY_READ,
    grants_permission,
)

# Agent key -> the ERP permission that authorizes the module's data reads.
AGENT_REQUIRED_PERMISSIONS: dict[str, str] = {
    AGENT_INVENTORY: PERM_INVENTORY_READ,
    AGENT_HR: PERM_HR_AI_READ,
    AGENT_CRM: PERM_CRM_READ,
    AGENT_FINANCE: PERM_FINANCE_READ,
    AGENT_SALES_COACH: PERM_AI_COACHING_READ,
    AGENT_AUDIT_GUARDIAN: PERM_AI_GUARDIAN_READ,
}

# Example question fragments per module, used to steer a refused caller toward
# the modules they CAN use (the "what CAN I ask about?" premium guidance).
AGENT_QUERY_HINTS: dict[str, str] = {
    AGENT_INVENTORY: '"stock levels" or "low-stock items"',
    AGENT_HR: '"leave policies" or "headcount"',
    AGENT_CRM: '"top customers" or "open deals"',
    AGENT_FINANCE: '"invoices" or "net income"',
    AGENT_SALES_COACH: '"pipeline review" or "deal strategy"',
    AGENT_AUDIT_GUARDIAN: '"flagged activity" or "integrity reports"',
}


def accessible_agents(granted_permissions: frozenset[str]) -> tuple[str, ...]:
    """Agent keys the caller can actually use, in registry order.

    A caller holding the wildcard ``"*"`` (tenant owner) satisfies every key.
    """
    return tuple(
        agent
        for agent, required in AGENT_REQUIRED_PERMISSIONS.items()
        if grants_permission(granted_permissions, required)
    )


def _accessible_module_guide(granted_permissions: frozenset[str]) -> str:
    """A short "what you CAN ask about" pointer grounded in the caller's grants."""
    accessible = [
        f"{AGENT_DISPLAY_NAMES[agent]} - try {AGENT_QUERY_HINTS[agent]}"
        for agent in accessible_agents(granted_permissions)
    ]
    if not accessible:
        return "Ask about a module your account can access."
    if len(accessible) == 1:
        return f"You can ask about {accessible[0]}."
    return "You can ask about " + ", ".join(accessible[:-1]) + f", and {accessible[-1]}."


def permission_denied_message(display_name: str, granted_permissions: frozenset[str]) -> str:
    """The honest refusal a caller without the module's key receives.

    The message names the denied module AND steers to the modules the caller
    can actually use - so a CRM-only user asking about finance is told exactly
    what they may ask about instead of just "no". Repeated identical asks get
    the same guidance on every turn (the supervisor is stateless; there is no
    separate "second refusal" state to track).
    """
    return (
        f"You don't have permission to ask about {display_name}. "
        f"{_accessible_module_guide(granted_permissions)}"
    )

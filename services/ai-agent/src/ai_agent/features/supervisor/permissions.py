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

# Natural example question phrases per module - the refusal's guidance is
# written as one human sentence, never as a per-module "try x or y" template.
AGENT_QUERY_HINTS: dict[str, str] = {
    AGENT_INVENTORY: "which stock is running low, or reorder forecasts",
    AGENT_HR: "leave policies, headcount, or time-off balances",
    AGENT_CRM: "top customers, open deals, or your pipeline",
    AGENT_FINANCE: "invoice totals, net income, or AR aging",
    AGENT_SALES_COACH: "pipeline reviews or deal strategy",
    AGENT_AUDIT_GUARDIAN: "flagged activity or integrity reports",
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
    """One natural sentence naming ONLY the modules the caller can use.

    Strictly grounded in the resolved grants: a caller who holds only
    ``erp.crm.read`` is told about CRM Assistant and nothing else, so the
    refusal can never reveal - or invent - access the caller does not have.
    """
    agents = accessible_agents(granted_permissions)
    if not agents:
        return (
            "Your account doesn't have access to any assistant modules yet — "
            "contact your workspace admin to enable one."
        )
    names = [AGENT_DISPLAY_NAMES[agent] for agent in agents]
    if len(agents) == 1:
        return f"Your access is scoped to {names[0]} — ask me about {AGENT_QUERY_HINTS[agents[0]]}."
    if len(agents) == 2:
        return (
            f"You can ask me about {names[0]} and {names[1]} — "
            f"for example, {AGENT_QUERY_HINTS[agents[0]]}."
        )
    return (
        "You can ask me about "
        + ", ".join(names[:-1])
        + f", and {names[-1]} — for example, {AGENT_QUERY_HINTS[agents[0]]}."
    )


def permission_denied_message(display_name: str, granted_permissions: frozenset[str]) -> str:
    """The honest, premium refusal a caller without the module's key receives.

    The message names the denied module AND steers the caller to exactly the
    modules their grants allow - a CRM-only user asking about finance is told
    "your access is scoped to CRM Assistant", never that they can read
    inventory or finance. Repeated identical asks get the same guidance on
    every turn (the supervisor is stateless; there is no separate "second
    refusal" state to track).
    """
    return (
        f"You don't have permission to ask about {display_name}. "
        f"{_accessible_module_guide(granted_permissions)}"
    )

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
module data. It is still grant-AWARE: the greeting, the no-provider fallback,
and the general LLM prompt all receive the caller's accessible modules so the
front-desk persona never claims access the caller does not have.
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


def accessible_module_names(granted_permissions: frozenset[str]) -> tuple[str, ...]:
    """Display names of the modules the caller can use, in registry order."""
    return tuple(AGENT_DISPLAY_NAMES[agent] for agent in accessible_agents(granted_permissions))


def _natural_join(names: tuple[str, ...]) -> str:
    """Join display names the way a person would: 1, 2, and 3."""
    if len(names) == 1:
        return names[0]
    if len(names) == 2:
        return f"{names[0]} and {names[1]}"
    return ", ".join(names[:-1]) + f", and {names[-1]}"


def _accessible_module_guide(granted_permissions: frozenset[str]) -> str:
    """One natural sentence naming ONLY the modules the caller can use.

    Strictly grounded in the resolved grants: a caller who holds only
    ``erp.crm.read`` is told about CRM Assistant and nothing else, so the
    refusal can never reveal - or invent - access the caller does not have.

    This same sentence answers a direct \"which modules can I ask?\" question
    deterministically - no LLM, so the general persona can never claim access
    the caller does not have.
    """
    agents = accessible_agents(granted_permissions)
    if not agents:
        return (
            "Your account doesn't have access to any assistant modules yet — "
            "contact your workspace admin to enable one."
        )
    names = accessible_module_names(granted_permissions)
    if len(agents) == 1:
        return f"Your access is scoped to {names[0]} — ask me about {AGENT_QUERY_HINTS[agents[0]]}."
    return f"You can ask me about {_natural_join(names)} — for example, {AGENT_QUERY_HINTS[agents[0]]}."


def greeting_message(granted_permissions: frozenset[str]) -> str:
    """Grant-scoped greeting: names only the modules the caller can access.

    The old constant greeting claimed \"inventory, HR, CRM, and finance\" for
    every caller; a CRM-only user was told they could ask all four. The
    greeting now mirrors the caller's real access and fails closed to an admin
    pointer when no module is granted.
    """
    names = accessible_module_names(granted_permissions)
    if not names:
        return (
            "Hey! I'm the Skyrict assistant. Your account doesn't have access "
            "to any assistant modules yet - contact your workspace admin to enable one."
        )
    return (
        f"Hey! I'm the Skyrict assistant. I can help with {_natural_join(names)} "
        "- what would you like to know?"
    )


def abstention_message(granted_permissions: frozenset[str]) -> str:
    """Grant-scoped fallback used when no LLM provider is reachable."""
    names = accessible_module_names(granted_permissions)
    if not names:
        return (
            "Your account doesn't have access to any assistant modules yet - "
            "contact your workspace admin to enable one."
        )
    return f"I can help with {_natural_join(names)}."


def supervisor_access_tail(granted_permissions: frozenset[str]) -> str:
    """The caller-scope line injected into the general answer's system prompt.

    The base supervisor persona is deliberately universal; this tail grounds
    every general answer in the caller's real grants so the LLM never claims
    (\"I can help with all four, no restrictions\") access the caller does not
    have - the reported permission hallucination.
    """
    names = accessible_module_names(granted_permissions)
    if not names:
        return (
            "The caller currently has no assistant module access. Answer general "
            "Skyrict questions only; never describe or offer module data."
        )
    return (
        f"The caller's current module access: {_natural_join(names)}. Only help "
        "with modules the caller can access; for anything else, say the caller "
        "doesn't have access to that module."
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

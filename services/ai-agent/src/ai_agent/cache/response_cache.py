"""Prompt/response and deterministic tool-result caches (SKY-100).

One tiny get/set protocol serves all three supervisor cache uses:

- **classification** - the classifier's raw JSON, so repeated identical
  questions skip the first provider call entirely;
- **response** - the general-supervisor answer text (never streamed until a
  full turn is measured), skipping the second provider call on repeat;
- **tool** - results of deterministic, read-only tools (CRM NL actions,
  finance aggregation) with a short TTL so repeated "how many invoices"
  questions do not re-fetch gateway data.

Redis backs the caches in production; ``MemoryResponseCache`` is the
in-process store used by unit tests and the latency harness.

Design decisions fixed in SKY-100:
- **TTL-only eviction** - no LRU/size management, keys expire on TTL.
- **Fail-open** - a Redis blip degrades to a cache miss, never an error.
- **Tenant-scoped keys** - the tenant UUID is always in the key so one
  tenant can never read another's cached answer.
- **Permission-scoped keys** - the caller's grant set fingerprint is part of
  response/tool keys so an answer or tool result computed for one role is
  never served to a lesser-granted caller in the same tenant.
- **Cachability rules** - LLM-only content is cacheable; tool results are
  cached only for deterministic read-only tools; agents that mix live data
  into their context (e.g. inventory) are never cached here (their RAG
  retrieval layer already caches separately).
"""

from __future__ import annotations

import hashlib
import time
from typing import TYPE_CHECKING, Protocol

import structlog

if TYPE_CHECKING:
    import uuid
    from collections.abc import Callable, Iterable

    from redis.asyncio import Redis

logger = structlog.get_logger("ai_agent.cache")

_KEY_PREFIX_CLASSIFICATION = "ai:classify:"
_KEY_PREFIX_RESPONSE = "ai:resp:"
_KEY_PREFIX_TOOL = "ai:tool:"


class ResponseCache(Protocol):
    """String get/set cache with bounded TTL; never raises."""

    async def get(self, key: str) -> str | None: ...

    async def set(self, key: str, value: str, *, ttl_seconds: int) -> None: ...


def _digest(*parts: str) -> str:
    """SHA-256 of the parts; the key never contains prompt text (PII)."""
    digest = hashlib.sha256()
    for part in parts:
        digest.update(part.encode("utf-8"))
        digest.update(b"\x00")
    return digest.hexdigest()


def permission_scope(granted: Iterable[str]) -> str:
    """Deterministic token for one caller's grant set (cache-key component).

    Grounded answers and deterministic tool results are cached per tenant;
    without a permission component a figure computed for one role would be
    served to a lesser-granted caller in the same tenant. The digest runs over
    the SORTED grants so the token is order-independent, and the empty set
    still yields a distinct token so a no-access caller never shares a key
    with anyone.
    """
    return _digest("\x00".join(sorted(set(granted))))


def classification_cache_key(tenant_id: uuid.UUID, query: str) -> str:
    """Key for one routing decision: tenant + query hash only."""
    return f"{_KEY_PREFIX_CLASSIFICATION}{tenant_id}:{_digest(query)}"


def response_cache_key(
    *,
    tenant_id: uuid.UUID,
    query: str,
    conversation_history: str = "",
    scope: str = "",
) -> str:
    """Key for one supervisor answer; history changes the prompt, so it keys.

    ``scope`` is the caller's :func:`permission_scope` token: an answer is
    grounded in what the caller can read, so it must never be served to a
    caller with a different grant set (default empty keeps legacy callers on
    their existing keys).
    """
    return f"{_KEY_PREFIX_RESPONSE}{tenant_id}:{_digest(query, conversation_history, scope)}"


def tool_cache_key(
    *,
    tenant_id: uuid.UUID,
    agent: str,
    parts: tuple[str, ...],
    scope: str = "",
) -> str:
    """Key for one deterministic tool result: agent + tenant + call parts.

    ``scope`` is the caller's :func:`permission_scope` token; see
    :func:`response_cache_key`.
    """
    return f"{_KEY_PREFIX_TOOL}{agent}:{tenant_id}:{_digest(*parts, scope)}"


class RedisResponseCache:
    """Redis-backed string cache (lazy client, fail-open on errors).

    Mirrors the RAG ``RedisQueryCache`` posture: the client is resolved on
    first use from the global ``ai_agent.core.redis.redis_client``, and any
    Redis error logs a warning and degrades to a miss.
    """

    def __init__(self, client: Redis | None = None) -> None:
        self._client = client

    def _get_client(self) -> Redis | None:
        if self._client is None:
            from ai_agent.core.redis import redis_client

            self._client = redis_client
        return self._client

    async def get(self, key: str) -> str | None:
        client = self._get_client()
        if client is None:
            return None
        try:
            raw = await client.get(key)
            return raw.decode("utf-8") if raw is not None else None
        except Exception as exc:
            # Fail-open: a Redis blip degrades to a cache miss, never an error.
            logger.warning("sk100_cache_get_failed_open", error=str(exc))
            return None

    async def set(self, key: str, value: str, *, ttl_seconds: int) -> None:
        client = self._get_client()
        if client is None:
            return
        try:
            await client.set(key, value, ex=ttl_seconds)
        except Exception as exc:
            logger.warning("sk100_cache_set_failed_open", error=str(exc))


class MemoryResponseCache:
    """In-process store for tests and the latency harness (TTL honoured).

    ``now`` is injectable so TTL expiry is deterministic in tests.
    """

    def __init__(self, now: Callable[[], float] = time.monotonic) -> None:
        self._now = now
        self._items: dict[str, tuple[str, float]] = {}
        self.get_calls = 0
        self.set_calls = 0

    async def get(self, key: str) -> str | None:
        self.get_calls += 1
        entry = self._items.get(key)
        if entry is None:
            return None
        value, expires_at = entry
        if self._now() > expires_at:
            self._items.pop(key, None)
            return None
        return value

    async def set(self, key: str, value: str, *, ttl_seconds: int) -> None:
        self.set_calls += 1
        if ttl_seconds <= 0:
            return
        self._items[key] = (value, self._now() + ttl_seconds)

    def __contains__(self, key: str) -> bool:
        return key in self._items

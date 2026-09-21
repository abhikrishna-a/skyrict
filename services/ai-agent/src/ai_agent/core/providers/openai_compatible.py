"""OpenAI-compatible chat-completions adapter (raw httpx, no vendor SDK).

Speaks ``POST {base_url}/chat/completions`` - the de-facto standard dialect
shared by OpenAI, OpenRouter, Groq, OmniRoute, AgentRouter and self-hosted
gateways. One adapter therefore serves every preset in the registry.

Error mapping (the router relies on this distinction):

- transport failure, timeout, or any HTTP error status -> AiUnavailableError
  ("this provider could not serve the request" - try the next one);
- HTTP 429 / a rate-limit error body (``rate_limit_error`` type,
  ``model_cooldown``/``rate_limit_exceeded`` code - OpenAI dialect and the
  self-hosted omniroute gateway) -> AiRateLimitError with a best-effort
  ``retry_after_seconds``. A rate limit is a SLOW-DOWN signal, not an outage:
  the router must not burn failover attempts on a gateway-wide cooldown;
- HTTP 200 with a body that fails schema validation -> AiInvalidResponseError
  ("the provider answered but unusably").

Upstream error bodies are read BOUNDED (4 KiB) and only the type/code strings
are trusted from them; the raised exception keeps a generic message, and
provider internals travel only in structured logs. API keys are sent as Bearer
headers and never appear in logs, results, or exception strings.
"""

from __future__ import annotations

import json
import time
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime
from typing import TYPE_CHECKING, Any, NoReturn

import httpx
import structlog

from ai_agent.core.exceptions import (
    AiInvalidResponseError,
    AiRateLimitError,
    AiUnavailableError,
)
from ai_agent.core.providers.base import LlmCompletion, LlmRequest, LlmStreamChunk

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

logger = structlog.get_logger("ai_agent.providers")

# The only JSON paths we read; anything missing/mistyped is a 502, not a crash.
_MIN_TIMEOUT_SECONDS = 1.0

# Error bodies are parsed for classification and logged for operators but NEVER
# returned to clients, and never read beyond this bound: a hostile or wild
# upstream cannot balloon memory or echo a large request back into the log.
_MAX_ERROR_BODY_BYTES = 4096

# The rate-limit signals we trust across the OpenAI-compatible dialects we
# speak (OpenAI/OpenRouter/Groq + the self-hosted omniroute gateway). Either
# matching marks a 429-class failure that must NOT count as a provider outage.
_RATE_LIMIT_ERROR_TYPES = frozenset({"rate_limit_error"})
_RATE_LIMIT_ERROR_CODES = frozenset({"model_cooldown", "rate_limit_exceeded"})


async def _read_bounded_error_body(
    response: httpx.Response,
    *,
    limit: int = _MAX_ERROR_BODY_BYTES,
) -> str:
    """Read a bounded, UTF-8-decoded copy of an HTTP error response body.

    Handles both buffered (``client.post`` - body already read) and streaming
    (``client.stream`` - body untouched) responses: a streaming body is
    consumed incrementally and stopped at ``limit`` bytes so a wild error body
    never lands in memory. Used only for classification and logging - the
    result is never returned to clients.
    """
    try:
        if response.is_stream_consumed:
            raw: bytes = response.content
        else:
            chunks: list[bytes] = []
            total = 0
            async for chunk in response.aiter_bytes():
                if not chunk:
                    continue
                chunks.append(chunk)
                total += len(chunk)
                if total >= limit:
                    break
            raw = b"".join(chunks)
    except httpx.HTTPError:
        # Transport teardown raced the read; there is no body to classify.
        return ""
    return raw.decode("utf-8", errors="replace")[:limit]


def _error_signal(text: str) -> tuple[str | None, str | None]:
    """Extract ``(type, code)`` from a provider error body - both optional.

    Accepts the OpenAI dialect (``{"error": {..., "type": ..., "code": ...}}``)
    and the top-level ``type``/``code`` variants some gateways emit. The body
    is NEVER trusted beyond these two bounded strings; anything else ignored.
    """
    try:
        data = json.loads(text)
    except (ValueError, TypeError):
        return None, None
    if not isinstance(data, dict):
        return None, None
    error = data.get("error")
    if isinstance(error, dict):
        error_type = error.get("type")
        error_code = error.get("code")
    else:
        error_type = data.get("type")
        error_code = data.get("code")
    return (
        error_type if isinstance(error_type, str) else None,
        error_code if isinstance(error_code, str) else None,
    )


def _is_rate_limit(
    status_code: int,
    error_type: str | None,
    error_code: str | None,
) -> bool:
    """True when the upstream answered with a rate-limit/cooldown signal."""
    if status_code == 429:
        return True
    return error_type in _RATE_LIMIT_ERROR_TYPES or error_code in _RATE_LIMIT_ERROR_CODES


def _retry_after_seconds(response: httpx.Response, text: str) -> int | None:
    """Best-effort seconds-until-retry from Retry-After or the error body.

    Precedence: ``Retry-After`` header (integer seconds, or HTTP-date) >
    body ``reset_seconds`` > body ``retry_after``/``reset_at`` (ISO-8601,
    naive treated as UTC). Returns None when upstream gave nothing reliable.
    """
    header = response.headers.get("Retry-After")
    if header:
        if header.isdigit():
            return int(header)
        try:
            retry_at = parsedate_to_datetime(header)
        except (TypeError, ValueError, OverflowError):
            pass
        else:
            return max(0, int(retry_at.timestamp() - time.time()))
    try:
        data = json.loads(text)
    except (ValueError, TypeError):
        return None
    if not isinstance(data, dict):
        return None
    error = data.get("error")
    inner = error if isinstance(error, dict) else {}
    reset_seconds = inner.get("reset_seconds")
    if (
        isinstance(reset_seconds, (int, float))
        and not isinstance(reset_seconds, bool)
        and reset_seconds > 0
    ):
        return int(reset_seconds)
    for key in ("retry_after", "reset_at"):
        value = inner.get(key)
        if not isinstance(value, str) or not value:
            continue
        try:
            retry_at = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            continue
        if retry_at.tzinfo is None:
            retry_at = retry_at.replace(tzinfo=UTC)
        return max(0, int(retry_at.timestamp() - time.time()))
    return None


class OpenAiCompatibleProvider:
    """One configured provider endpoint speaking the OpenAI-compatible dialect.

    ``native=True`` switches to the provider's NATIVE /api/chat dialect
    (Ollama). Reason: Ollama's /v1/chat/completions shim returns qwen3's
    reasoning in ``reasoning_content`` and an EMPTY ``message.content``,
    which breaks any strict-output consumer. The native endpoint honors
    ``think`` + the JSON grammar (``format: json``), so structured extraction
    works there. Error mapping is identical for both dialects.
    """

    def __init__(
        self,
        *,
        name: str,
        model: str,
        base_url: str,
        api_key: str,
        local_only: bool,
        native: bool = False,
        timeout_seconds: float,
    ) -> None:
        if not model.strip():
            raise ValueError("model is required")
        if not base_url.strip().lower().startswith(("http://", "https://")):
            raise ValueError("base_url must be an http(s) URL")
        self.name = name
        self.model = model
        self.local_only = local_only
        self._native = native
        self._base_url = base_url.rstrip("/")
        if native and self._base_url.endswith("/v1"):
            # Ollama native endpoints live at the server root (/api/chat),
            # not under the /v1 OpenAI-compat prefix.
            self._base_url = self._base_url[:-3]
        # Empty key allowed: some local gateways need no auth. Never logged.
        self._api_key = api_key
        self._timeout_seconds = max(timeout_seconds, _MIN_TIMEOUT_SECONDS)

    def _create_client(self) -> httpx.AsyncClient:
        """Create the per-call HTTP client (overridable seam for tests)."""
        return httpx.AsyncClient(timeout=self._timeout_seconds)

    async def _raise_for_error_response(
        self,
        response: httpx.Response,
        *,
        cause: BaseException | None = None,
        stream: bool = False,
    ) -> NoReturn:
        """Raise the typed exception an HTTP error response deserves.

        - 429 / a rate-limit body (``rate_limit_error`` type,
          ``model_cooldown``/``rate_limit_exceeded`` code) ->
          :class:`AiRateLimitError`, carrying ``retry_after_seconds`` when the
          gateway reports one (Retry-After header or ``reset_seconds``). This
          is a SLOW-DOWN signal, not an outage: the router must not burn
          failover attempts on a gateway-wide cooldown;
        - every other HTTP error status -> :class:`AiUnavailableError`.

        The upstream error body is read BOUNDED (4 KiB), sanitized (only the
        type/code strings are trusted), and logged so operators see the real
        cause; the raised exception keeps its generic message so provider
        internals and request echoes never reach clients.
        """
        body = await _read_bounded_error_body(response)
        error_type, error_code = _error_signal(body)
        if _is_rate_limit(response.status_code, error_type, error_code):
            retry_after = _retry_after_seconds(response, body)
            logger.warning(
                "provider.stream_rate_limited" if stream else "provider.rate_limited",
                provider=self.name,
                status_code=response.status_code,
                error_type=error_type,
                error_code=error_code,
                retry_after_seconds=retry_after,
                error_body=body or None,
            )
            raise AiRateLimitError(retry_after_seconds=retry_after) from cause
        logger.warning(
            "provider.stream_http_error" if stream else "provider.http_error",
            provider=self.name,
            status_code=response.status_code,
            error_type=error_type,
            error_code=error_code,
            error_body=body or None,
        )
        raise AiUnavailableError(f"Provider '{self.name}' could not serve the request") from cause

    @staticmethod
    def _build_user_content(
        request: LlmRequest,
    ) -> str | list[dict[str, object]]:
        """Build the user message content for the API payload.

        When ``request.image_blocks`` is present, returns an array of content
        blocks (text + image_url) for multimodal/vision requests.  Otherwise
        returns a plain string.
        """
        if request.image_blocks:
            blocks: list[dict[str, object]] = [{"type": "text", "text": request.user_prompt}]
            blocks.extend(request.image_blocks)
            return blocks
        return request.user_prompt

    async def complete(self, request: LlmRequest) -> LlmCompletion:
        """POST one generation and parse the completion text."""
        if self._native:
            return await self._complete_native(request)
        return await self._complete_openai(request)

    async def _complete_openai(self, request: LlmRequest) -> LlmCompletion:
        """POST one chat completion and parse choices[0].message.content."""
        payload: dict[str, Any] = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": request.system_prompt},
                {"role": "user", "content": self._build_user_content(request)},
            ],
            "temperature": request.temperature,
            "max_tokens": request.max_tokens,
            # Explicit, not implicit: OpenAI defaults to non-stream, but some
            # OpenAI-compatible gateways (e.g. self-hosted omniroute) stream
            # SSE by default and only return a JSON completion when asked.
            "stream": False,
        }
        # ``think`` is NOT part of the OpenAI chat-completions dialect - some
        # gateways add it (OmniRoute), others reject it outright (Groq returns
        # 400 "property 'think' is unsupported"). Forward it only when
        # explicitly requested: think=False means "no reasoning", which is the
        # default on every OpenAI-compatible endpoint, so omitting the field
        # is semantically identical and keeps the request portable. The native
        # Ollama dialect keeps explicit false because its qwen3 defaults DO
        # reason unless told not to.
        if request.think is True:
            payload["think"] = True
        if request.json_mode:
            payload["response_format"] = {"type": "json_object"}
        headers: dict[str, str] = {}
        if self._api_key:
            headers["Authorization"] = f"Bearer {self._api_key}"

        started = time.perf_counter()
        try:
            async with self._create_client() as client:
                response = await client.post(
                    f"{self._base_url}/chat/completions",
                    json=payload,
                    headers=headers,
                )
                response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            await self._raise_for_error_response(exc.response, cause=exc)
        except httpx.HTTPError as exc:
            # TimeoutException, ConnectError, and every other transport issue.
            logger.warning("provider.transport_error", provider=self.name)
            raise AiUnavailableError(f"Provider '{self.name}' is unreachable") from exc
        latency_ms = int((time.perf_counter() - started) * 1000)

        text, model_used = _parse_completion_payload(response)
        return LlmCompletion(text=text, model_used=model_used, latency_ms=latency_ms)

    async def _complete_native(self, request: LlmRequest) -> LlmCompletion:
        """POST a native /api/chat generation (e.g. Ollama) and parse it.

        ``format: json`` grammatically constrains the output to valid JSON
        (Ollama) — combined with ``think: false`` this turns qwen3 into a
        fast, obedient structured extractor (its /v1 shim otherwise returns
        empty content).
        """
        payload: dict[str, Any] = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": request.system_prompt},
                {"role": "user", "content": request.user_prompt},
            ],
            "stream": False,
            "temperature": request.temperature,
            # Grammar-constrained JSON: cheap, reliable structured extraction
            # even on small local models that otherwise ramble.
            "options": {"num_predict": request.max_tokens},
            "keep_alive": "1h",
        }
        if request.json_mode:
            payload["format"] = "json"
        if request.think is not None:
            payload["think"] = request.think
        headers: dict[str, str] = {}
        if self._api_key:
            headers["Authorization"] = f"Bearer {self._api_key}"

        started = time.perf_counter()
        try:
            async with self._create_client() as client:
                response = await client.post(
                    f"{self._base_url}/api/chat",
                    json=payload,
                    headers=headers,
                )
                response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            await self._raise_for_error_response(exc.response, cause=exc)
        except httpx.HTTPError as exc:
            logger.warning("provider.transport_error", provider=self.name)
            raise AiUnavailableError(f"Provider '{self.name}' is unreachable") from exc
        latency_ms = int((time.perf_counter() - started) * 1000)

        text, model_used = _parse_native_completion(response)
        return LlmCompletion(text=text, model_used=model_used, latency_ms=latency_ms)

    async def stream(
        self,
        request: LlmRequest,
    ) -> AsyncIterator[LlmStreamChunk]:
        """POST a streaming generation and yield token deltas (SKY-60)."""
        if self._native:
            async for chunk in self._stream_native(request):
                yield chunk
            return
        async for chunk in self._stream_openai(request):
            yield chunk

    async def _stream_openai(
        self,
        request: LlmRequest,
    ) -> AsyncIterator[LlmStreamChunk]:
        """POST a streaming chat completion and yield token deltas (SKY-60).

        Uses ``stream: true`` and parses ``data:`` SSE frames as they arrive
        - the response is NEVER buffered whole. The http client lives for the
        generator's lifetime: when the consumer stops iterating or closes the
        iterator (client disconnect), the ``async with`` exits and the
        upstream request is cancelled (disconnect propagation).

        Error mapping matches :meth:`complete`:

        - transport failure, timeout, or any HTTP error status ->
          :class:`AiUnavailableError`;
        - HTTP 429 / a rate-limit error body ->
          :class:`AiRateLimitError` (retry_after_seconds when reported);
        - a frame whose schema fails validation ->
          :class:`AiInvalidResponseError`.

        All are raised on iteration; a pre-yield failure lets the router
        fail over, a post-yield failure surfaces mid-stream.
        """
        payload: dict[str, Any] = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": request.system_prompt},
                {"role": "user", "content": self._build_user_content(request)},
            ],
            "temperature": request.temperature,
            "max_tokens": request.max_tokens,
            "stream": True,
        }
        # Same portability rule as complete(): think only when explicitly
        # requested; never send think=False to OpenAI-compatible endpoints.
        if request.think is True:
            payload["think"] = True
        headers: dict[str, str] = {}
        if self._api_key:
            headers["Authorization"] = f"Bearer {self._api_key}"

        try:
            async with (
                self._create_client() as client,
                client.stream(
                    "POST",
                    f"{self._base_url}/chat/completions",
                    json=payload,
                    headers=headers,
                ) as response,
            ):
                if response.status_code >= 400:
                    await self._raise_for_error_response(response, stream=True)
                model_used = ""
                async for line in response.aiter_lines():
                    text_frame = _parse_stream_frame(line)
                    if text_frame is None:
                        continue
                    delta, frame_model = text_frame
                    if delta or frame_model:
                        model_used = frame_model or model_used
                        if delta:
                            yield LlmStreamChunk(
                                token_delta=delta,
                                model_used=model_used,
                            )
        except httpx.HTTPError as exc:
            # Connect/timeout/etc. - the provider never served the request.
            logger.warning("provider.stream_transport_error", provider=self.name)
            raise AiUnavailableError(f"Provider '{self.name}' is unreachable") from exc

    async def _stream_native(
        self,
        request: LlmRequest,
    ) -> AsyncIterator[LlmStreamChunk]:
        """Stream via the native /api/chat SSE dialect (e.g. Ollama)."""
        payload: dict[str, Any] = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": request.system_prompt},
                {"role": "user", "content": request.user_prompt},
            ],
            "stream": True,
            "temperature": request.temperature,
            "options": {"num_predict": request.max_tokens},
            "keep_alive": "1h",
        }
        if request.json_mode:
            payload["format"] = "json"
        if request.think is not None:
            payload["think"] = request.think
        headers: dict[str, str] = {}
        if self._api_key:
            headers["Authorization"] = f"Bearer {self._api_key}"

        try:
            async with (
                self._create_client() as client,
                client.stream(
                    "POST",
                    f"{self._base_url}/api/chat",
                    json=payload,
                    headers=headers,
                ) as response,
            ):
                if response.status_code >= 400:
                    await self._raise_for_error_response(response, stream=True)
                model_used = ""
                async for line in response.aiter_lines():
                    text_frame = _parse_native_stream_frame(line)
                    if text_frame is None:
                        continue
                    delta, frame_model = text_frame
                    if delta or frame_model:
                        model_used = frame_model or model_used
                        if delta:
                            yield LlmStreamChunk(
                                token_delta=delta,
                                model_used=model_used,
                            )
        except httpx.HTTPError as exc:
            logger.warning("provider.stream_transport_error", provider=self.name)
            raise AiUnavailableError(f"Provider '{self.name}' is unreachable") from exc


def _parse_native_stream_frame(line: str) -> tuple[str, str] | None:
    """Parse one native /api/chat SSE frame into (token_delta, model) or None.

    Frames are bare JSON objects (no ``data:`` prefix): ``{"message":
    {"content": "..."}, "done": false}``. ``done: true`` frames and
    schema-less keep-alives return None. Reasoning-only frames (empty content)
    are skipped so a thinking block never leaks into the client stream.
    """
    payload = line.strip()
    if not payload:
        return None
    try:
        frame = json.loads(payload)
        if frame.get("done") is True:
            return None
        message = frame.get("message")
        content = message.get("content") if isinstance(message, dict) else None
        if content is not None and not isinstance(content, str):
            raise TypeError("message content must be a string")
        model = frame.get("model")
        if model is not None and not isinstance(model, str):
            raise TypeError("model must be a string")
    except (ValueError, TypeError) as exc:
        logger.warning("provider.invalid_stream_schema")
        raise AiInvalidResponseError(
            "Provider returned a stream frame that failed schema validation"
        ) from exc
    return (content or "", model or "")


def _parse_native_completion(response: httpx.Response) -> tuple[str, str]:
    """Extract (text, model) from a native /api/chat 200 body."""
    try:
        data = response.json()
        message = data["message"]
        content = message["content"]
        model = data.get("model") or ""
        if not isinstance(content, str) or not isinstance(model, str):
            raise TypeError("content/model must be strings")
    except (ValueError, KeyError, TypeError) as exc:
        logger.warning("provider.invalid_response_schema")
        raise AiInvalidResponseError(
            "Provider returned a response that failed schema validation"
        ) from exc
    return content, model


def _parse_stream_frame(line: str) -> tuple[str, str] | None:
    """Parse one SSE ``data:`` frame into (token_delta, model) or None.

    Returns None for keep-alive/schema-less frames every streaming API sends;
    raises :class:`AiInvalidResponseError` for a data frame whose schema is
    unusable (the provider "answered but unusably" - 502 semantics).
    """
    if not line.startswith("data:"):
        return None
    payload = line[5:].strip()
    if not payload or payload == "[DONE]":
        return None
    try:
        frame = json.loads(payload)
        choices = frame.get("choices")
        if not isinstance(choices, list) or not choices:
            return None
        delta = choices[0].get("delta") if isinstance(choices[0], dict) else None
        content = delta.get("content") if isinstance(delta, dict) else None
        if content is not None and not isinstance(content, str):
            raise TypeError("delta content must be a string")
        model = frame.get("model")
        if model is not None and not isinstance(model, str):
            raise TypeError("model must be a string")
    except (ValueError, TypeError) as exc:
        logger.warning("provider.invalid_stream_schema")
        raise AiInvalidResponseError(
            "Provider returned a stream frame that failed schema validation"
        ) from exc
    return (content or "", model or "")


def _parse_completion_payload(response: httpx.Response) -> tuple[str, str]:
    """Extract (text, model) from a 200 body; schema failures are 502s."""
    try:
        data = response.json()
        choice = data["choices"][0]
        content = choice["message"]["content"]
        model = data.get("model") or ""
        if not isinstance(content, str) or not isinstance(model, str):
            raise TypeError("content/model must be strings")
    except (ValueError, KeyError, IndexError, TypeError) as exc:
        logger.warning("provider.invalid_response_schema")
        raise AiInvalidResponseError(
            "Provider returned a response that failed schema validation"
        ) from exc
    return content, model

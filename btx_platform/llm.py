from __future__ import annotations

import logging

import httpx

from btx_platform.config import Settings
from btx_platform.schemas import LlmProxyRequest

logger = logging.getLogger(__name__)

DEFAULT_MODEL = "claude-haiku-4-5-20251001"


class LlmProviderError(Exception):
    def __init__(self, detail: str, status_code: int = 502) -> None:
        super().__init__(detail)
        self.detail = detail
        self.status_code = status_code


async def call_anthropic(payload: LlmProxyRequest, settings: Settings) -> str:
    if not settings.anthropic_api_key:
        raise LlmProviderError("Anthropic API key is not configured.", 501)

    selected_model = payload.model.strip() if payload.model and payload.model.strip() else DEFAULT_MODEL
    body = {
        "model": selected_model,
        "max_tokens": 1024,
        "system": payload.system,
        "messages": [message.model_dump() for message in payload.messages],
    }
    logger.info("llm.outbound", extra={"model": selected_model, "message_count": len(payload.messages)})
    try:
        async with httpx.AsyncClient(timeout=settings.llm_timeout_seconds) as client:
            response = await client.post(
                settings.anthropic_base_url,
                headers={
                    "x-api-key": settings.anthropic_api_key,
                    "anthropic-version": settings.anthropic_version,
                    "content-type": "application/json",
                },
                json=body,
            )
    except httpx.TimeoutException as exc:
        raise LlmProviderError("Anthropic request timed out.") from exc
    except httpx.HTTPError as exc:
        raise LlmProviderError(f"Anthropic request failed: {exc}") from exc

    try:
        data = response.json()
    except ValueError as exc:
        raise LlmProviderError("Anthropic returned invalid JSON.") from exc

    if response.status_code >= 400:
        detail = data.get("error", {}).get("message") if isinstance(data, dict) else None
        raise LlmProviderError(detail or f"Anthropic returned HTTP {response.status_code}.")

    content = data.get("content", []) if isinstance(data, dict) else []
    text = "".join(
        block.get("text", "")
        for block in content
        if isinstance(block, dict) and block.get("type") == "text"
    )
    if text:
        return text
    error_text = data.get("error", {}).get("message") if isinstance(data, dict) else None
    return error_text or "(no text)"

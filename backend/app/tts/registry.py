import logging

import httpx

from ..config import Settings
from .azure import AzureTtsProvider
from .base import TtsProvider, Voice
from .elevenlabs import ElevenLabsTtsProvider
from .gemini import GeminiTtsProvider
from .openai import OpenAiTtsProvider

logger = logging.getLogger(__name__)

PROVIDER_TYPES = [
    AzureTtsProvider,
    ElevenLabsTtsProvider,
    OpenAiTtsProvider,
    GeminiTtsProvider,
]


class TtsRegistry:

    def __init__(self, settings: Settings):
        self.settings = settings
        self._providers = [factory(settings) for factory in PROVIDER_TYPES]

    @property
    def allow_custom_voices(self) -> bool:
        return self.settings.tts_allow_custom_voices

    @property
    def available(self) -> list[TtsProvider]:
        return [provider for provider in self._providers if provider.available]

    @property
    def enabled(self) -> bool:
        return bool(self.available)

    def provider_for(self, voice_id: str) -> tuple[TtsProvider, str] | None:
        provider_id, _, code = voice_id.partition(":")
        if not code:
            return None
        for provider in self.available:
            if provider.id == provider_id:
                return provider, code
        return None

    async def resolve(self, voice_id: str) -> tuple[TtsProvider, str] | None:
        found = self.provider_for(voice_id)
        if found is None or self.allow_custom_voices:
            return found
        provider, code = found
        try:
            known = {voice.id for voice in await provider.voices()}
        except Exception:
            logger.warning("could not check %s catalog for %r", provider.id, voice_id, exc_info=True)
            return None
        return found if provider.qualify(code) in known else None

    async def catalog(self) -> tuple[list[Voice], list[dict]]:
        collected: list[Voice] = []
        described: list[dict] = []
        for provider in self.available:
            entry = {
                "id": provider.id,
                "label": provider.label,
                "ok": True,
                "error": None,
                "supports_rate": provider.supports_rate,
            }
            try:
                voices = await provider.voices()
                collected.extend(voices)
                entry["voice_count"] = len(voices)
            except Exception as e:
                logger.warning("could not list %s voices", provider.id, exc_info=True)
                entry.update(ok=False, error=describe_failure(e), voice_count=0)
            described.append(entry)
        return collected, described

    async def voices(self) -> list[Voice]:
        collected, _ = await self.catalog()
        return collected

    def describe(self) -> list[dict]:
        return [{"id": p.id, "label": p.label} for p in self.available]


def describe_failure(error: Exception) -> str:
    if isinstance(error, httpx.HTTPStatusError):
        detail = ""
        try:
            payload = error.response.json()
            body = payload.get("detail", payload)
            if isinstance(body, dict):
                detail = body.get("message") or body.get("status") or ""
            elif isinstance(body, str):
                detail = body
        except ValueError:
            detail = ""
        code = error.response.status_code
        return f"HTTP {code}: {detail}" if detail else f"HTTP {code}"
    if isinstance(error, httpx.RequestError):
        return "Could not reach the provider."
    return "Unexpected error; see the server logs."

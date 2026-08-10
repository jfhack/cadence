import httpx

from ..config import Settings
from .base import TtsError, TtsProvider, Voice

API_ROOT = "https://api.elevenlabs.io/v1"


class ElevenLabsTtsProvider(TtsProvider):
    id = "elevenlabs"
    label = "ElevenLabs"
    media_type = "audio/mpeg"
    supports_rate = True
    MIN_RATE, MAX_RATE = 0.7, 1.2

    def __init__(self, settings: Settings):
        self.settings = settings

    @property
    def available(self) -> bool:
        return bool(self.settings.elevenlabs_api_key)

    @property
    def _headers(self) -> dict:
        return {"xi-api-key": self.settings.elevenlabs_api_key}

    async def voices(self) -> list[Voice]:
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.get(f"{API_ROOT}/voices", headers=self._headers)
            response.raise_for_status()
            payload = response.json()

        voices = []
        for item in payload.get("voices", []):
            code = item.get("voice_id")
            if not code:
                continue
            labels = item.get("labels") or {}
            name, _, descriptor = (item.get("name") or code).strip().partition(" - ")
            traits = [descriptor, *(labels.get(key, "") for key in ("accent", "description", "use_case"))]
            voices.append(
                Voice(
                    id=self.qualify(code),
                    provider=self.id,
                    name=name.strip() or code,
                    locale="",
                    gender=(labels.get("gender") or "").lower(),
                    description=", ".join(t.strip() for t in traits if t and t.strip()),
                    any_language=True,
                )
            )
        return voices

    async def synthesize(self, text: str, voice_code: str, rate: float = 1.0) -> bytes:
        body: dict = {
            "text": text,
            "model_id": self.settings.elevenlabs_model,
        }
        if rate != 1.0:
            body["voice_settings"] = {"speed": min(self.MAX_RATE, max(self.MIN_RATE, rate))}
        async with httpx.AsyncClient(timeout=60) as client:
            response = await client.post(
                f"{API_ROOT}/text-to-speech/{voice_code}",
                headers=self._headers,
                json=body,
            )
            if response.status_code >= 400:
                raise TtsError(f"ElevenLabs error {response.status_code}: {response.text[:200]}")
            return response.content

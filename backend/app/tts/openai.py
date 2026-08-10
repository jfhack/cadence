import httpx

from ..config import Settings
from .base import TtsError, TtsProvider, Voice

API_URL = "https://api.openai.com/v1/audio/speech"

VOICES = [
    ("alloy", "neutral, balanced"),
    ("ash", "warm, conversational"),
    ("ballad", "expressive, storytelling"),
    ("coral", "bright, friendly"),
    ("echo", "calm, even"),
    ("fable", "animated, narrative"),
    ("nova", "energetic, clear"),
    ("onyx", "deep, authoritative"),
    ("sage", "measured, gentle"),
    ("shimmer", "light, upbeat"),
]


class OpenAiTtsProvider(TtsProvider):
    id = "openai"
    label = "OpenAI"
    media_type = "audio/wav"
    supports_rate = True
    MIN_RATE, MAX_RATE = 0.25, 4.0

    def __init__(self, settings: Settings):
        self.settings = settings

    @property
    def available(self) -> bool:
        return bool(self.settings.openai_api_key)

    async def voices(self) -> list[Voice]:
        return [
            Voice(
                id=self.qualify(code),
                provider=self.id,
                name=code.capitalize(),
                locale="",
                description=description,
                any_language=True,
            )
            for code, description in VOICES
        ]

    async def synthesize(self, text: str, voice_code: str, rate: float = 1.0) -> bytes:
        body = {
            "model": self.settings.openai_tts_model,
            "input": text,
            "voice": voice_code,
            "response_format": "wav",
        }
        if rate != 1.0:
            body["speed"] = min(self.MAX_RATE, max(self.MIN_RATE, rate))
        headers = {"Authorization": f"Bearer {self.settings.openai_api_key}"}
        async with httpx.AsyncClient(timeout=60) as client:
            response = await client.post(API_URL, headers=headers, json=body)
            if response.status_code >= 400:
                raise TtsError(f"OpenAI error {response.status_code}: {response.text[:200]}")
            return response.content

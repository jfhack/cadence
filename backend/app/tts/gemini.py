import base64
import struct

import httpx

from ..config import Settings
from .base import TtsError, TtsProvider, Voice

API_ROOT = "https://generativelanguage.googleapis.com/v1beta/models"

VOICES = [
    ("Zephyr", "bright"),
    ("Puck", "upbeat"),
    ("Charon", "informative"),
    ("Kore", "firm"),
    ("Fenrir", "excitable"),
    ("Leda", "youthful"),
    ("Orus", "firm, low"),
    ("Aoede", "breezy"),
    ("Callirrhoe", "easy-going"),
    ("Autonoe", "bright, warm"),
]

SAMPLE_RATE = 24000


class GeminiTtsProvider(TtsProvider):
    id = "gemini"
    label = "Gemini"
    media_type = "audio/wav"

    def __init__(self, settings: Settings):
        self.settings = settings

    @property
    def available(self) -> bool:
        return bool(self.settings.gemini_api_key)

    async def voices(self) -> list[Voice]:
        return [
            Voice(
                id=self.qualify(code),
                provider=self.id,
                name=code,
                locale="",
                description=description,
                any_language=True,
            )
            for code, description in VOICES
        ]

    async def synthesize(self, text: str, voice_code: str, rate: float = 1.0) -> bytes:
        model = self.settings.gemini_tts_model
        body = {
            "contents": [{"parts": [{"text": text}]}],
            "generationConfig": {
                "responseModalities": ["AUDIO"],
                "speechConfig": {
                    "voiceConfig": {"prebuiltVoiceConfig": {"voiceName": voice_code}}
                },
            },
        }
        headers = {"x-goog-api-key": self.settings.gemini_api_key}
        async with httpx.AsyncClient(timeout=60) as client:
            response = await client.post(
                f"{API_ROOT}/{model}:generateContent", headers=headers, json=body
            )
            if response.status_code >= 400:
                raise TtsError(f"Gemini error {response.status_code}: {response.text[:200]}")
            payload = response.json()

        try:
            part = payload["candidates"][0]["content"]["parts"][0]
            raw = base64.b64decode(part["inlineData"]["data"])
        except (KeyError, IndexError, TypeError, ValueError) as exc:
            raise TtsError("Gemini returned no audio for this phrase.") from exc

        return self._wrap_wav(raw)

    @staticmethod
    def _wrap_wav(pcm: bytes) -> bytes:
        header = struct.pack(
            "<4sI4s4sIHHIIHH4sI",
            b"RIFF",
            36 + len(pcm),
            b"WAVE",
            b"fmt ",
            16,
            1,
            1,
            SAMPLE_RATE,
            SAMPLE_RATE * 2,
            2,
            16,
            b"data",
            len(pcm),
        )
        return header + pcm

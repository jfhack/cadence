import asyncio
import json
import logging
import re
from pathlib import Path
from xml.sax.saxutils import escape

import azure.cognitiveservices.speech as speechsdk
import httpx

from ..config import Settings
from .base import TtsError, TtsProvider, Voice

logger = logging.getLogger(__name__)

OUTPUT_FORMAT = speechsdk.SpeechSynthesisOutputFormat.Riff24Khz16BitMonoPcm


class AzureTtsProvider(TtsProvider):
    id = "azure"
    label = "Azure"
    media_type = "audio/wav"
    supports_rate = True

    def __init__(self, settings: Settings):
        self.settings = settings
        self._voices: list[Voice] | None = None
        self._lock = asyncio.Lock()

    @property
    def available(self) -> bool:
        return self.settings.tts_azure_enabled and self.settings.azure_configured

    async def voices(self) -> list[Voice]:
        async with self._lock:
            if self._voices is None:
                try:
                    self._voices = await self._fetch_voices()
                except Exception:
                    logger.warning("falling back to the bundled voice list", exc_info=True)
                    self._voices = self._bundled_voices()
            return self._voices

    async def _fetch_voices(self) -> list[Voice]:
        url = f"{self._host()}/cognitiveservices/voices/list"
        headers = {"Ocp-Apim-Subscription-Key": self.settings.azure_speech_key}
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.get(url, headers=headers)
            response.raise_for_status()
            payload = response.json()

        voices: list[Voice] = []
        for item in payload:
            code = item.get("ShortName")
            if not code:
                continue
            locale = item.get("Locale", "")
            secondary = [loc for loc in item.get("SecondaryLocaleList") or [] if loc]
            locales = [locale, *secondary] if locale else secondary
            voices.append(
                Voice(
                    id=self.qualify(code),
                    provider=self.id,
                    name=item.get("LocalName") or item.get("DisplayName") or code,
                    locale=locale,
                    gender=(item.get("Gender") or "").lower(),
                    locales=locales,
                    description=item.get("VoiceType", ""),
                )
            )
        return voices

    def _bundled_voices(self) -> list[Voice]:
        path = Path(__file__).resolve().parent.parent / "locales.json"
        with path.open(encoding="utf-8") as f:
            catalog = json.load(f)
        return [
            Voice(
                id=self.qualify(voice["code"]),
                provider=self.id,
                name=voice["name"],
                locale=entry["locale"],
                gender=voice.get("gender", ""),
                locales=[entry["locale"]],
            )
            for entry in catalog
            for voice in entry.get("voices", [])
        ]

    def _host(self) -> str:
        region = self.settings.azure_speech_region.strip()
        if region:
            return f"https://{region}.tts.speech.microsoft.com"
        return self.settings.azure_speech_endpoint.rstrip("/")

    async def synthesize(self, text: str, voice_code: str, rate: float = 1.0) -> bytes:
        return await asyncio.get_running_loop().run_in_executor(
            None, self._synthesize_blocking, text, voice_code, rate
        )

    @staticmethod
    def _ssml(text: str, voice_code: str, rate: float) -> str:
        match = re.match(r"^([a-z]{2,3}-[A-Z]{2,4})-", voice_code)
        lang = match.group(1) if match else "en-US"
        percent = round((rate - 1.0) * 100)
        body = escape(text)
        if percent:
            body = f'<prosody rate="{percent:+d}%">{body}</prosody>'
        return (
            '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" '
            f'xml:lang="{escape(lang, {chr(34): "&quot;"})}">'
            f'<voice name="{escape(voice_code, {chr(34): "&quot;"})}">{body}</voice>'
            "</speak>"
        )

    def _synthesize_blocking(self, text: str, voice_code: str, rate: float = 1.0) -> bytes:
        s = self.settings
        if s.azure_speech_endpoint:
            config = speechsdk.SpeechConfig(
                subscription=s.azure_speech_key, endpoint=s.azure_speech_endpoint
            )
        else:
            config = speechsdk.SpeechConfig(
                subscription=s.azure_speech_key, region=s.azure_speech_region
            )
        config.speech_synthesis_voice_name = voice_code
        config.set_speech_synthesis_output_format(OUTPUT_FORMAT)

        synthesizer = speechsdk.SpeechSynthesizer(speech_config=config, audio_config=None)
        if rate == 1.0:
            result = synthesizer.speak_text_async(text).get()
        else:
            result = synthesizer.speak_ssml_async(self._ssml(text, voice_code, rate)).get()

        if result.reason == speechsdk.ResultReason.SynthesizingAudioCompleted:
            return bytes(result.audio_data)
        if result.reason == speechsdk.ResultReason.Canceled:
            details = result.cancellation_details
            raise TtsError(f"Azure canceled the synthesis: {details.error_details}")
        raise TtsError("Azure returned no audio for this phrase.")

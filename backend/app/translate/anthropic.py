import httpx

from ..config import Settings
from .base import TranslationError, Translator

API_VERSION = "2023-06-01"


class AnthropicTranslator(Translator):

    id = "anthropic"
    label = "Anthropic"

    def __init__(self, settings: Settings):
        self.settings = settings

    @property
    def available(self) -> bool:
        return bool(self.settings.translator_api_key and self.settings.translator_model)

    async def translate(self, text: str, prompt: str) -> str:
        s = self.settings
        base = s.translator_base_url.rstrip("/") or "https://api.anthropic.com/v1"
        headers = {
            "x-api-key": s.translator_api_key,
            "anthropic-version": API_VERSION,
            "content-type": "application/json",
        }
        body = {
            "model": s.translator_model,
            "max_tokens": s.translator_max_tokens,
            "temperature": s.translator_temperature,
            "system": prompt,
            "messages": [{"role": "user", "content": text}],
        }

        async with httpx.AsyncClient(timeout=s.translator_timeout) as client:
            response = await client.post(f"{base}/messages", headers=headers, json=body)
            if response.status_code >= 400:
                raise TranslationError(
                    f"Translator error {response.status_code}: {response.text[:200]}"
                )
            payload = response.json()

        try:
            parts = payload["content"]
        except (KeyError, TypeError) as exc:
            raise TranslationError("The translator returned an unexpected response.") from exc

        translated = "".join(
            part.get("text", "") for part in parts if isinstance(part, dict) and part.get("text")
        ).strip()
        if not translated:
            raise TranslationError("The translator returned an empty translation.")
        return translated

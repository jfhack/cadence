import httpx

from ..config import Settings
from .base import TranslationError, Translator


class OpenAiCompatibleTranslator(Translator):

    id = "openai"
    label = "OpenAI-compatible"

    def __init__(self, settings: Settings):
        self.settings = settings

    @property
    def available(self) -> bool:
        s = self.settings
        return bool(s.translator_model and (s.translator_api_key or s.translator_base_url))

    async def translate(self, text: str, prompt: str) -> str:
        s = self.settings
        url = f"{s.translator_base_url.rstrip('/')}/chat/completions"
        headers = {"Content-Type": "application/json"}
        if s.translator_api_key:
            headers["Authorization"] = f"Bearer {s.translator_api_key}"

        body = {
            "model": s.translator_model,
            "messages": [
                {"role": "system", "content": prompt},
                {"role": "user", "content": text},
            ],
            "temperature": s.translator_temperature,
            "max_tokens": s.translator_max_tokens,
        }

        async with httpx.AsyncClient(timeout=s.translator_timeout) as client:
            response = await client.post(url, headers=headers, json=body)
            if response.status_code >= 400:
                raise TranslationError(
                    f"Translator error {response.status_code}: {response.text[:200]}"
                )
            payload = response.json()

        try:
            content = payload["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as exc:
            raise TranslationError("The translator returned an unexpected response.") from exc

        if isinstance(content, list):
            content = "".join(part.get("text", "") for part in content if isinstance(part, dict))
        if not isinstance(content, str) or not content.strip():
            raise TranslationError("The translator returned an empty translation.")
        return content.strip()

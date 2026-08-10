import logging

from ..config import Settings
from .anthropic import AnthropicTranslator
from .base import LANGUAGE_PLACEHOLDER, LOCALE_PLACEHOLDER, TranslationError, Translator, render_prompt
from .openai_compatible import OpenAiCompatibleTranslator

logger = logging.getLogger(__name__)

PROVIDERS: dict[str, type[Translator]] = {
    OpenAiCompatibleTranslator.id: OpenAiCompatibleTranslator,
    AnthropicTranslator.id: AnthropicTranslator,
}


class TranslationService:

    def __init__(self, settings: Settings):
        self.settings = settings
        provider = PROVIDERS.get(settings.translator_provider.strip().lower())
        self.translator: Translator | None = provider(settings) if provider else None
        if provider is None and settings.translator_enabled:
            logger.warning(
                "unknown TRANSLATOR_PROVIDER %r; expected one of %s",
                settings.translator_provider,
                ", ".join(PROVIDERS),
            )

    @property
    def enabled(self) -> bool:
        return (
            self.settings.translator_enabled
            and self.translator is not None
            and self.translator.available
        )

    def describe(self) -> dict:
        return {
            "enabled": self.enabled,
            "provider": self.translator.id if self.translator else "",
            "label": self.translator.label if self.translator else "",
            "prompt": self.settings.translator_prompt,
            "prompt_editable": self.settings.translator_prompt_editable,
            "language_placeholder": LANGUAGE_PLACEHOLDER,
            "locale_placeholder": LOCALE_PLACEHOLDER,
            "max_chars": self.settings.translator_max_chars,
        }

    def resolve_prompt(self, requested: str | None) -> str:
        if requested and self.settings.translator_prompt_editable:
            cleaned = requested.strip()
            if cleaned:
                return cleaned[: self.settings.translator_max_prompt_chars]
        return self.settings.translator_prompt

    async def translate(self, text: str, language: str, locale: str, prompt: str | None) -> str:
        if not self.enabled or self.translator is None:
            raise TranslationError("The translator is not configured on the server.")
        rendered = render_prompt(self.resolve_prompt(prompt), language, locale)
        return await self.translator.translate(text, rendered)

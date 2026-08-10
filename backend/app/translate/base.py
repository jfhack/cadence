from abc import ABC, abstractmethod

LANGUAGE_PLACEHOLDER = "<selected-language>"
LOCALE_PLACEHOLDER = "<selected-locale>"


class TranslationError(RuntimeError):
    pass


def render_prompt(template: str, language: str, locale: str) -> str:
    return template.replace(LANGUAGE_PLACEHOLDER, language).replace(LOCALE_PLACEHOLDER, locale)


class Translator(ABC):

    id: str = ""
    label: str = ""

    @property
    @abstractmethod
    def available(self) -> bool:
        pass

    @abstractmethod
    async def translate(self, text: str, prompt: str) -> str:
        pass

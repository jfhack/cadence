from abc import ABC, abstractmethod
from dataclasses import dataclass, field


@dataclass(frozen=True)
class Voice:

    id: str
    provider: str
    name: str
    locale: str
    gender: str = ""
    locales: list[str] = field(default_factory=list)
    description: str = ""
    any_language: bool = False

    @property
    def multilingual(self) -> bool:
        return self.any_language or len(self.locales) > 1

    def as_dict(self) -> dict:
        return {
            "id": self.id,
            "provider": self.provider,
            "name": self.name,
            "locale": self.locale,
            "gender": self.gender,
            "locales": self.locales or ([self.locale] if self.locale else []),
            "multilingual": self.multilingual,
            "any_language": self.any_language,
            "description": self.description,
        }


class TtsError(RuntimeError):
    pass


class TtsProvider(ABC):

    id: str = ""
    label: str = ""
    media_type: str = "audio/wav"
    supports_rate: bool = False

    @property
    @abstractmethod
    def available(self) -> bool:
        pass

    @abstractmethod
    async def voices(self) -> list[Voice]:
        pass

    @abstractmethod
    async def synthesize(self, text: str, voice_code: str, rate: float = 1.0) -> bytes:
        pass

    def qualify(self, code: str) -> str:
        return f"{self.id}:{code}"

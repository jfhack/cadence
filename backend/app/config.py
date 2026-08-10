from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    azure_speech_key: str = ""
    azure_speech_endpoint: str = ""
    azure_speech_region: str = ""

    cors_origins: str = ""
    cors_allow_credentials: bool = False

    tts_azure_enabled: bool = True
    tts_allow_custom_voices: bool = False
    elevenlabs_api_key: str = ""
    elevenlabs_model: str = "eleven_multilingual_v2"
    openai_api_key: str = ""
    openai_tts_model: str = "gpt-4o-mini-tts"
    gemini_api_key: str = ""
    gemini_tts_model: str = "gemini-2.5-flash-preview-tts"

    translator_enabled: bool = True
    translator_provider: str = "openai"
    translator_base_url: str = "https://api.openai.com/v1"
    translator_api_key: str = ""
    translator_model: str = ""
    translator_prompt: str = (
        "Translate the following text into <selected-language>. Keep the tone, "
        "and output only the translation without any extra notes"
    )
    translator_prompt_editable: bool = False
    translator_temperature: float = 0.2
    translator_max_tokens: int = 2048
    translator_timeout: int = 60
    translator_max_chars: int = 5000
    translator_max_prompt_chars: int = 2000

    api_docs_enabled: bool = False

    daily_budget_usd: float = 10.0

    cost_assessment_per_audio_hour: float = 1.00
    cost_tts_azure_per_million_chars: float = 15.00
    cost_tts_openai_per_million_chars: float = 15.00
    cost_tts_gemini_per_million_chars: float = 15.00
    cost_tts_elevenlabs_per_million_chars: float = 220.00
    cost_translation_per_million_chars: float = 2.00

    max_session_seconds: int = 600
    max_audio_bytes_per_session: int = 64 * 1024 * 1024
    max_reference_text_chars: int = 5000
    max_tts_chars: int = 1000

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def azure_configured(self) -> bool:
        return bool(self.azure_speech_key and (self.azure_speech_endpoint or self.azure_speech_region))


@lru_cache
def get_settings() -> Settings:
    return Settings()

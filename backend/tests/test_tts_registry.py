import httpx
import pytest

from app.config import Settings
from app.tts import TtsRegistry, Voice


def settings(**overrides) -> Settings:
    base = {
        "azure_speech_key": "",
        "azure_speech_endpoint": "",
        "azure_speech_region": "",
        "tts_azure_enabled": True,
        "elevenlabs_api_key": "",
        "openai_api_key": "",
        "gemini_api_key": "",
    }
    return Settings.model_construct(**{**base, **overrides})


def ids(registry: TtsRegistry) -> list[str]:
    return [provider.id for provider in registry.available]


def test_nothing_configured_exposes_no_providers():
    registry = TtsRegistry(settings())
    assert ids(registry) == []
    assert registry.enabled is False


def test_azure_needs_credentials_even_when_enabled():
    assert ids(TtsRegistry(settings(tts_azure_enabled=True))) == []
    assert ids(TtsRegistry(settings(azure_speech_key="k", azure_speech_region="westus"))) == ["azure"]


def test_env_flag_hides_azure_despite_credentials():
    configured = settings(azure_speech_key="k", azure_speech_region="westus")
    assert ids(TtsRegistry(configured)) == ["azure"]

    hidden = settings(azure_speech_key="k", azure_speech_region="westus", tts_azure_enabled=False)
    assert ids(TtsRegistry(hidden)) == []
    assert TtsRegistry(hidden).enabled is False


@pytest.mark.parametrize(
    ("key", "expected"),
    [
        ("elevenlabs_api_key", "elevenlabs"),
        ("openai_api_key", "openai"),
        ("gemini_api_key", "gemini"),
    ],
)
def test_other_providers_appear_only_with_a_non_empty_key(key, expected):
    assert ids(TtsRegistry(settings(**{key: ""}))) == []
    assert ids(TtsRegistry(settings(**{key: "secret"}))) == [expected]


def test_voice_ids_resolve_only_for_available_providers():
    registry = TtsRegistry(settings(openai_api_key="secret"))

    provider, code = registry.provider_for("openai:alloy")
    assert (provider.id, code) == ("openai", "alloy")

    assert registry.provider_for("azure:en-US-AvaNeural") is None
    assert registry.provider_for("nonsense") is None
    assert registry.provider_for("openai:") is None


@pytest.mark.asyncio
async def test_keyless_providers_expose_any_language_voices():
    registry = TtsRegistry(settings(openai_api_key="secret"))
    voices = await registry.voices()

    assert voices, "expected the built-in OpenAI catalog"
    first = voices[0].as_dict()
    assert first["id"].startswith("openai:")
    assert first["any_language"] is True
    assert first["multilingual"] is True


@pytest.mark.asyncio
async def test_catalog_reports_why_a_provider_is_unavailable(monkeypatch):
    registry = TtsRegistry(settings(openai_api_key="secret", elevenlabs_api_key="secret"))

    async def unauthorized():
        request = httpx.Request("GET", "https://api.elevenlabs.io/v1/voices")
        response = httpx.Response(
            401,
            request=request,
            json={
                "detail": {
                    "status": "missing_permissions",
                    "message": "The API key you used is missing the permission voices_read.",
                }
            },
        )
        raise httpx.HTTPStatusError("401", request=request, response=response)

    broken = next(p for p in registry.available if p.id == "elevenlabs")
    monkeypatch.setattr(broken, "voices", unauthorized)

    voices, providers = await registry.catalog()
    by_id = {p["id"]: p for p in providers}

    assert by_id["openai"]["ok"] is True
    assert by_id["openai"]["voice_count"] == len(voices) > 0

    assert by_id["elevenlabs"]["ok"] is False
    assert by_id["elevenlabs"]["voice_count"] == 0
    assert "401" in by_id["elevenlabs"]["error"]
    assert "voices_read" in by_id["elevenlabs"]["error"]


@pytest.mark.asyncio
async def test_network_failures_get_a_readable_reason(monkeypatch):
    registry = TtsRegistry(settings(elevenlabs_api_key="secret"))

    async def unreachable():
        raise httpx.ConnectError("nope")

    monkeypatch.setattr(registry.available[0], "voices", unreachable)
    _, providers = await registry.catalog()
    assert providers[0]["error"] == "Could not reach the provider."


@pytest.mark.asyncio
async def test_a_failing_provider_does_not_hide_the_others(monkeypatch):
    registry = TtsRegistry(settings(openai_api_key="secret", elevenlabs_api_key="secret"))

    async def boom():
        raise RuntimeError("network down")

    broken = next(p for p in registry.available if p.id == "elevenlabs")
    monkeypatch.setattr(broken, "voices", boom)

    voices = await registry.voices()
    assert {v.provider for v in voices} == {"openai"}


def test_azure_ssml_carries_the_prosody_rate():
    from app.tts.azure import AzureTtsProvider

    ssml = AzureTtsProvider._ssml("Hello & goodbye", "es-CL-CatalinaNeural", 0.75)
    assert 'xml:lang="es-CL"' in ssml
    assert 'name="es-CL-CatalinaNeural"' in ssml
    assert '<prosody rate="-25%">' in ssml
    assert "Hello &amp; goodbye" in ssml


def test_azure_ssml_omits_prosody_at_normal_pace():
    from app.tts.azure import AzureTtsProvider

    assert "<prosody" not in AzureTtsProvider._ssml("hi", "en-US-AvaNeural", 1.0)


def test_azure_ssml_falls_back_for_a_custom_voice_code():
    from app.tts.azure import AzureTtsProvider

    assert 'xml:lang="en-US"' in AzureTtsProvider._ssml("hi", "my-custom-voice", 1.25)


def test_faster_rate_is_a_positive_percentage():
    from app.tts.azure import AzureTtsProvider

    assert '<prosody rate="+25%">' in AzureTtsProvider._ssml("hi", "en-US-AvaNeural", 1.25)


async def test_unknown_voice_is_refused_by_default(monkeypatch):
    settings = Settings(azure_speech_key="k", azure_speech_region="w", _env_file=None)
    registry = TtsRegistry(settings)
    azure = registry.available[0]

    async def catalog():
        return [Voice(id="azure:known", provider="azure", name="Known", locale="en-US")]

    monkeypatch.setattr(azure, "voices", catalog)

    assert await registry.resolve("azure:known") is not None
    assert await registry.resolve("azure:hand-written") is None


async def test_unknown_voice_is_allowed_when_opted_in():
    settings = Settings(
        azure_speech_key="k",
        azure_speech_region="w",
        tts_allow_custom_voices=True,
        _env_file=None,
    )
    registry = TtsRegistry(settings)

    resolved = await registry.resolve("azure:hand-written")
    assert resolved is not None
    assert resolved[1] == "hand-written"


async def test_custom_voice_for_a_hidden_provider_is_still_refused():
    settings = Settings(tts_allow_custom_voices=True, tts_azure_enabled=False, _env_file=None)
    registry = TtsRegistry(settings)
    assert await registry.resolve("azure:anything") is None

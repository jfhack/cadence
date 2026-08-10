import asyncio
import json
import logging
from pathlib import Path

from fastapi import FastAPI, HTTPException, Response, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, ValidationError

from . import __version__
from .assessment import AssessmentSession, SessionOptions
from .budget import BudgetExceeded, DailyBudget
from .config import get_settings
from .translate import TranslationError, TranslationService
from .tts import TtsError, TtsRegistry

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger("cadence")

settings = get_settings()

MIN_SESSION_SECONDS = 30

app = FastAPI(
    title="Cadence API",
    version=__version__,
    docs_url="/api/docs" if settings.api_docs_enabled else None,
    redoc_url=None,
    openapi_url="/api/openapi.json" if settings.api_docs_enabled else None,
)

if settings.cors_origin_list:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=settings.cors_allow_credentials,
        allow_methods=["GET"],
        allow_headers=["*"],
    )

with (Path(__file__).parent / "locales.json").open(encoding="utf-8") as f:
    LOCALES = json.load(f)


tts = TtsRegistry(settings)
translator = TranslationService(settings)
budget = DailyBudget(settings)


@app.get("/api/health")
async def health() -> dict:
    return {
        "status": "ok",
        "azure_configured": settings.azure_configured,
        "tts_enabled": tts.enabled,
        "translator_enabled": translator.enabled,
        "budget": await budget.snapshot(),
    }


@app.get("/api/locales")
async def locales() -> list:
    return LOCALES


@app.get("/api/tts/voices")
async def tts_voices() -> dict:
    voices, providers = await tts.catalog()
    return {
        "enabled": tts.enabled,
        "allow_custom_voices": tts.allow_custom_voices,
        "providers": providers,
        "voices": [voice.as_dict() for voice in voices],
    }


class SpeakRequest(BaseModel):
    voice: str = Field(min_length=1, max_length=200)
    text: str = Field(min_length=1)
    rate: float = Field(1.0, ge=0.5, le=2.0)


@app.post("/api/tts/speak")
async def tts_speak(request: SpeakRequest) -> Response:
    text = request.text.strip()
    if not text:
        raise HTTPException(status_code=422, detail="Nothing to say.")
    if len(text) > settings.max_tts_chars:
        raise HTTPException(status_code=422, detail="That phrase is too long to synthesize.")

    resolved = await tts.resolve(request.voice)
    if resolved is None:
        raise HTTPException(status_code=404, detail="That voice is not available.")
    provider, code = resolved

    try:
        await budget.reserve(budget.tts_cost(provider.id, len(text)), f"tts:{provider.id}")
    except BudgetExceeded as e:
        raise HTTPException(status_code=429, detail=str(e)) from e

    try:
        audio = await provider.synthesize(text, code, request.rate)
    except TtsError as e:
        logger.warning("tts failed on %s: %s", provider.id, e)
        raise HTTPException(status_code=502, detail=str(e)) from e
    except Exception as e:
        logger.exception("unexpected tts failure on %s", provider.id)
        raise HTTPException(status_code=502, detail="Speech synthesis failed.") from e

    return Response(
        content=audio,
        media_type=provider.media_type,
        headers={"Cache-Control": "private, max-age=3600"},
    )


@app.get("/api/translate/config")
async def translate_config() -> dict:
    return translator.describe()


class TranslateRequest(BaseModel):
    text: str = Field(min_length=1)
    language: str = Field(min_length=1, max_length=200)
    locale: str = Field("", max_length=40)
    prompt: str | None = None


@app.post("/api/translate")
async def translate(request: TranslateRequest) -> dict:
    if not translator.enabled:
        raise HTTPException(status_code=503, detail="The translator is not configured.")

    text = request.text.strip()
    if not text:
        raise HTTPException(status_code=422, detail="Nothing to translate.")
    if len(text) > settings.translator_max_chars:
        raise HTTPException(status_code=422, detail="That text is too long to translate.")

    try:
        await budget.reserve(budget.translation_cost(len(text)), "translate")
    except BudgetExceeded as e:
        raise HTTPException(status_code=429, detail=str(e)) from e

    try:
        translated = await translator.translate(
            text=text,
            language=request.language.strip(),
            locale=request.locale.strip(),
            prompt=request.prompt,
        )
    except TranslationError as e:
        logger.warning("translation failed: %s", e)
        raise HTTPException(status_code=502, detail=str(e)) from e
    except Exception as e:
        logger.exception("unexpected translation failure")
        raise HTTPException(status_code=502, detail="Translation failed.") from e

    return {"translation": translated}


@app.websocket("/ws/assess")
async def assess(websocket: WebSocket) -> None:
    await websocket.accept()

    session = await _open_session(websocket)
    if session is None:
        return

    pump = asyncio.create_task(_pump_events(session, websocket))
    try:
        await _receive_audio(session, websocket)
        await pump
    except WebSocketDisconnect:
        logger.info("client disconnected mid-session")
        pump.cancel()
        await session.abort()
    finally:
        try:
            await websocket.close()
        except RuntimeError:
            pass


async def _open_session(websocket: WebSocket) -> AssessmentSession | None:
    try:
        first = await asyncio.wait_for(websocket.receive_json(), timeout=30)
    except (asyncio.TimeoutError, WebSocketDisconnect, ValueError):
        await websocket.close(code=4400, reason="expected a start message")
        return None

    if first.get("type") != "start":
        await websocket.close(code=4400, reason="expected a start message")
        return None

    if not settings.azure_configured:
        await websocket.send_json(
            {"type": "error", "message": "Azure Speech credentials are not configured on the server."}
        )
        await websocket.close(code=4503)
        return None

    try:
        await budget.ensure_room("assess", budget.assessment_cost(MIN_SESSION_SECONDS))
    except BudgetExceeded as e:
        await websocket.send_json({"type": "error", "message": str(e)})
        await websocket.close(code=4429)
        return None

    try:
        options = SessionOptions.model_validate(first)
        if len(options.reference_text) > settings.max_reference_text_chars:
            raise ValueError("reference text too long")
    except (ValidationError, ValueError) as e:
        await websocket.send_json({"type": "error", "message": f"Invalid options: {e}"})
        await websocket.close(code=4400)
        return None

    session = AssessmentSession(options, settings)
    try:
        await session.start()
    except Exception:
        logger.exception("failed to start an assessment session")
        await websocket.send_json(
            {"type": "error", "message": "Could not start the recognizer. Check the server logs."}
        )
        await websocket.close(code=4500)
        return None

    await websocket.send_json({"type": "ready", "mode": options.mode, "locale": options.locale})
    return session


async def _pump_events(session: AssessmentSession, websocket: WebSocket) -> None:
    while True:
        event = await session.events.get()
        try:
            await websocket.send_json(event)
        except (WebSocketDisconnect, RuntimeError):
            return
        if event["type"] == "done":
            return


async def _receive_audio(session: AssessmentSession, websocket: WebSocket) -> None:
    loop = asyncio.get_running_loop()
    deadline = loop.time() + settings.max_session_seconds
    received = 0

    async def bill_audio() -> None:
        seconds = received / (session.options.sample_rate * 2)
        await budget.charge(budget.assessment_cost(seconds), "assess")

    while True:
        remaining = deadline - loop.time()
        if remaining <= 0 or received > settings.max_audio_bytes_per_session:
            await session.events.put(
                {"type": "error", "message": "Session limit reached; assessment was finalized."}
            )
            await session.finish()
            await bill_audio()
            return
        try:
            message = await asyncio.wait_for(websocket.receive(), timeout=remaining)
        except asyncio.TimeoutError:
            continue

        if message["type"] == "websocket.disconnect":
            await bill_audio()
            raise WebSocketDisconnect(message.get("code", 1000))

        data = message.get("bytes")
        if data is not None:
            received += len(data)
            session.write_audio(data)
            continue

        text = message.get("text")
        if text is not None:
            try:
                control = json.loads(text)
            except ValueError:
                continue
            if control.get("type") == "stop":
                await session.finish()
                await bill_audio()
                return

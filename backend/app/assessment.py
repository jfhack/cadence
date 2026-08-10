import asyncio
import json
import logging
import threading
from typing import Any, Literal

import azure.cognitiveservices.speech as speechsdk
from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from .aggregate import summarize_continuous
from .config import Settings

logger = logging.getLogger(__name__)


class SessionOptions(BaseModel):

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    locale: str = Field("en-US", pattern=r"^[a-zA-Z]{2,3}(-[a-zA-Z]{2,4}){0,2}$")
    reference_text: str = ""
    mode: Literal["single", "continuous"] = "single"
    enable_prosody: bool = True
    enable_miscue: bool = True
    phoneme_alphabet: Literal["IPA", "SAPI"] = "IPA"
    nbest_phoneme_count: int = Field(0, ge=0, le=5)
    sample_rate: int = Field(16000, ge=8000, le=48000)
    end_silence_timeout_ms: int = Field(3000, ge=100, le=10000)
    segmentation_silence_timeout_ms: int = Field(1500, ge=100, le=5000)

    @property
    def unscripted(self) -> bool:
        return not self.reference_text.strip()


def _phoneme_from_json(p: dict) -> dict:
    pa = p.get("PronunciationAssessment", {})
    return {
        "phoneme": p.get("Phoneme"),
        "accuracy_score": pa.get("AccuracyScore"),
        "nbest_phonemes": [
            {"phoneme": nb.get("Phoneme"), "score": nb.get("Score")}
            for nb in pa.get("NBestPhonemes", [])
        ],
        "offset": p.get("Offset", 0),
        "duration": p.get("Duration", 0),
    }


def _syllable_from_json(s: dict) -> dict:
    pa = s.get("PronunciationAssessment", {})
    return {
        "syllable": s.get("Syllable"),
        "grapheme": s.get("Grapheme"),
        "accuracy_score": pa.get("AccuracyScore"),
        "offset": s.get("Offset", 0),
        "duration": s.get("Duration", 0),
    }


def word_from_json(w: dict) -> dict:
    pa = w.get("PronunciationAssessment", {})
    return {
        "word": w.get("Word"),
        "accuracy_score": pa.get("AccuracyScore"),
        "error_type": pa.get("ErrorType", "None"),
        "offset": w.get("Offset", 0),
        "duration": w.get("Duration", 0),
        "phonemes": [_phoneme_from_json(p) for p in w.get("Phonemes", [])],
        "syllables": [_syllable_from_json(s) for s in w.get("Syllables", [])],
    }


def scores_from_json(nbest: dict) -> dict:
    pa = nbest.get("PronunciationAssessment", {})
    return {
        "accuracy": pa.get("AccuracyScore"),
        "fluency": pa.get("FluencyScore"),
        "completeness": pa.get("CompletenessScore"),
        "prosody": pa.get("ProsodyScore"),
        "pronunciation": pa.get("PronScore"),
    }


class AssessmentSession:
    def __init__(self, options: SessionOptions, settings: Settings):
        self.options = options
        self.settings = settings
        self.loop = asyncio.get_running_loop()
        self.events: asyncio.Queue[dict[str, Any]] = asyncio.Queue()

        self._phrases: list[dict] = []
        self._stopped = asyncio.Event()
        self._done_lock = threading.Lock()
        self._done_emitted = False
        self._failed = False

        self._stream: speechsdk.audio.PushAudioInputStream | None = None
        self._recognizer: speechsdk.SpeechRecognizer | None = None
        self._single_task: asyncio.Task | None = None

    def _emit(self, message: dict) -> None:
        self.loop.call_soon_threadsafe(self.events.put_nowait, message)

    def _emit_done(self) -> None:
        with self._done_lock:
            if self._done_emitted:
                return
            self._done_emitted = True
        self._emit({"type": "done"})

    def _set_stopped(self) -> None:
        self.loop.call_soon_threadsafe(self._stopped.set)

    def _speech_config(self) -> speechsdk.SpeechConfig:
        s = self.settings
        if s.azure_speech_endpoint:
            config = speechsdk.SpeechConfig(
                subscription=s.azure_speech_key, endpoint=s.azure_speech_endpoint
            )
        else:
            config = speechsdk.SpeechConfig(
                subscription=s.azure_speech_key, region=s.azure_speech_region
            )
        if self.options.mode == "single":
            config.set_property(
                speechsdk.PropertyId.SpeechServiceConnection_EndSilenceTimeoutMs,
                str(self.options.end_silence_timeout_ms),
            )
        else:
            config.set_property(
                speechsdk.PropertyId.Speech_SegmentationSilenceTimeoutMs,
                str(self.options.segmentation_silence_timeout_ms),
            )
        return config

    def _pronunciation_config(self) -> speechsdk.PronunciationAssessmentConfig:
        o = self.options
        config = speechsdk.PronunciationAssessmentConfig(
            reference_text="" if o.unscripted else o.reference_text,
            grading_system=speechsdk.PronunciationAssessmentGradingSystem.HundredMark,
            granularity=speechsdk.PronunciationAssessmentGranularity.Phoneme,
            enable_miscue=o.enable_miscue and not o.unscripted,
        )
        if o.enable_prosody:
            config.enable_prosody_assessment()
        config.phoneme_alphabet = o.phoneme_alphabet
        if o.nbest_phoneme_count > 0:
            config.nbest_phoneme_count = o.nbest_phoneme_count
        return config

    async def start(self) -> None:
        audio_format = speechsdk.audio.AudioStreamFormat(
            samples_per_second=self.options.sample_rate, bits_per_sample=16, channels=1
        )
        self._stream = speechsdk.audio.PushAudioInputStream(stream_format=audio_format)
        audio_config = speechsdk.audio.AudioConfig(stream=self._stream)

        self._recognizer = speechsdk.SpeechRecognizer(
            speech_config=self._speech_config(),
            language=self.options.locale,
            audio_config=audio_config,
        )
        self._pronunciation_config().apply_to(self._recognizer)

        self._recognizer.recognizing.connect(self._on_recognizing)
        self._recognizer.recognized.connect(self._on_recognized)
        self._recognizer.canceled.connect(self._on_canceled)
        self._recognizer.session_stopped.connect(lambda evt: self._set_stopped())

        if self.options.mode == "continuous":
            await self.loop.run_in_executor(
                None, lambda: self._recognizer.start_continuous_recognition_async().get()
            )
        else:
            future = self._recognizer.recognize_once_async()
            self._single_task = asyncio.ensure_future(self._run_single(future))

    def _on_recognizing(self, evt: speechsdk.SpeechRecognitionEventArgs) -> None:
        if evt.result.text:
            self._emit({"type": "recognizing", "text": evt.result.text})

    def _on_recognized(self, evt: speechsdk.SpeechRecognitionEventArgs) -> None:
        if evt.result.reason != speechsdk.ResultReason.RecognizedSpeech or not evt.result.text:
            return
        raw = evt.result.properties.get(speechsdk.PropertyId.SpeechServiceResponse_JsonResult)
        try:
            parsed = json.loads(raw)
            nbest = parsed["NBest"][0]
        except (TypeError, ValueError, KeyError, IndexError):
            logger.warning("could not parse recognition payload")
            return
        phrase = {
            "text": evt.result.text,
            "scores": scores_from_json(nbest),
            "words": [word_from_json(w) for w in nbest.get("Words", [])],
        }
        self._phrases.append(phrase)
        self._emit({"type": "phrase", **phrase})

    def _on_canceled(self, evt: speechsdk.SpeechRecognitionCanceledEventArgs) -> None:
        details = evt.cancellation_details
        if details.reason == speechsdk.CancellationReason.Error:
            self._failed = True
            logger.error("azure recognition error: %s", details.error_details)
            self._emit({"type": "error", "message": f"Recognition error: {details.error_details}"})
            self._emit_done()
        self._set_stopped()

    async def _run_single(self, future) -> None:
        try:
            result = await self.loop.run_in_executor(None, future.get)
        except Exception:
            logger.exception("recognize_once failed")
            self._emit({"type": "error", "message": "Recognition failed unexpectedly."})
            self._emit_done()
            return

        if result.reason == speechsdk.ResultReason.RecognizedSpeech and result.text:
            raw = result.properties.get(speechsdk.PropertyId.SpeechServiceResponse_JsonResult)
            try:
                nbest = json.loads(raw)["NBest"][0]
                self._emit(
                    {
                        "type": "summary",
                        "mode": "single",
                        "text": result.text,
                        "scores": scores_from_json(nbest),
                        "words": [word_from_json(w) for w in nbest.get("Words", [])],
                    }
                )
            except (TypeError, ValueError, KeyError, IndexError):
                self._emit({"type": "error", "message": "Could not parse assessment result."})
        elif result.reason == speechsdk.ResultReason.NoMatch:
            self._emit({"type": "error", "message": "No speech could be recognized."})
        elif result.reason == speechsdk.ResultReason.Canceled:
            details = result.cancellation_details
            if details.reason == speechsdk.CancellationReason.Error:
                self._emit({"type": "error", "message": f"Recognition error: {details.error_details}"})
            else:
                self._emit({"type": "error", "message": "Recognition was canceled."})
        self._emit_done()

    def write_audio(self, data: bytes) -> None:
        if self._stream is not None:
            self._stream.write(data)

    async def finish(self) -> None:
        if self._stream is not None:
            self._stream.close()

        if self.options.mode == "single":
            if self._single_task is not None:
                await self._single_task
            return

        try:
            await asyncio.wait_for(self._stopped.wait(), timeout=30)
        except asyncio.TimeoutError:
            logger.warning("timed out waiting for the recognizer to stop")
        await self.loop.run_in_executor(
            None, lambda: self._recognizer.stop_continuous_recognition_async().get()
        )
        if not self._failed:
            summary = summarize_continuous(
                phrases=self._phrases,
                reference_text=self.options.reference_text,
                locale=self.options.locale,
                enable_miscue=self.options.enable_miscue,
                unscripted=self.options.unscripted,
            )
            self._emit({"type": "summary", "mode": "continuous", **summary})
        self._emit_done()

    async def abort(self) -> None:
        self._done_emitted = True
        try:
            if self._stream is not None:
                self._stream.close()
            if self._single_task is not None:
                self._single_task.cancel()
            if self._recognizer is not None and self.options.mode == "continuous":
                await self.loop.run_in_executor(
                    None, lambda: self._recognizer.stop_continuous_recognition_async().get()
                )
        except Exception:
            logger.exception("error while aborting the session")

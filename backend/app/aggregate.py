import difflib
import string
from dataclasses import dataclass, field

DURATION_PADDING_TICKS = 100_000
MISPRONUNCIATION_THRESHOLD = 60

PUNCTUATION = string.punctuation + "¿¡«»。，、？！：；“”‘’"


@dataclass
class ContinuousSummarizer:
    phrases: list[dict]
    reference_text: str
    locale: str
    enable_miscue: bool
    unscripted: bool

    recognized_words: list[dict] = field(init=False)
    prosody_scores: list[float] = field(init=False)

    def __post_init__(self) -> None:
        self.recognized_words = [w for p in self.phrases for w in p["words"]]
        self.prosody_scores = [
            p["scores"]["prosody"] for p in self.phrases if p["scores"].get("prosody") is not None
        ]

    def _reference_words(self) -> list[str]:
        if self.locale.lower().startswith("zh"):
            import jieba

            jieba.suggest_freq([w["word"] for w in self.recognized_words], True)
            words = jieba.cut(self.reference_text.replace(" ", ""))
        else:
            words = self.reference_text.lower().split()
        cleaned = [w.strip(PUNCTUATION) for w in words]
        return [w for w in cleaned if w.strip()]

    def _apply_miscues(self, reference_words: list[str]) -> list[dict]:
        recognized_lower = [w["word"].lower() for w in self.recognized_words]
        diff = difflib.SequenceMatcher(None, reference_words, recognized_lower)
        final_words: list[dict] = []
        for tag, i1, i2, j1, j2 in diff.get_opcodes():
            if tag in ("insert", "replace"):
                for word in self.recognized_words[j1:j2]:
                    word["error_type"] = "Insertion"
                    final_words.append(word)
            if tag in ("delete", "replace"):
                for word_text in reference_words[i1:i2]:
                    final_words.append(
                        {
                            "word": word_text,
                            "accuracy_score": None,
                            "error_type": "Omission",
                            "offset": 0,
                            "duration": 0,
                            "phonemes": [],
                            "syllables": [],
                        }
                    )
            if tag == "equal":
                final_words.extend(self.recognized_words[j1:j2])
        return final_words

    def _accuracy(self, final_words: list[dict]) -> float:
        scores = [
            w["accuracy_score"] or 0.0 for w in final_words if w["error_type"] != "Insertion"
        ]
        return sum(scores) / len(scores) if scores else 0.0

    def _fluency(self) -> float:
        good = [w for w in self.recognized_words if w["error_type"] == "None"]
        if not self.recognized_words or not good:
            return 0.0
        start = self.recognized_words[0]["offset"]
        end = (
            self.recognized_words[-1]["offset"]
            + self.recognized_words[-1]["duration"]
            + DURATION_PADDING_TICKS
        )
        if end <= start:
            return 0.0
        spoken = sum(w["duration"] + DURATION_PADDING_TICKS for w in good)
        return min(spoken / (end - start) * 100, 100.0)

    def _prosody(self) -> float | None:
        if not self.prosody_scores:
            return None
        return sum(self.prosody_scores) / len(self.prosody_scores)

    def _completeness(self, final_words: list[dict]) -> float:
        if self.unscripted:
            return 100.0
        expected = [w for w in final_words if w["error_type"] != "Insertion"]
        if not expected:
            return 0.0
        good = [w for w in final_words if w["error_type"] == "None"]
        return min(len(good) / len(expected) * 100, 100.0)

    def _pronunciation(
        self, accuracy: float, fluency: float, completeness: float, prosody: float | None
    ) -> float:
        if not self.unscripted:
            if prosody is not None:
                s = sorted([accuracy, prosody, completeness, fluency])
                return s[0] * 0.4 + s[1] * 0.2 + s[2] * 0.2 + s[3] * 0.2
            s = sorted([accuracy, fluency, completeness])
            return s[0] * 0.6 + s[1] * 0.2 + s[2] * 0.2
        if prosody is not None:
            s = sorted([accuracy, prosody, fluency])
            return s[0] * 0.6 + s[1] * 0.2 + s[2] * 0.2
        s = sorted([accuracy, fluency])
        return s[0] * 0.6 + s[1] * 0.4

    def summarize(self) -> dict:
        if self.enable_miscue and not self.unscripted:
            final_words = self._apply_miscues(self._reference_words())
        else:
            final_words = list(self.recognized_words)

        for word in final_words:
            score = word.get("accuracy_score")
            if word["error_type"] == "None" and score is not None:
                if score < MISPRONUNCIATION_THRESHOLD:
                    word["error_type"] = "Mispronunciation"

        accuracy = self._accuracy(final_words)
        fluency = self._fluency()
        prosody = self._prosody()
        completeness = self._completeness(final_words)
        pronunciation = self._pronunciation(accuracy, fluency, completeness, prosody)

        return {
            "text": " ".join(p["text"] for p in self.phrases),
            "scores": {
                "accuracy": round(accuracy, 1),
                "fluency": round(fluency, 1),
                "completeness": round(completeness, 1),
                "prosody": round(prosody, 1) if prosody is not None else None,
                "pronunciation": round(pronunciation, 1),
            },
            "words": final_words,
        }


def summarize_continuous(
    phrases: list[dict],
    reference_text: str,
    locale: str,
    enable_miscue: bool,
    unscripted: bool,
) -> dict:
    return ContinuousSummarizer(
        phrases=phrases,
        reference_text=reference_text,
        locale=locale,
        enable_miscue=enable_miscue,
        unscripted=unscripted,
    ).summarize()

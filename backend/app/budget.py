import asyncio
import logging
from datetime import date, datetime, timezone

from .config import Settings

logger = logging.getLogger(__name__)

SECONDS_PER_HOUR = 3600
PER_MILLION = 1_000_000


class BudgetExceeded(RuntimeError):
    pass


class DailyBudget:
    def __init__(self, settings: Settings):
        self.settings = settings
        self._day: date | None = None
        self._spent = 0.0
        self._lock = asyncio.Lock()

    @property
    def limit(self) -> float:
        return self.settings.daily_budget_usd

    @property
    def enforced(self) -> bool:
        return self.limit > 0

    def _roll_over(self) -> None:
        today = datetime.now(timezone.utc).date()
        if self._day != today:
            if self._day is not None:
                logger.info("daily budget reset (spent %.4f USD on %s)", self._spent, self._day)
            self._day = today
            self._spent = 0.0

    async def snapshot(self) -> dict:
        async with self._lock:
            self._roll_over()
            return {
                "limit_usd": round(self.limit, 4),
                "spent_usd": round(self._spent, 4),
                "remaining_usd": round(max(0.0, self.limit - self._spent), 4),
                "enforced": self.enforced,
            }

    async def reserve(self, amount: float, what: str) -> None:
        if not self.enforced:
            return
        async with self._lock:
            self._roll_over()
            if self._spent + amount > self.limit:
                raise BudgetExceeded(
                    f"The daily budget of ${self.limit:.2f} is used up "
                    f"(${self._spent:.2f} so far). It resets at midnight UTC."
                )
            self._spent += amount
            logger.debug("%s: +$%.4f (day total $%.4f)", what, amount, self._spent)

    async def charge(self, amount: float, what: str) -> None:
        if not self.enforced or amount <= 0:
            return
        async with self._lock:
            self._roll_over()
            self._spent += amount
            logger.debug("%s: +$%.4f after the fact (day total $%.4f)", what, amount, self._spent)

    async def ensure_room(self, what: str, needed: float = 0.0) -> None:
        if not self.enforced:
            return
        async with self._lock:
            self._roll_over()
            if self._spent + needed >= self.limit:
                raise BudgetExceeded(
                    f"The daily budget of ${self.limit:.2f} is used up "
                    f"(${self._spent:.2f} so far). It resets at midnight UTC."
                )

    def assessment_cost(self, audio_seconds: float) -> float:
        return audio_seconds / SECONDS_PER_HOUR * self.settings.cost_assessment_per_audio_hour

    def tts_cost(self, provider_id: str, characters: int) -> float:
        rates = {
            "azure": self.settings.cost_tts_azure_per_million_chars,
            "elevenlabs": self.settings.cost_tts_elevenlabs_per_million_chars,
            "openai": self.settings.cost_tts_openai_per_million_chars,
            "gemini": self.settings.cost_tts_gemini_per_million_chars,
        }
        rate = rates.get(provider_id, max(rates.values()))
        return characters / PER_MILLION * rate

    def translation_cost(self, characters: int) -> float:
        return characters / PER_MILLION * self.settings.cost_translation_per_million_chars

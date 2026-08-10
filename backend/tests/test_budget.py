from datetime import date, timedelta

import pytest

from app.budget import BudgetExceeded, DailyBudget
from app.config import Settings


def budget(**overrides) -> DailyBudget:
    base = dict(daily_budget_usd=10.0, _env_file=None)
    base.update(overrides)
    return DailyBudget(Settings(**base))


def test_assessment_is_billed_by_audio_duration():
    b = budget(cost_assessment_per_audio_hour=1.0)
    assert b.assessment_cost(3600) == pytest.approx(1.0)
    assert b.assessment_cost(60) == pytest.approx(1.0 / 60)


def test_elevenlabs_is_billed_at_its_own_higher_rate():
    b = budget()
    chars = 10_000
    assert b.tts_cost("elevenlabs", chars) > b.tts_cost("azure", chars) * 10


def test_unknown_provider_bills_at_the_dearest_rate():
    b = budget()
    assert b.tts_cost("mystery", 10_000) == b.tts_cost("elevenlabs", 10_000)


async def test_spending_is_refused_once_the_budget_is_gone():
    b = budget(daily_budget_usd=1.0)
    await b.reserve(0.9, "test")
    with pytest.raises(BudgetExceeded, match="daily budget"):
        await b.reserve(0.2, "test")
    assert (await b.snapshot())["spent_usd"] == pytest.approx(0.9)


async def test_a_zero_budget_disables_the_guard():
    b = budget(daily_budget_usd=0)
    await b.reserve(1_000_000, "test")
    snapshot = await b.snapshot()
    assert snapshot["enforced"] is False
    assert snapshot["remaining_usd"] == 0.0


async def test_after_the_fact_charges_are_never_refused():
    b = budget(daily_budget_usd=0.01)
    await b.charge(5.0, "assess")
    assert (await b.snapshot())["spent_usd"] == pytest.approx(5.0)


async def test_open_ended_work_is_refused_when_the_budget_is_used_up():
    b = budget(daily_budget_usd=1.0)
    await b.ensure_room("assess")
    await b.charge(1.0, "assess")
    with pytest.raises(BudgetExceeded):
        await b.ensure_room("assess")


async def test_a_session_needs_headroom_not_just_a_non_zero_balance():
    b = budget(daily_budget_usd=1.0)
    await b.reserve(0.999, "test")
    await b.ensure_room("assess")
    with pytest.raises(BudgetExceeded):
        await b.ensure_room("assess", needed=b.assessment_cost(30))


async def test_the_total_resets_on_a_new_day():
    b = budget(daily_budget_usd=1.0)
    await b.reserve(1.0, "test")
    with pytest.raises(BudgetExceeded):
        await b.reserve(0.01, "test")

    b._day = date.today() - timedelta(days=1)
    snapshot = await b.snapshot()
    assert snapshot["spent_usd"] == 0.0
    await b.reserve(0.5, "test")


async def test_snapshot_reports_what_is_left():
    b = budget(daily_budget_usd=10.0)
    await b.reserve(2.5, "test")
    snapshot = await b.snapshot()
    assert snapshot["limit_usd"] == 10.0
    assert snapshot["remaining_usd"] == pytest.approx(7.5)
    assert snapshot["enforced"] is True


async def test_a_day_of_default_budget_buys_a_sane_amount_of_use():
    b = budget()
    await b.reserve(b.assessment_cost(3600), "assess")
    await b.reserve(b.tts_cost("azure", 200 * 100), "tts")
    await b.reserve(b.translation_cost(1000 * 50), "translate")
    assert (await b.snapshot())["remaining_usd"] > 5.0

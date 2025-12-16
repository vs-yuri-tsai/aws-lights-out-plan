import pytest
from datetime import datetime, time, date
from unittest.mock import MagicMock
from zoneinfo import ZoneInfo

from src.lambda_function.core.scheduler import Scheduler


class TestScheduler:

    @pytest.fixture
    def scheduler_default(self):
        return Scheduler()

    @pytest.fixture
    def scheduler_custom_work_days(self):
        # Saturday and Sunday as work days
        return Scheduler(work_days=[5, 6])

    @pytest.fixture
    def scheduler_custom_hours(self):
        # 8 AM to 6 PM
        return Scheduler(work_start_time=time(8, 0), work_end_time=time(18, 0))

    @pytest.fixture
    def scheduler_utc(self):
        return Scheduler(timezone="UTC")

    # --- Test is_workday ---
    @pytest.mark.parametrize("test_datetime_str, expected_result", [
        ("2024-12-16 10:00:00", True),  # Monday
        ("2024-12-17 10:00:00", True),  # Tuesday
        ("2024-12-20 10:00:00", True),  # Friday
        ("2024-12-21 10:00:00", False), # Saturday
        ("2024-12-22 10:00:00", False), # Sunday
    ])
    def test_is_workday_default(self, scheduler_default, test_datetime_str, expected_result):
        dt = datetime.fromisoformat(test_datetime_str)
        assert scheduler_default.is_workday(dt) == expected_result

    @pytest.mark.parametrize("test_datetime_str, expected_result", [
        ("2024-12-21 10:00:00", True),  # Saturday (custom workday)
        ("2024-12-22 10:00:00", True),  # Sunday (custom workday)
        ("2024-12-16 10:00:00", False), # Monday (not custom workday)
    ])
    def test_is_workday_custom_work_days(self, scheduler_custom_work_days, test_datetime_str, expected_result):
        dt = datetime.fromisoformat(test_datetime_str)
        assert scheduler_custom_work_days.is_workday(dt) == expected_result

    # --- Test is_working_hours ---
    @pytest.mark.parametrize("test_datetime_str, expected_result", [
        ("2024-12-16 09:00:00", True),  # Start of work day
        ("2024-12-16 12:00:00", True),  # Middle of work day
        ("2024-12-16 16:59:59", True),  # Just before end of work day
        ("2024-12-16 08:59:59", False), # Just before start
        ("2024-12-16 17:00:00", False), # End of work day
        ("2024-12-16 20:00:00", False), # After work day
    ])
    def test_is_working_hours_default(self, scheduler_default, test_datetime_str, expected_result):
        dt = datetime.fromisoformat(test_datetime_str)
        assert scheduler_default.is_working_hours(dt) == expected_result

    @pytest.mark.parametrize("test_datetime_str, expected_result", [
        ("2024-12-16 08:00:00", True),  # Start of custom work day
        ("2024-12-16 17:59:59", True),  # Just before end of custom work day
        ("2024-12-16 07:59:59", False), # Before custom start
        ("2024-12-16 18:00:00", False), # After custom end
    ])
    def test_is_working_hours_custom(self, scheduler_custom_hours, test_datetime_str, expected_result):
        dt = datetime.fromisoformat(test_datetime_str)
        assert scheduler_custom_hours.is_working_hours(dt) == expected_result

    # --- Test Timezone Handling ---
    @pytest.mark.parametrize("test_datetime_str_utc, expected_workday, expected_working_hours", [
        ("2024-12-16 17:00:00+00:00", True, True),  # Mon 9 AM PST (17:00 UTC) - During work time
        ("2024-12-16 00:00:00+00:00", False, True), # Sun 4 PM PST (00:00 UTC Mon) - Weekend but during work hours
        ("2024-12-17 01:00:00+00:00", True, False),  # Mon 5 PM PST (01:00 UTC Tue) - Workday but after hours
        ("2024-12-16 16:00:00+00:00", True, False), # Mon 8 AM PST (16:00 UTC) - Workday but before hours
    ])
    def test_is_during_work_time_with_timezone(self, scheduler_default, test_datetime_str_utc, expected_workday, expected_working_hours):
        # The scheduler is configured for America/Los_Angeles (PST/PDT)
        # UTC+00:00, PST is UTC-08:00 during standard time.
        # So, 17:00 UTC is 9:00 PST.
        dt_utc = datetime.fromisoformat(test_datetime_str_utc).replace(tzinfo=ZoneInfo("UTC"))
        
        assert scheduler_default.is_workday(dt_utc) == expected_workday
        assert scheduler_default.is_working_hours(dt_utc) == expected_working_hours
        assert scheduler_default.is_during_work_time(dt_utc) == (expected_workday and expected_working_hours)

    def test_constructor_defaults(self):
        s = Scheduler()
        assert s.timezone == ZoneInfo("America/Los_Angeles")
        assert s.work_days == [0, 1, 2, 3, 4]
        assert s.work_start_time == time(9, 0)
        assert s.work_end_time == time(17, 0)

    def test_constructor_custom_params(self):
        s = Scheduler(timezone="Asia/Tokyo", work_days=[5], work_start_time=time(10,0), work_end_time=time(18,0))
        assert s.timezone == ZoneInfo("Asia/Tokyo")
        assert s.work_days == [5]
        assert s.work_start_time == time(10, 0)
        assert s.work_end_time == time(18, 0)

    def test_non_utc_input_timezone(self):
        # Test with a datetime that already has a timezone, different from scheduler's
        scheduler_la = Scheduler(timezone="America/Los_Angeles") # PST is UTC-8
        dt_london_work_start = datetime(2024, 12, 16, 17, 0, 0, tzinfo=ZoneInfo("Europe/London")) # 17:00 London = 9:00 LA
        dt_london_weekend = datetime(2024, 12, 21, 10, 0, 0, tzinfo=ZoneInfo("Europe/London")) # Sat 10:00 London = Sat 2:00 LA

        assert scheduler_la.is_workday(dt_london_work_start) == True
        assert scheduler_la.is_working_hours(dt_london_work_start) == True
        assert scheduler_la.is_during_work_time(dt_london_work_start) == True

        assert scheduler_la.is_workday(dt_london_weekend) == False
        assert scheduler_la.is_working_hours(dt_london_weekend) == False
        assert scheduler_la.is_during_work_time(dt_london_weekend) == False


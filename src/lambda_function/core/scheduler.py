from datetime import datetime, time
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

class Scheduler:
    """
    Handles scheduling logic, including determining workdays and working hours
    based on a specified timezone and configuration.
    """

    def __init__(self,
                 timezone: str = "America/Los_Angeles",
                 work_days: list[int] = None,  # 0=Monday, 6=Sunday
                 work_start_time: time = time(9, 0),
                 work_end_time: time = time(17, 0)):
        """
        Initializes the Scheduler with specific timezone, workdays, and working hours.

        Args:
            timezone (str): The IANA timezone string (e.g., "America/Los_Angeles").
                            Defaults to "America/Los_Angeles".
            work_days (list[int]): A list of integers representing workdays (0 for Monday, 6 for Sunday).
                                   Defaults to [0, 1, 2, 3, 4] (Monday to Friday).
            work_start_time (time): The start time of working hours. Defaults to 9:00 AM.
            work_end_time (time): The end time of working hours. Defaults to 5:00 PM.

        Raises:
            ZoneInfoNotFoundError: If the provided timezone string is invalid.
            ValueError: If work_start_time is not before work_end_time.
        """
        try:
            self.timezone = ZoneInfo(timezone)
        except ZoneInfoNotFoundError:
            raise ZoneInfoNotFoundError(f"Invalid timezone specified: {timezone}")

        self.work_days = work_days if work_days is not None else [0, 1, 2, 3, 4]
        self.work_start_time = work_start_time
        self.work_end_time = work_end_time

        if not (self.work_start_time < self.work_end_time):
            raise ValueError("work_start_time must be before work_end_time.")

    def _normalize_to_timezone(self, dt: datetime) -> datetime:
        """
        Normalizes a datetime to the scheduler's timezone.

        For naive datetimes, assumes the time is already in the scheduler's timezone.
        For timezone-aware datetimes, converts to the scheduler's timezone.

        Args:
            dt (datetime): The datetime to normalize.

        Returns:
            datetime: Timezone-aware datetime in the scheduler's timezone.
        """
        if dt.tzinfo is None:
            # Naive datetime: treat as scheduler's timezone
            return dt.replace(tzinfo=self.timezone)
        else:
            # Timezone-aware: convert to scheduler's timezone
            return dt.astimezone(self.timezone)

    def is_workday(self, dt: datetime) -> bool:
        """
        Checks if the given datetime falls on a configured workday in the scheduler's timezone.

        Args:
            dt (datetime): The datetime object to check. It can be timezone-aware or naive.
                           If naive, it's assumed to be in the scheduler's timezone.

        Returns:
            bool: True if it's a workday, False otherwise.
        """
        dt_in_tz = self._normalize_to_timezone(dt)
        return dt_in_tz.weekday() in self.work_days

    def is_working_hours(self, dt: datetime) -> bool:
        """
        Checks if the given datetime falls within the configured working hours
        in the scheduler's timezone.

        Args:
            dt (datetime): The datetime object to check. It can be timezone-aware or naive.
                           If naive, it's assumed to be in the scheduler's timezone.

        Returns:
            bool: True if it's within working hours, False otherwise.
        """
        dt_in_tz = self._normalize_to_timezone(dt)
        current_time = dt_in_tz.time()
        # Working hours are inclusive of start_time and exclusive of end_time
        return self.work_start_time <= current_time < self.work_end_time

    def is_during_work_time(self, dt: datetime) -> bool:
        """
        Checks if the given datetime falls on a configured workday AND within
        the configured working hours in the scheduler's timezone.

        Args:
            dt (datetime): The datetime object to check.

        Returns:
            bool: True if it's during work time, False otherwise.
        """
        # Optimize: normalize once and check both conditions
        dt_in_tz = self._normalize_to_timezone(dt)
        is_valid_day = dt_in_tz.weekday() in self.work_days
        is_valid_hours = self.work_start_time <= dt_in_tz.time() < self.work_end_time
        return is_valid_day and is_valid_hours


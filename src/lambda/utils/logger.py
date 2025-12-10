"""
Structured JSON logger for AWS Lambda.

Provides CloudWatch Logs compatible JSON output with essential fields.
"""

import logging
import json
import os
import sys
from datetime import datetime, timezone
from typing import Any


class JsonFormatter(logging.Formatter):
    """
    Custom formatter that outputs log records as JSON.

    Each log entry includes:
    - timestamp: ISO 8601 format with timezone
    - level: Log level name (INFO, ERROR, etc.)
    - name: Logger name
    - message: Log message
    """

    def format(self, record: logging.LogRecord) -> str:
        """
        Format a log record as JSON string.

        Args:
            record: LogRecord instance from Python's logging module

        Returns:
            JSON string with structured log data
        """
        # Use record.created for consistent timestamp
        timestamp = datetime.fromtimestamp(record.created, tz=timezone.utc).isoformat()

        log_entry = {
            "timestamp": timestamp,
            "level": record.levelname,
            "name": record.name,
            "message": record.getMessage(),
        }

        # Include extra fields if provided
        if hasattr(record, "extra_fields") and record.extra_fields:
            log_entry.update(record.extra_fields)

        # Include exception info if present
        if record.exc_info:
            log_entry["exception"] = self.formatException(record.exc_info)

        return json.dumps(log_entry)


class StructuredLogger:
    """
    Wrapper around Python's logging.Logger with JSON output.

    Provides standard logging methods (info, warning, error, debug)
    with automatic JSON formatting.
    """

    def __init__(self, name: str, level: int = logging.INFO):
        """
        Initialize the structured logger.

        Args:
            name: Logger name (typically module name)
            level: Logging level (default: INFO)
        """
        self._logger = logging.getLogger(name)
        self._logger.setLevel(level)

        # Only add handler if not already present (avoid duplicates)
        if not self._logger.handlers:
            # Create console handler with JSON formatter
            # Explicitly output to stdout (default is stderr)
            handler = logging.StreamHandler(sys.stdout)
            handler.setFormatter(JsonFormatter())
            self._logger.addHandler(handler)

    def _prepare_extra(self, extra: dict[str, Any] | None) -> dict[str, Any]:
        """Prepare extra fields for logging."""
        if extra:
            return {"extra_fields": extra}
        return {}

    def info(self, msg: str, extra: dict[str, Any] | None = None) -> None:
        """
        Log an info message.

        Args:
            msg: Log message
            extra: Optional dict of additional fields to include in JSON output
        """
        self._logger.info(msg, extra=self._prepare_extra(extra))

    def warning(self, msg: str, extra: dict[str, Any] | None = None) -> None:
        """
        Log a warning message.

        Args:
            msg: Log message
            extra: Optional dict of additional fields to include in JSON output
        """
        self._logger.warning(msg, extra=self._prepare_extra(extra))

    def error(
        self,
        msg: str,
        extra: dict[str, Any] | None = None,
        exc_info: bool = False,
    ) -> None:
        """
        Log an error message.

        Args:
            msg: Log message
            extra: Optional dict of additional fields to include in JSON output
            exc_info: If True, include exception traceback (default: False)
        """
        self._logger.error(msg, extra=self._prepare_extra(extra), exc_info=exc_info)

    def debug(self, msg: str, extra: dict[str, Any] | None = None) -> None:
        """
        Log a debug message.

        Args:
            msg: Log message
            extra: Optional dict of additional fields to include in JSON output
        """
        self._logger.debug(msg, extra=self._prepare_extra(extra))


def setup_logger(
    name: str = "lights-out",
    level: int | None = None,
) -> StructuredLogger:
    """
    Create and configure a structured logger.

    Reads LOG_LEVEL from environment variable if level is not provided.

    Args:
        name: Logger name (default: "lights-out")
        level: Logging level (default: read from LOG_LEVEL env var, fallback to INFO)

    Returns:
        StructuredLogger instance ready to use

    Example:
        >>> logger = setup_logger("my-module")
        >>> logger.info("Application started")
        {"timestamp": "2025-12-10T10:00:00+00:00", "level": "INFO", ...}

        >>> # With environment variable: LOG_LEVEL=DEBUG
        >>> logger = setup_logger("debug-module")  # Will use DEBUG level
    """
    if level is None:
        # Read from environment variable, fallback to INFO
        level_name = os.getenv("LOG_LEVEL", "INFO").upper()
        level = getattr(logging, level_name, logging.INFO)

    return StructuredLogger(name, level)

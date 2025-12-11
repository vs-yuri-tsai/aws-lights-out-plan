import logging
import json
from io import StringIO
from unittest.mock import patch

# Import the actual implementation
from src.lambda_function.utils.logger import setup_logger


def test_logger_outputs_json():
    """
    Test that the logger outputs messages in a valid JSON format
    and includes essential fields.
    """
    with patch('sys.stdout', new_callable=StringIO) as mock_stdout:
        logger = setup_logger(name="json_test_logger")
        test_message = "This is a test log message."
        logger.info(test_message)

        log_output = mock_stdout.getvalue().strip()
        assert log_output, "Log output should not be empty"

        try:
            log_entry = json.loads(log_output)
        except json.JSONDecodeError:
            assert False, f"Log output is not valid JSON: {log_output}"

        assert "message" in log_entry
        assert log_entry["message"] == test_message
        assert "level" in log_entry
        assert log_entry["level"] == "INFO" # Assuming INFO level for this test
        assert "timestamp" in log_entry
        assert "name" in log_entry
        assert log_entry["name"] == "json_test_logger"

"""
Test helper utilities.

Common fixtures and helper functions for testing.
"""

from unittest.mock import MagicMock


def create_mock_lambda_context(
    function_name="test-function",
    request_id="test-request-123",
    memory_limit_mb=128,
    remaining_time_ms=300000
):
    """
    Create a mock Lambda context object with proper attributes.

    This helper ensures that context objects have the expected attributes
    set to actual values instead of MagicMock objects, preventing
    JSON serialization errors.

    Args:
        function_name: Lambda function name
        request_id: AWS request ID
        memory_limit_mb: Memory limit in MB
        remaining_time_ms: Remaining execution time in milliseconds

    Returns:
        MagicMock configured as Lambda context

    Example:
        >>> context = create_mock_lambda_context()
        >>> context.aws_request_id
        'test-request-123'
    """
    context = MagicMock()
    context.function_name = function_name
    context.aws_request_id = request_id
    context.memory_limit_in_mb = memory_limit_mb
    context.get_remaining_time_in_millis.return_value = remaining_time_ms
    context.invoked_function_arn = (
        f"arn:aws:lambda:us-east-1:123456789012:function:{function_name}"
    )

    return context

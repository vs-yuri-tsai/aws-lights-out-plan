"""
Local testing script for Lambda handler.

This script allows testing the Lambda handler locally without deploying to AWS.
Useful for development and debugging.

Usage:
    python examples/lambda_local_test.py
"""

from unittest.mock import MagicMock
from src.lambda_function.app import handler


def create_mock_context(
    function_name="lights-out-local",
    request_id="local-test-123"
):
    """
    Create a mock Lambda context object.

    Args:
        function_name: Lambda function name
        request_id: Request ID

    Returns:
        Mock context object
    """
    context = MagicMock()
    context.function_name = function_name
    context.aws_request_id = request_id
    context.invoked_function_arn = f"arn:aws:lambda:us-east-1:123456789012:function:{function_name}"
    context.memory_limit_in_mb = 128
    context.remaining_time_in_millis = lambda: 300000

    return context


def test_discover_action():
    """
    Test discover action locally.

    Note: This will fail if AWS credentials are not configured,
    as it attempts to call real AWS APIs.
    """
    print("=== Testing DISCOVER action ===")

    event = {
        "action": "discover"
    }
    context = create_mock_context()

    try:
        response = handler(event, context)
        print(f"Status Code: {response['statusCode']}")
        print(f"Response Body:\n{response['body']}\n")
    except Exception as e:
        print(f"Error: {e}\n")


def test_status_action():
    """
    Test status action locally.
    """
    print("=== Testing STATUS action ===")

    event = {
        "action": "status"
    }
    context = create_mock_context()

    try:
        response = handler(event, context)
        print(f"Status Code: {response['statusCode']}")
        print(f"Response Body:\n{response['body']}\n")
    except Exception as e:
        print(f"Error: {e}\n")


def test_invalid_action():
    """
    Test invalid action handling.
    """
    print("=== Testing INVALID action ===")

    event = {
        "action": "delete"  # Invalid action
    }
    context = create_mock_context()

    try:
        response = handler(event, context)
        print(f"Status Code: {response['statusCode']}")
        print(f"Response Body:\n{response['body']}\n")
    except Exception as e:
        print(f"Error: {e}\n")


def test_missing_action():
    """
    Test missing action (should default to 'status').
    """
    print("=== Testing MISSING action (defaults to status) ===")

    event = {}  # No action specified
    context = create_mock_context()

    try:
        response = handler(event, context)
        print(f"Status Code: {response['statusCode']}")
        print(f"Response Body:\n{response['body']}\n")
    except Exception as e:
        print(f"Error: {e}\n")


if __name__ == "__main__":
    print("""
╔══════════════════════════════════════════════════════════════╗
║         AWS Lights Out Plan - Local Lambda Test             ║
╚══════════════════════════════════════════════════════════════╝

This script tests the Lambda handler locally.

IMPORTANT:
- Ensure virtual environment is activated
- AWS credentials must be configured
- SSM parameter '/lights-out/config' must exist

To run unit tests instead (recommended for CI/CD):
    pytest tests/unit/test_app.py -v

""")

    # Test invalid action (should work without AWS)
    test_invalid_action()

    # Test missing action (should work without AWS in error case)
    test_missing_action()

    print("""
The following tests require:
1. Valid AWS credentials
2. SSM parameter '/lights-out/config' exists
3. Tagged resources in your AWS account

Uncomment to run:
""")

    # Uncomment to test with real AWS (requires setup)
    # test_discover_action()
    # test_status_action()

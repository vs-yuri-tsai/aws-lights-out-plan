"""
Global pytest configuration for all tests.

Provides shared fixtures to prevent test isolation issues.
"""

import os
import pytest

@pytest.fixture(scope="function", autouse=True)
def aws_credentials():
    """
    Set mock AWS credentials for all tests.

    This prevents boto3 from looking for real credentials and ensures
    consistent environment across all test modules.
    """
    os.environ['AWS_ACCESS_KEY_ID'] = 'testing'
    os.environ['AWS_SECRET_ACCESS_KEY'] = 'testing'
    os.environ['AWS_SECURITY_TOKEN'] = 'testing'
    os.environ['AWS_SESSION_TOKEN'] = 'testing'
    os.environ['AWS_DEFAULT_REGION'] = 'ap-southeast-1'
    yield
    # Cleanup not needed - os.environ changes are isolated per test by pytest

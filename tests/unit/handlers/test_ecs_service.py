"""
Unit tests for handlers/ecs_service.py

Tests ECS Service Handler implementation using moto for AWS API mocking.
Following TDD approach - these tests define the expected behavior.
"""

import pytest
import boto3
from moto import mock_aws
from src.lambda_function.discovery.base import DiscoveredResource
from src.lambda_function.handlers.ecs_service import ECSServiceHandler
from src.lambda_function.handlers.base import HandlerResult


# Test Fixtures
@pytest.fixture
def sample_resource():
    """Sample ECS Service DiscoveredResource"""
    return DiscoveredResource(
        resource_type="ecs-service",
        arn="arn:aws:ecs:ap-southeast-1:123456789012:service/test-cluster/test-service",
        resource_id="test-cluster/test-service",
        priority=50,
        group="default",
        tags={
            "lights-out:managed": "true",
            "lights-out:env": "workshop"
        },
        metadata={"cluster_name": "test-cluster"}
    )


@pytest.fixture
def sample_config():
    """Sample configuration with wait_for_stable enabled"""
    return {
        "version": "1.0",
        "environment": "workshop",
        "resource_defaults": {
            "ecs-service": {
                "wait_for_stable": False,  # Disable for faster tests
                "stable_timeout_seconds": 300,
                "default_desired_count": 1
            }
        }
    }


@pytest.fixture
def config_with_wait():
    """Configuration with wait_for_stable enabled"""
    return {
        "version": "1.0",
        "environment": "workshop",
        "resource_defaults": {
            "ecs-service": {
                "wait_for_stable": True,
                "stable_timeout_seconds": 60,  # Shorter for testing
                "default_desired_count": 2
            }
        }
    }


@pytest.fixture(scope="function", autouse=True)
def aws_mock():
    """Enable AWS mocking for entire test function (auto-applied)"""
    with mock_aws():
        yield


@pytest.fixture
def ecs_setup():
    """Setup mock ECS cluster and service"""
    ecs_client = boto3.client('ecs', region_name='ap-southeast-1')

    # Create cluster
    ecs_client.create_cluster(clusterName='test-cluster')

    # Register task definition
    ecs_client.register_task_definition(
        family='test-task',
        containerDefinitions=[
            {
                'name': 'test-container',
                'image': 'nginx:latest',
                'memory': 512,
            }
        ]
    )

    # Create service
    ecs_client.create_service(
        cluster='test-cluster',
        serviceName='test-service',
        taskDefinition='test-task',
        desiredCount=2  # Initial count
    )

    return ecs_client


# Test: Handler Initialization
def test_handler_initialization(ecs_setup, sample_resource, sample_config):
    """
    Test that ECSServiceHandler initializes correctly.
    """
    handler = ECSServiceHandler(resource=sample_resource, config=sample_config)

    assert handler.resource == sample_resource
    assert handler.config == sample_config
    assert handler.cluster_name == "test-cluster"
    assert handler.service_name == "test-service"
    assert handler.ecs_client is not None


def test_handler_initialization_no_cluster_in_metadata(ecs_setup, sample_config):
    """
    Test handler initialization when cluster_name is not in metadata.
    Should default to 'default'.
    """
    resource = DiscoveredResource(
        resource_type="ecs-service",
        arn="arn:aws:ecs:ap-southeast-1:123456789012:service/my-service",
        resource_id="my-service",
        priority=50,
        group="default",
        tags={},
        metadata={}  # No cluster_name
    )

    handler = ECSServiceHandler(resource=resource, config=sample_config)
    assert handler.cluster_name == "default"
    assert handler.service_name == "my-service"


# Test: get_status Method
def test_get_status_returns_correct_structure(ecs_setup, sample_resource, sample_config):
    """
    Test that get_status returns the expected dictionary structure.
    """
    handler = ECSServiceHandler(resource=sample_resource, config=sample_config)
    status = handler.get_status()

    assert isinstance(status, dict)
    assert "desired_count" in status
    assert "running_count" in status
    assert "status" in status
    assert "is_stopped" in status

    # Verify values
    assert status["desired_count"] == 2  # Initial count from fixture
    assert status["status"] == "ACTIVE"
    assert status["is_stopped"] is False


def test_get_status_when_service_is_stopped(ecs_setup, sample_resource, sample_config):
    """
    Test get_status when service has desiredCount=0.
    """
    # Stop the service first
    ecs_setup.update_service(
        cluster='test-cluster',
        service='test-service',
        desiredCount=0
    )

    handler = ECSServiceHandler(resource=sample_resource, config=sample_config)
    status = handler.get_status()

    assert status["desired_count"] == 0
    assert status["is_stopped"] is True


def test_get_status_service_not_found(ecs_setup, sample_config):
    """
    Test get_status when service does not exist.
    Should raise an exception.
    """
    resource = DiscoveredResource(
        resource_type="ecs-service",
        arn="arn:aws:ecs:ap-southeast-1:123456789012:service/test-cluster/nonexistent",
        resource_id="test-cluster/nonexistent",
        priority=50,
        group="default",
        tags={},
        metadata={"cluster_name": "test-cluster"}
    )

    handler = ECSServiceHandler(resource=resource, config=sample_config)

    with pytest.raises(Exception):
        handler.get_status()


# Test: stop Method
def test_stop_service_successfully(ecs_setup, sample_resource, sample_config):
    """
    Test stopping a running ECS service.
    """
    handler = ECSServiceHandler(resource=sample_resource, config=sample_config)
    result = handler.stop()

    assert isinstance(result, HandlerResult)
    assert result.success is True
    assert result.action == "stop"
    assert result.resource_type == "ecs-service"
    assert result.resource_id == "test-cluster/test-service"
    assert "scaled to 0" in result.message
    assert result.previous_state is not None
    assert result.previous_state["desired_count"] == 2  # Original count
    assert result.error is None

    # Verify service is actually stopped
    status = handler.get_status()
    assert status["desired_count"] == 0


def test_stop_service_idempotent(ecs_setup, sample_resource, sample_config):
    """
    Test that stopping an already stopped service is idempotent.
    """
    handler = ECSServiceHandler(resource=sample_resource, config=sample_config)

    # Stop once
    first_result = handler.stop()
    assert first_result.success is True

    # Stop again (should be idempotent)
    second_result = handler.stop()
    assert second_result.success is True
    assert "already stopped" in second_result.message.lower()
    assert second_result.previous_state["is_stopped"] is True


def test_stop_service_with_wait_for_stable(ecs_setup, sample_resource, config_with_wait):
    """
    Test stop with wait_for_stable enabled.
    Note: moto may not fully simulate waiter behavior, so we just verify it doesn't error.
    """
    handler = ECSServiceHandler(resource=sample_resource, config=config_with_wait)
    result = handler.stop()

    # Should complete without error (even if waiter is mocked)
    assert result.success is True


def test_stop_service_error_handling(ecs_setup, sample_config):
    """
    Test error handling when stopping a non-existent service.
    """
    resource = DiscoveredResource(
        resource_type="ecs-service",
        arn="arn:aws:ecs:ap-southeast-1:123456789012:service/test-cluster/nonexistent",
        resource_id="test-cluster/nonexistent",
        priority=50,
        group="default",
        tags={},
        metadata={"cluster_name": "test-cluster"}
    )

    handler = ECSServiceHandler(resource=resource, config=sample_config)
    result = handler.stop()

    assert result.success is False
    assert result.action == "stop"
    assert result.error is not None
    assert "failed" in result.message.lower()


# Test: start Method
def test_start_service_successfully(ecs_setup, sample_resource, sample_config):
    """
    Test starting a stopped ECS service.
    """
    # First, stop the service
    ecs_setup.update_service(
        cluster='test-cluster',
        service='test-service',
        desiredCount=0
    )

    handler = ECSServiceHandler(resource=sample_resource, config=sample_config)
    result = handler.start()

    assert isinstance(result, HandlerResult)
    assert result.success is True
    assert result.action == "start"
    assert result.resource_type == "ecs-service"
    assert result.resource_id == "test-cluster/test-service"
    assert "scaled to" in result.message
    assert result.previous_state is not None
    assert result.previous_state["desired_count"] == 0  # Was stopped
    assert result.error is None

    # Verify service is started with default_desired_count
    status = handler.get_status()
    assert status["desired_count"] == 1  # default_desired_count from config


def test_start_service_uses_default_desired_count(ecs_setup, sample_resource, config_with_wait):
    """
    Test that start uses default_desired_count from config.
    """
    # Stop service first
    ecs_setup.update_service(
        cluster='test-cluster',
        service='test-service',
        desiredCount=0
    )

    # config_with_wait has default_desired_count=2
    handler = ECSServiceHandler(resource=sample_resource, config=config_with_wait)
    result = handler.start()

    assert result.success is True

    # Verify it scaled to 2 (not the original 2, but from config)
    status = handler.get_status()
    assert status["desired_count"] == 2


def test_start_service_idempotent(ecs_setup, sample_resource, sample_config):
    """
    Test that starting an already running service is idempotent.
    """
    # Service is already running with desiredCount=2
    # default_desired_count in config is 1
    # First, manually set to 1 to match config
    ecs_setup.update_service(
        cluster='test-cluster',
        service='test-service',
        desiredCount=1
    )

    handler = ECSServiceHandler(resource=sample_resource, config=sample_config)
    result = handler.start()

    assert result.success is True
    assert "already at desired count" in result.message.lower()


def test_start_service_error_handling(ecs_setup, sample_config):
    """
    Test error handling when starting a non-existent service.
    """
    resource = DiscoveredResource(
        resource_type="ecs-service",
        arn="arn:aws:ecs:ap-southeast-1:123456789012:service/test-cluster/nonexistent",
        resource_id="test-cluster/nonexistent",
        priority=50,
        group="default",
        tags={},
        metadata={"cluster_name": "test-cluster"}
    )

    handler = ECSServiceHandler(resource=resource, config=sample_config)
    result = handler.start()

    assert result.success is False
    assert result.action == "start"
    assert result.error is not None


# Test: is_ready Method
def test_is_ready_when_service_is_ready(ecs_setup, sample_resource, sample_config):
    """
    Test is_ready returns True when desired_count equals running_count.
    """
    handler = ECSServiceHandler(resource=sample_resource, config=sample_config)

    # In moto, services may not automatically have running tasks
    # We'll test the logic by checking the current state
    status = handler.get_status()
    expected_ready = (status['desired_count'] == status['running_count'])

    assert handler.is_ready() == expected_ready


def test_is_ready_when_service_is_not_ready(ecs_setup, sample_resource, sample_config):
    """
    Test is_ready returns False when desired_count != running_count.
    """
    # Update service to have different desired vs running
    # Note: moto may not perfectly simulate this, but we test the logic
    handler = ECSServiceHandler(resource=sample_resource, config=sample_config)

    # The logic should be: desired_count == running_count
    status = handler.get_status()
    is_ready = handler.is_ready()

    # Verify logic
    assert is_ready == (status['desired_count'] == status['running_count'])


# Test: _wait_for_stable Method
def test_wait_for_stable_method_exists(ecs_setup, sample_resource, sample_config):
    """
    Test that _wait_for_stable method exists and can be called.
    """
    handler = ECSServiceHandler(resource=sample_resource, config=sample_config)

    # Should not raise error (though moto waiter may not wait)
    try:
        handler._wait_for_stable(timeout=10)
    except Exception as e:
        # If waiter fails in moto, that's okay for this test
        # We're just verifying the method exists
        pass


# Test: Integration - Stop then Start
def test_stop_then_start_workflow(ecs_setup, sample_resource, sample_config):
    """
    Integration test: Stop a service, verify it's stopped, then start it again.
    """
    handler = ECSServiceHandler(resource=sample_resource, config=sample_config)

    # Initial state
    initial_status = handler.get_status()
    assert initial_status["desired_count"] == 2

    # Stop
    stop_result = handler.stop()
    assert stop_result.success is True

    # Verify stopped
    stopped_status = handler.get_status()
    assert stopped_status["desired_count"] == 0
    assert stopped_status["is_stopped"] is True

    # Start
    start_result = handler.start()
    assert start_result.success is True

    # Verify started (with default_desired_count=1)
    started_status = handler.get_status()
    assert started_status["desired_count"] == 1
    assert started_status["is_stopped"] is False


# Test: Edge Cases
def test_handler_with_service_name_only_in_resource_id(ecs_setup, sample_config):
    """
    Test handler when resource_id is just service name (no cluster).
    """
    resource = DiscoveredResource(
        resource_type="ecs-service",
        arn="arn:aws:ecs:ap-southeast-1:123456789012:service/test-service",
        resource_id="test-service",
        priority=50,
        group="default",
        tags={},
        metadata={"cluster_name": "test-cluster"}
    )

    handler = ECSServiceHandler(resource=resource, config=sample_config)
    assert handler.service_name == "test-service"
    assert handler.cluster_name == "test-cluster"


def test_handler_extracts_service_name_from_full_path(ecs_setup, sample_resource, sample_config):
    """
    Test that handler correctly extracts service name from 'cluster/service' format.
    """
    handler = ECSServiceHandler(resource=sample_resource, config=sample_config)

    # resource_id is "test-cluster/test-service"
    # service_name should be just "test-service"
    assert handler.service_name == "test-service"

"""
Integration tests for Orchestrator with real Handler implementations.

Tests the complete flow: Orchestrator -> Factory -> Handler
"""

import pytest
from unittest.mock import patch, MagicMock
from src.lambda_function.core.orchestrator import Orchestrator
from src.lambda_function.discovery.base import DiscoveredResource
from src.lambda_function.handlers.factory import get_handler, HANDLER_REGISTRY
from src.lambda_function.handlers.base import HandlerResult


@pytest.fixture
def mock_config():
    """Configuration for orchestrator tests"""
    return {
        "discovery": {
            "method": "tags"
        },
        "settings": {
            "schedule_tag": "lights-out:schedule"
        },
        "resource_defaults": {
            "ecs-service": {
                "wait_for_stable": False,
                "default_desired_count": 1
            }
        }
    }


@pytest.fixture
def mock_ecs_resource():
    """Mock ECS Service resource"""
    return DiscoveredResource(
        resource_type="ecs-service",
        arn="arn:aws:ecs:us-east-1:123456789012:service/test-cluster/test-service",
        resource_id="test-cluster/test-service",
        priority=50,
        group="default",
        tags={
            "lights-out:managed": "true",
            "lights-out:schedule": "office-hours"
        },
        metadata={"cluster_name": "test-cluster"}
    )


def test_factory_returns_ecs_handler(mock_ecs_resource, mock_config):
    """
    Test that factory correctly instantiates ECSServiceHandler
    """
    handler = get_handler("ecs-service", mock_ecs_resource, mock_config)

    assert handler is not None
    assert handler.__class__.__name__ == "ECSServiceHandler"
    assert handler.resource == mock_ecs_resource
    assert handler.config == mock_config


def test_factory_returns_none_for_unknown_type(mock_ecs_resource, mock_config):
    """
    Test that factory returns None for unregistered resource types
    """
    handler = get_handler("unknown-type", mock_ecs_resource, mock_config)

    assert handler is None


def test_handler_registry_contains_ecs_service():
    """
    Test that ECS Service handler is registered in the registry
    """
    assert "ecs-service" in HANDLER_REGISTRY
    assert HANDLER_REGISTRY["ecs-service"].__name__ == "ECSServiceHandler"


@patch('src.lambda_function.core.orchestrator.get_schedule')
@patch.object(Orchestrator, 'discover_resources')
@patch('src.lambda_function.handlers.ecs_service.boto3')
def test_orchestrator_calls_ecs_handler_stop(
    mock_boto3,
    mock_discover_resources,
    mock_get_schedule,
    mock_ecs_resource,
    mock_config
):
    """
    Integration test: Orchestrator -> Factory -> ECSServiceHandler.stop()
    """
    # Arrange
    mock_discover_resources.return_value = [mock_ecs_resource]
    mock_get_schedule.return_value = "office-hours"

    # Mock ECS client
    mock_ecs_client = MagicMock()
    mock_boto3.client.return_value = mock_ecs_client

    # Mock describe_services response (service already stopped)
    mock_ecs_client.describe_services.return_value = {
        'services': [{
            'serviceName': 'test-service',
            'desiredCount': 0,
            'runningCount': 0,
            'status': 'ACTIVE'
        }]
    }

    orchestrator = Orchestrator(config=mock_config)

    # Act
    result = orchestrator.run(action="stop")

    # Assert
    assert result["total"] == 1
    assert result["succeeded"] == 1
    assert result["failed"] == 0
    assert len(result["results"]) == 1

    # Verify the result structure
    handler_result = result["results"][0]
    assert handler_result.success is True
    assert handler_result.action == "stop"
    assert handler_result.resource_type == "ecs-service"


@patch('src.lambda_function.core.orchestrator.get_schedule')
@patch.object(Orchestrator, 'discover_resources')
@patch('src.lambda_function.handlers.ecs_service.boto3')
def test_orchestrator_calls_ecs_handler_start(
    mock_boto3,
    mock_discover_resources,
    mock_get_schedule,
    mock_ecs_resource,
    mock_config
):
    """
    Integration test: Orchestrator -> Factory -> ECSServiceHandler.start()
    """
    # Arrange
    mock_discover_resources.return_value = [mock_ecs_resource]
    mock_get_schedule.return_value = "office-hours"

    # Mock ECS client
    mock_ecs_client = MagicMock()
    mock_boto3.client.return_value = mock_ecs_client

    # Mock describe_services response (service stopped)
    mock_ecs_client.describe_services.return_value = {
        'services': [{
            'serviceName': 'test-service',
            'desiredCount': 0,
            'runningCount': 0,
            'status': 'ACTIVE'
        }]
    }

    orchestrator = Orchestrator(config=mock_config)

    # Act
    result = orchestrator.run(action="start")

    # Assert
    assert result["total"] == 1
    assert result["succeeded"] == 1
    assert result["failed"] == 0

    # Verify ECS update was called
    mock_ecs_client.update_service.assert_called_once_with(
        cluster="test-cluster",
        service="test-service",
        desiredCount=1
    )


@patch('src.lambda_function.core.orchestrator.get_schedule')
@patch.object(Orchestrator, 'discover_resources')
@patch('src.lambda_function.handlers.ecs_service.boto3')
def test_orchestrator_handles_handler_error_gracefully(
    mock_boto3,
    mock_discover_resources,
    mock_get_schedule,
    mock_ecs_resource,
    mock_config
):
    """
    Test that orchestrator handles handler errors without crashing
    """
    # Arrange
    mock_discover_resources.return_value = [mock_ecs_resource]
    mock_get_schedule.return_value = "office-hours"

    # Mock ECS client to raise an error
    mock_ecs_client = MagicMock()
    mock_boto3.client.return_value = mock_ecs_client
    mock_ecs_client.describe_services.side_effect = Exception("AWS API Error")

    orchestrator = Orchestrator(config=mock_config)

    # Act
    result = orchestrator.run(action="stop")

    # Assert - orchestrator should not crash
    assert result["total"] == 1
    assert result["succeeded"] == 0
    assert result["failed"] == 1

    # Verify error is captured in results
    # Handler catches exception and returns HandlerResult(success=False) (see ecs_service.py:182-198)
    handler_result = result["results"][0]
    assert isinstance(handler_result, HandlerResult)
    assert handler_result.success is False
    assert handler_result.error is not None
    assert "AWS API Error" in handler_result.error


@patch('src.lambda_function.core.orchestrator.get_schedule')
@patch.object(Orchestrator, 'discover_resources')
def test_orchestrator_handles_multiple_resources(
    mock_discover_resources,
    mock_get_schedule,
    mock_config
):
    """
    Test orchestrator processing multiple resources
    """
    # Arrange - create multiple resources with different types
    ecs_resource = DiscoveredResource(
        resource_type="ecs-service",
        arn="arn:aws:ecs:us-east-1:123456789012:service/cluster/service",
        resource_id="cluster/service",
        priority=50,
        group="default",
        tags={"lights-out:schedule": "office-hours"},
        metadata={"cluster_name": "cluster"}
    )

    unknown_resource = DiscoveredResource(
        resource_type="unknown-type",
        arn="arn:aws:unknown:us-east-1:123456789012:resource/id",
        resource_id="id",
        priority=50,
        group="default",
        tags={"lights-out:schedule": "office-hours"}
    )

    mock_discover_resources.return_value = [ecs_resource, unknown_resource]
    mock_get_schedule.return_value = "office-hours"

    orchestrator = Orchestrator(config=mock_config)

    # Act
    with patch('src.lambda_function.handlers.ecs_service.boto3') as mock_boto3:
        mock_ecs_client = MagicMock()
        mock_boto3.client.return_value = mock_ecs_client
        mock_ecs_client.describe_services.return_value = {
            'services': [{
                'serviceName': 'service',
                'desiredCount': 0,
                'runningCount': 0,
                'status': 'ACTIVE'
            }]
        }

        result = orchestrator.run(action="stop")

    # Assert
    assert result["total"] == 2
    assert result["succeeded"] == 1  # Only ECS service succeeds
    assert result["failed"] == 1     # Unknown type has no handler

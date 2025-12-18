import pytest
from unittest.mock import patch, MagicMock
from src.lambda_function.core.orchestrator import Orchestrator
from src.lambda_function.discovery.base import DiscoveredResource


def test_orchestrator_initialization():
    """
    Test that the Orchestrator can be initialized.
    """
    orchestrator = Orchestrator({})
    assert isinstance(orchestrator, Orchestrator)

def test_orchestrator_stores_config():
    """
    Test that the orchestrator stores the configuration.
    """
    mock_config = {"discovery": {"method": "tags"}}
    orchestrator = Orchestrator(config=mock_config)
    assert orchestrator.config == mock_config

@patch('src.lambda_function.core.orchestrator.TagDiscovery')
def test_discover_resources_uses_tag_discovery(mock_tag_discovery):
    """
    Test that discover_resources uses TagDiscovery when the config specifies 'tags'.
    """
    # Arrange
    mock_config = {
        "discovery": {
            "method": "tags",
            "tag_filters": {"key": "value"}
        }
    }
    orchestrator = Orchestrator(config=mock_config)
    mock_discovery_instance = mock_tag_discovery.return_value
    mock_discovery_instance.discover.return_value = ["resource1", "resource2"]

    # Act
    resources = orchestrator.discover_resources()

    # Assert
    mock_tag_discovery.assert_called_once_with(mock_config)
    mock_discovery_instance.discover.assert_called_once()
    assert resources == ["resource1", "resource2"]

def test_discover_resources_with_unknown_method():
    """
    Test that discover_resources returns an empty list for an unknown discovery method.
    """
    # Arrange
    mock_config = {
        "discovery": {
            "method": "unknown"
        }
    }
    orchestrator = Orchestrator(config=mock_config)

    # Act
    resources = orchestrator.discover_resources()

    # Assert
    assert resources == []

@patch('src.lambda_function.core.orchestrator.get_schedule')
@patch('src.lambda_function.core.orchestrator.get_handler')
@patch.object(Orchestrator, 'discover_resources')
def test_run_calls_scheduler_for_each_resource(mock_discover_resources, mock_get_handler, mock_get_schedule):
    """
    Test that the run method calls the scheduler for each discovered resource.
    """
    # Arrange
    mock_config = {"settings": {"schedule_tag": "schedule"}}
    mock_resource = DiscoveredResource(
        resource_type="ec2",
        arn="arn:aws:ec2:us-east-1:123456789012:instance/i-123",
        resource_id="i-123",
        priority=50,
        group="default",
        tags={"schedule": "some_schedule"}
    )

    mock_discover_resources.return_value = [mock_resource]
    mock_get_schedule.return_value = "some_schedule"

    mock_handler = MagicMock()
    mock_handler.stop.return_value = MagicMock(success=True)
    mock_get_handler.return_value = mock_handler

    orchestrator = Orchestrator(config=mock_config)

    # Act
    result = orchestrator.run(action="stop")

    # Assert
    mock_discover_resources.assert_called_once()
    mock_get_schedule.assert_called_once_with(mock_resource, "schedule")
    assert result["total"] == 1
    assert result["succeeded"] == 1

@patch('src.lambda_function.core.orchestrator.get_handler')
@patch('src.lambda_function.core.orchestrator.get_schedule')
@patch.object(Orchestrator, 'discover_resources')
def test_run_calls_handler_for_resource(mock_discover_resources, mock_get_schedule, mock_get_handler):
    """
    Test that the run method calls the correct handler for a discovered resource.
    """
    # Arrange
    mock_config = {"settings": {"schedule_tag": "schedule"}}
    mock_resource = DiscoveredResource(
        resource_type="ec2",
        arn="arn:aws:ec2:us-east-1:123456789012:instance/i-123",
        resource_id="i-123",
        priority=50,
        group="default",
        tags={"schedule": "some_schedule"}
    )

    mock_discover_resources.return_value = [mock_resource]
    mock_get_schedule.return_value = "some_schedule"

    mock_handler = MagicMock()
    mock_handler.start.return_value = MagicMock(success=True)
    mock_get_handler.return_value = mock_handler

    orchestrator = Orchestrator(config=mock_config)

    # Act
    result = orchestrator.run(action="start")

    # Assert
    mock_get_handler.assert_called_once_with("ec2", mock_resource, mock_config)
    mock_handler.start.assert_called_once()
    assert result["total"] == 1
    assert result["succeeded"] == 1
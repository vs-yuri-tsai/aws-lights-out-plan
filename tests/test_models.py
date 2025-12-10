"""Tests for core models."""
import sys
from pathlib import Path

import pytest

# Add src to path
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from lights_out.core.models import (
    ActionResult,
    ActionType,
    LightsOutConfig,
    Resource,
    ResourceConfig,
    ResourceType,
)


def test_resource_type_enum():
    """Test ResourceType enum values."""
    assert ResourceType.EC2 == "ec2"
    assert ResourceType.RDS == "rds"
    assert ResourceType.ASG == "asg"


def test_action_type_enum():
    """Test ActionType enum values."""
    assert ActionType.START == "start"
    assert ActionType.STOP == "stop"


def test_resource_config_default():
    """Test ResourceConfig with defaults."""
    config = ResourceConfig(resource_type=ResourceType.EC2, priority=1)
    assert config.resource_type == ResourceType.EC2
    assert config.priority == 1
    assert config.enabled is True


def test_resource_config_priority_validation():
    """Test ResourceConfig priority must be non-negative."""
    with pytest.raises(Exception):  # pydantic ValidationError
        ResourceConfig(resource_type=ResourceType.EC2, priority=-1)


def test_lights_out_config_defaults():
    """Test LightsOutConfig default values."""
    config = LightsOutConfig()
    assert config.tag_key == "LightsOut"
    assert config.tag_value == "enabled"
    assert config.dry_run is False
    assert len(config.resources) == 3
    
    # Check default priorities
    priorities = {r.resource_type: r.priority for r in config.resources}
    assert priorities[ResourceType.RDS] == 1
    assert priorities[ResourceType.EC2] == 2
    assert priorities[ResourceType.ASG] == 3


def test_lights_out_config_custom():
    """Test LightsOutConfig with custom values."""
    config = LightsOutConfig(
        tag_key="CustomTag",
        tag_value="custom",
        dry_run=True,
        resources=[
            ResourceConfig(resource_type=ResourceType.EC2, priority=5)
        ]
    )
    assert config.tag_key == "CustomTag"
    assert config.tag_value == "custom"
    assert config.dry_run is True
    assert len(config.resources) == 1


def test_resource_model():
    """Test Resource model."""
    resource = Resource(
        resource_id="i-12345",
        resource_type=ResourceType.EC2,
        resource_arn="arn:aws:ec2:us-east-1:123456789012:instance/i-12345",
        tags={"Name": "TestInstance", "LightsOut": "enabled"},
        priority=2,
        region="us-east-1"
    )
    assert resource.resource_id == "i-12345"
    assert resource.resource_type == ResourceType.EC2
    assert resource.priority == 2
    assert resource.tags["Name"] == "TestInstance"


def test_action_result_model():
    """Test ActionResult model."""
    result = ActionResult(
        resource_id="i-12345",
        resource_type=ResourceType.EC2,
        action=ActionType.START,
        success=True,
        message="Instance started",
        dry_run=False
    )
    assert result.resource_id == "i-12345"
    assert result.action == ActionType.START
    assert result.success is True
    assert result.dry_run is False


def test_action_result_dry_run():
    """Test ActionResult with dry_run flag."""
    result = ActionResult(
        resource_id="i-12345",
        resource_type=ResourceType.EC2,
        action=ActionType.STOP,
        success=True,
        message="DRY RUN: Would stop instance",
        dry_run=True
    )
    assert result.dry_run is True

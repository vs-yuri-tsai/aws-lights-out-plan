import pytest
from typing import List, Dict, Any
from src.lambda_function.discovery.base import DiscoveredResource, ResourceDiscovery


def test_discovered_resource_creation():
    """
    Tests the creation of a DiscoveredResource instance based on AGENTS.md spec.
    """
    resource_data = {
        "resource_type": "ecs-service",
        "arn": "arn:aws:ecs:ap-southeast-1:123456789012:service/my-cluster/my-service",
        "resource_id": "my-cluster/my-service",
        "priority": 50,
        "group": "default",
        "tags": {"Name": "my-service", "lights-out:managed": "true"},
        "metadata": {"cluster": "my-cluster"}
    }
    resource = DiscoveredResource(**resource_data)

    assert resource.resource_type == "ecs-service"
    assert resource.arn == "arn:aws:ecs:ap-southeast-1:123456789012:service/my-cluster/my-service"
    assert resource.resource_id == "my-cluster/my-service"
    assert resource.priority == 50
    assert resource.group == "default"
    assert resource.tags == {"Name": "my-service", "lights-out:managed": "true"}
    assert resource.metadata == {"cluster": "my-cluster"}


class MockDiscovery(ResourceDiscovery):
    """
    A mock implementation of the ResourceDiscovery interface for testing.
    """
    def __init__(self, resources_to_return: List[DiscoveredResource]):
        self.resources = resources_to_return

    def discover(self) -> List[DiscoveredResource]:
        return self.resources

def test_resource_discovery_interface():
    """
    Tests a mock implementation of the ResourceDiscovery interface.
    """
    res1 = DiscoveredResource(
        resource_type="test",
        arn="arn:test:1",
        resource_id="res-1",
        priority=100,
        group="group1",
        tags={},
        metadata={}
    )
    res2 = DiscoveredResource(
        resource_type="test",
        arn="arn:test:2",
        resource_id="res-2",
        priority=50,
        group="group2",
        tags={"Project": "lights-out"},
        metadata={}
    )
    
    mock_resources = [res1, res2]
    
    discovery_service = MockDiscovery(resources_to_return=mock_resources)
    
    discovered_resources = discovery_service.discover()
    
    assert discovered_resources == mock_resources
    assert len(discovered_resources) == 2
    assert discovered_resources[0].resource_id == "res-1"
    assert discovered_resources[1].tags == {"Project": "lights-out"}

def test_resource_discovery_abstract_method():
    """
    Tests that instantiating ResourceDiscovery directly raises a TypeError.
    """
    with pytest.raises(TypeError, match="Can't instantiate abstract class ResourceDiscovery with abstract method discover"):
        ResourceDiscovery()

from dataclasses import dataclass, field
from typing import List, Dict, Any
from abc import ABC, abstractmethod

@dataclass
class DiscoveredResource:
    """
    Represents a discovered resource that is managed by the lights-out plan.
    This is a data structure, not an entity with behavior.
    """
    resource_type: str      # e.g. "ecs-service", "nat-gateway"
    arn: str                # Full AWS ARN for unique identification
    resource_id: str        # Human-readable ID (e.g., cluster/service, ngw-id)
    priority: int           # From tag 'lights-out:priority', default 50
    group: str              # Schedule group from tag 'lights-out:group', default 'default'
    tags: Dict[str, str]
    metadata: Dict[str, Any] = field(default_factory=dict) # For handler-specific data

class ResourceDiscovery(ABC):
    """
    Abstract base class for resource discovery strategies.
    Implementations of this interface will be responsible for finding resources
    that should be managed by the lights-out scheduler.
    """

    @abstractmethod
    def discover(self) -> List[DiscoveredResource]:
        """
        Discover resources based on a specific strategy (e.g., tags, CloudFormation stacks).

        Returns:
            A list of DiscoveredResource objects.
        """
        raise NotImplementedError

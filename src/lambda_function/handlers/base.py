"""
Abstract base class for resource handlers.

Defines the common interface that all concrete resource handlers must implement.
Each handler is responsible for performing start, stop, and status operations
on a specific AWS resource type (e.g., ECS Service, NAT Gateway).
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Dict, Any, Optional

from src.lambda_function.discovery.base import DiscoveredResource
from src.lambda_function.utils.logger import setup_logger


@dataclass
class HandlerResult:
    """
    Standardized result structure for handler operations.

    This dataclass represents the outcome of a handler operation (start/stop)
    and is used by the orchestrator to aggregate results.

    Attributes:
        success: Whether the operation succeeded
        action: The action performed ("start" or "stop")
        resource_type: Type of resource (e.g., "ecs-service")
        resource_id: Human-readable resource identifier
        message: Human-readable message describing the result
        previous_state: Optional dict containing the resource state before operation
        error: Optional error message if the operation failed
    """
    success: bool
    action: str
    resource_type: str
    resource_id: str
    message: str
    previous_state: Optional[Dict[str, Any]] = None
    error: Optional[str] = None


class ResourceHandler(ABC):
    """
    Abstract base class for resource handlers.

    This class defines the common interface that all concrete resource
    handlers must implement. Each handler is responsible for performing
    specific actions on a given resource.

    Subclasses must implement:
        - get_status(): Retrieve current resource state
        - start(): Start/enable the resource
        - stop(): Stop/disable the resource
        - is_ready(): Check if resource has reached desired state
    """

    def __init__(self, resource: DiscoveredResource, config: Dict[str, Any]):
        """
        Initialize the handler with a specific resource and configuration.

        Args:
            resource: The discovered resource to be handled
            config: Configuration dictionary from SSM Parameter Store,
                    containing resource_defaults and other settings
        """
        self.resource = resource
        self.config = config
        self.logger = setup_logger(f"handler.{resource.resource_type}")

    @abstractmethod
    def get_status(self) -> Dict[str, Any]:
        """
        Retrieve the current status of the resource.

        This method should query the AWS API to get the resource's current state.
        The returned dictionary structure is resource-type specific.

        Returns:
            Dictionary containing resource status information.
            For ECS Service example:
            {
                "desired_count": 1,
                "running_count": 1,
                "status": "ACTIVE",
                "is_stopped": False
            }

        Raises:
            Exception: If unable to retrieve status (e.g., resource not found)
        """
        pass

    @abstractmethod
    def start(self) -> HandlerResult:
        """
        Start or enable the resource.

        This method should:
        1. Check current state (idempotent check)
        2. Perform the start operation via AWS API
        3. Optionally wait for the resource to reach ready state
        4. Return a HandlerResult with operation outcome

        Returns:
            HandlerResult object containing operation result
        """
        pass

    @abstractmethod
    def stop(self) -> HandlerResult:
        """
        Stop or disable the resource.

        This method should:
        1. Check current state (idempotent check)
        2. Perform the stop operation via AWS API
        3. Optionally wait for the resource to reach stopped state
        4. Return a HandlerResult with operation outcome

        Returns:
            HandlerResult object containing operation result
        """
        pass

    @abstractmethod
    def is_ready(self) -> bool:
        """
        Check if the resource has reached its desired state.

        This method is used when wait_for_stable is enabled to determine
        if the resource has completed its state transition.

        Returns:
            True if resource is ready/stable, False otherwise
        """
        pass

    def _get_resource_defaults(self) -> Dict[str, Any]:
        """
        Extract resource-type-specific defaults from configuration.

        This helper method retrieves the default settings for the handler's
        resource type from the config's resource_defaults section.

        Returns:
            Dictionary of default settings, or empty dict if not configured.
            Example for ECS Service:
            {
                "wait_for_stable": True,
                "stable_timeout_seconds": 300,
                "default_desired_count": 1
            }
        """
        return (
            self.config
            .get('resource_defaults', {})
            .get(self.resource.resource_type, {})
        )

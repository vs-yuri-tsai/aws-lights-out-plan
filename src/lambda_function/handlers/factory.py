from typing import Optional, Dict, Any, Type
from src.lambda_function.discovery.base import DiscoveredResource
from src.lambda_function.handlers.base import ResourceHandler
from src.lambda_function.handlers.ecs_service import ECSServiceHandler


# Handler registry mapping resource types to handler classes
HANDLER_REGISTRY: Dict[str, Type[ResourceHandler]] = {
    "ecs-service": ECSServiceHandler,
    # Future handlers can be registered here:
    # "nat-gateway": NatGatewayHandler,
    # "rds-instance": RDSInstanceHandler,
}


def get_handler(
    resource_type: str,
    resource: DiscoveredResource,
    config: Dict[str, Any]
) -> Optional[ResourceHandler]:
    """
    Factory function to get a handler for a specific resource type.

    This function uses a registry pattern to map resource types to their
    corresponding handler classes. When a new handler is implemented,
    it should be registered in HANDLER_REGISTRY.

    Args:
        resource_type: Type of the resource (e.g., "ecs-service")
        resource: The discovered resource object
        config: Configuration dictionary

    Returns:
        ResourceHandler instance or None if handler not found

    Example:
        >>> resource = DiscoveredResource(...)
        >>> handler = get_handler("ecs-service", resource, config)
        >>> if handler:
        ...     result = handler.stop()
    """
    handler_class = HANDLER_REGISTRY.get(resource_type)

    if handler_class:
        return handler_class(resource, config)

    return None


def register_handler(resource_type: str, handler_class: Type[ResourceHandler]) -> None:
    """
    Register a new handler class for a resource type.

    This function allows dynamic registration of handlers, which is useful
    for testing or plugin-based architectures.

    Args:
        resource_type: The resource type identifier
        handler_class: The handler class to register

    Example:
        >>> register_handler("custom-resource", CustomHandler)
    """
    HANDLER_REGISTRY[resource_type] = handler_class


def get_registered_handlers() -> Dict[str, Type[ResourceHandler]]:
    """
    Get a copy of the current handler registry.

    Returns:
        Dictionary mapping resource types to handler classes
    """
    return HANDLER_REGISTRY.copy()

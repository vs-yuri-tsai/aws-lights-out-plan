"""
Example usage of Orchestrator with Handler Factory.

This example demonstrates how the Orchestrator discovers resources,
retrieves handlers from the factory, and executes actions.

This is for documentation purposes - actual usage would be through Lambda handler.
"""

from src.lambda_function.core.orchestrator import Orchestrator
from src.lambda_function.handlers.factory import get_handler, get_registered_handlers


def example_list_registered_handlers():
    """
    Example: List all registered handlers
    """
    print("=== Registered Handlers ===")
    handlers = get_registered_handlers()
    for resource_type, handler_class in handlers.items():
        print(f"  {resource_type}: {handler_class.__name__}")
    print()


def example_get_handler_for_resource():
    """
    Example: Get a handler for a specific resource
    """
    from src.lambda_function.discovery.base import DiscoveredResource

    print("=== Get Handler Example ===")

    # Create a mock resource
    resource = DiscoveredResource(
        resource_type="ecs-service",
        arn="arn:aws:ecs:us-east-1:123456789012:service/my-cluster/my-service",
        resource_id="my-cluster/my-service",
        priority=50,
        group="default",
        tags={"lights-out:managed": "true"},
        metadata={"cluster_name": "my-cluster"}
    )

    config = {
        "resource_defaults": {
            "ecs-service": {
                "wait_for_stable": False,
                "default_desired_count": 1
            }
        }
    }

    # Get handler from factory
    handler = get_handler("ecs-service", resource, config)

    if handler:
        print(f"✓ Handler found: {handler.__class__.__name__}")
        print(f"  Resource: {handler.resource.resource_id}")
        print(f"  Cluster: {handler.cluster_name}")
        print(f"  Service: {handler.service_name}")
    else:
        print("✗ No handler found")
    print()


def example_orchestrator_flow():
    """
    Example: How Orchestrator uses the factory

    Note: This is pseudo-code since it requires AWS credentials and resources
    """
    print("=== Orchestrator Flow ===")
    print("""
    1. Orchestrator discovers resources via TagDiscovery
    2. For each resource:
       a. Get schedule from resource tags
       b. Call get_handler(resource_type, resource, config)
       c. Execute handler.start() or handler.stop()
       d. Collect results
    3. Return aggregated results

    Example configuration:
    {
        "discovery": {
            "method": "tags",
            "tag_filters": {
                "lights-out:managed": "true",
                "lights-out:env": "workshop"
            }
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

    Usage:
    >>> orchestrator = Orchestrator(config)
    >>> result = orchestrator.run(action="stop")
    >>> print(f"Total: {result['total']}, Success: {result['succeeded']}")
    """)


def example_adding_new_handler():
    """
    Example: How to add a new handler type
    """
    print("=== Adding New Handler ===")
    print("""
    1. Create new handler class:

       # src/lambda_function/handlers/nat_gateway.py
       from src.lambda_function.handlers.base import ResourceHandler, HandlerResult

       class NatGatewayHandler(ResourceHandler):
           def get_status(self) -> Dict[str, Any]:
               # Implementation
               pass

           def start(self) -> HandlerResult:
               # Implementation
               pass

           def stop(self) -> HandlerResult:
               # Implementation
               pass

           def is_ready(self) -> bool:
               # Implementation
               pass

    2. Register in factory.py:

       # src/lambda_function/handlers/factory.py
       from src.lambda_function.handlers.nat_gateway import NatGatewayHandler

       HANDLER_REGISTRY = {
           "ecs-service": ECSServiceHandler,
           "nat-gateway": NatGatewayHandler,  # <- Add this line
       }

    3. Orchestrator will automatically use it when resource_type="nat-gateway"
    """)


if __name__ == "__main__":
    example_list_registered_handlers()
    example_get_handler_for_resource()
    example_orchestrator_flow()
    example_adding_new_handler()

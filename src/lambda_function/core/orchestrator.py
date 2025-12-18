from typing import List, Dict, Any
from src.lambda_function.core.scheduler import get_schedule
from src.lambda_function.discovery.tag_discovery import TagDiscovery
from src.lambda_function.handlers.factory import get_handler
from src.lambda_function.utils.logger import setup_logger


class Orchestrator:
    """
    Orchestrates the lights-out plan execution.

    Coordinates resource discovery, schedule checking, and handler execution.
    Ensures that single resource failures don't interrupt the overall flow.
    """

    def __init__(self, config: Dict[str, Any]):
        self.config = config
        self.logger = setup_logger("orchestrator")

    def discover_resources(self) -> List:
        """
        Discover resources based on configured discovery method.

        Returns:
            List of DiscoveredResource objects
        """
        discovery_method = self.config.get("discovery", {}).get("method")

        if discovery_method == "tags":
            discovery_strategy = TagDiscovery(self.config)
            return discovery_strategy.discover()
        else:
            self.logger.warning(
                "Unknown or missing discovery method",
                extra={"method": discovery_method}
            )
            return []

    def run(self, action: str) -> Dict[str, Any]:
        """
        Execute the lights-out plan for all discovered resources.

        Args:
            action: Operation to perform ("start", "stop", "status")

        Returns:
            Dictionary containing:
                - total: Total resources processed
                - succeeded: Number of successful operations
                - failed: Number of failed operations
                - results: List of handler results
        """
        self.logger.info(f"Starting orchestration", extra={"action": action})

        resources = self.discover_resources()
        self.logger.info(
            f"Discovered {len(resources)} resources",
            extra={"count": len(resources)}
        )

        results = []
        succeeded = 0
        failed = 0

        schedule_tag = self.config.get("settings", {}).get("schedule_tag")

        for resource in resources:
            try:
                schedule = get_schedule(resource, schedule_tag)
                if not schedule:
                    self.logger.debug(
                        "No schedule found for resource",
                        extra={
                            "resource_id": resource.resource_id,
                            "resource_type": resource.resource_type
                        }
                    )
                    continue

                handler = get_handler(resource.resource_type, resource, self.config)
                if not handler:
                    self.logger.warning(
                        "No handler available for resource type",
                        extra={
                            "resource_id": resource.resource_id,
                            "resource_type": resource.resource_type
                        }
                    )
                    failed += 1
                    continue

                # Execute the action via handler
                if action == "start":
                    result = handler.start()
                elif action == "stop":
                    result = handler.stop()
                elif action == "status":
                    status = handler.get_status()
                    result = {
                        "success": True,
                        "resource_id": resource.resource_id,
                        "resource_type": resource.resource_type,
                        "status": status
                    }
                else:
                    self.logger.error(
                        "Invalid action",
                        extra={"action": action, "resource_id": resource.resource_id}
                    )
                    failed += 1
                    continue

                results.append(result)

                if isinstance(result, dict) and result.get("success"):
                    succeeded += 1
                elif hasattr(result, "success") and result.success:
                    succeeded += 1
                else:
                    failed += 1

            except Exception as e:
                self.logger.error(
                    "Failed to process resource",
                    extra={
                        "resource_id": resource.resource_id,
                        "resource_type": resource.resource_type,
                        "error": str(e)
                    },
                    exc_info=True
                )
                failed += 1
                results.append({
                    "success": False,
                    "resource_id": resource.resource_id,
                    "resource_type": resource.resource_type,
                    "error": str(e)
                })

        summary = {
            "total": len(resources),
            "succeeded": succeeded,
            "failed": failed,
            "results": results
        }

        self.logger.info(
            "Orchestration completed",
            extra=summary
        )

        return summary
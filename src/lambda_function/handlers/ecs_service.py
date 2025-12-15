"""
ECS Service Handler implementation.

Handles start, stop, and status operations for AWS ECS Services.
"""

import boto3
from typing import Dict, Any

from src.lambda_function.handlers.base import ResourceHandler, HandlerResult
from src.lambda_function.discovery.base import DiscoveredResource


class ECSServiceHandler(ResourceHandler):
    """
    Handler for AWS ECS Service resources.

    This handler manages the lifecycle of ECS Services by controlling
    the desiredCount parameter. When stopping, it sets desiredCount to 0.
    When starting, it uses the default_desired_count from configuration.
    """

    def __init__(self, resource: DiscoveredResource, config: Dict[str, Any]):
        """
        Initialize ECS Service Handler.

        Args:
            resource: DiscoveredResource with metadata containing cluster_name
            config: Configuration with resource_defaults for ecs-service
        """
        super().__init__(resource, config)

        # Extract region from ARN (format: arn:aws:ecs:REGION:account:...)
        # Falls back to AWS_DEFAULT_REGION environment variable if not in ARN
        region = None
        if resource.arn and resource.arn.startswith('arn:aws:'):
            arn_parts = resource.arn.split(':')
            if len(arn_parts) >= 4:
                region = arn_parts[3]

        # Initialize ECS client with region
        self.ecs_client = boto3.client('ecs', region_name=region) if region else boto3.client('ecs')

        # Extract cluster and service names from resource
        self.cluster_name = resource.metadata.get('cluster_name', 'default')

        # Extract service name from resource_id
        # Format can be "cluster/service" or just "service"
        if '/' in resource.resource_id:
            self.service_name = resource.resource_id.split('/')[-1]
        else:
            self.service_name = resource.resource_id

    def get_status(self) -> Dict[str, Any]:
        """
        Get current status of the ECS Service.

        Returns:
            Dictionary with keys:
                - desired_count: Target number of tasks
                - running_count: Currently running tasks
                - status: Service status (e.g., "ACTIVE")
                - is_stopped: Boolean indicating if desiredCount is 0

        Raises:
            Exception: If service not found or API call fails
        """
        try:
            response = self.ecs_client.describe_services(
                cluster=self.cluster_name,
                services=[self.service_name]
            )

            if not response.get('services'):
                raise Exception(
                    f"Service {self.service_name} not found in cluster {self.cluster_name}"
                )

            service = response['services'][0]

            desired_count = service['desiredCount']
            running_count = service['runningCount']
            status = service['status']

            return {
                "desired_count": desired_count,
                "running_count": running_count,
                "status": status,
                "is_stopped": desired_count == 0
            }

        except Exception as e:
            self.logger.error(
                f"Failed to get status for service {self.service_name}",
                extra={
                    "cluster": self.cluster_name,
                    "service": self.service_name
                },
                exc_info=True
            )
            raise

    def stop(self) -> HandlerResult:
        """
        Stop the ECS Service by setting desiredCount to 0.

        This operation is idempotent - if the service is already stopped,
        it returns success without making changes.

        Returns:
            HandlerResult indicating success or failure
        """
        try:
            # 1. Get current status
            current_status = self.get_status()

            self.logger.info(
                f"Attempting to stop service",
                extra={
                    "cluster": self.cluster_name,
                    "service": self.service_name,
                    "current_desired_count": current_status['desired_count']
                }
            )

            # 2. Idempotent check - already stopped
            if current_status['is_stopped']:
                self.logger.info(
                    f"Service already stopped",
                    extra={
                        "cluster": self.cluster_name,
                        "service": self.service_name
                    }
                )
                return HandlerResult(
                    success=True,
                    action="stop",
                    resource_type=self.resource.resource_type,
                    resource_id=self.resource.resource_id,
                    message="Service already stopped",
                    previous_state=current_status
                )

            # 3. Update service to stop (desiredCount=0)
            self.ecs_client.update_service(
                cluster=self.cluster_name,
                service=self.service_name,
                desiredCount=0
            )

            self.logger.info(
                f"Updated service desiredCount to 0",
                extra={
                    "cluster": self.cluster_name,
                    "service": self.service_name,
                    "previous_count": current_status['desired_count']
                }
            )

            # 4. Wait for stable if configured
            defaults = self._get_resource_defaults()
            if defaults.get('wait_for_stable', False):
                timeout = defaults.get('stable_timeout_seconds', 300)
                self.logger.info(
                    f"Waiting for service to stabilize (timeout: {timeout}s)",
                    extra={
                        "cluster": self.cluster_name,
                        "service": self.service_name
                    }
                )
                self._wait_for_stable(timeout=timeout)

            return HandlerResult(
                success=True,
                action="stop",
                resource_type=self.resource.resource_type,
                resource_id=self.resource.resource_id,
                message=f"Service scaled to 0 (was {current_status['desired_count']})",
                previous_state=current_status
            )

        except Exception as e:
            self.logger.error(
                f"Failed to stop service",
                extra={
                    "cluster": self.cluster_name,
                    "service": self.service_name
                },
                exc_info=True
            )
            return HandlerResult(
                success=False,
                action="stop",
                resource_type=self.resource.resource_type,
                resource_id=self.resource.resource_id,
                message="Stop operation failed",
                error=str(e)
            )

    def start(self) -> HandlerResult:
        """
        Start the ECS Service by setting desiredCount to default value.

        Uses default_desired_count from configuration. This operation is
        idempotent - if the service is already at the desired count, it
        returns success without making changes.

        Returns:
            HandlerResult indicating success or failure
        """
        try:
            # 1. Get current status
            current_status = self.get_status()

            # 2. Get target desired count from config
            defaults = self._get_resource_defaults()
            target_count = defaults.get('default_desired_count', 1)

            self.logger.info(
                f"Attempting to start service",
                extra={
                    "cluster": self.cluster_name,
                    "service": self.service_name,
                    "current_desired_count": current_status['desired_count'],
                    "target_count": target_count
                }
            )

            # 3. Idempotent check - already at target count
            if current_status['desired_count'] == target_count:
                self.logger.info(
                    f"Service already at desired count {target_count}",
                    extra={
                        "cluster": self.cluster_name,
                        "service": self.service_name
                    }
                )
                return HandlerResult(
                    success=True,
                    action="start",
                    resource_type=self.resource.resource_type,
                    resource_id=self.resource.resource_id,
                    message=f"Service already at desired count {target_count}",
                    previous_state=current_status
                )

            # 4. Update service to start
            self.ecs_client.update_service(
                cluster=self.cluster_name,
                service=self.service_name,
                desiredCount=target_count
            )

            self.logger.info(
                f"Updated service desiredCount to {target_count}",
                extra={
                    "cluster": self.cluster_name,
                    "service": self.service_name,
                    "previous_count": current_status['desired_count']
                }
            )

            # 5. Wait for stable if configured
            if defaults.get('wait_for_stable', False):
                timeout = defaults.get('stable_timeout_seconds', 300)
                self.logger.info(
                    f"Waiting for service to stabilize (timeout: {timeout}s)",
                    extra={
                        "cluster": self.cluster_name,
                        "service": self.service_name
                    }
                )
                self._wait_for_stable(timeout=timeout)

            return HandlerResult(
                success=True,
                action="start",
                resource_type=self.resource.resource_type,
                resource_id=self.resource.resource_id,
                message=f"Service scaled to {target_count}",
                previous_state=current_status
            )

        except Exception as e:
            self.logger.error(
                f"Failed to start service",
                extra={
                    "cluster": self.cluster_name,
                    "service": self.service_name
                },
                exc_info=True
            )
            return HandlerResult(
                success=False,
                action="start",
                resource_type=self.resource.resource_type,
                resource_id=self.resource.resource_id,
                message="Start operation failed",
                error=str(e)
            )

    def is_ready(self) -> bool:
        """
        Check if service has reached its desired state.

        A service is considered ready when:
        - desired_count equals running_count

        Returns:
            True if service is ready, False otherwise
        """
        try:
            status = self.get_status()
            is_ready = status['desired_count'] == status['running_count']

            self.logger.debug(
                f"Service ready check: {is_ready}",
                extra={
                    "cluster": self.cluster_name,
                    "service": self.service_name,
                    "desired_count": status['desired_count'],
                    "running_count": status['running_count']
                }
            )

            return is_ready

        except Exception as e:
            self.logger.error(
                f"Failed to check if service is ready",
                extra={
                    "cluster": self.cluster_name,
                    "service": self.service_name
                },
                exc_info=True
            )
            return False

    def _wait_for_stable(self, timeout: int = 300):
        """
        Wait for the ECS Service to reach a stable state.

        Uses boto3 waiter to poll the service status until it becomes stable.

        Args:
            timeout: Maximum wait time in seconds

        Raises:
            WaiterError: If service does not stabilize within timeout
        """
        waiter = self.ecs_client.get_waiter('services_stable')

        # Calculate max attempts based on timeout and polling interval
        # Waiter polls every 15 seconds by default
        polling_interval = 15
        max_attempts = max(1, timeout // polling_interval)

        self.logger.debug(
            f"Starting waiter for service stability",
            extra={
                "cluster": self.cluster_name,
                "service": self.service_name,
                "timeout": timeout,
                "max_attempts": max_attempts
            }
        )

        waiter.wait(
            cluster=self.cluster_name,
            services=[self.service_name],
            WaiterConfig={
                'Delay': polling_interval,
                'MaxAttempts': max_attempts
            }
        )

        self.logger.info(
            f"Service reached stable state",
            extra={
                "cluster": self.cluster_name,
                "service": self.service_name
            }
        )

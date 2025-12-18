"""
AWS Lambda handler for Lights Out Plan.

This module serves as the entry point for the Lambda function.
It loads configuration, orchestrates resource management, and returns responses.
"""

import os
import json
from datetime import datetime
from typing import Dict, Any

from src.lambda_function.core.config import load_config_from_ssm
from src.lambda_function.core.orchestrator import Orchestrator
from src.lambda_function.utils.logger import setup_logger


# Module logger
logger = setup_logger(__name__)

# Default SSM parameter name (can be overridden via environment variable)
DEFAULT_CONFIG_PARAMETER = "/lights-out/config"

# Valid actions
VALID_ACTIONS = {"start", "stop", "status", "discover"}


def handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Lambda handler function for Lights Out Plan.

    Args:
        event: Lambda event containing:
            - action: Operation to perform ("start", "stop", "status", "discover")
        context: Lambda context object

    Returns:
        Dictionary with:
            - statusCode: HTTP status code (200, 400, 500)
            - body: JSON string containing operation results

    Example event:
        {
            "action": "stop"
        }

    Example response:
        {
            "statusCode": 200,
            "body": "{
                \"action\": \"stop\",
                \"total\": 10,
                \"succeeded\": 9,
                \"failed\": 1,
                \"timestamp\": \"2024-12-17T10:30:00Z\",
                \"request_id\": \"abc-123\"
            }"
        }
    """
    # Extract request ID and function name from context (do this first for error handling)
    try:
        request_id = getattr(context, 'aws_request_id', 'local-test')
        function_name = getattr(context, 'function_name', 'lights-out')
    except Exception:
        # Fallback if context is malformed
        request_id = 'unknown'
        function_name = 'lights-out'

    # Extract action from event (default to 'status')
    action = event.get("action", "status")

    logger.info(
        "Lambda invoked",
        extra={
            "action": action,
            "request_id": request_id,
            "function_name": function_name
        }
    )

    try:
        # Validate action
        if action not in VALID_ACTIONS:
            logger.warning(
                f"Invalid action: {action}",
                extra={"valid_actions": list(VALID_ACTIONS)}
            )
            return _error_response(
                status_code=400,
                error=f"Invalid action '{action}'. Valid actions: {', '.join(VALID_ACTIONS)}",
                request_id=request_id
            )

        # Load configuration from SSM
        config_parameter = os.environ.get('CONFIG_PARAMETER_NAME', DEFAULT_CONFIG_PARAMETER)
        logger.info(f"Loading config from SSM: {config_parameter}")

        config = load_config_from_ssm(config_parameter)

        # Initialize orchestrator
        orchestrator = Orchestrator(config=config)

        # Execute action
        if action == "discover":
            # Discover action only lists resources without executing operations
            resources = orchestrator.discover_resources()

            result = {
                "action": action,
                "discovered_count": len(resources),
                "resources": [
                    {
                        "resource_type": r.resource_type,
                        "resource_id": r.resource_id,
                        "arn": r.arn,
                        "priority": r.priority,
                        "group": r.group
                    }
                    for r in resources
                ],
                "timestamp": datetime.utcnow().isoformat() + "Z",
                "request_id": request_id
            }

        else:
            # Execute start/stop/status action
            orchestrator_result = orchestrator.run(action=action)

            result = {
                "action": action,
                "total": orchestrator_result["total"],
                "succeeded": orchestrator_result["succeeded"],
                "failed": orchestrator_result["failed"],
                "results": _serialize_results(orchestrator_result["results"]),
                "timestamp": datetime.utcnow().isoformat() + "Z",
                "request_id": request_id
            }

        logger.info(
            "Lambda execution completed successfully",
            extra={
                "action": action,
                "total": result.get("total") or result.get("discovered_count"),
                "request_id": request_id
            }
        )

        return {
            "statusCode": 200,
            "body": json.dumps(result, default=str)
        }

    except Exception as e:
        logger.error(
            "Lambda execution failed",
            extra={
                "action": action,
                "error": str(e),
                "request_id": request_id
            },
            exc_info=True
        )

        return _error_response(
            status_code=500,
            error=str(e),
            request_id=request_id
        )


def _error_response(status_code: int, error: str, request_id: str) -> Dict[str, Any]:
    """
    Create standardized error response.

    Args:
        status_code: HTTP status code
        error: Error message
        request_id: Lambda request ID

    Returns:
        Lambda response dictionary
    """
    return {
        "statusCode": status_code,
        "body": json.dumps({
            "error": error,
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "request_id": request_id
        })
    }


def _serialize_results(results: list) -> list:
    """
    Serialize handler results to JSON-compatible format.

    Converts HandlerResult dataclass objects to dictionaries.

    Args:
        results: List of HandlerResult objects or dicts

    Returns:
        List of serializable dictionaries
    """
    serialized = []

    for result in results:
        if hasattr(result, '__dict__'):
            # Convert dataclass/object to dict
            serialized.append({
                k: v for k, v in result.__dict__.items()
                if not k.startswith('_')
            })
        else:
            # Already a dict
            serialized.append(result)

    return serialized

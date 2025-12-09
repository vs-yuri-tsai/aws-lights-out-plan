"""Lambda handler for stopping AWS resources."""
import json
from typing import Any, Dict

from ..app.orchestrator import stop_resources
from ..core.config import get_config
from ..core.logger import log_with_context, setup_logger
from ..discovery.resource_discovery import discover_resources

logger = setup_logger(__name__)


def handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """Lambda handler for stopping resources.
    
    Args:
        event: Lambda event object
        context: Lambda context object
    
    Returns:
        Response dict with status and results
    """
    try:
        logger.info("Stop handler invoked")
        log_with_context(logger, "info", "Processing stop request", event=event)
        
        # Load configuration
        config = get_config()
        
        # Discover resources
        resources = discover_resources(config)
        logger.info(f"Discovered {len(resources)} resources to stop")
        
        if not resources:
            return {
                "statusCode": 200,
                "body": json.dumps({
                    "message": "No resources found to stop",
                    "resources_stopped": 0
                })
            }
        
        # Stop resources
        results = stop_resources(resources, dry_run=config.dry_run)
        
        success_count = sum(1 for r in results if r.success)
        
        response_body = {
            "message": "Stop operation completed",
            "dry_run": config.dry_run,
            "total_resources": len(resources),
            "successful": success_count,
            "failed": len(results) - success_count,
            "results": [r.dict() for r in results]
        }
        
        logger.info(f"Stop handler completed: {success_count}/{len(results)} successful")
        
        return {
            "statusCode": 200,
            "body": json.dumps(response_body)
        }
        
    except Exception as e:
        logger.error(f"Stop handler error: {str(e)}", exc_info=True)
        return {
            "statusCode": 500,
            "body": json.dumps({
                "message": "Error stopping resources",
                "error": str(e)
            })
        }

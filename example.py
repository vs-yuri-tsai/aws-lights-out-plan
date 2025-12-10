#!/usr/bin/env python3
"""Example script demonstrating AWS Lights Out usage."""
import json
import sys
from pathlib import Path

# Add src to path for local testing
sys.path.insert(0, str(Path(__file__).parent / "src"))

from lights_out.core.config import get_config, parse_config
from lights_out.core.logger import setup_logger
from lights_out.discovery.resource_discovery import discover_resources
from lights_out.app.orchestrator import start_resources, stop_resources


def main():
    """Run example demonstrating lights out functionality."""
    # Set up logging
    logger = setup_logger(__name__)
    
    # Example 1: Using default configuration
    print("\n=== Example 1: Default Configuration ===")
    config = get_config()
    print(f"Tag Key: {config.tag_key}")
    print(f"Tag Value: {config.tag_value}")
    print(f"Dry Run: {config.dry_run}")
    print(f"Resources configured: {len(config.resources)}")
    for res_config in config.resources:
        print(f"  - {res_config.resource_type}: priority={res_config.priority}, enabled={res_config.enabled}")
    
    # Example 2: Loading custom configuration
    print("\n=== Example 2: Custom Configuration ===")
    custom_config_json = json.dumps({
        "tag_key": "AutoShutdown",
        "tag_value": "true",
        "dry_run": True,
        "resources": [
            {"resource_type": "rds", "priority": 1, "enabled": True},
            {"resource_type": "ec2", "priority": 2, "enabled": True}
        ]
    })
    custom_config = parse_config(custom_config_json)
    print(f"Custom Tag Key: {custom_config.tag_key}")
    print(f"Custom Dry Run: {custom_config.dry_run}")
    
    # Example 3: Resource discovery (will use actual AWS API if credentials available)
    print("\n=== Example 3: Resource Discovery ===")
    print("Note: This requires AWS credentials and will make API calls")
    print("Skipping actual discovery in example mode")
    # Uncomment to run actual discovery:
    # try:
    #     resources = discover_resources(config)
    #     print(f"Discovered {len(resources)} resources")
    #     for resource in resources:
    #         print(f"  - {resource.resource_type}: {resource.resource_id} (priority={resource.priority})")
    # except Exception as e:
    #     print(f"Discovery failed: {e}")
    
    # Example 4: Simulating orchestration
    print("\n=== Example 4: Orchestration (Dry Run) ===")
    # Create mock resources for demonstration
    from lights_out.core.models import Resource, ResourceType
    
    mock_resources = [
        Resource(
            resource_id="db-primary",
            resource_type=ResourceType.RDS,
            resource_arn="arn:aws:rds:us-east-1:123456789012:db:db-primary",
            priority=1,
            region="us-east-1",
            tags={"Name": "Primary Database", "LightsOut": "enabled"}
        ),
        Resource(
            resource_id="i-app-server",
            resource_type=ResourceType.EC2,
            resource_arn="arn:aws:ec2:us-east-1:123456789012:instance/i-app-server",
            priority=2,
            region="us-east-1",
            tags={"Name": "App Server", "LightsOut": "enabled"}
        ),
        Resource(
            resource_id="web-asg",
            resource_type=ResourceType.ASG,
            resource_arn="arn:aws:autoscaling:us-east-1:123456789012:autoScalingGroup:uuid:autoScalingGroupName/web-asg",
            priority=3,
            region="us-east-1",
            tags={"Name": "Web ASG", "LightsOut": "enabled"}
        )
    ]
    
    # Start resources (dry run)
    print("\nStarting resources (priority order: lower first):")
    start_results = start_resources(mock_resources, dry_run=True)
    for result in start_results:
        status = "✓" if result.success else "✗"
        print(f"  {status} {result.resource_type} {result.resource_id}: {result.message}")
    
    # Stop resources (dry run)
    print("\nStopping resources (priority order: higher first):")
    stop_results = stop_resources(mock_resources, dry_run=True)
    for result in stop_results:
        status = "✓" if result.success else "✗"
        print(f"  {status} {result.resource_type} {result.resource_id}: {result.message}")
    
    print("\n=== Example Complete ===")
    print("To run with actual AWS resources:")
    print("1. Configure AWS credentials")
    print("2. Tag your resources with LightsOut=enabled")
    print("3. Set DRY_RUN=false environment variable")
    print("4. Run the Lambda handlers or use the discovery/orchestration modules")


if __name__ == "__main__":
    main()

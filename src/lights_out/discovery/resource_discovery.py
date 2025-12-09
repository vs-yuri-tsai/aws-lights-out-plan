"""Resource discovery using AWS Resource Groups Tagging API."""
from typing import Dict, List, Optional

import boto3
from botocore.exceptions import ClientError

from ..core.logger import setup_logger
from ..core.models import LightsOutConfig, Resource, ResourceType

logger = setup_logger(__name__)


class DiscoveryError(Exception):
    """Exception raised for discovery errors."""
    pass


def discover_resources(config: LightsOutConfig, region: Optional[str] = None) -> List[Resource]:
    """Discover AWS resources using Resource Groups Tagging API.
    
    Args:
        config: LightsOutConfig with tag configuration
        region: AWS region (defaults to current region)
    
    Returns:
        List of discovered resources
    
    Raises:
        DiscoveryError: If discovery fails
    """
    import os
    region = region or os.environ.get("AWS_REGION", "us-east-1")
    
    try:
        # Use Resource Groups Tagging API to find tagged resources
        client = boto3.client("resourcegroupstaggingapi", region_name=region)
        
        logger.info(f"Discovering resources with tag {config.tag_key}={config.tag_value}")
        
        resources: List[Resource] = []
        
        # Build resource type filters based on enabled resource configs
        resource_type_filters = _build_resource_type_filters(config)
        
        # Paginate through all tagged resources
        paginator = client.get_paginator("get_resources")
        page_iterator = paginator.paginate(
            TagFilters=[
                {
                    "Key": config.tag_key,
                    "Values": [config.tag_value]
                }
            ],
            ResourceTypeFilters=resource_type_filters
        )
        
        priority_map = {rc.resource_type: rc.priority for rc in config.resources if rc.enabled}
        
        for page in page_iterator:
            for resource_info in page.get("ResourceTagMappingList", []):
                arn = resource_info["ResourceARN"]
                tags = {tag["Key"]: tag["Value"] for tag in resource_info.get("Tags", [])}
                
                # Determine resource type from ARN
                resource_type = _extract_resource_type(arn)
                if resource_type:
                    resource_id = _extract_resource_id(arn, resource_type)
                    priority = priority_map.get(resource_type, 999)
                    
                    resource = Resource(
                        resource_id=resource_id,
                        resource_type=resource_type,
                        resource_arn=arn,
                        tags=tags,
                        priority=priority,
                        region=region
                    )
                    resources.append(resource)
                    logger.debug(f"Discovered {resource_type} resource: {resource_id}")
        
        logger.info(f"Discovered {len(resources)} resources")
        return resources
        
    except ClientError as e:
        raise DiscoveryError(f"AWS API error during discovery: {str(e)}")
    except Exception as e:
        raise DiscoveryError(f"Unexpected error during discovery: {str(e)}")


def _build_resource_type_filters(config: LightsOutConfig) -> List[str]:
    """Build resource type filters for tagging API.
    
    Args:
        config: LightsOutConfig
    
    Returns:
        List of resource type filters
    """
    filters = []
    for resource_config in config.resources:
        if not resource_config.enabled:
            continue
            
        if resource_config.resource_type == ResourceType.EC2:
            filters.append("ec2:instance")
        elif resource_config.resource_type == ResourceType.RDS:
            filters.extend(["rds:db", "rds:cluster"])
        elif resource_config.resource_type == ResourceType.ASG:
            filters.append("autoscaling:autoScalingGroup")
    
    return filters if filters else None  # None means all resource types


def _extract_resource_type(arn: str) -> Optional[ResourceType]:
    """Extract resource type from ARN.
    
    Args:
        arn: AWS Resource ARN
    
    Returns:
        ResourceType or None if not supported
    """
    # ARN format: arn:aws:service:region:account:resource-type/resource-id
    parts = arn.split(":")
    if len(parts) < 6:
        return None
    
    service = parts[2]
    
    if service == "ec2" and "instance" in arn:
        return ResourceType.EC2
    elif service == "rds":
        return ResourceType.RDS
    elif service == "autoscaling":
        return ResourceType.ASG
    
    return None


def _extract_resource_id(arn: str, resource_type: ResourceType) -> str:
    """Extract resource ID from ARN.
    
    Args:
        arn: AWS Resource ARN
        resource_type: Type of resource
    
    Returns:
        Resource ID
    """
    # ARN formats vary by service
    if resource_type == ResourceType.EC2:
        # arn:aws:ec2:region:account:instance/i-xxxxx
        return arn.split("/")[-1]
    elif resource_type == ResourceType.RDS:
        # arn:aws:rds:region:account:db:database-name or cluster:cluster-name
        return arn.split(":")[-1]
    elif resource_type == ResourceType.ASG:
        # arn:aws:autoscaling:region:account:autoScalingGroup:uuid:autoScalingGroupName/name
        return arn.split("/")[-1]
    
    # Fallback: return last part after / or :
    if "/" in arn:
        return arn.split("/")[-1]
    return arn.split(":")[-1]

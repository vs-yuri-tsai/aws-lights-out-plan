"""Orchestration logic for starting and stopping AWS resources."""
from typing import List

import boto3
from botocore.exceptions import ClientError

from ..core.logger import setup_logger
from ..core.models import ActionResult, ActionType, Resource, ResourceType

logger = setup_logger(__name__)


class OrchestrationError(Exception):
    """Exception raised for orchestration errors."""
    pass


def start_resources(resources: List[Resource], dry_run: bool = False) -> List[ActionResult]:
    """Start AWS resources in priority order (lower priority first).
    
    Args:
        resources: List of resources to start
        dry_run: If True, only log actions without executing
    
    Returns:
        List of action results
    """
    logger.info(f"Starting {len(resources)} resources (dry_run={dry_run})")
    
    # Sort by priority (lower numbers start first - e.g., databases before apps)
    sorted_resources = sorted(resources, key=lambda r: r.priority)
    
    results = []
    for resource in sorted_resources:
        result = _start_resource(resource, dry_run)
        results.append(result)
        
        if not result.success:
            logger.warning(f"Failed to start {resource.resource_id}: {result.message}")
    
    success_count = sum(1 for r in results if r.success)
    logger.info(f"Start operation completed: {success_count}/{len(results)} successful")
    return results


def stop_resources(resources: List[Resource], dry_run: bool = False) -> List[ActionResult]:
    """Stop AWS resources in reverse priority order (higher priority first).
    
    Args:
        resources: List of resources to stop
        dry_run: If True, only log actions without executing
    
    Returns:
        List of action results
    """
    logger.info(f"Stopping {len(resources)} resources (dry_run={dry_run})")
    
    # Sort by priority in reverse (higher numbers stop first - e.g., apps before databases)
    sorted_resources = sorted(resources, key=lambda r: r.priority, reverse=True)
    
    results = []
    for resource in sorted_resources:
        result = _stop_resource(resource, dry_run)
        results.append(result)
        
        if not result.success:
            logger.warning(f"Failed to stop {resource.resource_id}: {result.message}")
    
    success_count = sum(1 for r in results if r.success)
    logger.info(f"Stop operation completed: {success_count}/{len(results)} successful")
    return results


def _start_resource(resource: Resource, dry_run: bool) -> ActionResult:
    """Start a single AWS resource.
    
    Args:
        resource: Resource to start
        dry_run: If True, only log the action
    
    Returns:
        ActionResult
    """
    logger.info(
        f"Starting {resource.resource_type} resource: {resource.resource_id} "
        f"(priority={resource.priority}, dry_run={dry_run})"
    )
    
    if dry_run:
        return ActionResult(
            resource_id=resource.resource_id,
            resource_type=resource.resource_type,
            action=ActionType.START,
            success=True,
            message="DRY RUN: Would start resource",
            dry_run=True
        )
    
    try:
        if resource.resource_type == ResourceType.EC2:
            return _start_ec2_instance(resource)
        elif resource.resource_type == ResourceType.RDS:
            return _start_rds_instance(resource)
        elif resource.resource_type == ResourceType.ASG:
            return _start_asg(resource)
        else:
            return ActionResult(
                resource_id=resource.resource_id,
                resource_type=resource.resource_type,
                action=ActionType.START,
                success=False,
                message=f"Unsupported resource type: {resource.resource_type}"
            )
    except Exception as e:
        logger.error(f"Error starting {resource.resource_id}: {str(e)}")
        return ActionResult(
            resource_id=resource.resource_id,
            resource_type=resource.resource_type,
            action=ActionType.START,
            success=False,
            message=str(e)
        )


def _stop_resource(resource: Resource, dry_run: bool) -> ActionResult:
    """Stop a single AWS resource.
    
    Args:
        resource: Resource to stop
        dry_run: If True, only log the action
    
    Returns:
        ActionResult
    """
    logger.info(
        f"Stopping {resource.resource_type} resource: {resource.resource_id} "
        f"(priority={resource.priority}, dry_run={dry_run})"
    )
    
    if dry_run:
        return ActionResult(
            resource_id=resource.resource_id,
            resource_type=resource.resource_type,
            action=ActionType.STOP,
            success=True,
            message="DRY RUN: Would stop resource",
            dry_run=True
        )
    
    try:
        if resource.resource_type == ResourceType.EC2:
            return _stop_ec2_instance(resource)
        elif resource.resource_type == ResourceType.RDS:
            return _stop_rds_instance(resource)
        elif resource.resource_type == ResourceType.ASG:
            return _stop_asg(resource)
        else:
            return ActionResult(
                resource_id=resource.resource_id,
                resource_type=resource.resource_type,
                action=ActionType.STOP,
                success=False,
                message=f"Unsupported resource type: {resource.resource_type}"
            )
    except Exception as e:
        logger.error(f"Error stopping {resource.resource_id}: {str(e)}")
        return ActionResult(
            resource_id=resource.resource_id,
            resource_type=resource.resource_type,
            action=ActionType.STOP,
            success=False,
            message=str(e)
        )


def _start_ec2_instance(resource: Resource) -> ActionResult:
    """Start an EC2 instance."""
    try:
        ec2 = boto3.client("ec2", region_name=resource.region)
        ec2.start_instances(InstanceIds=[resource.resource_id])
        return ActionResult(
            resource_id=resource.resource_id,
            resource_type=resource.resource_type,
            action=ActionType.START,
            success=True,
            message="EC2 instance start initiated"
        )
    except ClientError as e:
        return ActionResult(
            resource_id=resource.resource_id,
            resource_type=resource.resource_type,
            action=ActionType.START,
            success=False,
            message=f"AWS API error: {str(e)}"
        )


def _stop_ec2_instance(resource: Resource) -> ActionResult:
    """Stop an EC2 instance."""
    try:
        ec2 = boto3.client("ec2", region_name=resource.region)
        ec2.stop_instances(InstanceIds=[resource.resource_id])
        return ActionResult(
            resource_id=resource.resource_id,
            resource_type=resource.resource_type,
            action=ActionType.STOP,
            success=True,
            message="EC2 instance stop initiated"
        )
    except ClientError as e:
        return ActionResult(
            resource_id=resource.resource_id,
            resource_type=resource.resource_type,
            action=ActionType.STOP,
            success=False,
            message=f"AWS API error: {str(e)}"
        )


def _start_rds_instance(resource: Resource) -> ActionResult:
    """Start an RDS instance or cluster."""
    try:
        rds = boto3.client("rds", region_name=resource.region)
        
        # Try as DB instance first, then cluster
        if "cluster" in resource.resource_arn.lower():
            rds.start_db_cluster(DBClusterIdentifier=resource.resource_id)
            message = "RDS cluster start initiated"
        else:
            rds.start_db_instance(DBInstanceIdentifier=resource.resource_id)
            message = "RDS instance start initiated"
        
        return ActionResult(
            resource_id=resource.resource_id,
            resource_type=resource.resource_type,
            action=ActionType.START,
            success=True,
            message=message
        )
    except ClientError as e:
        return ActionResult(
            resource_id=resource.resource_id,
            resource_type=resource.resource_type,
            action=ActionType.START,
            success=False,
            message=f"AWS API error: {str(e)}"
        )


def _stop_rds_instance(resource: Resource) -> ActionResult:
    """Stop an RDS instance or cluster."""
    try:
        rds = boto3.client("rds", region_name=resource.region)
        
        # Try as DB instance first, then cluster
        if "cluster" in resource.resource_arn.lower():
            rds.stop_db_cluster(DBClusterIdentifier=resource.resource_id)
            message = "RDS cluster stop initiated"
        else:
            rds.stop_db_instance(DBInstanceIdentifier=resource.resource_id)
            message = "RDS instance stop initiated"
        
        return ActionResult(
            resource_id=resource.resource_id,
            resource_type=resource.resource_type,
            action=ActionType.STOP,
            success=True,
            message=message
        )
    except ClientError as e:
        return ActionResult(
            resource_id=resource.resource_id,
            resource_type=resource.resource_type,
            action=ActionType.STOP,
            success=False,
            message=f"AWS API error: {str(e)}"
        )


def _start_asg(resource: Resource) -> ActionResult:
    """Start an Auto Scaling Group by resuming processes."""
    try:
        asg = boto3.client("autoscaling", region_name=resource.region)
        asg.resume_processes(AutoScalingGroupName=resource.resource_id)
        return ActionResult(
            resource_id=resource.resource_id,
            resource_type=resource.resource_type,
            action=ActionType.START,
            success=True,
            message="ASG processes resumed"
        )
    except ClientError as e:
        return ActionResult(
            resource_id=resource.resource_id,
            resource_type=resource.resource_type,
            action=ActionType.START,
            success=False,
            message=f"AWS API error: {str(e)}"
        )


def _stop_asg(resource: Resource) -> ActionResult:
    """Stop an Auto Scaling Group by suspending processes."""
    try:
        asg = boto3.client("autoscaling", region_name=resource.region)
        asg.suspend_processes(AutoScalingGroupName=resource.resource_id)
        return ActionResult(
            resource_id=resource.resource_id,
            resource_type=resource.resource_type,
            action=ActionType.STOP,
            success=True,
            message="ASG processes suspended"
        )
    except ClientError as e:
        return ActionResult(
            resource_id=resource.resource_id,
            resource_type=resource.resource_type,
            action=ActionType.STOP,
            success=False,
            message=f"AWS API error: {str(e)}"
        )

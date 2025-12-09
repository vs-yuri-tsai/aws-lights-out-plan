"""Tests for orchestration logic."""
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

# Add src to path
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from lights_out.app.orchestrator import start_resources, stop_resources
from lights_out.core.models import ActionType, Resource, ResourceType


@pytest.fixture
def sample_resources():
    """Create sample resources with different priorities."""
    return [
        Resource(
            resource_id="i-app",
            resource_type=ResourceType.EC2,
            resource_arn="arn:aws:ec2:us-east-1:123456789012:instance/i-app",
            priority=2,
            region="us-east-1"
        ),
        Resource(
            resource_id="mydb",
            resource_type=ResourceType.RDS,
            resource_arn="arn:aws:rds:us-east-1:123456789012:db:mydb",
            priority=1,
            region="us-east-1"
        ),
        Resource(
            resource_id="my-asg",
            resource_type=ResourceType.ASG,
            resource_arn="arn:aws:autoscaling:us-east-1:123456789012:autoScalingGroup:uuid:autoScalingGroupName/my-asg",
            priority=3,
            region="us-east-1"
        ),
    ]


def test_start_resources_dry_run(sample_resources):
    """Test starting resources in dry run mode."""
    results = start_resources(sample_resources, dry_run=True)
    
    assert len(results) == 3
    
    # Check all succeeded
    assert all(r.success for r in results)
    assert all(r.dry_run for r in results)
    assert all(r.action == ActionType.START for r in results)
    
    # Check priority order: RDS (1), EC2 (2), ASG (3)
    assert results[0].resource_id == "mydb"
    assert results[1].resource_id == "i-app"
    assert results[2].resource_id == "my-asg"


def test_stop_resources_dry_run(sample_resources):
    """Test stopping resources in dry run mode."""
    results = stop_resources(sample_resources, dry_run=True)
    
    assert len(results) == 3
    
    # Check all succeeded
    assert all(r.success for r in results)
    assert all(r.dry_run for r in results)
    assert all(r.action == ActionType.STOP for r in results)
    
    # Check reverse priority order: ASG (3), EC2 (2), RDS (1)
    assert results[0].resource_id == "my-asg"
    assert results[1].resource_id == "i-app"
    assert results[2].resource_id == "mydb"


@patch("lights_out.app.orchestrator.boto3.client")
def test_start_ec2_instance(mock_boto_client):
    """Test starting an EC2 instance."""
    mock_ec2 = MagicMock()
    mock_boto_client.return_value = mock_ec2
    
    resources = [
        Resource(
            resource_id="i-12345",
            resource_type=ResourceType.EC2,
            resource_arn="arn:aws:ec2:us-east-1:123456789012:instance/i-12345",
            priority=1,
            region="us-east-1"
        )
    ]
    
    results = start_resources(resources, dry_run=False)
    
    assert len(results) == 1
    assert results[0].success is True
    assert results[0].action == ActionType.START
    mock_ec2.start_instances.assert_called_once_with(InstanceIds=["i-12345"])


@patch("lights_out.app.orchestrator.boto3.client")
def test_stop_ec2_instance(mock_boto_client):
    """Test stopping an EC2 instance."""
    mock_ec2 = MagicMock()
    mock_boto_client.return_value = mock_ec2
    
    resources = [
        Resource(
            resource_id="i-12345",
            resource_type=ResourceType.EC2,
            resource_arn="arn:aws:ec2:us-east-1:123456789012:instance/i-12345",
            priority=1,
            region="us-east-1"
        )
    ]
    
    results = stop_resources(resources, dry_run=False)
    
    assert len(results) == 1
    assert results[0].success is True
    assert results[0].action == ActionType.STOP
    mock_ec2.stop_instances.assert_called_once_with(InstanceIds=["i-12345"])


@patch("lights_out.app.orchestrator.boto3.client")
def test_start_rds_instance(mock_boto_client):
    """Test starting an RDS instance."""
    mock_rds = MagicMock()
    mock_boto_client.return_value = mock_rds
    
    resources = [
        Resource(
            resource_id="mydb",
            resource_type=ResourceType.RDS,
            resource_arn="arn:aws:rds:us-east-1:123456789012:db:mydb",
            priority=1,
            region="us-east-1"
        )
    ]
    
    results = start_resources(resources, dry_run=False)
    
    assert len(results) == 1
    assert results[0].success is True
    mock_rds.start_db_instance.assert_called_once_with(DBInstanceIdentifier="mydb")


@patch("lights_out.app.orchestrator.boto3.client")
def test_start_rds_cluster(mock_boto_client):
    """Test starting an RDS cluster."""
    mock_rds = MagicMock()
    mock_boto_client.return_value = mock_rds
    
    resources = [
        Resource(
            resource_id="mycluster",
            resource_type=ResourceType.RDS,
            resource_arn="arn:aws:rds:us-east-1:123456789012:cluster:mycluster",
            priority=1,
            region="us-east-1"
        )
    ]
    
    results = start_resources(resources, dry_run=False)
    
    assert len(results) == 1
    assert results[0].success is True
    mock_rds.start_db_cluster.assert_called_once_with(DBClusterIdentifier="mycluster")


@patch("lights_out.app.orchestrator.boto3.client")
def test_start_asg(mock_boto_client):
    """Test starting an Auto Scaling Group."""
    mock_asg = MagicMock()
    mock_boto_client.return_value = mock_asg
    
    resources = [
        Resource(
            resource_id="my-asg",
            resource_type=ResourceType.ASG,
            resource_arn="arn:aws:autoscaling:us-east-1:123456789012:autoScalingGroup:uuid:autoScalingGroupName/my-asg",
            priority=1,
            region="us-east-1"
        )
    ]
    
    results = start_resources(resources, dry_run=False)
    
    assert len(results) == 1
    assert results[0].success is True
    mock_asg.resume_processes.assert_called_once_with(AutoScalingGroupName="my-asg")


@patch("lights_out.app.orchestrator.boto3.client")
def test_stop_asg(mock_boto_client):
    """Test stopping an Auto Scaling Group."""
    mock_asg = MagicMock()
    mock_boto_client.return_value = mock_asg
    
    resources = [
        Resource(
            resource_id="my-asg",
            resource_type=ResourceType.ASG,
            resource_arn="arn:aws:autoscaling:us-east-1:123456789012:autoScalingGroup:uuid:autoScalingGroupName/my-asg",
            priority=1,
            region="us-east-1"
        )
    ]
    
    results = stop_resources(resources, dry_run=False)
    
    assert len(results) == 1
    assert results[0].success is True
    mock_asg.suspend_processes.assert_called_once_with(AutoScalingGroupName="my-asg")


@patch("lights_out.app.orchestrator.boto3.client")
def test_start_resources_with_error(mock_boto_client):
    """Test handling errors during start operation."""
    from botocore.exceptions import ClientError
    
    mock_ec2 = MagicMock()
    mock_boto_client.return_value = mock_ec2
    
    mock_ec2.start_instances.side_effect = ClientError(
        {"Error": {"Code": "InvalidInstanceID"}},
        "StartInstances"
    )
    
    resources = [
        Resource(
            resource_id="i-invalid",
            resource_type=ResourceType.EC2,
            resource_arn="arn:aws:ec2:us-east-1:123456789012:instance/i-invalid",
            priority=1,
            region="us-east-1"
        )
    ]
    
    results = start_resources(resources, dry_run=False)
    
    assert len(results) == 1
    assert results[0].success is False
    assert "AWS API error" in results[0].message

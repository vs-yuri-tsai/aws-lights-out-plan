# AWS Lights Out Plan - Configuration Guide

## Overview

AWS Lights Out is a serverless solution for automatically starting and stopping AWS resources to save costs. It uses tags to identify resources and orchestrates actions based on configurable priorities.

## Configuration

### SSM Parameter Store (Recommended)

Store your configuration in AWS Systems Manager Parameter Store:

```bash
aws ssm put-parameter \
  --name "/lights-out/config" \
  --type "String" \
  --value file://configs/example-config.json
```

Then set the environment variable in your Lambda:
```
LIGHTS_OUT_CONFIG_PARAM=/lights-out/config
```

### Configuration Schema

```json
{
  "tag_key": "LightsOut",           // Tag key to identify resources
  "tag_value": "enabled",            // Tag value that enables lights out
  "resources": [                     // Resource configurations
    {
      "resource_type": "rds",        // Type: ec2, rds, or asg
      "priority": 1,                 // Lower starts first, higher stops first
      "enabled": true                // Enable/disable this resource type
    }
  ],
  "dry_run": false                   // If true, only logs actions
}
```

### Resource Priorities

Priorities determine the order of operations:

- **Start**: Lower priority values start first (e.g., databases before apps)
- **Stop**: Higher priority values stop first (e.g., apps before databases)

Example priority scheme:
- Priority 1: RDS databases (start first, stop last)
- Priority 2: EC2 instances (start middle, stop middle)
- Priority 3: Auto Scaling Groups (start last, stop first)

## Environment Variables

### Required
- `AWS_REGION`: AWS region for operations (default: us-east-1)

### Optional
- `LIGHTS_OUT_CONFIG_PARAM`: SSM Parameter Store path for configuration
- `DRY_RUN`: Override dry_run setting (values: true/false/1/0/yes/no)

## Tagging Resources

Tag your AWS resources to enable lights out management:

```bash
# EC2 instance
aws ec2 create-tags \
  --resources i-1234567890abcdef0 \
  --tags Key=LightsOut,Value=enabled

# RDS instance
aws rds add-tags-to-resource \
  --resource-name arn:aws:rds:us-east-1:123456789012:db:mydb \
  --tags Key=LightsOut,Value=enabled

# Auto Scaling Group
aws autoscaling create-or-update-tags \
  --tags ResourceId=my-asg,ResourceType=auto-scaling-group,Key=LightsOut,Value=enabled,PropagateAtLaunch=false
```

## Lambda Functions

### Start Handler

Discovers and starts tagged resources in priority order.

**Entry point**: `lights_out.handlers.start_handler.handler`

**Invocation**:
```python
import boto3
lambda_client = boto3.client('lambda')
response = lambda_client.invoke(
    FunctionName='lights-out-start',
    InvocationType='RequestResponse'
)
```

### Stop Handler

Discovers and stops tagged resources in reverse priority order.

**Entry point**: `lights_out.handlers.stop_handler.handler`

**Invocation**:
```python
import boto3
lambda_client = boto3.client('lambda')
response = lambda_client.invoke(
    FunctionName='lights-out-stop',
    InvocationType='RequestResponse'
)
```

## Logging

All logs are emitted in structured JSON format:

```json
{
  "timestamp": "2025-12-09T08:00:00.000000+00:00",
  "level": "INFO",
  "logger": "lights_out.handlers.start_handler",
  "message": "Start handler invoked"
}
```

## DRY RUN Mode

Enable dry run to test without actually starting/stopping resources:

### Via Configuration
```json
{
  "dry_run": true
}
```

### Via Environment Variable
```bash
export DRY_RUN=true
```

In dry run mode, all actions are logged but not executed.

## Supported Resource Types

- **EC2 Instances** (`ec2`): Start/stop instances
- **RDS Instances/Clusters** (`rds`): Start/stop databases
- **Auto Scaling Groups** (`asg`): Suspend/resume processes

## IAM Permissions

The Lambda execution role needs the following permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "tag:GetResources"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "ec2:DescribeInstances",
        "ec2:StartInstances",
        "ec2:StopInstances"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "rds:DescribeDBInstances",
        "rds:DescribeDBClusters",
        "rds:StartDBInstance",
        "rds:StopDBInstance",
        "rds:StartDBCluster",
        "rds:StopDBCluster"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "autoscaling:DescribeAutoScalingGroups",
        "autoscaling:SuspendProcesses",
        "autoscaling:ResumeProcesses"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "ssm:GetParameter"
      ],
      "Resource": "arn:aws:ssm:*:*:parameter/lights-out/*"
    }
  ]
}
```

## Scheduling

Use EventBridge (CloudWatch Events) to schedule start/stop operations:

```bash
# Stop resources at 7 PM weekdays
aws events put-rule \
  --name lights-out-stop \
  --schedule-expression "cron(0 19 ? * MON-FRI *)"

# Start resources at 7 AM weekdays  
aws events put-rule \
  --name lights-out-start \
  --schedule-expression "cron(0 7 ? * MON-FRI *)"
```

## Future Enhancements

The JSON configuration format supports future AI/MCP integration:
- AI-driven scheduling optimization
- Machine learning for usage patterns
- Model Context Protocol for intelligent resource management

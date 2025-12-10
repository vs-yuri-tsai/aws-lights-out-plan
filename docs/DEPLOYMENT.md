# Deployment Guide

## Prerequisites

- AWS CLI configured with appropriate credentials
- Python 3.9+ installed
- Access to create Lambda functions, IAM roles, and SSM parameters

## Quick Deployment

### 1. Install Dependencies

Create a deployment package:

```bash
# Create a clean directory for the Lambda package
mkdir -p /tmp/lambda-package
cd /tmp/lambda-package

# Install dependencies
pip install -r /path/to/aws-lights-out-plan/requirements.txt -t .

# Copy source code
cp -r /path/to/aws-lights-out-plan/src/lights_out .

# Create ZIP file
zip -r lights-out-lambda.zip .
```

### 2. Create IAM Role

Create an IAM role for Lambda with the following policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "arn:aws:logs:*:*:*"
    },
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

### 3. Store Configuration in SSM

```bash
aws ssm put-parameter \
  --name "/lights-out/config" \
  --type "String" \
  --value file://configs/example-config.json \
  --description "AWS Lights Out configuration"
```

### 4. Create Lambda Functions

#### Start Function

```bash
aws lambda create-function \
  --function-name lights-out-start \
  --runtime python3.11 \
  --handler lights_out.handlers.start_handler.handler \
  --role arn:aws:iam::YOUR_ACCOUNT:role/LightsOutLambdaRole \
  --zip-file fileb:///tmp/lambda-package/lights-out-lambda.zip \
  --timeout 300 \
  --memory-size 256 \
  --environment Variables="{LIGHTS_OUT_CONFIG_PARAM=/lights-out/config,AWS_REGION=us-east-1}"
```

#### Stop Function

```bash
aws lambda create-function \
  --function-name lights-out-stop \
  --runtime python3.11 \
  --handler lights_out.handlers.stop_handler.handler \
  --role arn:aws:iam::YOUR_ACCOUNT:role/LightsOutLambdaRole \
  --zip-file fileb:///tmp/lambda-package/lights-out-lambda.zip \
  --timeout 300 \
  --memory-size 256 \
  --environment Variables="{LIGHTS_OUT_CONFIG_PARAM=/lights-out/config,AWS_REGION=us-east-1}"
```

### 5. Create EventBridge Rules

#### Stop Resources at 7 PM Weekdays

```bash
# Create rule
aws events put-rule \
  --name lights-out-stop \
  --schedule-expression "cron(0 19 ? * MON-FRI *)" \
  --description "Stop AWS resources at 7 PM weekdays"

# Add Lambda target
aws events put-targets \
  --rule lights-out-stop \
  --targets "Id=1,Arn=arn:aws:lambda:us-east-1:YOUR_ACCOUNT:function:lights-out-stop"

# Grant EventBridge permission to invoke Lambda
aws lambda add-permission \
  --function-name lights-out-stop \
  --statement-id AllowEventBridgeInvoke \
  --action lambda:InvokeFunction \
  --principal events.amazonaws.com \
  --source-arn arn:aws:events:us-east-1:YOUR_ACCOUNT:rule/lights-out-stop
```

#### Start Resources at 7 AM Weekdays

```bash
# Create rule
aws events put-rule \
  --name lights-out-start \
  --schedule-expression "cron(0 7 ? * MON-FRI *)" \
  --description "Start AWS resources at 7 AM weekdays"

# Add Lambda target
aws events put-targets \
  --rule lights-out-start \
  --targets "Id=1,Arn=arn:aws:lambda:us-east-1:YOUR_ACCOUNT:function:lights-out-start"

# Grant EventBridge permission to invoke Lambda
aws lambda add-permission \
  --function-name lights-out-start \
  --statement-id AllowEventBridgeInvoke \
  --action lambda:InvokeFunction \
  --principal events.amazonaws.com \
  --source-arn arn:aws:events:us-east-1:YOUR_ACCOUNT:rule/lights-out-start
```

### 6. Tag Your Resources

Tag resources you want to manage:

```bash
# EC2
aws ec2 create-tags \
  --resources i-1234567890abcdef0 \
  --tags Key=LightsOut,Value=enabled

# RDS
aws rds add-tags-to-resource \
  --resource-name arn:aws:rds:us-east-1:123456789012:db:mydb \
  --tags Key=LightsOut,Value=enabled

# Auto Scaling Group
aws autoscaling create-or-update-tags \
  --tags ResourceId=my-asg,ResourceType=auto-scaling-group,Key=LightsOut,Value=enabled,PropagateAtLaunch=false
```

## Testing

### Dry Run Test

Enable dry run mode to test without actually starting/stopping resources:

```bash
aws lambda update-function-configuration \
  --function-name lights-out-start \
  --environment Variables="{LIGHTS_OUT_CONFIG_PARAM=/lights-out/config,DRY_RUN=true,AWS_REGION=us-east-1}"

# Invoke and check logs
aws lambda invoke \
  --function-name lights-out-start \
  --log-type Tail \
  response.json

# View response
cat response.json
```

### Manual Invocation

```bash
# Start resources
aws lambda invoke \
  --function-name lights-out-start \
  response-start.json

# Stop resources  
aws lambda invoke \
  --function-name lights-out-stop \
  response-stop.json
```

## Monitoring

View logs in CloudWatch:

```bash
# View latest logs for start function
aws logs tail /aws/lambda/lights-out-start --follow

# View latest logs for stop function
aws logs tail /aws/lambda/lights-out-stop --follow
```

## Updating Configuration

Update the SSM parameter:

```bash
aws ssm put-parameter \
  --name "/lights-out/config" \
  --type "String" \
  --value file://configs/example-config.json \
  --overwrite
```

## Cleanup

To remove all resources:

```bash
# Delete EventBridge rules
aws events remove-targets --rule lights-out-start --ids 1
aws events remove-targets --rule lights-out-stop --ids 1
aws events delete-rule --name lights-out-start
aws events delete-rule --name lights-out-stop

# Delete Lambda functions
aws lambda delete-function --function-name lights-out-start
aws lambda delete-function --function-name lights-out-stop

# Delete SSM parameter
aws ssm delete-parameter --name /lights-out/config

# Delete IAM role (after detaching policies)
aws iam delete-role --role-name LightsOutLambdaRole
```

## Troubleshooting

### Check CloudWatch Logs

If resources aren't starting/stopping:

1. Check CloudWatch Logs for errors
2. Verify IAM permissions
3. Ensure resources are tagged correctly
4. Test with DRY_RUN=true first

### Common Issues

1. **No resources discovered**: Check tag key/value in configuration and on resources
2. **Permission denied**: Verify IAM role has all required permissions
3. **RDS won't stop**: Some RDS instances can't be stopped (e.g., read replicas)
4. **ASG not responding**: Check ASG has processes to suspend/resume

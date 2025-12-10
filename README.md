# AWS Lights Out Plan

Automated AWS resource management to save costs by automatically starting and stopping resources based on schedules and tags.

## Overview

AWS Lights Out is a serverless proof-of-concept that helps reduce AWS costs by automatically managing resource lifecycles. It uses AWS Lambda functions to discover tagged resources and orchestrate start/stop operations with configurable priorities.

### Key Features

- 🏷️ **Tag-based Discovery**: Uses AWS Resource Groups Tagging API to find resources
- ⚙️ **SSM Configuration**: Load JSON configuration from AWS SSM Parameter Store
- 📊 **Priority-based Orchestration**: Start databases before apps, stop apps before databases
- 🔒 **Dry Run Mode**: Test operations without actual changes via `DRY_RUN` environment variable
- 📝 **Structured JSON Logging**: All logs in machine-readable JSON format
- 🔧 **Extensible**: Built with Pydantic models for future AI/MCP integration

### Supported Resources

- **EC2 Instances**: Start/stop instances
- **RDS Instances & Clusters**: Start/stop databases
- **Auto Scaling Groups**: Suspend/resume processes

## Project Structure

```
aws-lights-out-plan/
├── src/lights_out/
│   ├── core/              # Core functionality
│   │   ├── config.py      # Configuration with SSM support
│   │   ├── logger.py      # Structured JSON logging
│   │   └── models.py      # Pydantic models
│   ├── discovery/         # Resource discovery
│   │   └── resource_discovery.py
│   ├── app/               # Application logic
│   │   └── orchestrator.py  # Start/stop orchestration
│   └── handlers/          # Lambda handlers
│       ├── start_handler.py
│       └── stop_handler.py
├── configs/               # Configuration examples
│   └── example-config.json
├── docs/                  # Documentation
│   └── CONFIGURATION.md
└── tests/                 # Unit tests
    ├── test_config.py
    ├── test_models.py
    └── test_orchestrator.py
```

## Quick Start

### 1. Install Dependencies

```bash
pip install -r requirements.txt
```

### 2. Tag Your Resources

Tag AWS resources with the `LightsOut` tag:

```bash
# EC2 instance
aws ec2 create-tags \
  --resources i-1234567890abcdef0 \
  --tags Key=LightsOut,Value=enabled

# RDS instance
aws rds add-tags-to-resource \
  --resource-name arn:aws:rds:us-east-1:123456789012:db:mydb \
  --tags Key=LightsOut,Value=enabled
```

### 3. Deploy Configuration to SSM (Optional)

```bash
aws ssm put-parameter \
  --name "/lights-out/config" \
  --type "String" \
  --value file://configs/example-config.json
```

### 4. Deploy Lambda Functions

Configure Lambda functions with:
- **Runtime**: Python 3.9+
- **Handler**: 
  - Start: `lights_out.handlers.start_handler.handler`
  - Stop: `lights_out.handlers.stop_handler.handler`
- **Environment Variables**:
  - `LIGHTS_OUT_CONFIG_PARAM`: `/lights-out/config` (optional)
  - `DRY_RUN`: `true` or `false` (optional)
  - `AWS_REGION`: Your AWS region

### 5. Test with Dry Run

```bash
export DRY_RUN=true
python -c "from lights_out.handlers.start_handler import handler; handler({}, None)"
```

## Configuration

See [docs/CONFIGURATION.md](docs/CONFIGURATION.md) for detailed configuration options.

### Example Configuration

```json
{
  "tag_key": "LightsOut",
  "tag_value": "enabled",
  "resources": [
    {
      "resource_type": "rds",
      "priority": 1,
      "enabled": true
    },
    {
      "resource_type": "ec2",
      "priority": 2,
      "enabled": true
    },
    {
      "resource_type": "asg",
      "priority": 3,
      "enabled": true
    }
  ],
  "dry_run": false
}
```

### Priority System

- **Lower priority starts first**: Databases (1) → Apps (2) → ASG (3)
- **Higher priority stops first**: ASG (3) → Apps (2) → Databases (1)

This ensures applications have database access when starting and databases remain available until apps are stopped.

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `LIGHTS_OUT_CONFIG_PARAM` | SSM Parameter Store path | None (uses defaults) |
| `DRY_RUN` | Enable dry run mode | `false` |
| `AWS_REGION` | AWS region | `us-east-1` |

## Logging

All operations log structured JSON to stdout:

```json
{
  "timestamp": "2025-12-09T08:00:00.000000+00:00",
  "level": "INFO",
  "logger": "lights_out.handlers.start_handler",
  "message": "Start handler invoked"
}
```

## Testing

Run tests with pytest:

```bash
# Install dev dependencies
pip install -r requirements-dev.txt

# Run tests
pytest tests/ -v

# Run with coverage
pytest tests/ --cov=src --cov-report=html
```

## IAM Permissions

The Lambda execution role needs:

- `tag:GetResources` - Discover tagged resources
- `ec2:StartInstances`, `ec2:StopInstances` - Manage EC2
- `rds:Start*`, `rds:Stop*` - Manage RDS
- `autoscaling:SuspendProcesses`, `autoscaling:ResumeProcesses` - Manage ASG
- `ssm:GetParameter` - Load configuration

See [docs/CONFIGURATION.md](docs/CONFIGURATION.md) for complete IAM policy.

## Scheduling

Use EventBridge to schedule operations:

```bash
# Stop at 7 PM weekdays
aws events put-rule \
  --name lights-out-stop \
  --schedule-expression "cron(0 19 ? * MON-FRI *)"

# Start at 7 AM weekdays
aws events put-rule \
  --name lights-out-start \
  --schedule-expression "cron(0 7 ? * MON-FRI *)"
```

## Future Enhancements

- AI-driven scheduling optimization
- Machine learning for usage pattern analysis
- Model Context Protocol (MCP) integration
- Cost savings analytics
- Multi-region support
- Additional resource types (ECS, EKS, etc.)

## License

MIT

## Contributing

Contributions welcome! Please submit issues and pull requests.
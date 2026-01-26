# Lights Out Onboarding Plugin

Claude Code Plugin for AWS Lights Out resource discovery and configuration guidance.

## Overview

This plugin provides slash commands to help users:

1. Discover AWS resources (ECS Services, RDS Instances)
2. Analyze resources for Lights Out suitability
3. Generate configuration recommendations

## Installation

### Prerequisites

- Node.js 22+
- AWS CLI configured with SSO profile
- Claude Code CLI

### Build

```bash
cd packages/lights-out-onboarding
npm install
npm run build
```

### Register Plugin

Add to your Claude Code settings (`.claude/settings.json`):

```json
{
  "plugins": ["./packages/lights-out-onboarding"]
}
```

Or register the MCP server directly in `.mcp.json`:

```json
{
  "mcpServers": {
    "lights-out-discovery": {
      "command": "node",
      "args": ["packages/lights-out-onboarding/servers/discovery-mcp/dist/index.js"]
    }
  }
}
```

## Usage

### /lights-out-discover

Guided workflow to discover AWS resources and generate an analysis report.

```
/lights-out-discover
```

The command will:

1. Verify AWS credentials
2. Let you select AWS regions to scan
3. Discover ECS Services and RDS Instances
4. Generate a detailed analysis report with recommendations

## MCP Server Tools

The plugin includes an MCP server with the following tools:

### verify_credentials

Verify AWS credentials and return account identity.

**Parameters:**

- `profile` (optional): AWS profile name

**Returns:**

```json
{
  "valid": true,
  "identity": {
    "account": "123456789012",
    "arn": "arn:aws:iam::123456789012:user/username",
    "userId": "AIDAEXAMPLE"
  }
}
```

### discover_ecs_services

Discover ECS services in specified regions.

**Parameters:**

- `regions`: Array of AWS region codes

**Returns:**

```json
{
  "services": [
    {
      "region": "ap-southeast-1",
      "clusterName": "my-cluster",
      "serviceName": "my-service",
      "arn": "arn:aws:ecs:...",
      "desiredCount": 2,
      "runningCount": 2,
      "status": "ACTIVE",
      "hasAutoScaling": true,
      "autoScalingConfig": {
        "minCapacity": 1,
        "maxCapacity": 4
      },
      "tags": {},
      "hasLightsOutTags": false
    }
  ]
}
```

### discover_rds_instances

Discover RDS instances in specified regions.

**Parameters:**

- `regions`: Array of AWS region codes

**Returns:**

```json
{
  "instances": [
    {
      "region": "ap-southeast-1",
      "instanceId": "my-database",
      "arn": "arn:aws:rds:...",
      "engine": "mysql",
      "engineVersion": "8.0",
      "status": "available",
      "instanceClass": "db.t3.micro",
      "multiAZ": false,
      "tags": {},
      "hasLightsOutTags": false
    }
  ]
}
```

### analyze_resources

Analyze resources and generate recommendations.

**Parameters:**

- `resources`: Object containing `ecs` and `rds` arrays from discovery tools

**Returns:**
Markdown-formatted analysis report with:

- Summary statistics
- Resource tables
- Per-resource recommendations
- Suggested tags and configuration

## Required IAM Permissions

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "sts:GetCallerIdentity",
        "ecs:ListClusters",
        "ecs:ListServices",
        "ecs:DescribeServices",
        "ecs:ListTagsForResource",
        "rds:DescribeDBInstances",
        "rds:ListTagsForResource",
        "application-autoscaling:DescribeScalableTargets"
      ],
      "Resource": "*"
    }
  ]
}
```

## Development

### Project Structure

```
packages/lights-out-onboarding/
├── .claude-plugin/
│   └── plugin.json           # Plugin manifest
├── commands/
│   └── lights-out-discover.md # Slash command definition
├── servers/
│   └── discovery-mcp/
│       ├── src/
│       │   ├── index.ts      # MCP Server entry point
│       │   ├── types.ts      # Type definitions
│       │   └── tools/        # Tool implementations
│       ├── package.json
│       └── tsconfig.json
├── templates/
│   └── report-template.md    # Report template
├── .mcp.json                 # MCP Server config
├── package.json
└── README.md
```

### Building

```bash
# Build MCP server
npm run build

# Watch mode for development
npm run dev
```

### Testing

```bash
# Test MCP server with mcp-server-test
npx @anthropic-ai/mcp-server-test servers/discovery-mcp/dist/index.js
```

## License

ISC

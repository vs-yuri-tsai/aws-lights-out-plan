# Lights Out - Project Onboarding Guide

This guide explains how to set up a new project for the Lights Out automated resource management system.

## Prerequisites

Before onboarding a new project, ensure the following are in place:

### 1. AWS SSO Profile

You need an AWS SSO profile configured in your `~/.aws/config`:

```ini
[profile my-account]
sso_session = my-session
sso_account_id = 123456789012
sso_role_name = AdministratorAccess
region = us-east-1

[sso-session my-session]
sso_start_url = https://my-org.awsapps.com/start
sso_region = us-east-1
sso_registration_scopes = sso:account:access
```

### 2. AWS Resource Tags

Your AWS resources must be tagged for discovery:

| Tag Key               | Value            | Description                                    |
| --------------------- | ---------------- | ---------------------------------------------- |
| `lights-out:managed`  | `true`           | Required for all resources                     |
| `lights-out:project`  | `{project-name}` | For project-scoped resources                   |
| `lights-out:group`    | `{group-name}`   | For account-wide resource groups               |
| `lights-out:priority` | `100`            | Optional: Lower numbers start first, stop last |

**Example for ECS Service:**

```
lights-out:managed = true
lights-out:project = my-project
lights-out:priority = 100
```

### 3. Required Permissions

The deployment account needs permissions to:

- Deploy Lambda functions (Serverless Framework)
- Create/update SSM Parameters
- Read resource tags
- Manage ECS Services
- Manage RDS Instances (if applicable)
- Manage Application Auto Scaling (if applicable)

---

## Quick Start (Interactive Wizard)

The fastest way to onboard a new project is using the interactive wizard:

```bash
node scripts/onboard-project.js
```

The wizard will guide you through 10 steps:

1. **Project Information** - Name, account alias, AWS profile, primary region
2. **Scope Selection** - Account-wide or project-specific resources
3. **Region Mode** - Single, multiple, or grouped regions
4. **Resource Types** - ECS Services, RDS Instances
5. **ECS Configuration** - Direct or Auto Scaling mode
6. **RDS Configuration** - Wait time, snapshot settings
7. **Schedule** - Timezone, start/stop times, active days
8. **Notifications** - Teams webhook configuration
9. **Summary** - Review all settings
10. **Generate Files** - Create configuration files

### Generated Files

The wizard creates two files:

1. **`scripts/arguments/{project}.json`** - Lambda invocation arguments
2. **`config/{account}/{project}.yml`** - Project configuration

### After Running the Wizard

Follow these steps to complete the setup:

```bash
# 1. Update serverless.yml with the new stage mapping
#    Edit custom.resolveConfigPath section

# 2. Deploy the Lambda function
pnpm deploy

# 3. Upload configuration to SSM Parameter Store
pnpm config

# 4. Verify resource discovery
pnpm action  # Select "Discover"
```

---

## Manual Configuration

For advanced users who prefer manual setup:

### Step 1: Create Argument File

Create `scripts/arguments/{project}.json`:

```json
{
  "scope": "project",
  "region": "us-east-1",
  "stage": "my-account-my-project",
  "profile": "my-account",
  "function-name": "lights-out-my-account-my-project",
  "config": {
    "name": "/lights-out/my-account-my-project/config",
    "path": "config/my-account/my-project.yml",
    "description": "Lights Out configuration for my-project"
  }
}
```

### Step 2: Create Configuration File

Copy the template and customize:

```bash
mkdir -p config/my-account
cp config/templates/project.yml config/my-account/my-project.yml
```

Edit the configuration file with your settings. See the template for detailed comments on each option.

### Step 3: Generate Cron Expressions

```bash
node scripts/generate-cron.js --config config/my-account/my-project.yml
```

### Step 4: Update serverless.yml

Add the stage mapping:

```yaml
custom:
  resolveConfigPath:
    my-account-my-project: my-account/my-project.yml
```

### Step 5: Deploy and Configure

```bash
# Deploy Lambda
pnpm deploy

# Upload configuration
pnpm config

# Verify
pnpm action  # Select "Discover"
```

---

## Configuration Options

### Region Modes

#### Single Region

```yaml
regions:
  - us-east-1
```

#### Multiple Regions (Shared Schedule)

```yaml
regions:
  - us-east-1
  - ap-southeast-1
  - ap-northeast-1
```

#### Region Groups (Different Schedules)

```yaml
region_groups:
  asia:
    - ap-southeast-1
    - ap-northeast-1
  america:
    - us-east-1
    - us-west-2

group_schedules:
  asia:
    timezone: Asia/Taipei
    startTime: '08:00'
    stopTime: '22:00'
    activeDays: [MON, TUE, WED, THU, FRI]
    enabled: true
  america:
    timezone: America/New_York
    startTime: '08:00'
    stopTime: '18:00'
    activeDays: [MON, TUE, WED, THU, FRI]
    enabled: true
```

### ECS Service Modes

#### Direct Mode (No Auto Scaling)

```yaml
resource_defaults:
  ecs-service:
    waitForStable: true
    stableTimeoutSeconds: 300
    start:
      desiredCount: 1
    stop:
      desiredCount: 0
```

#### Auto Scaling Mode

```yaml
resource_defaults:
  ecs-service:
    waitForStable: true
    stableTimeoutSeconds: 300
    start:
      minCapacity: 2
      maxCapacity: 6
      desiredCount: 2
    stop:
      minCapacity: 0
      maxCapacity: 0
      desiredCount: 0
```

### RDS Instance Configuration

```yaml
resource_defaults:
  rds-db:
    waitAfterCommand: 60 # Seconds to wait after command
    skipSnapshot: true # Skip snapshot on stop (dev environments)
```

---

## Verification Steps

After completing the setup, verify your configuration:

### 1. Check Resource Discovery

```bash
pnpm action
# Select your project
# Select "Discover"
```

Expected output shows discovered resources with their tags.

### 2. Check Resource Status

```bash
pnpm action
# Select your project
# Select "Status"
```

Expected output shows current state of all managed resources.

### 3. Test Start/Stop (Optional)

```bash
pnpm action
# Select your project
# Select "Stop" or "Start"
```

**Warning:** This will actually stop/start your resources!

---

## Troubleshooting

### No Resources Discovered

1. Verify tags are correctly applied to resources
2. Check the `lights-out:managed` tag value is exactly `true` (string)
3. Ensure the discovery region matches your resource region
4. Verify IAM permissions for tag:GetResources

### Configuration Upload Fails

1. Check AWS SSO session is active: `aws sso login --profile {profile}`
2. Verify SSM Parameter permissions
3. Check YAML syntax: `node -e "require('js-yaml').load(require('fs').readFileSync('config/path/to/file.yml'))"`

### Lambda Invocation Fails

1. Check Lambda function exists: `aws lambda get-function --function-name lights-out-{stage}`
2. Verify IAM role permissions
3. Check CloudWatch Logs for error details

### ECS Service Not Updating

1. Check if service has Application Auto Scaling configured
2. If yes, ensure configuration includes `minCapacity` and `maxCapacity`
3. Verify ECS service permissions

### RDS Instance Stuck

1. RDS operations take 5-10 minutes - check status in AWS Console
2. Check for pending maintenance windows
3. Verify RDS instance is not in a protected state

---

## Related Documentation

- [Deployment Guide](./deployment-guide.md) - Full deployment and operations manual
- [CLAUDE.md](../CLAUDE.md) - Technical specifications
- [config/templates/project.yml](../config/templates/project.yml) - Configuration template with comments

#!/usr/bin/env node

/**
 * Interactive command runner with prompts
 *
 * Usage:
 *   node scripts/run-interactive.js --mode action
 *   node scripts/run-interactive.js --mode config
 *   node scripts/run-interactive.js --mode deploy
 */

const { execSync } = require('child_process');
const prompts = require('prompts');
const path = require('path');
const fs = require('fs');

// Discover available targets from arguments directory
function getAvailableTargets() {
  const argsDir = path.join(__dirname, 'arguments');
  const files = fs.readdirSync(argsDir);

  return files
    .filter(file => file.endsWith('.json'))
    .map(file => {
      const targetName = file.replace('.json', '');
      const argPath = path.join(argsDir, file);
      const args = JSON.parse(fs.readFileSync(argPath, 'utf8'));

      // Read scope from arguments file
      const scope = args.scope || 'unknown scope';
      const scopeLabel = scope === 'project' ? 'project scope' :
                        scope === 'aws-account' ? 'aws account scope' :
                        scope;

      return {
        title: `${targetName} (${args.region})`,
        value: targetName,
        description: `${args.stage || targetName} (${scopeLabel})`,
      };
    });
}

const MODES = {
  action: {
    title: 'Lambda Action',
    choices: [
      {
        title: '▶️  Start   - Start all managed resources',
        value: 'start',
      },
      {
        title: '⏹️  Stop    - Stop all managed resources',
        value: 'stop',
      },
      {
        title: '📊 Status  - Check current resource status',
        value: 'status',
      },
      {
        title: '🔍 Discover - Find resources with lights-out tags',
        value: 'discover',
      },
    ],
    script: 'invoke-lambda',
  },
  config: {
    title: 'SSM Config Management',
    choices: [
      {
        title: '⬆️  Upload   - Deploy YAML config to SSM Parameter Store',
        value: 'upload',
      },
      {
        title: '⬇️  Retrieve - Fetch current config from SSM Parameter Store',
        value: 'retrieve',
      },
    ],
    scriptMap: {
      upload: 'deploy-config',
      retrieve: 'get-ssm-config',
    },
  },
  deploy: {
    title: 'Serverless Deployment',
    choices: [
      {
        title: '🚀 All          - Full Serverless deployment (infrastructure + Lambda)',
        value: 'all',
      },
      {
        title: '⚡ Lambda Only  - Quick Lambda function code update only',
        value: 'lambda-function',
      },
    ],
    customCommand: true,
  },
};

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const params = {};

  for (let i = 0; i < args.length; i += 2) {
    const key = args[i].replace(/^--/, '');
    const value = args[i + 1];
    params[key] = value;
  }

  return params;
}

// Main function
async function main() {
  try {
    const params = parseArgs();

    if (!params.mode || !MODES[params.mode]) {
      console.error('❌ Invalid or missing mode. Valid modes: action, config, deploy');
      console.error('\nUsage:');
      console.error('  node scripts/run-interactive.js --mode <action|config|deploy>');
      console.error('\nExample:');
      console.error('  node scripts/run-interactive.js --mode action');
      process.exit(1);
    }

    const mode = MODES[params.mode];

    // Step 1: Select target
    const availableTargets = getAvailableTargets();

    if (availableTargets.length === 0) {
      console.error('❌ No targets found in scripts/arguments/');
      process.exit(1);
    }

    const targetResponse = await prompts({
      type: 'select',
      name: 'target',
      message: 'Select target',
      choices: availableTargets,
      initial: 0,
    });

    if (!targetResponse.target) {
      console.log('\n👋 Cancelled\n');
      process.exit(0);
    }

    const projectName = targetResponse.target;

    // Ask user to select option
    const response = await prompts({
      type: 'select',
      name: 'selection',
      message: `${mode.title} for ${projectName}`,
      choices: mode.choices,
      initial: 0,
    });

    // Handle Ctrl+C or ESC
    if (!response.selection) {
      console.log('\n👋 Cancelled\n');
      process.exit(0);
    }

    const selectedValue = response.selection;

    console.log(''); // Empty line for spacing

    // Handle deploy mode with custom commands
    if (params.mode === 'deploy') {
      // Load project arguments for region and stage info
      const argFilePath = path.join(__dirname, 'arguments', `${projectName}.json`);
      const projectArgs = JSON.parse(fs.readFileSync(argFilePath, 'utf8'));

      // Set AWS credentials environment variables
      const env = { ...process.env };

      // CRITICAL: Clear all AWS credentials to prevent conflicts with terminal env vars
      delete env.AWS_PROFILE;
      delete env.AWS_ACCESS_KEY_ID;
      delete env.AWS_SECRET_ACCESS_KEY;
      delete env.AWS_SESSION_TOKEN;

      if (projectArgs.profile) {
        console.log(`🔑 Using AWS profile: ${projectArgs.profile}`);

        try {
          // Export SSO credentials as environment variables (most reliable method)
          // This bypasses serverless-better-credentials issues with SSO
          const credentialsJson = execSync(
            `aws configure export-credentials --profile ${projectArgs.profile} --format env-no-export`,
            { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
          );

          // Parse and set credentials as environment variables
          credentialsJson.trim().split('\n').forEach(line => {
            const [key, value] = line.split('=');
            if (key && value) {
              env[key] = value;
            }
          });

          console.log('✅ SSO credentials exported successfully');
        } catch (error) {
          // Fallback to AWS_PROFILE if export-credentials fails
          console.warn('⚠️  Could not export SSO credentials, falling back to AWS_PROFILE');
          console.warn('   If deployment fails, run: aws sso login --profile ' + projectArgs.profile);
          env.AWS_PROFILE = projectArgs.profile;
        }
      }

      if (selectedValue === 'all') {
        // Full Serverless deployment
        const configPath = projectArgs.config?.path;
        const region = projectArgs.region;
        const stage = projectArgs.stage;

        // Profile is set via env.AWS_PROFILE (see above), no CLI parameter needed
        const command = `node scripts/generate-cron.js --config ${configPath} && serverless deploy --region ${region} --stage ${stage} --verbose`;
        execSync(command, { stdio: 'inherit', env });
      } else if (selectedValue === 'lambda-function') {
        // Lambda-only deployment
        const region = projectArgs.region;
        const stage = projectArgs.stage;

        // Profile is set via env.AWS_PROFILE (see above), no CLI parameter needed
        const command = `serverless deploy function -f handler --region ${region} --stage ${stage} --verbose`;
        execSync(command, { stdio: 'inherit', env });
      }
      return;
    }

    // Handle action and config modes
    let scriptName;
    let actionParam = '';

    if (params.mode === 'action') {
      scriptName = mode.script;
      actionParam = ` --action ${selectedValue}`;
    } else if (params.mode === 'config') {
      scriptName = mode.scriptMap[selectedValue];
    }

    // Run the selected command
    const runScript = path.join(__dirname, 'run-command.js');
    const command = `node "${runScript}" --project ${projectName} --script ${scriptName}${actionParam}`;

    execSync(command, { stdio: 'inherit' });

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
}

main();

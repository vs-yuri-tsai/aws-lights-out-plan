#!/usr/bin/env node
/* eslint-disable no-undef */

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
const { setupAwsCredentials } = require('./aws-credentials');

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
        title: '📊 Status   - Check current resource status',
        value: 'status',
      },
      {
        title: '🔍 Discover - Find resources with lights-out tags',
        value: 'discover',
      },
    ],
    script: 'invoke-lambda-handler',
  },
  config: {
    title: 'SSM Config Management',
    choices: [
      {
        title: '⬆️  Upload Project Config  - Deploy YAML config to SSM Parameter Store',
        value: 'upload',
      },
      {
        title: '⬇️  Retrieve Project Config - Fetch current config from SSM Parameter Store',
        value: 'retrieve',
      },
      {
        title: '🔑 Upload Teams Webhook Token - Upload Teams webhook security token',
        value: 'upload-token',
      },
    ],
    scriptMap: {
      upload: 'deploy-config',
      'upload-token': 'upload-teams-webhook-token',
      retrieve: 'get-ssm-config',
    },
    promptForToken: true, // Flag to indicate this mode needs token input
  },
  deploy: {
    title: 'Serverless Deployment',
    choices: [
      {
        title: '🚀 All                              - Full Serverless deployment (infrastructure + Lambda)',
        value: 'all',
      },
      {
        title: '⚡ Lambda: Handler function         - Deploy only the Lambda `handler` function',
        value: 'lambda-function-handler',
      }
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
      console.error('  node scripts/run-interactive.js --mode deploy');
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

    // Load project arguments (used by all modes)
    const argFilePath = path.join(__dirname, 'arguments', `${projectName}.json`);
    const projectArgs = JSON.parse(fs.readFileSync(argFilePath, 'utf8'));

    // Handle deploy mode with custom commands
    if (params.mode === 'deploy') {
      // Validate required fields for deploy mode
      if (!projectArgs.region) {
        console.error(`❌ Missing required field: "region" in ${argFilePath}`);
        console.error('   Please set the "region" field in your project arguments file.');
        process.exit(1);
      }
      if (!projectArgs.stage) {
        console.error(`❌ Missing required field: "stage" in ${argFilePath}`);
        console.error('   Please set the "stage" field in your project arguments file.');
        process.exit(1);
      }

      // Set AWS credentials environment variables
      const env = setupAwsCredentials(projectArgs.profile);

      const region = projectArgs.region;
      const stage = projectArgs.stage;

      if (selectedValue === 'all') {
        // Full Serverless deployment
        const configPath = projectArgs.config?.path;
        const command = `node scripts/generate-cron.js --config ${configPath} && serverless deploy --region ${region} --stage ${stage} --verbose`;
        execSync(command, { stdio: 'inherit', env });
      } else if( selectedValue.startsWith('lambda-function-')) {
        // Lambda-only deployment
        const functionName = selectedValue.replace('lambda-function-', '');
        const command = `serverless deploy function -f ${functionName} --region ${region} --stage ${stage} --verbose`;
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

      // Special handling for upload-token: prompt for token value
      if (selectedValue === 'upload-token') {
        const tokenResponse = await prompts({
          type: 'password',
          name: 'token',
          message: 'Enter Teams webhook security token',
          validate: value => {
            if (!value || value.trim().length === 0) {
              return 'Token cannot be empty';
            }
            if (value.length < 10) {
              return 'Token seems too short (expected at least 10 characters)';
            }
            return true;
          },
        });

        // Handle Ctrl+C or ESC
        if (!tokenResponse.token) {
          console.log('\n👋 Cancelled\n');
          process.exit(0);
        }

        // Run upload-teams-webhook-token.js directly with token parameter
        const uploadScript = path.join(__dirname, `${scriptName}.js`);
        const command = `node "${uploadScript}" --project ${projectName} --token "${tokenResponse.token}"`;

        execSync(command, { stdio: 'inherit' });
        return;
      }
    }

    // Run the selected command (for non-upload-token options)
    const runScript = path.join(__dirname, 'run-command.js');
    const command = `node "${runScript}" --project ${projectName} --script ${scriptName}${actionParam}`;

    execSync(command, { stdio: 'inherit' });

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
}

main();

#!/usr/bin/env node
/* eslint-disable no-undef */

/**
 * Unified command runner that reads arguments from JSON files
 *
 * Usage:
 *   node scripts/run-command.js --project airsync-dev --script invoke-lambda-handler --action start
 *   node scripts/run-command.js --project airsync-dev --script deploy-config
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { setupAwsCredentials } = require('./aws-credentials');

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

// Load project arguments from JSON
function loadProjectArgs(projectName) {
  const argFilePath = path.join(__dirname, 'arguments', `${projectName}.json`);

  if (!fs.existsSync(argFilePath)) {
    throw new Error(`Arguments file not found: ${argFilePath}`);
  }

  const content = fs.readFileSync(argFilePath, 'utf8');
  return JSON.parse(content);
}

// Build command line from arguments
function buildCommand(scriptName, projectArgs, extraArgs = {}) {
  const scriptPath = path.join(__dirname, `${scriptName}.js`);

  if (!fs.existsSync(scriptPath)) {
    throw new Error(`Script not found: ${scriptPath}`);
  }

  const args = [];

  // Script-specific argument mapping
  // Note: invoke-lambda-handler uses arguments.json region (Lambda deployment region),
  // NOT config.yml regions (which are the regions Lambda scans for resources)
  const argMappings = {
    'invoke-lambda-handler': {
      'function-name': projectArgs['function-name'],
      region: projectArgs.region,
      action: extraArgs.action,
    },
    'deploy-config': {
      name: projectArgs.config?.name,
      config: projectArgs.config?.path,
      region: projectArgs.region,
      description: projectArgs.config?.description,
    },
    'get-ssm-config': {
      name: projectArgs.config?.name,
      region: projectArgs.region,
    },
  };

  const mapping = argMappings[scriptName];
  if (!mapping) {
    throw new Error(`Unknown script: ${scriptName}`);
  }

  // Build argument list
  for (const [key, value] of Object.entries(mapping)) {
    if (value !== undefined && value !== null) {
      args.push(`--${key}`, value);
    }
  }

  return `node "${scriptPath}" ${args.join(' ')}`;
}

// Main function
function main() {
  try {
    const params = parseArgs();

    if (!params.project) {
      console.error('❌ Missing required parameter: --project');
      console.error('\nUsage:');
      console.error(
        '  node scripts/run-command.js --project <name> --script <script-name> [--action <action>]'
      );
      console.error('\nExamples:');
      console.error(
        '  node scripts/run-command.js --project airsync-dev --script invoke-lambda-handler --action start'
      );
      console.error('  node scripts/run-command.js --project airsync-dev --script deploy-config');
      process.exit(1);
    }

    if (!params.script) {
      console.error('❌ Missing required parameter: --script');
      process.exit(1);
    }

    // Load project arguments
    const projectArgs = loadProjectArgs(params.project);

    // Set AWS credentials environment variables
    const env = setupAwsCredentials(projectArgs.profile);

    // Build and execute command
    const extraArgs = {
      action: params.action,
    };

    const command = buildCommand(params.script, projectArgs, extraArgs);

    console.log(`🚀 Executing: ${params.script}`);
    console.log(`📦 Project: ${params.project}\n`);

    // Execute the command with clean credentials environment
    execSync(command, { stdio: 'inherit', env });
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
}

main();

#!/usr/bin/env node
/* eslint-disable no-undef */

/**
 * Upload Teams webhook security token to SSM Parameter Store.
 *
 * Usage:
 *   node scripts/upload-teams-webhook-token.js --project <project-name> --token <security-token>
 */

const { SSMClient, PutParameterCommand } = require('@aws-sdk/client-ssm');
const path = require('path');
const fs = require('fs');
const { setupAwsCredentials } = require('./aws-credentials');

/**
 * Parse command line arguments.
 */
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

/**
 * Upload Teams webhook token to SSM Parameter Store.
 */
async function main() {
  try {
    const params = parseArgs();

    // Validate required parameters
    if (!params.project) {
      console.error('❌ Missing required parameter: --project');
      console.error('\nUsage:');
      console.error('  node scripts/upload-teams-webhook-token.js --project <project-name> --token <security-token>');
      process.exit(1);
    }

    if (!params.token) {
      console.error('❌ Missing required parameter: --token');
      console.error('\nUsage:');
      console.error('  node scripts/upload-teams-webhook-token.js --project <project-name> --token <security-token>');
      process.exit(1);
    }

    // Load project arguments
    const argFilePath = path.join(__dirname, 'arguments', `${params.project}.json`);

    if (!fs.existsSync(argFilePath)) {
      console.error(`❌ Project arguments file not found: ${argFilePath}`);
      console.error(`   Available projects are in scripts/arguments/`);
      process.exit(1);
    }

    const projectArgs = JSON.parse(fs.readFileSync(argFilePath, 'utf8'));

    // Validate required fields
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

    const region = projectArgs.region;
    const stage = projectArgs.stage;
    const parameterName = `/lights-out/${stage}/teams-webhook-token`;

    console.log('');
    console.log('📝 Teams Webhook Token Upload');
    console.log('─'.repeat(50));
    console.log(`Project:        ${params.project}`);
    console.log(`Region:         ${region}`);
    console.log(`Stage:          ${stage}`);
    console.log(`Parameter Name: ${parameterName}`);
    console.log('─'.repeat(50));
    console.log('');

    // Set AWS credentials environment variables
    const env = setupAwsCredentials(projectArgs.profile);

    // Create SSM client
    const ssmClient = new SSMClient({ region, ...env });

    // Upload token as SecureString
    const command = new PutParameterCommand({
      Name: parameterName,
      Value: params.token,
      Type: 'SecureString',
      Description: `Microsoft Teams Outgoing Webhook security token for ${stage} environment`,
      Overwrite: true, // Allow updating existing parameter
    });

    console.log('⏳ Uploading token to SSM Parameter Store...');

    await ssmClient.send(command);

    console.log('');
    console.log('✅ Teams webhook token uploaded successfully!');
    console.log('');
    console.log('ℹ️  Next Steps:');
    console.log('   1. Configure Teams Outgoing Webhook in your Teams app');
    console.log('   2. Copy the security token from Teams webhook settings');
    console.log('   3. Verify the token matches what you just uploaded');
    console.log('');

  } catch (error) {
    console.error('');
    console.error('❌ Error:', error.message);

    if (error.name === 'ParameterLimitExceeded') {
      console.error('   SSM Parameter Store limit reached for this region/account.');
    } else if (error.name === 'ParameterAlreadyExists') {
      console.error('   Parameter already exists. Use --overwrite flag to update.');
    } else if (error.name === 'AccessDeniedException') {
      console.error('   AWS credentials do not have permission to create SSM parameters.');
      console.error('   Required IAM permission: ssm:PutParameter');
    }

    console.error('');
    process.exit(1);
  }
}

main();

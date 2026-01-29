#!/usr/bin/env node
/* eslint-disable no-undef */

/**
 * Deploy YAML configuration to AWS SSM Parameter Store
 *
 * Usage:
 *   node scripts/deploy-config.js \
 *     --name "/lights-out/config" \
 *     --config "config/pg-development/airsync-dev.yml" \
 *     --region "ap-southeast-1" \
 *     --description "Lights Out configuration"
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { SSMClient, PutParameterCommand } = require('@aws-sdk/client-ssm');

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

// Validate required parameters
function validateParams(params) {
  const required = ['name', 'config', 'region'];
  const missing = required.filter((key) => !params[key]);

  if (missing.length > 0) {
    console.error(`❌ Missing required parameters: ${missing.join(', ')}`);
    console.error('\nUsage:');
    console.error('  node scripts/deploy-config.js \\');
    console.error('    --name "/ssm/parameter/name" \\');
    console.error('    --config "path/to/config.yml" \\');
    console.error('    --region "aws-region" \\');
    console.error('    --description "Optional description"');
    process.exit(1);
  }
}

// Main function
async function main() {
  try {
    const params = parseArgs();
    validateParams(params);

    const { name, config, region, description = 'Deployed by deploy-config.js' } = params;

    // Resolve config file path
    const configPath = path.resolve(process.cwd(), config);

    // Check if file exists
    if (!fs.existsSync(configPath)) {
      throw new Error(`Config file not found: ${configPath}`);
    }

    console.log(`📄 Reading config from: ${configPath}`);

    // Read and parse YAML
    const yamlContent = fs.readFileSync(configPath, 'utf8');
    const configData = yaml.load(yamlContent);

    // Convert to JSON string
    const jsonValue = JSON.stringify(configData);

    console.log(`📦 Config size: ${jsonValue.length} bytes`);
    console.log(`🚀 Uploading to SSM: ${name}`);
    console.log(`🌍 Region: ${region}`);

    // Create SSM client
    const client = new SSMClient({ region });

    // Upload to SSM Parameter Store
    const command = new PutParameterCommand({
      Name: name,
      Type: 'String',
      Value: jsonValue,
      Description: description,
      Overwrite: true,
    });

    const response = await client.send(command);

    console.log(`✅ Successfully deployed config to ${name}`);
    console.log(`📌 Version: ${response.Version}`);
  } catch (error) {
    console.error('❌ Deployment failed:');
    console.error(error.message);
    process.exit(1);
  }
}

main();

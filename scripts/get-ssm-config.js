#!/usr/bin/env node

/**
 * Get configuration from AWS SSM Parameter Store
 *
 * Usage:
 *   node scripts/get-ssm-config.js \
 *     --name "/lights-out/config" \
 *     --region "us-east-1"
 */

const { SSMClient, GetParameterCommand } = require('@aws-sdk/client-ssm');

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
  const required = ['name', 'region'];
  const missing = required.filter(key => !params[key]);

  if (missing.length > 0) {
    console.error(`❌ Missing required parameters: ${missing.join(', ')}`);
    console.error('\nUsage:');
    console.error('  node scripts/get-ssm-config.js \\');
    console.error('    --name "/ssm/parameter/name" \\');
    console.error('    --region "aws-region"');
    process.exit(1);
  }
}

// Main function
async function main() {
  try {
    const params = parseArgs();
    validateParams(params);

    const { name, region } = params;

    console.log(`📄 Fetching SSM parameter: ${name}`);
    console.log(`🌍 Region: ${region}\n`);

    // Create SSM client
    const client = new SSMClient({ region });

    // Get parameter
    const command = new GetParameterCommand({
      Name: name,
      WithDecryption: true,
    });

    const response = await client.send(command);

    if (!response.Parameter || !response.Parameter.Value) {
      throw new Error('Parameter not found or empty');
    }

    console.log('✅ Configuration retrieved successfully\n');
    console.log('━'.repeat(80));

    // Try to parse as JSON for pretty printing
    try {
      const config = JSON.parse(response.Parameter.Value);
      console.log(JSON.stringify(config, null, 2));
    } catch {
      // If not JSON, print as-is
      console.log(response.Parameter.Value);
    }

    console.log('━'.repeat(80));
    console.log(`\n📌 Parameter ARN: ${response.Parameter.ARN}`);
    console.log(`📌 Last Modified: ${response.Parameter.LastModifiedDate}`);
    console.log(`📌 Version: ${response.Parameter.Version}`);

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (error.name === 'ParameterNotFound') {
      console.error('\n💡 Hint: Make sure the parameter exists and you have the correct permissions.');
      console.error('   You can create it using: npm run airsync-dev:set-config');
    }
    process.exit(1);
  }
}

main();

#!/usr/bin/env node
/* eslint-disable no-undef */

/**
 * Invoke AWS Lambda function with specified action
 *
 * Usage:
 *   node scripts/invoke-lambda-handler.js \
 *     --function-name "lights-out-dev" \
 *     --action "start" \
 *     --region "us-east-1"
 */

const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');

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
  const required = ['function-name', 'action', 'region'];
  const missing = required.filter((key) => !params[key]);

  if (missing.length > 0) {
    console.error(`❌ Missing required parameters: ${missing.join(', ')}`);
    console.error('\nUsage:');
    console.error('  node scripts/invoke-lambda-handler.js \\');
    console.error('    --function-name "lights-out-dev" \\');
    console.error('    --action "start|stop|status|discover" \\');
    console.error('    --region "aws-region"');
    process.exit(1);
  }

  // Validate action
  const validActions = ['start', 'stop', 'status', 'discover'];
  if (!validActions.includes(params.action)) {
    console.error(`❌ Invalid action: ${params.action}`);
    console.error(`   Valid actions: ${validActions.join(', ')}`);
    process.exit(1);
  }
}

// Get action emoji
function getActionEmoji(action) {
  const emojiMap = {
    start: '▶️',
    stop: '⏹️',
    status: '📊',
    discover: '🔍',
  };
  return emojiMap[action] || '⚡';
}

// Main function
async function main() {
  try {
    const params = parseArgs();
    validateParams(params);

    const { 'function-name': functionName, action, region } = params;

    console.log(`${getActionEmoji(action)} Invoking Lambda: ${functionName}`);
    console.log(`🎯 Action: ${action}`);
    console.log(`🌍 Region: ${region}\n`);

    // Create Lambda client
    const client = new LambdaClient({ region });

    // Prepare payload
    const payload = { action };

    // Invoke Lambda
    const command = new InvokeCommand({
      FunctionName: functionName,
      Payload: JSON.stringify(payload),
      LogType: 'Tail', // Include last 4KB of logs
    });

    const startTime = Date.now();
    const response = await client.send(command);
    const duration = Date.now() - startTime;

    // Parse response
    const responsePayload = JSON.parse(new TextDecoder().decode(response.Payload));

    console.log('✅ Lambda invocation successful\n');
    console.log('━'.repeat(80));
    console.log('📦 Response:');
    console.log('━'.repeat(80));
    console.log(JSON.stringify(responsePayload, null, 2));
    console.log('━'.repeat(80));

    // Display execution info
    console.log(`\n⏱️  Duration: ${duration}ms`);
    console.log(`📌 Status Code: ${response.StatusCode}`);

    if (response.FunctionError) {
      console.log(`❌ Function Error: ${response.FunctionError}`);
    }

    // Display logs if available
    if (response.LogResult) {
      const logs = Buffer.from(response.LogResult, 'base64').toString('utf-8');
      console.log('\n📋 CloudWatch Logs (last 4KB):');
      console.log('━'.repeat(80));
      console.log(logs);
      console.log('━'.repeat(80));
    }
  } catch (error) {
    console.error('\n❌ Invocation failed:', error.message);

    if (error.name === 'ResourceNotFoundException') {
      console.error('\n💡 Hint: Function not found. Make sure it has been deployed.');
    } else if (error.name === 'AccessDeniedException') {
      console.error(
        '\n💡 Hint: Permission denied. Make sure your AWS profile has lambda:InvokeFunction permission.'
      );
    }

    process.exit(1);
  }
}

main();

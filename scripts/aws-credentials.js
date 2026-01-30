/* eslint-disable no-unused-vars */
/* eslint-disable no-undef */
/**
 * AWS Credentials Management Utility
 *
 * Provides unified AWS credentials handling for SSO profiles.
 * Exports SSO credentials as standard environment variables to avoid
 * compatibility issues with tools that don't support SSO natively.
 */

const { execSync } = require('child_process');

/**
 * Setup AWS credentials environment variables from a profile
 *
 * @param {string} profile - AWS profile name (supports SSO profiles)
 * @param {Object} baseEnv - Base environment object to extend (default: process.env)
 * @returns {Object} Environment object with AWS credentials configured
 *
 * @example
 * const env = setupAwsCredentials('my-sso-profile');
 * execSync('aws s3 ls', { env });
 */
function setupAwsCredentials(profile, baseEnv = process.env) {
  const env = { ...baseEnv };

  // CRITICAL: Clear all AWS credentials to prevent conflicts with terminal env vars
  delete env.AWS_PROFILE;
  delete env.AWS_ACCESS_KEY_ID;
  delete env.AWS_SECRET_ACCESS_KEY;
  delete env.AWS_SESSION_TOKEN;

  if (!profile) {
    return env;
  }

  console.log(`🔑 Using AWS profile: ${profile}`);

  try {
    // Export SSO credentials as environment variables (most reliable method)
    // This bypasses compatibility issues with tools that don't support SSO
    const credentialsJson = execSync(
      `aws configure export-credentials --profile ${profile} --format env-no-export`,
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    );

    // Parse and set credentials as environment variables
    credentialsJson
      .trim()
      .split('\n')
      .forEach((line) => {
        const [key, value] = line.split('=');
        if (key && value) {
          env[key] = value;
        }
      });

    console.log('✅ SSO credentials exported successfully');
  } catch (error) {
    // Fallback to AWS_PROFILE if export-credentials fails
    console.warn('⚠️  Could not export SSO credentials, falling back to AWS_PROFILE');
    console.warn(`   If operation fails, run: aws sso login --profile ${profile}`);
    env.AWS_PROFILE = profile;
  }

  return env;
}

module.exports = {
  setupAwsCredentials,
};

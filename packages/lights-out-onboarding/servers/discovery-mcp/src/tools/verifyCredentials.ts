/**
 * AWS Credentials Verification Tool
 *
 * Verifies that AWS credentials are valid by calling STS GetCallerIdentity.
 */

import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import { fromSSO } from '@aws-sdk/credential-provider-sso';
import type { CredentialVerificationResult, VerifyCredentialsInput } from '../types.js';

/**
 * Verifies AWS credentials by calling STS GetCallerIdentity.
 *
 * @param input - Input parameters
 * @returns Verification result with identity information
 */
export async function verifyCredentials(
  input: VerifyCredentialsInput
): Promise<CredentialVerificationResult> {
  const { profile } = input;

  try {
    // Create STS client with optional SSO profile
    const clientConfig = profile ? { credentials: fromSSO({ profile }) } : {};

    const client = new STSClient(clientConfig);
    const command = new GetCallerIdentityCommand({});
    const response = await client.send(command);

    if (!response.Account || !response.Arn || !response.UserId) {
      return {
        valid: false,
        error: 'GetCallerIdentity returned incomplete response',
      };
    }

    return {
      valid: true,
      identity: {
        account: response.Account,
        arn: response.Arn,
        userId: response.UserId,
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Provide helpful error messages for common scenarios
    if (errorMessage.includes('Token has expired')) {
      return {
        valid: false,
        error: `SSO session expired. Run: aws sso login${profile ? ` --profile ${profile}` : ''}`,
      };
    }

    if (errorMessage.includes('not authorized')) {
      return {
        valid: false,
        error: 'Credentials valid but lack required permissions',
      };
    }

    if (errorMessage.includes('Could not load credentials')) {
      return {
        valid: false,
        error: `No credentials found. ${profile ? `Ensure profile '${profile}' exists and run: aws sso login --profile ${profile}` : 'Configure AWS credentials or specify a profile.'}`,
      };
    }

    return {
      valid: false,
      error: `Credential verification failed: ${errorMessage}`,
    };
  }
}

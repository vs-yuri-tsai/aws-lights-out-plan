/**
 * AWS Lambda handler for Teams Outgoing Webhook integration.
 *
 * Handles incoming webhook requests from Microsoft Teams, validates HMAC signatures,
 * parses commands, and invokes the main handler Lambda function.
 *
 * Phase 2.1: ✅ HMAC validation
 * Phase 2.2: ✅ Command parsing and Lambda invocation
 * Phase 2.4: ✅ User permission checking (allowlist-based)
 *
 * @see https://learn.microsoft.com/en-us/microsoftteams/platform/webhooks-and-connectors/how-to/add-outgoing-webhook
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import type { TriggerSource } from '@shared/types';
import type { OutgoingWebhookMessage, OutgoingWebhookBasePayload } from './types';
import { validateHmacSignature, getSecurityToken } from './core/hmacAuthenticator';
import { parseCommand } from './core/commandParser';
import { invokeMainHandler } from './core/handlerInvoker';
import { isUserAllowed } from './core/permissionChecker';
import { loadConfigFromSsm } from '@functions/handler/core/config';
import { setupLogger } from '@shared/utils/logger';

const logger = setupLogger('lights-out:teams-outgoing-webhook');

/**
 * Build a success response for Teams.
 *
 * @param message - Message text (supports markdown)
 * @returns API Gateway response
 */
function buildSuccessResponse(message: string): APIGatewayProxyResult {
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      type: 'message',
      text: message,
    }),
  };
}

/**
 * Build an error response for Teams.
 *
 * @param message - Error message
 * @param statusCode - HTTP status code
 * @returns API Gateway response
 */
function buildErrorResponse(message: string, statusCode: number = 400): APIGatewayProxyResult {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      type: 'message',
      text: message,
    }),
  };
}

/**
 * Lambda handler for Teams Outgoing Webhook.
 *
 * Validates HMAC signature and processes Teams bot commands.
 *
 * @param event - API Gateway proxy event
 * @param context - Lambda context
 * @returns API Gateway proxy result
 */
export async function main(
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> {
  const requestId = context.awsRequestId;

  logger.info({ requestId }, 'Teams Outgoing Webhook request received');

  try {
    // 1. Parse request body
    if (!event.body) {
      logger.warn({ requestId }, 'Empty request body');
      return buildErrorResponse('❌ Empty request body');
    }

    // 2. Parse Teams payload first to check message type
    const payload = JSON.parse(event.body) as OutgoingWebhookBasePayload;

    // 3. Check for Authorization header
    // IMPORTANT: Teams does NOT send Authorization header during webhook creation/verification
    // The security token is generated AFTER the webhook is successfully created
    const authHeader = event.headers.Authorization || event.headers.authorization;

    if (!authHeader) {
      logger.info(
        { requestId, type: payload.type },
        'No Authorization header - treating as webhook verification request'
      );

      // Allow webhook creation by responding with success
      // This is ONLY for the initial webhook setup in Teams
      return buildSuccessResponse('✅ Webhook endpoint verified successfully');
    }

    // 4. Validate HMAC signature for authenticated requests
    const securityToken = await getSecurityToken();
    const isValid = validateHmacSignature(authHeader, event.body, securityToken);

    if (!isValid) {
      logger.warn({ requestId }, 'Invalid HMAC signature');
      return buildErrorResponse('❌ Unauthorized: Invalid signature', 401);
    }

    logger.info({ requestId }, 'HMAC signature validated successfully');

    // 5. Verify this is a message type (not a legacy verification request)
    if (payload.type !== 'message') {
      logger.info(
        { requestId, type: payload.type },
        'Received non-message payload with valid signature'
      );

      // Respond with success
      return buildSuccessResponse('✅ Request acknowledged');
    }

    // 6. Cast to message type after verification
    const message = payload as OutgoingWebhookMessage;

    logger.info(
      {
        requestId,
        messageId: message.id,
        from: message.from.name,
        text: message.text,
      },
      'Message parsed successfully'
    );

    // 7. Parse command
    const commandResult = parseCommand(message.text || '');

    if (!commandResult.valid || !commandResult.action) {
      logger.warn({ text: message.text, error: commandResult.error }, 'Invalid command');
      return buildSuccessResponse(commandResult.error || '❌ Invalid command');
    }

    // TypeScript now knows commandResult.action is defined
    const action = commandResult.action;

    // 8. Load config from SSM and check user permission
    const configParameter = process.env.CONFIG_PARAMETER_NAME || '/lights-out/config';
    logger.debug({ configParameter }, 'Loading config from SSM');

    const config = await loadConfigFromSsm(configParameter);

    const isAllowed = isUserAllowed(message.from.name, config);

    if (!isAllowed) {
      logger.warn(
        {
          user: message.from.name,
          userId: message.from.id,
          requestId,
        },
        'User not authorized to execute commands'
      );

      return buildSuccessResponse(
        '❌ **Unauthorized**: You are not allowed to execute commands.\n\n' +
          'Please contact your administrator if you need access.'
      );
    }

    logger.info({ user: message.from.name }, 'User authorized successfully');

    // 6. Build trigger source metadata
    const triggerSource: TriggerSource = {
      type: 'teams-bot',
      identity: message.from.id,
      displayName: `@${message.from.name}`,
      metadata: {
        teamsMessageId: message.id,
        teamsChannelId: message.channelData?.teamsChannelId,
        teamsTeamId: message.channelData?.teamsTeamId,
      },
    };

    // 9. Invoke main handler Lambda (fire-and-forget)
    logger.info(
      {
        action,
        user: message.from.name,
        requestId,
      },
      'Invoking main handler Lambda'
    );

    const invocationResult = await invokeMainHandler({
      action,
      triggerSource,
    });

    if (!invocationResult.success) {
      logger.error({ error: invocationResult.error, requestId }, 'Failed to invoke main handler');
      return buildErrorResponse(`❌ Failed to invoke handler: ${invocationResult.error}`, 500);
    }

    // 10. Send immediate acknowledgment to Teams
    const acknowledgment =
      `✅ Command received: **${action.toUpperCase()}**\n\n` +
      `ℹ️ Processing resources... Check this channel for detailed status in ~30 seconds.`;

    logger.info({ requestId }, 'Command processed successfully');

    return buildSuccessResponse(acknowledgment);
  } catch (error) {
    logger.error({ error: String(error), requestId }, 'Handler execution failed');
    return buildErrorResponse(
      `❌ Internal error: ${error instanceof Error ? error.message : String(error)}`,
      500
    );
  }
}

/**
 * AWS Lambda handler for Lights Out Plan.
 *
 * Entry point for the Lambda function. Loads configuration, orchestrates
 * resource management, and returns responses.
 */

import type { Context } from 'aws-lambda';
import type { LambdaAction, DiscoveryResult, LambdaExecutionResult } from '@shared/types';
import { loadConfigFromSsm } from './core/config';
import { Orchestrator } from './core/orchestrator';
import { setupLogger } from '@shared/utils/logger';

const logger = setupLogger('lights-out:main');

// Default SSM parameter name (can be overridden via environment variable)
const DEFAULT_CONFIG_PARAMETER = '/lights-out/config';

// Valid actions
const VALID_ACTIONS: ReadonlySet<string> = new Set(['start', 'stop', 'status', 'discover']);

/**
 * Lambda event structure.
 */
interface LambdaEvent {
  action?: string;
  [key: string]: unknown;
}

/**
 * Lambda response structure.
 */
interface LambdaResponse {
  statusCode: number;
  body: string;
}

/**
 * Validates if a string is a valid Lambda action.
 *
 * @param action - Action string to validate
 * @returns Type-safe LambdaAction if valid, null otherwise
 */
function validateAction(action: string): LambdaAction | null {
  return VALID_ACTIONS.has(action) ? (action as LambdaAction) : null;
}

/**
 * Lambda handler function for Lights Out Plan.
 *
 * @param event - Lambda event containing action parameter
 * @param context - Lambda context object
 * @returns Lambda response with statusCode and JSON body
 *
 * @example
 * Event:
 * {
 *   "action": "stop"
 * }
 *
 * Response:
 * {
 *   "statusCode": 200,
 *   "body": "{\"action\":\"stop\",\"total\":10,\"succeeded\":9,\"failed\":1,...}"
 * }
 */
export async function main(event: LambdaEvent, context: Context): Promise<LambdaResponse> {
  // Extract request ID and function name from context
  const requestId = context.awsRequestId || 'local-test';
  const functionName = context.functionName || 'lights-out';

  // Extract and validate action
  const actionStr = event.action ?? 'status';
  const action = validateAction(actionStr);

  logger.info(
    {
      action: actionStr,
      requestId,
      functionName,
    },
    'Lambda invoked'
  );

  // Validate action
  if (!action) {
    logger.warn(
      {
        validActions: Array.from(VALID_ACTIONS),
      },
      `Invalid action: ${actionStr}`
    );

    return {
      statusCode: 400,
      body: JSON.stringify({
        error: `Invalid action '${actionStr}'. Valid actions: ${Array.from(VALID_ACTIONS).join(', ')}`,
        timestamp: new Date().toISOString(),
        request_id: requestId,
      }),
    };
  }

  try {
    // Load configuration from SSM
    const configParameter = process.env.CONFIG_PARAMETER_NAME ?? DEFAULT_CONFIG_PARAMETER;
    logger.info(`Loading config from SSM: ${configParameter}`);

    const config = await loadConfigFromSsm(configParameter);

    // Initialize orchestrator
    const orchestrator = new Orchestrator(config);

    // Execute action
    if (action === 'discover') {
      // Discover action only lists resources without executing operations
      const resources = await orchestrator.discoverResources();

      const result: DiscoveryResult = {
        action: 'discover',
        discovered_count: resources.length,
        resources: resources.map((r) => ({
          resource_type: r.resourceType,
          resource_id: r.resourceId,
          arn: r.arn,
          priority: r.priority,
          group: r.group,
        })),
        timestamp: new Date().toISOString(),
        request_id: requestId,
      };

      logger.info(
        {
          action,
          total: result.discovered_count,
          requestId,
        },
        'Lambda execution completed successfully'
      );

      return {
        statusCode: 200,
        body: JSON.stringify(result),
      };
    } else {
      // Execute start/stop/status action
      const orchestratorResult = await orchestrator.run(action);

      const result: LambdaExecutionResult = {
        action,
        total: orchestratorResult.total,
        succeeded: orchestratorResult.succeeded,
        failed: orchestratorResult.failed,
        results: orchestratorResult.results,
        timestamp: new Date().toISOString(),
        request_id: requestId,
      };

      logger.info(
        {
          action,
          total: result.total,
          succeeded: result.succeeded,
          failed: result.failed,
          requestId,
        },
        'Lambda execution completed successfully'
      );

      return {
        statusCode: 200,
        body: JSON.stringify(result),
      };
    }
  } catch (error) {
    logger.error(
      {
        action: actionStr,
        error: String(error),
        requestId,
      },
      'Lambda execution failed'
    );

    return {
      statusCode: 500,
      body: JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
        request_id: requestId,
      }),
    };
  }
}

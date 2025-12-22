/**
 * Core type definitions for AWS Lights Out Plan.
 *
 * Centralizes shared types to avoid circular dependencies.
 */

/**
 * Valid Lambda action types.
 */
export type LambdaAction = "start" | "stop" | "status" | "discover";

/**
 * Discovered resource from tag discovery.
 */
export interface DiscoveredResource {
  resourceType: string;
  arn: string;
  resourceId: string;
  priority: number;
  group: string;
  tags: Record<string, string>;
  metadata: Record<string, unknown>;
}

/**
 * Handler operation result.
 */
export interface HandlerResult {
  success: boolean;
  action: string;
  resourceType: string;
  resourceId: string;
  message: string;
  previousState?: Record<string, unknown>;
  error?: string;
}

/**
 * Configuration from SSM Parameter Store.
 */
export interface Config {
  version: string;
  environment: string;
  discovery: {
    method: string;
    tags?: Record<string, string>;
    resource_types?: string[];
    [key: string]: unknown;
  };
  settings?: {
    schedule_tag?: string;
    [key: string]: unknown;
  };
  resource_defaults?: Record<string, Record<string, unknown>>;
  [key: string]: unknown;
}

/**
 * Orchestration result summary.
 */
export interface OrchestrationResult {
  total: number;
  succeeded: number;
  failed: number;
  results: HandlerResult[];
}

/**
 * Discovery result for the "discover" action.
 */
export interface DiscoveryResult {
  action: "discover";
  discovered_count: number;
  resources: Array<{
    resource_type: string;
    resource_id: string;
    arn: string;
    priority: number;
    group: string;
  }>;
  timestamp: string;
  request_id: string;
}

/**
 * Lambda execution result.
 */
export interface LambdaExecutionResult {
  action: LambdaAction;
  total: number;
  succeeded: number;
  failed: number;
  results: HandlerResult[];
  timestamp: string;
  request_id: string;
}

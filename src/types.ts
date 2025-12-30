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
 * Interface that all concrete resource handlers must implement.
 *
 * This interface defines the common operations that can be performed on
 * any managed resource. Each handler is responsible for implementing
 * these methods for their specific AWS resource type.
 */
export interface ResourceHandler {
  /**
   * Retrieve the current status of the resource.
   *
   * This method should query the AWS API to get the resource's current state.
   * The returned object structure is resource-type specific.
   *
   * @returns Promise resolving to resource status information
   * @throws Error if unable to retrieve status (e.g., resource not found)
   *
   * @example
   * // For ECS Service:
   * {
   *   desired_count: 1,
   *   running_count: 1,
   *   status: "ACTIVE",
   *   is_stopped: false
   * }
   */
  getStatus(): Promise<Record<string, unknown>>;

  /**
   * Start or enable the resource.
   *
   * This method should:
   * 1. Check current state (idempotent check)
   * 2. Perform the start operation via AWS API
   * 3. Optionally wait for the resource to reach ready state
   * 4. Return a HandlerResult with operation outcome
   *
   * @returns Promise resolving to HandlerResult object
   */
  start(): Promise<HandlerResult>;

  /**
   * Stop or disable the resource.
   *
   * This method should:
   * 1. Check current state (idempotent check)
   * 2. Perform the stop operation via AWS API
   * 3. Optionally wait for the resource to reach stopped state
   * 4. Return a HandlerResult with operation outcome
   *
   * @returns Promise resolving to HandlerResult object
   */
  stop(): Promise<HandlerResult>;

  /**
   * Check if the resource has reached its desired state.
   *
   * This method is used when wait_for_stable is enabled to determine
   * if the resource has completed its state transition.
   *
   * @returns Promise resolving to true if resource is ready/stable, false otherwise
   */
  isReady(): Promise<boolean>;
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
 * ECS Service stop behavior configuration.
 *
 * Defines how ECS services should be scaled down during stop operations.
 */
export interface ECSStopBehavior {
  /**
   * Stop mode strategy:
   * - scale_to_zero: Set desiredCount to 0 (default, backward compatible)
   * - reduce_by_count: Reduce current desiredCount by a specific amount
   * - reduce_to_count: Set desiredCount to a specific target value
   */
  mode: "scale_to_zero" | "reduce_by_count" | "reduce_to_count";

  /**
   * Amount to reduce when mode is "reduce_by_count".
   * Example: If current is 3 and reduceByCount is 1, target will be 2.
   */
  reduceByCount?: number;

  /**
   * Target count when mode is "reduce_to_count".
   * Example: If reduceToCount is 1, service will always scale to 1.
   */
  reduceToCount?: number;
}

/**
 * ECS Service Auto Scaling configuration.
 *
 * Defines Application Auto Scaling MinCapacity/MaxCapacity management.
 * When configured, this takes precedence over direct desiredCount manipulation.
 */
export interface ECSAutoScalingConfig {
  /**
   * Minimum capacity when service is running (START operation).
   * Example: 2 (ensures at least 2 tasks even when scaled down)
   */
  minCapacity: number;

  /**
   * Maximum capacity when service is running (START operation).
   * Example: 6 (allows scaling up to 6 tasks)
   */
  maxCapacity: number;

  /**
   * Desired count to set when starting service.
   * Must be between minCapacity and maxCapacity.
   * Example: 3 (start with 3 tasks, allow Auto Scaling to adjust)
   */
  desiredCount: number;
}

/**
 * ECS Service resource defaults configuration.
 *
 * Defines default behavior for all ECS service operations.
 */
export interface ECSResourceDefaults {
  /**
   * Whether to wait for service to stabilize after operations.
   */
  waitForStable?: boolean;

  /**
   * Maximum seconds to wait for stabilization (default: 300).
   */
  stableTimeoutSeconds?: number;

  /**
   * DEPRECATED: Use autoScaling.desiredCount instead.
   * Only used as fallback when autoScaling is not configured.
   * Target desiredCount when starting services (default: 1).
   */
  defaultDesiredCount?: number;

  /**
   * Stop behavior configuration for flexible scaling strategies.
   * Only used when autoScaling is not configured (legacy mode).
   */
  stopBehavior?: ECSStopBehavior;

  /**
   * Auto Scaling configuration (recommended for production).
   * When present, manages MinCapacity/MaxCapacity instead of desiredCount.
   * Takes precedence over defaultDesiredCount and stopBehavior.
   */
  autoScaling?: ECSAutoScalingConfig;
}

/**
 * Configuration from SSM Parameter Store.
 */
export interface Config {
  version: string;
  environment: string;
  regions?: string[];  // Optional list of AWS regions to scan
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

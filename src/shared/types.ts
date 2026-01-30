/**
 * Core type definitions for AWS Lights Out Plan.
 *
 * Centralizes shared types to avoid circular dependencies.
 */

/**
 * Valid Lambda action types.
 */
export type LambdaAction = 'start' | 'stop' | 'status' | 'discover';

/**
 * Trigger source type for Lambda invocation.
 */
export type TriggerSourceType =
  | 'eventbridge-scheduled' // EventBridge cron rule
  | 'manual-invoke' // Manual CLI invocation
  | 'teams-bot' // Teams Bot command (future)
  | 'unknown'; // Fallback for unidentified sources

/**
 * Trigger source metadata.
 */
export interface TriggerSource {
  /**
   * Type of trigger source.
   */
  type: TriggerSourceType;

  /**
   * Identity information (ARN, username, etc.).
   * - EventBridge: Rule ARN (e.g., "arn:aws:events:...")
   * - Manual: IAM user/role ARN (from STS GetCallerIdentity)
   * - Teams Bot: Teams user display name
   */
  identity: string;

  /**
   * Human-readable display name.
   * - EventBridge: Rule name (e.g., "lights-out-sss-lab-start")
   * - Manual: IAM username or role name
   * - Teams Bot: "@username"
   */
  displayName: string;

  /**
   * Optional additional metadata.
   */
  metadata?: {
    /**
     * For EventBridge: detail-type (e.g., "Scheduled Event")
     */
    eventDetailType?: string;
    /**
     * For manual invoke: AWS account ID
     */
    accountId?: string;
    /**
     * For Teams Bot: Teams message ID
     */
    teamsMessageId?: string;
    [key: string]: unknown;
  };
}

/**
 * Lambda event structure.
 */
export interface LambdaEvent {
  action?: string;

  /**
   * Target region group for regional schedules.
   * When specified, only resources in the corresponding region_groups will be processed.
   * If not present, all regions will be processed (backward compatible).
   */
  targetGroup?: string;

  /**
   * Trigger source metadata.
   * If not present, will be detected from Lambda context + event structure.
   */
  triggerSource?: TriggerSource;

  /**
   * AWS EventBridge event fields (when triggered by EventBridge).
   */
  source?: string; // "aws.events"
  'detail-type'?: string; // "Scheduled Event"
  resources?: string[]; // [Rule ARN]

  [key: string]: unknown;
}

/**
 * Execution strategy for resource operations.
 *
 * - sequential: Process resources one by one in priority order (safest, slowest)
 * - parallel: Process all resources simultaneously, ignoring priority (fastest, riskiest)
 * - grouped-parallel: Process same-priority resources in parallel, different priorities sequentially (balanced, recommended)
 */
export type ExecutionStrategy = 'sequential' | 'parallel' | 'grouped-parallel';

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
  idempotent?: boolean;
  error?: string;
  /**
   * Trigger source metadata (passed to Teams notifier).
   */
  triggerSource?: TriggerSource;
  /**
   * AWS region where the resource is located (extracted from ARN).
   */
  region?: string;
}

/**
 * ECS Service action configuration for start or stop operations.
 *
 * Defines capacity settings for a specific action (START or STOP).
 *
 * Two modes are supported:
 * 1. Auto Scaling mode: When minCapacity and maxCapacity are both present
 * 2. Direct mode: When only desiredCount is present
 */
export type ECSActionConfig =
  | {
      /**
       * Minimum capacity for Auto Scaling mode.
       * Example: 2 (ensures at least 2 tasks when service is running)
       */
      minCapacity: number;

      /**
       * Maximum capacity for Auto Scaling mode.
       * Example: 6 (allows scaling up to 6 tasks)
       */
      maxCapacity: number;

      /**
       * Desired count (required).
       * Must be between minCapacity and maxCapacity.
       * Example: 2 (start with 2 tasks)
       */
      desiredCount: number;
    }
  | {
      /**
       * Desired count for Direct mode (required).
       * Example: 2 (set service to 2 tasks)
       */
      desiredCount: number;
    };

/**
 * ECS Service resource defaults configuration (simplified).
 *
 * Defines default behavior for all ECS service operations.
 */
export interface ECSResourceDefaults {
  /**
   * Whether to wait for service to stabilize after operations (default: true).
   */
  waitForStable?: boolean;

  /**
   * Maximum seconds to wait for stabilization (default: 300).
   */
  stableTimeoutSeconds?: number;

  /**
   * Configuration for START operation (required).
   */
  start: ECSActionConfig;

  /**
   * Configuration for STOP operation (required).
   */
  stop: ECSActionConfig;
}

/**
 * RDS Instance resource defaults configuration.
 *
 * RDS uses a "fire-and-forget" approach because start/stop operations
 * take 5-10 minutes to complete, which would exceed Lambda timeout limits.
 *
 * The handler sends the command, waits briefly to confirm the state transition
 * has begun, then returns without waiting for completion.
 */
export interface RDSResourceDefaults {
  /**
   * Seconds to wait after sending start/stop command before returning.
   * This brief wait confirms the operation has begun (status changes to 'starting' or 'stopping').
   * Default: 60 seconds.
   *
   * @example 60 - Wait 1 minute after command
   */
  waitAfterCommand?: number;

  /**
   * Whether to skip creating a DB snapshot when stopping the instance.
   * Default: true (no snapshot created).
   *
   * When false, a snapshot is created before stopping with auto-generated identifier:
   * `lights-out-{instance-id}-{timestamp}`
   *
   * **Use Cases:**
   * | Environment        | Recommended | Reason                                      |
   * |--------------------|-------------|---------------------------------------------|
   * | Development/Test   | true        | Daily stop/start doesn't need backups       |
   * | Staging            | true/false  | Depends on data importance                  |
   * | Critical data      | false       | Snapshot as restore point before each stop  |
   *
   * **Cost consideration:** Each snapshot incurs storage costs.
   * For daily lights-out cycles, this can accumulate quickly.
   *
   * @example true - Skip snapshot (recommended for dev environments)
   * @example false - Create snapshot before each stop
   */
  skipSnapshot?: boolean;
}

/**
 * Region groups mapping.
 * Maps group names to arrays of AWS region codes.
 *
 * @example
 * {
 *   asia: ['ap-southeast-1', 'ap-northeast-1'],
 *   america: ['us-east-1']
 * }
 */
export type RegionGroups = Record<string, string[]>;

/**
 * Group schedules mapping (human-readable format).
 * Maps group names to their schedule configurations.
 *
 * Note: This is converted to group_schedules_cron by generate-cron.js.
 * Lambda does not use group_schedules at runtime (only region_groups is used),
 * so this type is kept loose to accept any format.
 *
 * Expected format in config YAML:
 * @example
 * {
 *   asia: { timezone: 'Asia/Taipei', startTime: '08:00', stopTime: '22:00', activeDays: ['MON', ...], enabled: true },
 *   america: { timezone: 'America/New_York', startTime: '08:00', stopTime: '18:00', activeDays: ['MON', ...], enabled: true }
 * }
 */
export type GroupSchedules = Record<string, Record<string, unknown>>;

/**
 * Configuration from SSM Parameter Store.
 */
/**
 * Teams notification configuration.
 */
export interface TeamsNotificationConfig {
  enabled: boolean;
  webhook_url: string;
  description?: string; // Optional description for webhook (e.g., "Dev Team Channel", "Staging Alerts")
}

/**
 * Notification configuration for various channels.
 */
export interface NotificationConfig {
  teams?: TeamsNotificationConfig;
  [key: string]: unknown; // Allow for future notification channels (e.g., Slack, email)
}

export interface Config {
  version?: string; // Optional, not used at runtime
  environment: string;
  regions?: string[]; // Optional list of AWS regions to scan (legacy, for backward compatibility)

  /**
   * Region groups for regional scheduling.
   * Maps group names (e.g., 'asia', 'america') to arrays of AWS region codes.
   * When present, used in conjunction with group_schedules for per-group scheduling.
   */
  region_groups?: RegionGroups;

  /**
   * Group schedules for regional scheduling.
   * Defines per-group start/stop schedules with timezone information.
   * When present, EventBridge rules are generated per group instead of globally.
   */
  group_schedules?: GroupSchedules;

  discovery: {
    method: string;
    tags?: Record<string, string>;
    resource_types?: string[];
    [key: string]: unknown;
  };
  settings?: {
    schedule_tag?: string;
    execution_strategy?: ExecutionStrategy;
    [key: string]: unknown;
  };
  notifications?: NotificationConfig; // New: notification settings
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
 * Aggregated resource group for Teams notification.
 * Groups resources of the same type with their IDs and message.
 */
export interface AggregatedResourceGroup {
  resourceType: string;
  resourceIds: string[];
  message: string;
}

/**
 * Aggregated notification payload for Teams.
 * Used to send a single notification for multiple resources.
 */
export interface AggregatedNotificationPayload {
  success: boolean;
  action: string;
  environment: string;
  triggerSource?: TriggerSource;
  region: string;
  resourceGroups: AggregatedResourceGroup[];
  timestamp: string;
}

/**
 * Discovery result for the "discover" action.
 */
export interface DiscoveryResult {
  action: 'discover';
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

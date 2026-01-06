/**
 * ECS Service Handler implementation.
 *
 * Handles start, stop, and status operations for AWS ECS Services.
 */

import {
  ECSClient,
  DescribeServicesCommand,
  UpdateServiceCommand,
  waitUntilServicesStable,
  type Service,
} from '@aws-sdk/client-ecs';
import {
  ApplicationAutoScalingClient,
  DescribeScalableTargetsCommand,
  RegisterScalableTargetCommand,
  ServiceNamespace,
} from '@aws-sdk/client-application-auto-scaling';
import type { Logger } from 'pino';
import type {
  DiscoveredResource,
  Config,
  HandlerResult,
  ResourceHandler,
  ECSActionConfig,
  ECSResourceDefaults,
} from '@shared/types';
import { setupLogger } from '@shared/utils/logger';
import { getResourceDefaults } from './base';

/**
 * Handler for AWS ECS Service resources.
 *
 * This handler manages the lifecycle of ECS Services by controlling
 * the desiredCount parameter and optionally Auto Scaling capacity.
 * Supports two modes:
 * - Auto Scaling mode: When minCapacity/maxCapacity are configured
 * - Direct mode: When only desiredCount is configured
 */
export class ECSServiceHandler implements ResourceHandler {
  private ecsClient: ECSClient;
  private autoScalingClient: ApplicationAutoScalingClient;
  private clusterName: string;
  private serviceName: string;
  private logger: Logger;

  constructor(
    private resource: DiscoveredResource,
    private config: Config
  ) {
    this.logger = setupLogger(`lights-out:handler.${resource.resourceType}`);

    // Extract region from ARN (format: arn:aws:ecs:REGION:account:...)
    // Falls back to AWS_DEFAULT_REGION environment variable if not in ARN
    let region: string | undefined;
    if (resource.arn?.startsWith('arn:aws:')) {
      const arnParts = resource.arn.split(':');
      if (arnParts.length >= 4) {
        region = arnParts[3];
      }
    }

    // Initialize ECS client with region
    this.ecsClient = new ECSClient({ region });

    // Initialize Application Auto Scaling client with same region
    this.autoScalingClient = new ApplicationAutoScalingClient({ region });

    // Extract cluster and service names from resource
    this.clusterName = (resource.metadata.cluster_name as string) ?? 'default';

    // Extract service name from resource_id
    // Format can be "cluster/service" or just "service"
    if (resource.resourceId.includes('/')) {
      this.serviceName = resource.resourceId.split('/').pop()!;
    } else {
      this.serviceName = resource.resourceId;
    }
  }

  /**
   * Get current status of the ECS Service.
   *
   * @returns Object with keys:
   *   - desired_count: Target number of tasks
   *   - running_count: Currently running tasks
   *   - status: Service status (e.g., "ACTIVE")
   *   - is_stopped: Boolean indicating if desiredCount is 0
   *
   * @throws Error if service not found or API call fails
   */
  async getStatus(): Promise<Record<string, unknown>> {
    try {
      const response = await this.ecsClient.send(
        new DescribeServicesCommand({
          cluster: this.clusterName,
          services: [this.serviceName],
        })
      );

      if (!response.services || response.services.length === 0) {
        throw new Error(`Service ${this.serviceName} not found in cluster ${this.clusterName}`);
      }

      const service: Service = response.services[0];
      const desiredCount = service.desiredCount ?? 0;
      const runningCount = service.runningCount ?? 0;
      const status = service.status ?? 'UNKNOWN';

      return {
        desired_count: desiredCount,
        running_count: runningCount,
        status,
        is_stopped: desiredCount === 0,
      };
    } catch (error) {
      this.logger.error(
        {
          cluster: this.clusterName,
          service: this.serviceName,
          error,
        },
        `Failed to get status for service ${this.serviceName}`
      );
      throw error;
    }
  }

  /**
   * Detect if the ECS Service has Application Auto Scaling configured.
   *
   * @returns ScalableTarget configuration (minCapacity, maxCapacity) if found, otherwise null
   */
  private async detectAutoScaling(): Promise<{
    minCapacity: number;
    maxCapacity: number;
  } | null> {
    const resourceId = `service/${this.clusterName}/${this.serviceName}`;

    try {
      const response = await this.autoScalingClient.send(
        new DescribeScalableTargetsCommand({
          ServiceNamespace: ServiceNamespace.ECS,
          ResourceIds: [resourceId],
          ScalableDimension: 'ecs:service:DesiredCount',
        })
      );

      if (response.ScalableTargets && response.ScalableTargets.length > 0) {
        const target = response.ScalableTargets[0];
        this.logger.debug(
          {
            cluster: this.clusterName,
            service: this.serviceName,
            minCapacity: target.MinCapacity,
            maxCapacity: target.MaxCapacity,
          },
          'Detected Auto Scaling configuration'
        );

        return {
          minCapacity: target.MinCapacity!,
          maxCapacity: target.MaxCapacity!,
        };
      }

      this.logger.debug(
        { cluster: this.clusterName, service: this.serviceName },
        'No Auto Scaling detected'
      );
      return null;
    } catch (error) {
      // DescribeScalableTargets failed - assume no Auto Scaling
      this.logger.warn(
        {
          cluster: this.clusterName,
          service: this.serviceName,
          error,
        },
        'Failed to detect Auto Scaling, assuming none'
      );
      return null;
    }
  }

  /**
   * Manage service capacity via Application Auto Scaling.
   *
   * @param minCapacity - Minimum task count
   * @param maxCapacity - Maximum task count
   * @param desiredCount - Optional desired count (also updates ECS service if provided)
   */
  private async manageViaAutoScaling(
    minCapacity: number,
    maxCapacity: number,
    desiredCount?: number
  ): Promise<void> {
    const resourceId = `service/${this.clusterName}/${this.serviceName}`;

    this.logger.info(
      {
        cluster: this.clusterName,
        service: this.serviceName,
        minCapacity,
        maxCapacity,
        desiredCount,
      },
      'Managing service via Auto Scaling'
    );

    // 1. Register/update Scalable Target
    await this.autoScalingClient.send(
      new RegisterScalableTargetCommand({
        ServiceNamespace: ServiceNamespace.ECS,
        ResourceId: resourceId,
        ScalableDimension: 'ecs:service:DesiredCount',
        MinCapacity: minCapacity,
        MaxCapacity: maxCapacity,
      })
    );

    // 2. If desiredCount specified, also update ECS Service
    if (desiredCount !== undefined) {
      await this.ecsClient.send(
        new UpdateServiceCommand({
          cluster: this.clusterName,
          service: this.serviceName,
          desiredCount: desiredCount,
        })
      );

      this.logger.info(
        {
          cluster: this.clusterName,
          service: this.serviceName,
          desiredCount,
        },
        'Updated service desiredCount'
      );
    }
  }

  /**
   * Validate action configuration.
   *
   * @param actionConfig - The action configuration to validate
   * @param actionName - Name of the action (for error messages)
   * @throws Error if validation fails
   */
  private validateActionConfig(actionConfig: ECSActionConfig, actionName: string): void {
    // Validate desiredCount is present (always required)
    if (actionConfig.desiredCount === undefined) {
      throw new Error(`Invalid ${actionName} config: desiredCount is required`);
    }

    // Type guard: check if this is Auto Scaling mode
    if ('minCapacity' in actionConfig && 'maxCapacity' in actionConfig) {
      const { minCapacity, maxCapacity, desiredCount } = actionConfig;

      // Validate all values are non-negative
      if (minCapacity < 0 || maxCapacity < 0 || desiredCount < 0) {
        throw new Error(`Invalid ${actionName} config: all values must be >= 0`);
      }

      // Validate minCapacity <= maxCapacity
      if (minCapacity > maxCapacity) {
        throw new Error(
          `Invalid ${actionName} config: minCapacity (${minCapacity}) must be <= maxCapacity (${maxCapacity})`
        );
      }

      // Validate desiredCount is within range
      if (desiredCount < minCapacity || desiredCount > maxCapacity) {
        throw new Error(
          `Invalid ${actionName} config: desiredCount (${desiredCount}) must be between minCapacity (${minCapacity}) and maxCapacity (${maxCapacity})`
        );
      }
    } else {
      // Direct mode: just validate desiredCount is non-negative
      if (actionConfig.desiredCount < 0) {
        throw new Error(`Invalid ${actionName} config: desiredCount must be >= 0`);
      }
    }
  }

  /**
   * Stop the ECS Service using the stop configuration.
   *
   * This operation is idempotent - if the service is already at the target state,
   * it returns success without making changes.
   *
   * @returns HandlerResult indicating success or failure
   */
  async stop(): Promise<HandlerResult> {
    try {
      const currentStatus = await this.getStatus();
      const defaults = getResourceDefaults(
        this.config,
        this.resource.resourceType
      ) as unknown as ECSResourceDefaults;

      // Validate stop configuration
      if (!defaults.stop) {
        throw new Error(
          'Missing required stop configuration in resource_defaults.ecs-service.stop'
        );
      }

      this.validateActionConfig(defaults.stop, 'stop');

      const stopConfig = defaults.stop;
      const { desiredCount } = stopConfig;

      this.logger.info(
        {
          cluster: this.clusterName,
          service: this.serviceName,
          current_desired_count: currentStatus.desired_count,
          target_desired_count: desiredCount,
          minCapacity: 'minCapacity' in stopConfig ? stopConfig.minCapacity : undefined,
          maxCapacity: 'maxCapacity' in stopConfig ? stopConfig.maxCapacity : undefined,
        },
        'Attempting to stop service'
      );

      // Idempotent check
      if (currentStatus.desired_count === desiredCount) {
        this.logger.info(
          { cluster: this.clusterName, service: this.serviceName },
          `Service already at target count ${desiredCount}`
        );
        return {
          success: true,
          action: 'stop',
          resourceType: this.resource.resourceType,
          resourceId: this.resource.resourceId,
          message: `Service already at target count ${desiredCount}`,
          previousState: currentStatus,
        };
      }

      // Determine operation mode using type guard
      if ('minCapacity' in stopConfig && 'maxCapacity' in stopConfig) {
        // Auto Scaling mode
        const { minCapacity, maxCapacity } = stopConfig;
        await this.detectAutoScaling(); // Optional: for logging purposes
        await this.manageViaAutoScaling(minCapacity, maxCapacity, desiredCount);

        const waitForStable = defaults.waitForStable ?? true;
        if (waitForStable) {
          const timeout = defaults.stableTimeoutSeconds ?? 300;
          await this.waitForStable(timeout);
        }

        return {
          success: true,
          action: 'stop',
          resourceType: this.resource.resourceType,
          resourceId: this.resource.resourceId,
          message: `Service stopped via Auto Scaling (min=${minCapacity}, max=${maxCapacity}, desired=${desiredCount}, was ${currentStatus.desired_count as number})`,
          previousState: currentStatus,
        };
      } else {
        // Direct mode
        await this.ecsClient.send(
          new UpdateServiceCommand({
            cluster: this.clusterName,
            service: this.serviceName,
            desiredCount: desiredCount,
          })
        );

        const waitForStable = defaults.waitForStable ?? true;
        if (waitForStable) {
          const timeout = defaults.stableTimeoutSeconds ?? 300;
          await this.waitForStable(timeout);
        }

        return {
          success: true,
          action: 'stop',
          resourceType: this.resource.resourceType,
          resourceId: this.resource.resourceId,
          message: `Service stopped (desired=${desiredCount}, was ${currentStatus.desired_count as number})`,
          previousState: currentStatus,
        };
      }
    } catch (error) {
      this.logger.error(
        { cluster: this.clusterName, service: this.serviceName, error },
        'Failed to stop service'
      );
      return {
        success: false,
        action: 'stop',
        resourceType: this.resource.resourceType,
        resourceId: this.resource.resourceId,
        message: 'Stop operation failed',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Start the ECS Service using the start configuration.
   *
   * This operation is idempotent - if the service is already at the target state,
   * it returns success without making changes.
   *
   * @returns HandlerResult indicating success or failure
   */
  async start(): Promise<HandlerResult> {
    try {
      const currentStatus = await this.getStatus();
      const defaults = getResourceDefaults(
        this.config,
        this.resource.resourceType
      ) as unknown as ECSResourceDefaults;

      // Validate start configuration
      if (!defaults.start) {
        throw new Error(
          'Missing required start configuration in resource_defaults.ecs-service.start'
        );
      }

      this.validateActionConfig(defaults.start, 'start');

      const startConfig = defaults.start;
      const { desiredCount } = startConfig;

      this.logger.info(
        {
          cluster: this.clusterName,
          service: this.serviceName,
          current_desired_count: currentStatus.desired_count,
          target_desired_count: desiredCount,
          minCapacity: 'minCapacity' in startConfig ? startConfig.minCapacity : undefined,
          maxCapacity: 'maxCapacity' in startConfig ? startConfig.maxCapacity : undefined,
        },
        'Attempting to start service'
      );

      // Idempotent check
      if (currentStatus.desired_count === desiredCount) {
        this.logger.info(
          { cluster: this.clusterName, service: this.serviceName },
          `Service already at desired count ${desiredCount}`
        );
        return {
          success: true,
          action: 'start',
          resourceType: this.resource.resourceType,
          resourceId: this.resource.resourceId,
          message: `Service already at desired count ${desiredCount}`,
          previousState: currentStatus,
        };
      }

      // Determine operation mode using type guard
      if ('minCapacity' in startConfig && 'maxCapacity' in startConfig) {
        // Auto Scaling mode
        const { minCapacity, maxCapacity } = startConfig;
        await this.detectAutoScaling(); // Optional: for logging purposes
        await this.manageViaAutoScaling(minCapacity, maxCapacity, desiredCount);

        const waitForStable = defaults.waitForStable ?? true;
        if (waitForStable) {
          const timeout = defaults.stableTimeoutSeconds ?? 300;
          await this.waitForStable(timeout);
        }

        return {
          success: true,
          action: 'start',
          resourceType: this.resource.resourceType,
          resourceId: this.resource.resourceId,
          message: `Service started via Auto Scaling (min=${minCapacity}, max=${maxCapacity}, desired=${desiredCount}, was ${currentStatus.desired_count as number})`,
          previousState: currentStatus,
        };
      } else {
        // Direct mode
        await this.ecsClient.send(
          new UpdateServiceCommand({
            cluster: this.clusterName,
            service: this.serviceName,
            desiredCount: desiredCount,
          })
        );

        const waitForStable = defaults.waitForStable ?? true;
        if (waitForStable) {
          const timeout = defaults.stableTimeoutSeconds ?? 300;
          await this.waitForStable(timeout);
        }

        return {
          success: true,
          action: 'start',
          resourceType: this.resource.resourceType,
          resourceId: this.resource.resourceId,
          message: `Service started (desired=${desiredCount}, was ${currentStatus.desired_count as number})`,
          previousState: currentStatus,
        };
      }
    } catch (error) {
      this.logger.error(
        { cluster: this.clusterName, service: this.serviceName, error },
        'Failed to start service'
      );
      return {
        success: false,
        action: 'start',
        resourceType: this.resource.resourceType,
        resourceId: this.resource.resourceId,
        message: 'Start operation failed',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Check if service has reached its desired state.
   *
   * A service is considered ready when:
   * - desired_count equals running_count
   *
   * @returns True if service is ready, false otherwise
   */
  async isReady(): Promise<boolean> {
    try {
      const status = await this.getStatus();
      const isReady = status.desired_count === status.running_count;

      this.logger.debug(
        {
          cluster: this.clusterName,
          service: this.serviceName,
          desired_count: status.desired_count,
          running_count: status.running_count,
          is_ready: isReady,
        },
        `Service ready check: ${isReady}`
      );

      return isReady;
    } catch (error) {
      this.logger.error(
        {
          cluster: this.clusterName,
          service: this.serviceName,
          error,
        },
        'Failed to check if service is ready'
      );
      return false;
    }
  }

  /**
   * Wait for the ECS Service to reach a stable state.
   *
   * Uses AWS SDK waiter to poll the service status until it becomes stable.
   *
   * @param timeout - Maximum wait time in seconds
   * @throws Error if service does not stabilize within timeout
   */
  private async waitForStable(timeout: number = 300): Promise<void> {
    // Calculate max attempts based on timeout and polling interval
    // Waiter polls every 15 seconds by default
    const pollingInterval = 15;
    const maxAttempts = Math.max(1, Math.floor(timeout / pollingInterval));

    this.logger.debug(
      {
        cluster: this.clusterName,
        service: this.serviceName,
        timeout,
        max_attempts: maxAttempts,
      },
      'Starting waiter for service stability'
    );

    await waitUntilServicesStable(
      {
        client: this.ecsClient,
        maxWaitTime: timeout,
        minDelay: pollingInterval,
        maxDelay: pollingInterval,
      },
      {
        cluster: this.clusterName,
        services: [this.serviceName],
      }
    );

    this.logger.info(
      {
        cluster: this.clusterName,
        service: this.serviceName,
      },
      'Service reached stable state'
    );
  }
}

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
} from "@aws-sdk/client-ecs";
import {
  ApplicationAutoScalingClient,
  DescribeScalableTargetsCommand,
  RegisterScalableTargetCommand,
  ServiceNamespace,
} from "@aws-sdk/client-application-auto-scaling";
import type { Logger } from "pino";
import type {
  DiscoveredResource,
  Config,
  HandlerResult,
  ResourceHandler,
  ECSStopBehavior,
  ECSAutoScalingConfig,
} from "@/types";
import { setupLogger } from "@utils/logger";
import { getResourceDefaults } from "@handlers/base";

/**
 * Handler for AWS ECS Service resources.
 *
 * This handler manages the lifecycle of ECS Services by controlling
 * the desiredCount parameter. When stopping, it sets desiredCount to 0.
 * When starting, it uses the default_desired_count from configuration.
 */
export class ECSServiceHandler implements ResourceHandler {
  private ecsClient: ECSClient;
  private autoScalingClient: ApplicationAutoScalingClient;
  private clusterName: string;
  private serviceName: string;
  private logger: Logger;

  constructor(private resource: DiscoveredResource, private config: Config) {
    this.logger = setupLogger(`lights-out:handler.${resource.resourceType}`);

    // Extract region from ARN (format: arn:aws:ecs:REGION:account:...)
    // Falls back to AWS_DEFAULT_REGION environment variable if not in ARN
    let region: string | undefined;
    if (resource.arn?.startsWith("arn:aws:")) {
      const arnParts = resource.arn.split(":");
      if (arnParts.length >= 4) {
        region = arnParts[3];
      }
    }

    // Initialize ECS client with region
    this.ecsClient = new ECSClient({ region });

    // Initialize Application Auto Scaling client with same region
    this.autoScalingClient = new ApplicationAutoScalingClient({ region });

    // Extract cluster and service names from resource
    this.clusterName = (resource.metadata.cluster_name as string) ?? "default";

    // Extract service name from resource_id
    // Format can be "cluster/service" or just "service"
    if (resource.resourceId.includes("/")) {
      this.serviceName = resource.resourceId.split("/").pop()!;
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
        throw new Error(
          `Service ${this.serviceName} not found in cluster ${this.clusterName}`
        );
      }

      const service: Service = response.services[0];
      const desiredCount = service.desiredCount ?? 0;
      const runningCount = service.runningCount ?? 0;
      const status = service.status ?? "UNKNOWN";

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
          ScalableDimension: "ecs:service:DesiredCount",
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
          "Detected Auto Scaling configuration"
        );

        return {
          minCapacity: target.MinCapacity!,
          maxCapacity: target.MaxCapacity!,
        };
      }

      this.logger.debug(
        { cluster: this.clusterName, service: this.serviceName },
        "No Auto Scaling detected"
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
        "Failed to detect Auto Scaling, assuming none"
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
      "Managing service via Auto Scaling"
    );

    // 1. Register/update Scalable Target
    await this.autoScalingClient.send(
      new RegisterScalableTargetCommand({
        ServiceNamespace: ServiceNamespace.ECS,
        ResourceId: resourceId,
        ScalableDimension: "ecs:service:DesiredCount",
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
        "Updated service desiredCount"
      );
    }
  }

  /**
   * Stop the ECS Service by setting desiredCount to 0.
   *
   * This operation is idempotent - if the service is already stopped,
   * it returns success without making changes.
   *
   * @returns HandlerResult indicating success or failure
   */
  async stop(): Promise<HandlerResult> {
    try {
      const currentStatus = await this.getStatus();
      const defaults = getResourceDefaults(this.config, this.resource.resourceType);

      this.logger.info(
        {
          cluster: this.clusterName,
          service: this.serviceName,
          current_desired_count: currentStatus.desired_count,
        },
        "Attempting to stop service"
      );

      // Detect if service has Auto Scaling
      const autoScalingState = await this.detectAutoScaling();

      // Path 1: Service has Auto Scaling
      if (autoScalingState !== null) {
        // Idempotent check
        if (currentStatus.desired_count === 0) {
          this.logger.info(
            { cluster: this.clusterName, service: this.serviceName },
            "Service already stopped"
          );
          return {
            success: true,
            action: "stop",
            resourceType: this.resource.resourceType,
            resourceId: this.resource.resourceId,
            message: "Service already stopped",
            previousState: currentStatus,
          };
        }

        // Set MinCapacity=0, MaxCapacity=0 to force stop
        await this.manageViaAutoScaling(0, 0, 0);

        if (defaults.waitForStable) {
          const timeout = (defaults.stableTimeoutSeconds as number) ?? 300;
          await this.waitForStable(timeout);
        }

        return {
          success: true,
          action: "stop",
          resourceType: this.resource.resourceType,
          resourceId: this.resource.resourceId,
          message: `Service stopped via Auto Scaling (was ${currentStatus.desired_count})`,
          previousState: currentStatus,
        };
      }

      // Path 2: No Auto Scaling (Legacy Mode)
      const stopBehavior = (defaults.stopBehavior as ECSStopBehavior) ?? {
        mode: "scale_to_zero",
      };

      let targetCount: number;
      switch (stopBehavior.mode) {
        case "scale_to_zero":
          targetCount = 0;
          break;
        case "reduce_by_count":
          targetCount = Math.max(
            0,
            (currentStatus.desired_count as number) - (stopBehavior.reduceByCount ?? 1)
          );
          break;
        case "reduce_to_count":
          targetCount = stopBehavior.reduceToCount ?? 0;
          break;
        default:
          targetCount = 0;
      }

      if (currentStatus.desired_count === targetCount) {
        return {
          success: true,
          action: "stop",
          resourceType: this.resource.resourceType,
          resourceId: this.resource.resourceId,
          message: `Service already at target count ${targetCount}`,
          previousState: currentStatus,
        };
      }

      await this.ecsClient.send(
        new UpdateServiceCommand({
          cluster: this.clusterName,
          service: this.serviceName,
          desiredCount: targetCount,
        })
      );

      if (defaults.waitForStable) {
        const timeout = (defaults.stableTimeoutSeconds as number) ?? 300;
        await this.waitForStable(timeout);
      }

      return {
        success: true,
        action: "stop",
        resourceType: this.resource.resourceType,
        resourceId: this.resource.resourceId,
        message: `Service scaled to ${targetCount} (legacy mode, was ${currentStatus.desired_count})`,
        previousState: currentStatus,
      };
    } catch (error) {
      this.logger.error(
        { cluster: this.clusterName, service: this.serviceName, error },
        "Failed to stop service"
      );
      return {
        success: false,
        action: "stop",
        resourceType: this.resource.resourceType,
        resourceId: this.resource.resourceId,
        message: "Stop operation failed",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Start the ECS Service by setting desiredCount to default value.
   *
   * Uses default_desired_count from configuration. This operation is
   * idempotent - if the service is already at the desired count, it
   * returns success without making changes.
   *
   * @returns HandlerResult indicating success or failure
   */
  async start(): Promise<HandlerResult> {
    try {
      const currentStatus = await this.getStatus();
      const defaults = getResourceDefaults(this.config, this.resource.resourceType);

      this.logger.info(
        {
          cluster: this.clusterName,
          service: this.serviceName,
          current_desired_count: currentStatus.desired_count,
        },
        "Attempting to start service"
      );

      // Detect if service has Auto Scaling
      const autoScalingState = await this.detectAutoScaling();

      // Path 1: Service has Auto Scaling
      if (autoScalingState !== null) {
        // Require autoScaling config if Auto Scaling detected
        const autoScalingConfig = defaults.autoScaling as ECSAutoScalingConfig | undefined;

        if (!autoScalingConfig) {
          throw new Error(
            `Service has Auto Scaling but config lacks autoScaling settings. ` +
            `Please add resource_defaults.ecs-service.autoScaling to config.`
          );
        }

        const targetCount = autoScalingConfig.desiredCount;

        // Idempotent check
        if (currentStatus.desired_count === targetCount) {
          this.logger.info(
            { cluster: this.clusterName, service: this.serviceName },
            `Service already at desired count ${targetCount}`
          );
          return {
            success: true,
            action: "start",
            resourceType: this.resource.resourceType,
            resourceId: this.resource.resourceId,
            message: `Service already at desired count ${targetCount}`,
            previousState: currentStatus,
          };
        }

        // Set Auto Scaling min/max and desired count
        await this.manageViaAutoScaling(
          autoScalingConfig.minCapacity,
          autoScalingConfig.maxCapacity,
          targetCount
        );

        if (defaults.waitForStable) {
          const timeout = (defaults.stableTimeoutSeconds as number) ?? 300;
          await this.waitForStable(timeout);
        }

        return {
          success: true,
          action: "start",
          resourceType: this.resource.resourceType,
          resourceId: this.resource.resourceId,
          message: `Service started via Auto Scaling (min=${autoScalingConfig.minCapacity}, max=${autoScalingConfig.maxCapacity}, desired=${targetCount})`,
          previousState: currentStatus,
        };
      }

      // Path 2: No Auto Scaling (Legacy Mode)
      const targetCount = (defaults.defaultDesiredCount as number) ?? 1;

      if (currentStatus.desired_count === targetCount) {
        return {
          success: true,
          action: "start",
          resourceType: this.resource.resourceType,
          resourceId: this.resource.resourceId,
          message: `Service already at desired count ${targetCount}`,
          previousState: currentStatus,
        };
      }

      await this.ecsClient.send(
        new UpdateServiceCommand({
          cluster: this.clusterName,
          service: this.serviceName,
          desiredCount: targetCount,
        })
      );

      if (defaults.waitForStable) {
        const timeout = (defaults.stableTimeoutSeconds as number) ?? 300;
        await this.waitForStable(timeout);
      }

      return {
        success: true,
        action: "start",
        resourceType: this.resource.resourceType,
        resourceId: this.resource.resourceId,
        message: `Service scaled to ${targetCount} (legacy mode)`,
        previousState: currentStatus,
      };
    } catch (error) {
      this.logger.error(
        { cluster: this.clusterName, service: this.serviceName, error },
        "Failed to start service"
      );
      return {
        success: false,
        action: "start",
        resourceType: this.resource.resourceType,
        resourceId: this.resource.resourceId,
        message: "Start operation failed",
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
        "Failed to check if service is ready"
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
      "Starting waiter for service stability"
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
      "Service reached stable state"
    );
  }
}

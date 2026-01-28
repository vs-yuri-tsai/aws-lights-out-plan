/**
 * ASG Group Handler implementation.
 *
 * Handles start, stop, and status operations for AWS EC2 Auto Scaling Groups.
 */

import {
  AutoScalingClient,
  DescribeAutoScalingGroupsCommand,
  UpdateAutoScalingGroupCommand,
  SuspendProcessesCommand,
  ResumeProcessesCommand,
} from '@aws-sdk/client-auto-scaling';
import type { Logger } from 'pino';
import type {
  DiscoveredResource,
  Config,
  HandlerResult,
  ResourceHandler,
  ASGActionConfig,
  ASGResourceDefaults,
  TriggerSource,
} from '@shared/types';
import { DEFAULT_PROCESSES_TO_SUSPEND } from '@shared/types';
import { setupLogger } from '@shared/utils/logger';
import { getResourceDefaults } from './base';

/**
 * Handler for AWS EC2 Auto Scaling Groups.
 *
 * This handler manages the lifecycle of ASGs by controlling
 * the MinSize, MaxSize, and DesiredCapacity parameters.
 * It also handles suspending/resuming scaling processes to prevent
 * conflicts with lights-out operations.
 */
export class ASGGroupHandler implements ResourceHandler {
  private autoScalingClient: AutoScalingClient;
  private asgName: string;
  private logger: Logger;
  private triggerSource?: TriggerSource;
  private region?: string;

  constructor(
    private resource: DiscoveredResource,
    private config: Config
  ) {
    this.logger = setupLogger(`lights-out:handler.${resource.resourceType}`);

    // Extract trigger source from resource metadata (injected by Orchestrator)
    this.triggerSource = resource.metadata.__triggerSource as TriggerSource | undefined;

    // Extract region from ARN (format: arn:aws:autoscaling:REGION:account:...)
    if (resource.arn?.startsWith('arn:aws:')) {
      const arnParts = resource.arn.split(':');
      if (arnParts.length >= 4) {
        this.region = arnParts[3];
      }
    }

    // Initialize Auto Scaling client with region
    this.autoScalingClient = new AutoScalingClient({ region: this.region });

    // Extract ASG name from resource ID
    this.asgName = resource.resourceId;
  }

  /**
   * Get current status of the Auto Scaling Group.
   *
   * @returns Object with keys:
   *   - min_size: Minimum size
   *   - max_size: Maximum size
   *   - desired_capacity: Desired capacity
   *   - instances: Total number of instances
   *   - in_service_instances: Number of InService instances
   *   - is_stopped: Boolean indicating if desired_capacity is 0
   *   - suspended_processes: Array of suspended process names
   *
   * @throws Error if ASG not found or API call fails
   */
  async getStatus(): Promise<Record<string, unknown>> {
    try {
      const response = await this.autoScalingClient.send(
        new DescribeAutoScalingGroupsCommand({
          AutoScalingGroupNames: [this.asgName],
        })
      );

      if (!response.AutoScalingGroups || response.AutoScalingGroups.length === 0) {
        throw new Error(`Auto Scaling Group ${this.asgName} not found`);
      }

      const asg = response.AutoScalingGroups[0];
      const instances = asg.Instances ?? [];
      const inServiceInstances = instances.filter((i) => i.LifecycleState === 'InService');
      const suspendedProcesses = (asg.SuspendedProcesses ?? [])
        .map((p) => p.ProcessName)
        .filter((name): name is string => name !== undefined);

      return {
        min_size: asg.MinSize ?? 0,
        max_size: asg.MaxSize ?? 0,
        desired_capacity: asg.DesiredCapacity ?? 0,
        instances: instances.length,
        in_service_instances: inServiceInstances.length,
        is_stopped: (asg.DesiredCapacity ?? 0) === 0,
        suspended_processes: suspendedProcesses,
      };
    } catch (error) {
      this.logger.error(
        {
          asgName: this.asgName,
          error,
        },
        `Failed to get status for ASG ${this.asgName}`
      );
      throw error;
    }
  }

  /**
   * Validate action configuration.
   *
   * @param actionConfig - The action configuration to validate
   * @param actionName - Name of the action (for error messages)
   * @throws Error if validation fails
   */
  private validateActionConfig(actionConfig: ASGActionConfig, actionName: string): void {
    const { minSize, maxSize, desiredCapacity } = actionConfig;

    // Validate all values are non-negative
    if (minSize < 0 || maxSize < 0 || desiredCapacity < 0) {
      throw new Error(`Invalid ${actionName} config: all values must be >= 0`);
    }

    // Validate minSize <= maxSize
    if (minSize > maxSize) {
      throw new Error(
        `Invalid ${actionName} config: minSize (${minSize}) must be <= maxSize (${maxSize})`
      );
    }

    // Validate desiredCapacity is within range
    if (desiredCapacity < minSize || desiredCapacity > maxSize) {
      throw new Error(
        `Invalid ${actionName} config: desiredCapacity (${desiredCapacity}) must be between minSize (${minSize}) and maxSize (${maxSize})`
      );
    }
  }

  /**
   * Stop the Auto Scaling Group using the stop configuration.
   *
   * This operation:
   * 1. Suspends scaling processes (if configured)
   * 2. Updates ASG to MinSize=0, MaxSize=0, DesiredCapacity=0
   * 3. Waits briefly for confirmation
   *
   * @returns HandlerResult indicating success or failure
   */
  async stop(): Promise<HandlerResult> {
    try {
      const currentStatus = await this.getStatus();
      const defaults = getResourceDefaults(
        this.config,
        this.resource.resourceType
      ) as unknown as ASGResourceDefaults;

      // Validate stop configuration
      if (!defaults.stop) {
        throw new Error(
          'Missing required stop configuration in resource_defaults.autoscaling-group.stop'
        );
      }

      this.validateActionConfig(defaults.stop, 'stop');

      const stopConfig = defaults.stop;
      const { minSize, maxSize, desiredCapacity } = stopConfig;

      this.logger.info(
        {
          asgName: this.asgName,
          current: {
            minSize: currentStatus.min_size,
            maxSize: currentStatus.max_size,
            desiredCapacity: currentStatus.desired_capacity,
          },
          target: { minSize, maxSize, desiredCapacity },
        },
        'Attempting to stop ASG'
      );

      // Idempotent check
      if (
        currentStatus.min_size === minSize &&
        currentStatus.max_size === maxSize &&
        currentStatus.desired_capacity === desiredCapacity
      ) {
        this.logger.info({ asgName: this.asgName }, 'ASG already at target capacity');
        return {
          success: true,
          action: 'stop',
          resourceType: this.resource.resourceType,
          resourceId: this.resource.resourceId,
          message: `ASG already at target (min=${minSize}, max=${maxSize}, desired=${desiredCapacity})`,
          previousState: currentStatus,
          idempotent: true,
          triggerSource: this.triggerSource,
          region: this.region,
        };
      }

      // Suspend scaling processes if configured
      const shouldSuspend = defaults.suspendProcesses ?? true;
      if (shouldSuspend) {
        const processesToSuspend = defaults.processesToSuspend ?? [...DEFAULT_PROCESSES_TO_SUSPEND];
        await this.suspendProcesses(processesToSuspend);
      }

      // Update ASG
      await this.autoScalingClient.send(
        new UpdateAutoScalingGroupCommand({
          AutoScalingGroupName: this.asgName,
          MinSize: minSize,
          MaxSize: maxSize,
          DesiredCapacity: desiredCapacity,
        })
      );

      this.logger.info(
        {
          asgName: this.asgName,
          minSize,
          maxSize,
          desiredCapacity,
        },
        'Updated ASG capacity'
      );

      // Wait briefly if configured
      const waitSeconds = defaults.waitAfterCommand ?? 30;
      if (waitSeconds > 0) {
        await this.sleep(waitSeconds * 1000);
      }

      return {
        success: true,
        action: 'stop',
        resourceType: this.resource.resourceType,
        resourceId: this.resource.resourceId,
        message: `ASG stopped (min=${minSize}, max=${maxSize}, desired=${desiredCapacity}, was min=${currentStatus.min_size as number}, max=${currentStatus.max_size as number}, desired=${currentStatus.desired_capacity as number})`,
        previousState: currentStatus,
        triggerSource: this.triggerSource,
        region: this.region,
      };
    } catch (error) {
      this.logger.error({ asgName: this.asgName, error }, 'Failed to stop ASG');
      return {
        success: false,
        action: 'stop',
        resourceType: this.resource.resourceType,
        resourceId: this.resource.resourceId,
        message: 'Stop operation failed',
        error: error instanceof Error ? error.message : String(error),
        triggerSource: this.triggerSource,
        region: this.region,
      };
    }
  }

  /**
   * Start the Auto Scaling Group using the start configuration.
   *
   * This operation:
   * 1. Updates ASG to configured MinSize, MaxSize, DesiredCapacity
   * 2. Resumes scaling processes (if configured)
   * 3. Waits briefly for confirmation
   *
   * @returns HandlerResult indicating success or failure
   */
  async start(): Promise<HandlerResult> {
    try {
      const currentStatus = await this.getStatus();
      const defaults = getResourceDefaults(
        this.config,
        this.resource.resourceType
      ) as unknown as ASGResourceDefaults;

      // Validate start configuration
      if (!defaults.start) {
        throw new Error(
          'Missing required start configuration in resource_defaults.autoscaling-group.start'
        );
      }

      this.validateActionConfig(defaults.start, 'start');

      const startConfig = defaults.start;
      const { minSize, maxSize, desiredCapacity } = startConfig;

      this.logger.info(
        {
          asgName: this.asgName,
          current: {
            minSize: currentStatus.min_size,
            maxSize: currentStatus.max_size,
            desiredCapacity: currentStatus.desired_capacity,
          },
          target: { minSize, maxSize, desiredCapacity },
        },
        'Attempting to start ASG'
      );

      // Idempotent check
      if (
        currentStatus.min_size === minSize &&
        currentStatus.max_size === maxSize &&
        currentStatus.desired_capacity === desiredCapacity
      ) {
        this.logger.info({ asgName: this.asgName }, 'ASG already at target capacity');
        return {
          success: true,
          action: 'start',
          resourceType: this.resource.resourceType,
          resourceId: this.resource.resourceId,
          message: `ASG already at target (min=${minSize}, max=${maxSize}, desired=${desiredCapacity})`,
          previousState: currentStatus,
          idempotent: true,
          triggerSource: this.triggerSource,
          region: this.region,
        };
      }

      // Update ASG
      await this.autoScalingClient.send(
        new UpdateAutoScalingGroupCommand({
          AutoScalingGroupName: this.asgName,
          MinSize: minSize,
          MaxSize: maxSize,
          DesiredCapacity: desiredCapacity,
        })
      );

      this.logger.info(
        {
          asgName: this.asgName,
          minSize,
          maxSize,
          desiredCapacity,
        },
        'Updated ASG capacity'
      );

      // Resume scaling processes if configured
      const shouldSuspend = defaults.suspendProcesses ?? true;
      if (shouldSuspend) {
        const processesToResume = defaults.processesToSuspend ?? [...DEFAULT_PROCESSES_TO_SUSPEND];
        await this.resumeProcesses(processesToResume);
      }

      // Wait briefly if configured
      const waitSeconds = defaults.waitAfterCommand ?? 30;
      if (waitSeconds > 0) {
        await this.sleep(waitSeconds * 1000);
      }

      return {
        success: true,
        action: 'start',
        resourceType: this.resource.resourceType,
        resourceId: this.resource.resourceId,
        message: `ASG started (min=${minSize}, max=${maxSize}, desired=${desiredCapacity}, was min=${currentStatus.min_size as number}, max=${currentStatus.max_size as number}, desired=${currentStatus.desired_capacity as number})`,
        previousState: currentStatus,
        triggerSource: this.triggerSource,
        region: this.region,
      };
    } catch (error) {
      this.logger.error({ asgName: this.asgName, error }, 'Failed to start ASG');
      return {
        success: false,
        action: 'start',
        resourceType: this.resource.resourceType,
        resourceId: this.resource.resourceId,
        message: 'Start operation failed',
        error: error instanceof Error ? error.message : String(error),
        triggerSource: this.triggerSource,
        region: this.region,
      };
    }
  }

  /**
   * Check if ASG has reached its desired state.
   *
   * @returns True if:
   *   - DesiredCapacity is 0 and there are no instances
   *   - Or all instances are InService and count matches DesiredCapacity
   */
  async isReady(): Promise<boolean> {
    try {
      const status = await this.getStatus();
      const desiredCapacity = status.desired_capacity as number;
      const inServiceInstances = status.in_service_instances as number;

      // If desired is 0, we're ready when there are no instances
      if (desiredCapacity === 0) {
        const isReady = (status.instances as number) === 0;
        this.logger.debug(
          {
            asgName: this.asgName,
            desired_capacity: desiredCapacity,
            instances: status.instances,
            is_ready: isReady,
          },
          `ASG ready check (stopped): ${isReady}`
        );
        return isReady;
      }

      // Otherwise, we're ready when InService count matches desired
      const isReady = inServiceInstances === desiredCapacity;

      this.logger.debug(
        {
          asgName: this.asgName,
          desired_capacity: desiredCapacity,
          in_service_instances: inServiceInstances,
          is_ready: isReady,
        },
        `ASG ready check: ${isReady}`
      );

      return isReady;
    } catch (error) {
      this.logger.error(
        {
          asgName: this.asgName,
          error,
        },
        'Failed to check if ASG is ready'
      );
      return false;
    }
  }

  /**
   * Suspend scaling processes for the ASG.
   *
   * @param processes - List of process names to suspend
   */
  private async suspendProcesses(processes: string[]): Promise<void> {
    this.logger.info(
      {
        asgName: this.asgName,
        processes,
      },
      'Suspending scaling processes'
    );

    await this.autoScalingClient.send(
      new SuspendProcessesCommand({
        AutoScalingGroupName: this.asgName,
        ScalingProcesses: processes,
      })
    );
  }

  /**
   * Resume scaling processes for the ASG.
   *
   * @param processes - List of process names to resume
   */
  private async resumeProcesses(processes: string[]): Promise<void> {
    this.logger.info(
      {
        asgName: this.asgName,
        processes,
      },
      'Resuming scaling processes'
    );

    await this.autoScalingClient.send(
      new ResumeProcessesCommand({
        AutoScalingGroupName: this.asgName,
        ScalingProcesses: processes,
      })
    );
  }

  /**
   * Sleep for specified milliseconds.
   *
   * @param ms - Milliseconds to sleep
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
  }
}

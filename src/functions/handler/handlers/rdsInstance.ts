/**
 * RDS Instance Handler implementation.
 *
 * Handles start, stop, and status operations for AWS RDS DB Instances.
 */

import {
  RDSClient,
  DescribeDBInstancesCommand,
  StartDBInstanceCommand,
  StopDBInstanceCommand,
  waitUntilDBInstanceAvailable,
  type DBInstance,
} from '@aws-sdk/client-rds';
import { setTimeout } from 'timers/promises';
import type { Logger } from 'pino';
import type { DiscoveredResource, Config, HandlerResult, ResourceHandler } from '@shared/types';
import { setupLogger } from '@shared/utils/logger';
import { sendTeamsNotification } from '@shared/utils/teamsNotifier';
import { getResourceDefaults } from './base';

/**
 * Handler for AWS RDS DB Instance resources.
 *
 * This handler manages the lifecycle of RDS DB Instances by using
 * the StartDBInstance and StopDBInstance APIs. Unlike ECS services,
 * RDS instances are directly started/stopped rather than scaled.
 */
export class RDSInstanceHandler implements ResourceHandler {
  private rdsClient: RDSClient;
  private dbInstanceIdentifier: string;
  private logger: Logger;

  constructor(
    private resource: DiscoveredResource,
    private config: Config
  ) {
    this.logger = setupLogger(`lights-out:handler.${resource.resourceType}`);

    // Extract region from ARN (format: arn:aws:rds:REGION:account:db:instance-id)
    // Falls back to AWS_DEFAULT_REGION environment variable if not in ARN
    let region: string | undefined;
    if (resource.arn?.startsWith('arn:aws:')) {
      const arnParts = resource.arn.split(':');
      if (arnParts.length >= 4) {
        region = arnParts[3];
      }
    }

    // Initialize RDS client with region
    this.rdsClient = new RDSClient({ region });

    // Extract DB instance identifier from ARN or resource_id
    // ARN format: arn:aws:rds:region:account:db:instance-id
    // resource_id can be either the full ARN or just the instance ID
    if (resource.arn?.includes(':db:')) {
      this.dbInstanceIdentifier = resource.arn.split(':db:')[1];
    } else {
      this.dbInstanceIdentifier = resource.resourceId;
    }
  }

  /**
   * Get current status of the RDS DB Instance.
   *
   * @returns Object with keys:
   *   - status: DB instance status (e.g., "available", "stopped", "stopping", "starting")
   *   - is_stopped: Boolean indicating if instance is stopped
   *   - engine: Database engine (e.g., "postgres", "mysql")
   *   - engine_version: Engine version
   *
   * @throws Error if DB instance not found or API call fails
   */
  async getStatus(): Promise<Record<string, unknown>> {
    try {
      const response = await this.rdsClient.send(
        new DescribeDBInstancesCommand({
          DBInstanceIdentifier: this.dbInstanceIdentifier,
        })
      );

      if (!response.DBInstances || response.DBInstances.length === 0) {
        throw new Error(`DB Instance ${this.dbInstanceIdentifier} not found`);
      }

      const instance: DBInstance = response.DBInstances[0];
      const status = instance.DBInstanceStatus ?? 'unknown';

      return {
        status,
        is_stopped: status === 'stopped',
        engine: instance.Engine ?? 'unknown',
        engine_version: instance.EngineVersion ?? 'unknown',
        instance_class: instance.DBInstanceClass ?? 'unknown',
      };
    } catch (error) {
      this.logger.error(
        {
          db_instance: this.dbInstanceIdentifier,
          error,
        },
        `Failed to get status for DB instance ${this.dbInstanceIdentifier}`
      );
      throw error;
    }
  }

  /**
   * Stop the RDS DB Instance.
   *
   * This operation is idempotent - if the instance is already stopped or stopping,
   * it returns success without making changes.
   *
   * @returns HandlerResult indicating success or failure
   */
  async stop(): Promise<HandlerResult> {
    try {
      // 1. Get current status
      const currentStatus = await this.getStatus();

      this.logger.info(
        {
          db_instance: this.dbInstanceIdentifier,
          current_status: currentStatus.status,
        },
        'Attempting to stop DB instance'
      );

      // 2. Idempotent check - already stopped or stopping
      if (currentStatus.status === 'stopped' || currentStatus.status === 'stopping') {
        this.logger.info(
          {
            db_instance: this.dbInstanceIdentifier,
            status: currentStatus.status,
          },
          `DB instance already ${currentStatus.status}`
        );
        return {
          success: true,
          action: 'stop',
          resourceType: this.resource.resourceType,
          resourceId: this.resource.resourceId,
          message: `DB instance already ${currentStatus.status}`,
          previousState: currentStatus,
        };
      }

      // 3. Check if instance can be stopped (must be 'available')
      if (currentStatus.status !== 'available') {
        const errorMessage = `Cannot stop DB instance in status: ${String(currentStatus.status)}. Instance must be 'available' to be stopped.`;
        this.logger.warn(
          {
            db_instance: this.dbInstanceIdentifier,
            status: currentStatus.status,
          },
          errorMessage
        );
        return {
          success: false,
          action: 'stop',
          resourceType: this.resource.resourceType,
          resourceId: this.resource.resourceId,
          message: errorMessage,
          previousState: currentStatus,
        };
      }

      // 4. Stop the DB instance
      await this.rdsClient.send(
        new StopDBInstanceCommand({
          DBInstanceIdentifier: this.dbInstanceIdentifier,
        })
      );

      this.logger.info(
        {
          db_instance: this.dbInstanceIdentifier,
        },
        'Issued stop command for DB instance'
      );

      // 5. Wait for stopped if configured
      const defaults = getResourceDefaults(this.config, this.resource.resourceType);
      if (defaults.waitForStable) {
        const timeout = (defaults.stableTimeoutSeconds as number) ?? 300;
        this.logger.info(
          {
            db_instance: this.dbInstanceIdentifier,
            timeout,
          },
          `Waiting for DB instance to stop (timeout: ${timeout}s)`
        );
        await this.waitForStopped(timeout);
      }

      const result: HandlerResult = {
        success: true,
        action: 'stop',
        resourceType: this.resource.resourceType,
        resourceId: this.resource.resourceId,
        message: `DB instance stopped (was ${String(currentStatus.status)})`,
        previousState: currentStatus,
      };

      // Send Teams notification if configured
      await this.sendNotification(result);

      return result;
    } catch (error) {
      this.logger.error(
        {
          db_instance: this.dbInstanceIdentifier,
          error,
        },
        'Failed to stop DB instance'
      );
      const result: HandlerResult = {
        success: false,
        action: 'stop',
        resourceType: this.resource.resourceType,
        resourceId: this.resource.resourceId,
        message: 'Stop operation failed',
        error: error instanceof Error ? error.message : String(error),
      };

      // Send Teams notification for failure
      await this.sendNotification(result);

      return result;
    }
  }

  /**
   * Start the RDS DB Instance.
   *
   * This operation is idempotent - if the instance is already available or starting,
   * it returns success without making changes.
   *
   * @returns HandlerResult indicating success or failure
   */
  async start(): Promise<HandlerResult> {
    try {
      // 1. Get current status
      const currentStatus = await this.getStatus();

      this.logger.info(
        {
          db_instance: this.dbInstanceIdentifier,
          current_status: currentStatus.status,
        },
        'Attempting to start DB instance'
      );

      // 2. Idempotent check - already available or starting
      if (currentStatus.status === 'available' || currentStatus.status === 'starting') {
        this.logger.info(
          {
            db_instance: this.dbInstanceIdentifier,
            status: currentStatus.status,
          },
          `DB instance already ${currentStatus.status}`
        );
        return {
          success: true,
          action: 'start',
          resourceType: this.resource.resourceType,
          resourceId: this.resource.resourceId,
          message: `DB instance already ${currentStatus.status}`,
          previousState: currentStatus,
        };
      }

      // 3. Check if instance can be started (must be 'stopped')
      if (currentStatus.status !== 'stopped') {
        const errorMessage = `Cannot start DB instance in status: ${String(currentStatus.status)}. Instance must be 'stopped' to be started.`;
        this.logger.warn(
          {
            db_instance: this.dbInstanceIdentifier,
            status: currentStatus.status,
          },
          errorMessage
        );
        return {
          success: false,
          action: 'start',
          resourceType: this.resource.resourceType,
          resourceId: this.resource.resourceId,
          message: errorMessage,
          previousState: currentStatus,
        };
      }

      // 4. Start the DB instance
      await this.rdsClient.send(
        new StartDBInstanceCommand({
          DBInstanceIdentifier: this.dbInstanceIdentifier,
        })
      );

      this.logger.info(
        {
          db_instance: this.dbInstanceIdentifier,
        },
        'Issued start command for DB instance'
      );

      // 5. Wait for available if configured
      const defaults = getResourceDefaults(this.config, this.resource.resourceType);
      if (defaults.waitForStable) {
        const timeout = (defaults.stableTimeoutSeconds as number) ?? 300;
        this.logger.info(
          {
            db_instance: this.dbInstanceIdentifier,
            timeout,
          },
          `Waiting for DB instance to become available (timeout: ${timeout}s)`
        );
        await this.waitForAvailable(timeout);
      }

      const result: HandlerResult = {
        success: true,
        action: 'start',
        resourceType: this.resource.resourceType,
        resourceId: this.resource.resourceId,
        message: `DB instance started (was ${String(currentStatus.status)})`,
        previousState: currentStatus,
      };

      // Send Teams notification if configured
      await this.sendNotification(result);

      return result;
    } catch (error) {
      this.logger.error(
        {
          db_instance: this.dbInstanceIdentifier,
          error,
        },
        'Failed to start DB instance'
      );
      const result: HandlerResult = {
        success: false,
        action: 'start',
        resourceType: this.resource.resourceType,
        resourceId: this.resource.resourceId,
        message: 'Start operation failed',
        error: error instanceof Error ? error.message : String(error),
      };

      // Send Teams notification for failure
      await this.sendNotification(result);

      return result;
    }
  }

  /**
   * Check if DB instance has reached its desired state.
   *
   * A DB instance is considered ready when:
   * - status is 'available' (for start operations)
   * - status is 'stopped' (for stop operations)
   *
   * @returns True if instance is ready, false otherwise
   */
  async isReady(): Promise<boolean> {
    try {
      const status = await this.getStatus();
      const isReady = status.status === 'available' || status.status === 'stopped';

      this.logger.debug(
        {
          db_instance: this.dbInstanceIdentifier,
          status: status.status,
          is_ready: isReady,
        },
        `DB instance ready check: ${isReady}`
      );

      return isReady;
    } catch (error) {
      this.logger.error(
        {
          db_instance: this.dbInstanceIdentifier,
          error,
        },
        'Failed to check if DB instance is ready'
      );
      return false;
    }
  }

  /**
   * Wait for the RDS DB Instance to reach 'available' state.
   *
   * Uses AWS SDK waiter to poll the instance status until it becomes available.
   *
   * @param timeout - Maximum wait time in seconds
   * @throws Error if instance does not become available within timeout
   */
  private async waitForAvailable(timeout: number = 300): Promise<void> {
    this.logger.debug(
      {
        db_instance: this.dbInstanceIdentifier,
        timeout,
      },
      'Starting waiter for DB instance availability'
    );

    await waitUntilDBInstanceAvailable(
      {
        client: this.rdsClient,
        maxWaitTime: timeout,
        minDelay: 30, // RDS instances take longer to start
        maxDelay: 30,
      },
      {
        DBInstanceIdentifier: this.dbInstanceIdentifier,
      }
    );

    this.logger.info(
      {
        db_instance: this.dbInstanceIdentifier,
      },
      'DB instance reached available state'
    );
  }

  /**
   * Wait for the RDS DB Instance to reach 'stopped' state.
   *
   * Custom polling implementation since AWS SDK does not provide a stopped waiter.
   *
   * @param timeout - Maximum wait time in seconds
   * @throws Error if instance does not stop within timeout
   */
  private async waitForStopped(timeout: number = 300): Promise<void> {
    this.logger.debug(
      {
        db_instance: this.dbInstanceIdentifier,
        timeout,
      },
      'Starting waiter for DB instance to stop'
    );

    const startTime = Date.now();
    const pollingInterval = 30000; // 30 seconds

    while (Date.now() - startTime < timeout * 1000) {
      const status = await this.getStatus();

      if (status.status === 'stopped') {
        this.logger.info(
          {
            db_instance: this.dbInstanceIdentifier,
          },
          'DB instance reached stopped state'
        );
        return;
      }

      if (status.status !== 'stopping' && status.status !== 'stopped') {
        throw new Error(`Unexpected DB instance status during stop: ${String(status.status)}`);
      }

      this.logger.debug(
        {
          db_instance: this.dbInstanceIdentifier,
          status: status.status,
        },
        'DB instance still stopping, continuing to wait'
      );

      await setTimeout(pollingInterval);
    }

    throw new Error(`Timeout waiting for DB instance to stop after ${timeout} seconds`);
  }

  /**
   * Send Teams notification if configured.
   *
   * @param result - Handler operation result
   */
  private async sendNotification(result: HandlerResult): Promise<void> {
    const teamsConfig = this.config.notifications?.teams;

    if (!teamsConfig) {
      this.logger.debug('Teams notifications not configured, skipping');
      return;
    }

    try {
      await sendTeamsNotification(teamsConfig, result, this.config.environment);
    } catch (error) {
      // Log but don't throw - notification failure should not affect the main operation
      this.logger.error(
        {
          error: error instanceof Error ? error.message : String(error),
          action: result.action,
          resourceType: result.resourceType,
        },
        'Failed to send Teams notification'
      );
    }
  }
}

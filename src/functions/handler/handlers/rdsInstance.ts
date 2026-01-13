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
  type DBInstance,
} from '@aws-sdk/client-rds';
import { setTimeout } from 'timers/promises';
import type { Logger } from 'pino';
import type {
  DiscoveredResource,
  Config,
  HandlerResult,
  ResourceHandler,
  TriggerSource,
  RDSResourceDefaults,
} from '@shared/types';
import { setupLogger } from '@shared/utils/logger';
import { getResourceDefaults } from './base';

/**
 * Handler for AWS RDS DB Instance resources.
 *
 * This handler manages the lifecycle of RDS DB Instances using a "fire-and-forget"
 * approach. RDS start/stop operations take 5-10 minutes to complete, which would
 * exceed Lambda timeout limits if we waited for completion.
 *
 * Instead, the handler:
 * 1. Sends the start/stop command
 * 2. Waits briefly (configurable, default 60s) to confirm state transition began
 * 3. Sends notification indicating operation is "in progress"
 * 4. Returns immediately, allowing subsequent operations (e.g., ECS) to proceed
 */

/**
 * Default seconds to wait after sending RDS command before returning.
 * This brief wait confirms the operation has begun (status changes to 'starting' or 'stopping').
 */
const RDS_DEFAULT_WAIT_AFTER_COMMAND = 60;

export class RDSInstanceHandler implements ResourceHandler {
  private rdsClient: RDSClient;
  private dbInstanceIdentifier: string;
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

    // Extract region from ARN (format: arn:aws:rds:REGION:account:db:instance-id)
    // Falls back to AWS_DEFAULT_REGION environment variable if not in ARN
    if (resource.arn?.startsWith('arn:aws:')) {
      const arnParts = resource.arn.split(':');
      if (arnParts.length >= 4) {
        this.region = arnParts[3];
      }
    }

    // Initialize RDS client with region
    this.rdsClient = new RDSClient({ region: this.region });

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
   * Stop the RDS DB Instance using fire-and-forget approach.
   *
   * This operation is idempotent - if the instance is already stopped or stopping,
   * it returns success without making changes.
   *
   * The handler does NOT wait for the instance to fully stop (5-10 minutes).
   * Instead, it waits briefly to confirm the state transition has begun,
   * then returns immediately.
   *
   * @returns HandlerResult indicating the command was sent (not that stop completed)
   */
  async stop(): Promise<HandlerResult> {
    const defaults = getResourceDefaults(
      this.config,
      this.resource.resourceType
    ) as RDSResourceDefaults;
    const waitAfterCommand = defaults.waitAfterCommand ?? RDS_DEFAULT_WAIT_AFTER_COMMAND;
    const skipSnapshot = defaults.skipSnapshot ?? true;

    try {
      // 1. Get current status
      const currentStatus = await this.getStatus();

      this.logger.info(
        {
          db_instance: this.dbInstanceIdentifier,
          current_status: currentStatus.status,
          skipSnapshot,
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

      // 4. Build stop command with optional snapshot
      const stopParams: { DBInstanceIdentifier: string; DBSnapshotIdentifier?: string } = {
        DBInstanceIdentifier: this.dbInstanceIdentifier,
      };

      if (!skipSnapshot) {
        // Generate snapshot identifier: lights-out-{instance-id}-{timestamp}
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        stopParams.DBSnapshotIdentifier = `lights-out-${this.dbInstanceIdentifier}-${timestamp}`;
        this.logger.info(
          {
            db_instance: this.dbInstanceIdentifier,
            snapshot_id: stopParams.DBSnapshotIdentifier,
          },
          'Creating snapshot before stopping DB instance'
        );
      }

      // 5. Stop the DB instance
      await this.rdsClient.send(new StopDBInstanceCommand(stopParams));

      this.logger.info(
        {
          db_instance: this.dbInstanceIdentifier,
          skipSnapshot,
        },
        'Issued stop command for DB instance'
      );

      // 6. Wait briefly to confirm state transition has begun
      this.logger.info(
        {
          db_instance: this.dbInstanceIdentifier,
          waitSeconds: waitAfterCommand,
        },
        `Waiting ${waitAfterCommand}s to confirm stop operation started`
      );
      await setTimeout(waitAfterCommand * 1000);

      // 7. Check current status to confirm transition started
      const newStatus = await this.getStatus();
      const transitionStarted = newStatus.status === 'stopping' || newStatus.status === 'stopped';

      if (!transitionStarted) {
        this.logger.warn(
          {
            db_instance: this.dbInstanceIdentifier,
            expected: 'stopping',
            actual: newStatus.status,
          },
          'DB instance status did not change to stopping as expected'
        );
      }

      // 8. Build result - note this is "in progress", not completed
      const result: HandlerResult = {
        success: true,
        action: 'stop',
        resourceType: this.resource.resourceType,
        resourceId: this.resource.resourceId,
        message: `DB instance stop initiated (status: ${String(newStatus.status)}, was: ${String(currentStatus.status)}). Full stop takes ~5-10 minutes.`,
        previousState: currentStatus,
        triggerSource: this.triggerSource,
        region: this.region,
      };

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
        triggerSource: this.triggerSource,
        region: this.region,
      };

      return result;
    }
  }

  /**
   * Start the RDS DB Instance using fire-and-forget approach.
   *
   * This operation is idempotent - if the instance is already available or starting,
   * it returns success without making changes.
   *
   * The handler does NOT wait for the instance to fully start (5-10 minutes).
   * Instead, it waits briefly to confirm the state transition has begun,
   * then returns immediately.
   *
   * @returns HandlerResult indicating the command was sent (not that start completed)
   */
  async start(): Promise<HandlerResult> {
    const defaults = getResourceDefaults(
      this.config,
      this.resource.resourceType
    ) as RDSResourceDefaults;
    const waitAfterCommand = defaults.waitAfterCommand ?? RDS_DEFAULT_WAIT_AFTER_COMMAND;

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

      // 5. Wait briefly to confirm state transition has begun
      this.logger.info(
        {
          db_instance: this.dbInstanceIdentifier,
          waitSeconds: waitAfterCommand,
        },
        `Waiting ${waitAfterCommand}s to confirm start operation started`
      );
      await setTimeout(waitAfterCommand * 1000);

      // 6. Check current status to confirm transition started
      const newStatus = await this.getStatus();
      const transitionStarted = newStatus.status === 'starting' || newStatus.status === 'available';

      if (!transitionStarted) {
        this.logger.warn(
          {
            db_instance: this.dbInstanceIdentifier,
            expected: 'starting',
            actual: newStatus.status,
          },
          'DB instance status did not change to starting as expected'
        );
      }

      // 7. Build result - note this is "in progress", not completed
      const result: HandlerResult = {
        success: true,
        action: 'start',
        resourceType: this.resource.resourceType,
        resourceId: this.resource.resourceId,
        message: `DB instance start initiated (status: ${String(newStatus.status)}, was: ${String(currentStatus.status)}). Full start takes ~5-10 minutes.`,
        previousState: currentStatus,
        triggerSource: this.triggerSource,
        region: this.region,
      };

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
        triggerSource: this.triggerSource,
        region: this.region,
      };

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
}

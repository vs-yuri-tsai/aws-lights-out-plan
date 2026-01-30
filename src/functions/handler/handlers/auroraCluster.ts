/**
 * Aurora Cluster Handler implementation.
 *
 * Handles start, stop, and status operations for AWS Aurora DB Clusters.
 * Uses the same "fire-and-forget" approach as RDS Instance handler since
 * cluster start/stop operations also take 5-10 minutes to complete.
 *
 * Key differences from RDS Instance handler:
 * - Uses DescribeDBClusters / StartDBCluster / StopDBCluster APIs
 * - Aurora Cluster stop does NOT support creating a snapshot
 * - Stopping a cluster automatically stops all member instances
 */

import {
  RDSClient,
  DescribeDBClustersCommand,
  StartDBClusterCommand,
  StopDBClusterCommand,
  type DBCluster,
} from '@aws-sdk/client-rds';
import { setTimeout } from 'timers/promises';
import type { Logger } from 'pino';
import type {
  DiscoveredResource,
  Config,
  HandlerResult,
  ResourceHandler,
  TriggerSource,
  AuroraClusterResourceDefaults,
} from '@shared/types';
import { setupLogger } from '@shared/utils/logger';
import { getResourceDefaults } from './base';

/**
 * Default seconds to wait after sending Aurora Cluster command before returning.
 */
const AURORA_DEFAULT_WAIT_AFTER_COMMAND = 60;

export class AuroraClusterHandler implements ResourceHandler {
  private rdsClient: RDSClient;
  private dbClusterIdentifier: string;
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

    // Extract region from ARN (format: arn:aws:rds:REGION:account:cluster:cluster-id)
    if (resource.arn?.startsWith('arn:aws:')) {
      const arnParts = resource.arn.split(':');
      if (arnParts.length >= 4) {
        this.region = arnParts[3];
      }
    }

    // Initialize RDS client with region
    this.rdsClient = new RDSClient({ region: this.region });

    // Extract DB cluster identifier from ARN or resource_id
    // ARN format: arn:aws:rds:region:account:cluster:cluster-id
    if (resource.arn?.includes(':cluster:')) {
      this.dbClusterIdentifier = resource.arn.split(':cluster:')[1];
    } else {
      this.dbClusterIdentifier = resource.resourceId;
    }
  }

  /**
   * Get current status of the Aurora DB Cluster.
   *
   * @returns Object with keys:
   *   - status: DB cluster status (e.g., "available", "stopped", "stopping", "starting")
   *   - is_stopped: Boolean indicating if cluster is stopped
   *   - engine: Database engine (e.g., "aurora-mysql", "aurora-postgresql")
   *   - engine_version: Engine version
   *   - engine_mode: Engine mode (e.g., "provisioned", "serverless")
   *   - cluster_members: Number of member instances
   *
   * @throws Error if DB cluster not found or API call fails
   */
  async getStatus(): Promise<Record<string, unknown>> {
    try {
      const response = await this.rdsClient.send(
        new DescribeDBClustersCommand({
          DBClusterIdentifier: this.dbClusterIdentifier,
        })
      );

      if (!response.DBClusters || response.DBClusters.length === 0) {
        throw new Error(`DB Cluster ${this.dbClusterIdentifier} not found`);
      }

      const cluster: DBCluster = response.DBClusters[0];
      const status = cluster.Status ?? 'unknown';

      return {
        status,
        is_stopped: status === 'stopped',
        engine: cluster.Engine ?? 'unknown',
        engine_version: cluster.EngineVersion ?? 'unknown',
        engine_mode: cluster.EngineMode ?? 'unknown',
        cluster_members: cluster.DBClusterMembers?.length ?? 0,
      };
    } catch (error) {
      this.logger.error(
        {
          db_cluster: this.dbClusterIdentifier,
          error,
        },
        `Failed to get status for DB cluster ${this.dbClusterIdentifier}`
      );
      throw error;
    }
  }

  /**
   * Stop the Aurora DB Cluster using fire-and-forget approach.
   *
   * This operation is idempotent - if the cluster is already stopped or stopping,
   * it returns success without making changes.
   *
   * Note: Aurora Cluster stop does NOT support creating a snapshot.
   * Stopping a cluster automatically stops all member instances.
   *
   * @returns HandlerResult indicating the command was sent (not that stop completed)
   */
  async stop(): Promise<HandlerResult> {
    const defaults = getResourceDefaults(
      this.config,
      this.resource.resourceType
    ) as AuroraClusterResourceDefaults;
    const waitAfterCommand = defaults.waitAfterCommand ?? AURORA_DEFAULT_WAIT_AFTER_COMMAND;

    try {
      // 1. Get current status
      const currentStatus = await this.getStatus();

      this.logger.info(
        {
          db_cluster: this.dbClusterIdentifier,
          current_status: currentStatus.status,
          cluster_members: currentStatus.cluster_members,
        },
        'Attempting to stop DB cluster'
      );

      // 2. Idempotent check - already stopped or stopping
      if (currentStatus.status === 'stopped' || currentStatus.status === 'stopping') {
        this.logger.info(
          {
            db_cluster: this.dbClusterIdentifier,
            status: currentStatus.status,
          },
          `DB cluster already ${currentStatus.status}`
        );
        return {
          success: true,
          action: 'stop',
          resourceType: this.resource.resourceType,
          resourceId: this.resource.resourceId,
          message: `DB cluster already ${currentStatus.status}`,
          previousState: currentStatus,
          idempotent: true,
        };
      }

      // 3. Check if cluster can be stopped (must be 'available')
      if (currentStatus.status !== 'available') {
        const errorMessage = `Cannot stop DB cluster in status: ${String(currentStatus.status)}. Cluster must be 'available' to be stopped.`;
        this.logger.warn(
          {
            db_cluster: this.dbClusterIdentifier,
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

      // 4. Stop the DB cluster (Aurora does NOT support snapshot on stop)
      await this.rdsClient.send(
        new StopDBClusterCommand({
          DBClusterIdentifier: this.dbClusterIdentifier,
        })
      );

      this.logger.info(
        {
          db_cluster: this.dbClusterIdentifier,
          cluster_members: currentStatus.cluster_members,
        },
        'Issued stop command for DB cluster. All member instances will also stop.'
      );

      // 5. Wait briefly to confirm state transition has begun
      this.logger.info(
        {
          db_cluster: this.dbClusterIdentifier,
          waitSeconds: waitAfterCommand,
        },
        `Waiting ${waitAfterCommand}s to confirm stop operation started`
      );
      await setTimeout(waitAfterCommand * 1000);

      // 6. Check current status to confirm transition started
      const newStatus = await this.getStatus();
      const transitionStarted = newStatus.status === 'stopping' || newStatus.status === 'stopped';

      if (!transitionStarted) {
        this.logger.warn(
          {
            db_cluster: this.dbClusterIdentifier,
            expected: 'stopping',
            actual: newStatus.status,
          },
          'DB cluster status did not change to stopping as expected'
        );
      }

      // 7. Build result
      const result: HandlerResult = {
        success: true,
        action: 'stop',
        resourceType: this.resource.resourceType,
        resourceId: this.resource.resourceId,
        message: `DB cluster stop initiated (status: ${String(newStatus.status)}, was: ${String(currentStatus.status)}). All member instances will also stop. Full stop takes ~5-10 minutes.`,
        previousState: currentStatus,
        triggerSource: this.triggerSource,
        region: this.region,
      };

      return result;
    } catch (error) {
      this.logger.error(
        {
          db_cluster: this.dbClusterIdentifier,
          error,
        },
        'Failed to stop DB cluster'
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
   * Start the Aurora DB Cluster using fire-and-forget approach.
   *
   * This operation is idempotent - if the cluster is already available or starting,
   * it returns success without making changes.
   *
   * Starting a cluster automatically starts all member instances.
   *
   * @returns HandlerResult indicating the command was sent (not that start completed)
   */
  async start(): Promise<HandlerResult> {
    const defaults = getResourceDefaults(
      this.config,
      this.resource.resourceType
    ) as AuroraClusterResourceDefaults;
    const waitAfterCommand = defaults.waitAfterCommand ?? AURORA_DEFAULT_WAIT_AFTER_COMMAND;

    try {
      // 1. Get current status
      const currentStatus = await this.getStatus();

      this.logger.info(
        {
          db_cluster: this.dbClusterIdentifier,
          current_status: currentStatus.status,
          cluster_members: currentStatus.cluster_members,
        },
        'Attempting to start DB cluster'
      );

      // 2. Idempotent check - already available or starting
      if (currentStatus.status === 'available' || currentStatus.status === 'starting') {
        this.logger.info(
          {
            db_cluster: this.dbClusterIdentifier,
            status: currentStatus.status,
          },
          `DB cluster already ${currentStatus.status}`
        );
        return {
          success: true,
          action: 'start',
          resourceType: this.resource.resourceType,
          resourceId: this.resource.resourceId,
          message: `DB cluster already ${currentStatus.status}`,
          previousState: currentStatus,
          idempotent: true,
        };
      }

      // 3. Check if cluster can be started (must be 'stopped')
      if (currentStatus.status !== 'stopped') {
        const errorMessage = `Cannot start DB cluster in status: ${String(currentStatus.status)}. Cluster must be 'stopped' to be started.`;
        this.logger.warn(
          {
            db_cluster: this.dbClusterIdentifier,
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

      // 4. Start the DB cluster
      await this.rdsClient.send(
        new StartDBClusterCommand({
          DBClusterIdentifier: this.dbClusterIdentifier,
        })
      );

      this.logger.info(
        {
          db_cluster: this.dbClusterIdentifier,
          cluster_members: currentStatus.cluster_members,
        },
        'Issued start command for DB cluster. All member instances will also start.'
      );

      // 5. Wait briefly to confirm state transition has begun
      this.logger.info(
        {
          db_cluster: this.dbClusterIdentifier,
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
            db_cluster: this.dbClusterIdentifier,
            expected: 'starting',
            actual: newStatus.status,
          },
          'DB cluster status did not change to starting as expected'
        );
      }

      // 7. Build result
      const result: HandlerResult = {
        success: true,
        action: 'start',
        resourceType: this.resource.resourceType,
        resourceId: this.resource.resourceId,
        message: `DB cluster start initiated (status: ${String(newStatus.status)}, was: ${String(currentStatus.status)}). All member instances will also start. Full start takes ~5-10 minutes.`,
        previousState: currentStatus,
        triggerSource: this.triggerSource,
        region: this.region,
      };

      return result;
    } catch (error) {
      this.logger.error(
        {
          db_cluster: this.dbClusterIdentifier,
          error,
        },
        'Failed to start DB cluster'
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
   * Check if DB cluster has reached its desired state.
   *
   * A DB cluster is considered ready when:
   * - status is 'available' (for start operations)
   * - status is 'stopped' (for stop operations)
   *
   * @returns True if cluster is ready, false otherwise
   */
  async isReady(): Promise<boolean> {
    try {
      const status = await this.getStatus();
      const isReady = status.status === 'available' || status.status === 'stopped';

      this.logger.debug(
        {
          db_cluster: this.dbClusterIdentifier,
          status: status.status,
          is_ready: isReady,
        },
        `DB cluster ready check: ${isReady}`
      );

      return isReady;
    } catch (error) {
      this.logger.error(
        {
          db_cluster: this.dbClusterIdentifier,
          error,
        },
        'Failed to check if DB cluster is ready'
      );
      return false;
    }
  }
}

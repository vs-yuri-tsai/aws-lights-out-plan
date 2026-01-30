/**
 * Unit tests for handlers/auroraCluster.ts
 *
 * Tests Aurora Cluster Handler implementation using aws-sdk-client-mock
 * to mock AWS SDK v3 calls.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  RDSClient,
  DescribeDBClustersCommand,
  StartDBClusterCommand,
  StopDBClusterCommand,
} from '@aws-sdk/client-rds';
import { AuroraClusterHandler } from '@functions/handler/handlers/auroraCluster';
import type { DiscoveredResource, Config } from '@shared/types';

// Mock timers/promises to work with Vitest fake timers
vi.mock('timers/promises', () => ({
  setTimeout: (ms: number) => new Promise((resolve) => globalThis.setTimeout(resolve, ms)),
}));

const rdsMock = mockClient(RDSClient);

describe('AuroraClusterHandler', () => {
  let sampleResource: DiscoveredResource;
  let sampleConfig: Config;

  beforeEach(() => {
    rdsMock.reset();

    sampleResource = {
      resourceType: 'rds-cluster',
      arn: 'arn:aws:rds:ap-southeast-1:123456789012:cluster:test-aurora-cluster',
      resourceId: 'test-aurora-cluster',
      priority: 10,
      group: 'default',
      tags: {
        'lights-out:managed': 'true',
      },
      metadata: {},
    };

    sampleConfig = {
      version: '1.0',
      environment: 'test',
      discovery: {
        method: 'tags',
      },
      resource_defaults: {
        'rds-cluster': {
          waitAfterCommand: 0, // Disable wait for faster tests
        },
      },
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('should extract region from ARN', async () => {
      const handler = new AuroraClusterHandler(sampleResource, sampleConfig);

      expect(handler).toBeDefined();
      expect(await handler['rdsClient'].config.region()).toBe('ap-southeast-1');
    });

    it('should extract DB cluster identifier from ARN', () => {
      const handler = new AuroraClusterHandler(sampleResource, sampleConfig);

      expect(handler['dbClusterIdentifier']).toBe('test-aurora-cluster');
    });

    it('should use resource_id when ARN does not contain :cluster:', () => {
      const resourceWithoutClusterArn: DiscoveredResource = {
        ...sampleResource,
        arn: 'arn:aws:rds:ap-southeast-1:123456789012:db:my-instance',
        resourceId: 'my-cluster-id',
      };

      const handler = new AuroraClusterHandler(resourceWithoutClusterArn, sampleConfig);

      expect(handler['dbClusterIdentifier']).toBe('my-cluster-id');
    });

    it('should use default region when ARN is missing', () => {
      const resourceWithoutArn: DiscoveredResource = {
        ...sampleResource,
        arn: '',
      };

      const handler = new AuroraClusterHandler(resourceWithoutArn, sampleConfig);
      expect(handler).toBeDefined();
    });
  });

  describe('getStatus', () => {
    it('should return cluster status when available', async () => {
      rdsMock.on(DescribeDBClustersCommand).resolves({
        DBClusters: [
          {
            DBClusterIdentifier: 'test-aurora-cluster',
            Status: 'available',
            Engine: 'aurora-postgresql',
            EngineVersion: '15.4',
            EngineMode: 'provisioned',
            DBClusterMembers: [
              { DBInstanceIdentifier: 'instance-1' },
              { DBInstanceIdentifier: 'instance-2' },
            ],
          },
        ],
      });

      const handler = new AuroraClusterHandler(sampleResource, sampleConfig);
      const status = await handler.getStatus();

      expect(status).toEqual({
        status: 'available',
        is_stopped: false,
        engine: 'aurora-postgresql',
        engine_version: '15.4',
        engine_mode: 'provisioned',
        cluster_members: 2,
      });
    });

    it('should handle missing fields in cluster response', async () => {
      rdsMock.on(DescribeDBClustersCommand).resolves({
        DBClusters: [
          {
            DBClusterIdentifier: 'test-aurora-cluster',
            // Missing other fields
          },
        ],
      });

      const handler = new AuroraClusterHandler(sampleResource, sampleConfig);
      const status = await handler.getStatus();

      expect(status).toEqual({
        status: 'unknown',
        is_stopped: false,
        engine: 'unknown',
        engine_version: 'unknown',
        engine_mode: 'unknown',
        cluster_members: 0,
      });
    });

    it('should return status with is_stopped=true when stopped', async () => {
      rdsMock.on(DescribeDBClustersCommand).resolves({
        DBClusters: [
          {
            DBClusterIdentifier: 'test-aurora-cluster',
            Status: 'stopped',
            Engine: 'aurora-mysql',
            EngineVersion: '8.0',
            EngineMode: 'provisioned',
            DBClusterMembers: [{ DBInstanceIdentifier: 'instance-1' }],
          },
        ],
      });

      const handler = new AuroraClusterHandler(sampleResource, sampleConfig);
      const status = await handler.getStatus();

      expect(status.status).toBe('stopped');
      expect(status.is_stopped).toBe(true);
    });

    it('should throw error when DB cluster not found', async () => {
      rdsMock.on(DescribeDBClustersCommand).resolves({
        DBClusters: [],
      });

      const handler = new AuroraClusterHandler(sampleResource, sampleConfig);

      await expect(handler.getStatus()).rejects.toThrow('DB Cluster test-aurora-cluster not found');
    });

    it('should call DescribeDBClustersCommand with correct parameters', async () => {
      rdsMock.on(DescribeDBClustersCommand).resolves({
        DBClusters: [
          {
            Status: 'available',
          },
        ],
      });

      const handler = new AuroraClusterHandler(sampleResource, sampleConfig);
      await handler.getStatus();

      expect(rdsMock.calls()).toHaveLength(1);
      expect(rdsMock.call(0).args[0].input).toEqual({
        DBClusterIdentifier: 'test-aurora-cluster',
      });
    });
  });

  describe('stop', () => {
    it('should stop DB cluster when available (fire-and-forget)', async () => {
      rdsMock
        .on(DescribeDBClustersCommand)
        .resolvesOnce({
          DBClusters: [
            {
              Status: 'available',
              Engine: 'aurora-postgresql',
              DBClusterMembers: [{ DBInstanceIdentifier: 'i-1' }],
            },
          ],
        }) // Initial status check
        .resolvesOnce({
          DBClusters: [{ Status: 'stopping' }],
        }); // Status check after waitAfterCommand

      rdsMock.on(StopDBClusterCommand).resolves({});

      const handler = new AuroraClusterHandler(sampleResource, sampleConfig);
      const result = await handler.stop();

      expect(result.success).toBe(true);
      expect(result.action).toBe('stop');
      expect(result.message).toContain('stop initiated');
      expect(result.message).toContain('stopping');
      expect(result.message).toContain('All member instances will also stop');

      const stopCalls = rdsMock.commandCalls(StopDBClusterCommand);
      expect(stopCalls).toHaveLength(1);
      expect(stopCalls[0].args[0].input).toEqual({
        DBClusterIdentifier: 'test-aurora-cluster',
      });
    });

    it('should not pass snapshot parameters (Aurora does not support it)', async () => {
      rdsMock
        .on(DescribeDBClustersCommand)
        .resolvesOnce({ DBClusters: [{ Status: 'available' }] })
        .resolvesOnce({ DBClusters: [{ Status: 'stopping' }] });

      rdsMock.on(StopDBClusterCommand).resolves({});

      const handler = new AuroraClusterHandler(sampleResource, sampleConfig);
      await handler.stop();

      const stopCalls = rdsMock.commandCalls(StopDBClusterCommand);
      expect(stopCalls).toHaveLength(1);
      // Aurora stop command should only have DBClusterIdentifier, no snapshot
      expect(stopCalls[0].args[0].input).toEqual({
        DBClusterIdentifier: 'test-aurora-cluster',
      });
    });

    it('should warn if status does not change to stopping after wait', async () => {
      rdsMock
        .on(DescribeDBClustersCommand)
        .resolvesOnce({ DBClusters: [{ Status: 'available' }] })
        .resolvesOnce({ DBClusters: [{ Status: 'available' }] }); // Unexpected - still available

      rdsMock.on(StopDBClusterCommand).resolves({});

      const handler = new AuroraClusterHandler(sampleResource, sampleConfig);
      const result = await handler.stop();

      // Should still succeed (fire-and-forget), but message reflects current status
      expect(result.success).toBe(true);
      expect(result.message).toContain('stop initiated');
    });

    it('should be idempotent - return success if already stopped', async () => {
      rdsMock.on(DescribeDBClustersCommand).resolves({
        DBClusters: [{ Status: 'stopped' }],
      });

      const handler = new AuroraClusterHandler(sampleResource, sampleConfig);
      const result = await handler.stop();

      expect(result.success).toBe(true);
      expect(result.message).toContain('DB cluster already stopped');
      expect(result.idempotent).toBe(true);

      const stopCalls = rdsMock.commandCalls(StopDBClusterCommand);
      expect(stopCalls).toHaveLength(0);
    });

    it('should be idempotent - return success if already stopping', async () => {
      rdsMock.on(DescribeDBClustersCommand).resolves({
        DBClusters: [{ Status: 'stopping' }],
      });

      const handler = new AuroraClusterHandler(sampleResource, sampleConfig);
      const result = await handler.stop();

      expect(result.success).toBe(true);
      expect(result.message).toContain('DB cluster already stopping');
      expect(result.idempotent).toBe(true);

      const stopCalls = rdsMock.commandCalls(StopDBClusterCommand);
      expect(stopCalls).toHaveLength(0);
    });

    it('should return failure when cluster is not in available state', async () => {
      rdsMock.on(DescribeDBClustersCommand).resolves({
        DBClusters: [{ Status: 'modifying' }],
      });

      const handler = new AuroraClusterHandler(sampleResource, sampleConfig);
      const result = await handler.stop();

      expect(result.success).toBe(false);
      expect(result.message).toContain('Cannot stop DB cluster in status: modifying');

      const stopCalls = rdsMock.commandCalls(StopDBClusterCommand);
      expect(stopCalls).toHaveLength(0);
    });

    it('should return failure result on error', async () => {
      rdsMock.on(DescribeDBClustersCommand).rejects(new Error('Network error'));

      const handler = new AuroraClusterHandler(sampleResource, sampleConfig);
      const result = await handler.stop();

      expect(result.success).toBe(false);
      expect(result.message).toBe('Stop operation failed');
      expect(result.error).toContain('Network error');
    });
  });

  describe('start', () => {
    it('should start DB cluster when stopped (fire-and-forget)', async () => {
      rdsMock
        .on(DescribeDBClustersCommand)
        .resolvesOnce({
          DBClusters: [
            {
              Status: 'stopped',
              Engine: 'aurora-mysql',
              DBClusterMembers: [{ DBInstanceIdentifier: 'i-1' }],
            },
          ],
        }) // Initial status check
        .resolvesOnce({
          DBClusters: [{ Status: 'starting' }],
        }); // Status check after waitAfterCommand

      rdsMock.on(StartDBClusterCommand).resolves({});

      const handler = new AuroraClusterHandler(sampleResource, sampleConfig);
      const result = await handler.start();

      expect(result.success).toBe(true);
      expect(result.action).toBe('start');
      expect(result.message).toContain('start initiated');
      expect(result.message).toContain('starting');
      expect(result.message).toContain('All member instances will also start');

      const startCalls = rdsMock.commandCalls(StartDBClusterCommand);
      expect(startCalls).toHaveLength(1);
      expect(startCalls[0].args[0].input).toEqual({
        DBClusterIdentifier: 'test-aurora-cluster',
      });
    });

    it('should warn if status does not change to starting after wait', async () => {
      rdsMock
        .on(DescribeDBClustersCommand)
        .resolvesOnce({ DBClusters: [{ Status: 'stopped' }] })
        .resolvesOnce({ DBClusters: [{ Status: 'stopped' }] }); // Unexpected - still stopped

      rdsMock.on(StartDBClusterCommand).resolves({});

      const handler = new AuroraClusterHandler(sampleResource, sampleConfig);
      const result = await handler.start();

      // Should still succeed (fire-and-forget), but message reflects current status
      expect(result.success).toBe(true);
      expect(result.message).toContain('start initiated');
    });

    it('should be idempotent - return success if already available', async () => {
      rdsMock.on(DescribeDBClustersCommand).resolves({
        DBClusters: [{ Status: 'available' }],
      });

      const handler = new AuroraClusterHandler(sampleResource, sampleConfig);
      const result = await handler.start();

      expect(result.success).toBe(true);
      expect(result.message).toContain('DB cluster already available');
      expect(result.idempotent).toBe(true);

      const startCalls = rdsMock.commandCalls(StartDBClusterCommand);
      expect(startCalls).toHaveLength(0);
    });

    it('should be idempotent - return success if already starting', async () => {
      rdsMock.on(DescribeDBClustersCommand).resolves({
        DBClusters: [{ Status: 'starting' }],
      });

      const handler = new AuroraClusterHandler(sampleResource, sampleConfig);
      const result = await handler.start();

      expect(result.success).toBe(true);
      expect(result.message).toContain('DB cluster already starting');
      expect(result.idempotent).toBe(true);

      const startCalls = rdsMock.commandCalls(StartDBClusterCommand);
      expect(startCalls).toHaveLength(0);
    });

    it('should return failure when cluster is not in stopped state', async () => {
      rdsMock.on(DescribeDBClustersCommand).resolves({
        DBClusters: [{ Status: 'backing-up' }],
      });

      const handler = new AuroraClusterHandler(sampleResource, sampleConfig);
      const result = await handler.start();

      expect(result.success).toBe(false);
      expect(result.message).toContain('Cannot start DB cluster in status: backing-up');

      const startCalls = rdsMock.commandCalls(StartDBClusterCommand);
      expect(startCalls).toHaveLength(0);
    });

    it('should return failure result on error', async () => {
      rdsMock
        .on(DescribeDBClustersCommand)
        .resolvesOnce({ DBClusters: [{ Status: 'stopped' }] })
        .resolvesOnce({ DBClusters: [{ Status: 'stopped' }] });

      rdsMock.on(StartDBClusterCommand).rejects(new Error('Permission denied'));

      const handler = new AuroraClusterHandler(sampleResource, sampleConfig);
      const result = await handler.start();

      expect(result.success).toBe(false);
      expect(result.message).toBe('Start operation failed');
      expect(result.error).toContain('Permission denied');
    });
  });

  describe('isReady', () => {
    it('should return true when status is available', async () => {
      rdsMock.on(DescribeDBClustersCommand).resolves({
        DBClusters: [{ Status: 'available' }],
      });

      const handler = new AuroraClusterHandler(sampleResource, sampleConfig);
      const ready = await handler.isReady();

      expect(ready).toBe(true);
    });

    it('should return true when status is stopped', async () => {
      rdsMock.on(DescribeDBClustersCommand).resolves({
        DBClusters: [{ Status: 'stopped' }],
      });

      const handler = new AuroraClusterHandler(sampleResource, sampleConfig);
      const ready = await handler.isReady();

      expect(ready).toBe(true);
    });

    it('should return false when status is transitioning (stopping)', async () => {
      rdsMock.on(DescribeDBClustersCommand).resolves({
        DBClusters: [{ Status: 'stopping' }],
      });

      const handler = new AuroraClusterHandler(sampleResource, sampleConfig);
      const ready = await handler.isReady();

      expect(ready).toBe(false);
    });

    it('should return false when status is transitioning (starting)', async () => {
      rdsMock.on(DescribeDBClustersCommand).resolves({
        DBClusters: [{ Status: 'starting' }],
      });

      const handler = new AuroraClusterHandler(sampleResource, sampleConfig);
      const ready = await handler.isReady();

      expect(ready).toBe(false);
    });

    it('should return false on error', async () => {
      rdsMock.on(DescribeDBClustersCommand).rejects(new Error('API Error'));

      const handler = new AuroraClusterHandler(sampleResource, sampleConfig);
      const ready = await handler.isReady();

      expect(ready).toBe(false);
    });
  });
});

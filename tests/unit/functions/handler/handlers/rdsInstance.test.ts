/**
 * Unit tests for handlers/rdsInstance.ts
 *
 * Tests RDS Instance Handler implementation using aws-sdk-client-mock
 * to mock AWS SDK v3 calls.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  RDSClient,
  DescribeDBInstancesCommand,
  StartDBInstanceCommand,
  StopDBInstanceCommand,
} from '@aws-sdk/client-rds';
import { RDSInstanceHandler } from '@functions/handler/handlers/rdsInstance';
import type { DiscoveredResource, Config } from '@shared/types';

// Mock timers/promises to work with Vitest fake timers
vi.mock('timers/promises', () => ({
  setTimeout: (ms: number) => new Promise((resolve) => globalThis.setTimeout(resolve, ms)),
}));

// Mock Teams notifier
vi.mock('@shared/utils/teamsNotifier', () => ({
  sendTeamsNotification: vi.fn(),
}));

import { sendTeamsNotification } from '@shared/utils/teamsNotifier';
const mockSendTeamsNotification = vi.mocked(sendTeamsNotification);

const rdsMock = mockClient(RDSClient);

describe('RDSInstanceHandler', () => {
  let sampleResource: DiscoveredResource;
  let sampleConfig: Config;

  beforeEach(() => {
    rdsMock.reset();
    mockSendTeamsNotification.mockClear();

    sampleResource = {
      resourceType: 'rds-db',
      arn: 'arn:aws:rds:us-east-1:123456789012:db:test-database',
      resourceId: 'test-database',
      priority: 100,
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
        'rds-db': {
          waitAfterCommand: 0, // Disable wait for faster tests
          skipSnapshot: true,
        },
      },
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('should extract region from ARN', async () => {
      const handler = new RDSInstanceHandler(sampleResource, sampleConfig);

      expect(handler).toBeDefined();
      expect(await handler['rdsClient'].config.region()).toBe('us-east-1');
    });

    it('should extract DB instance identifier from ARN', () => {
      const handler = new RDSInstanceHandler(sampleResource, sampleConfig);

      expect(handler['dbInstanceIdentifier']).toBe('test-database');
    });

    it('should use resource_id when ARN does not contain :db:', () => {
      const resourceWithoutDbArn: DiscoveredResource = {
        ...sampleResource,
        arn: 'arn:aws:rds:us-east-1:123456789012:cluster:my-cluster',
        resourceId: 'my-instance-id',
      };

      const handler = new RDSInstanceHandler(resourceWithoutDbArn, sampleConfig);

      expect(handler['dbInstanceIdentifier']).toBe('my-instance-id');
    });

    it('should use default region when ARN is missing', async () => {
      const resourceWithoutArn: DiscoveredResource = {
        ...sampleResource,
        arn: '',
      };

      const handler = new RDSInstanceHandler(resourceWithoutArn, sampleConfig);
      expect(handler).toBeDefined();
    });
  });

  describe('getStatus', () => {
    it('should return instance status when available', async () => {
      rdsMock.on(DescribeDBInstancesCommand).resolves({
        DBInstances: [
          {
            DBInstanceIdentifier: 'test-database',
            DBInstanceStatus: 'available',
            Engine: 'postgres',
            EngineVersion: '14.7',
            DBInstanceClass: 'db.t3.micro',
          },
        ],
      });

      const handler = new RDSInstanceHandler(sampleResource, sampleConfig);
      const status = await handler.getStatus();

      expect(status).toEqual({
        status: 'available',
        is_stopped: false,
        engine: 'postgres',
        engine_version: '14.7',
        instance_class: 'db.t3.micro',
      });
    });

    it('should handle missing fields in instance response', async () => {
      rdsMock.on(DescribeDBInstancesCommand).resolves({
        DBInstances: [
          {
            DBInstanceIdentifier: 'test-database',
            // Missing other fields
          },
        ],
      });

      const handler = new RDSInstanceHandler(sampleResource, sampleConfig);
      const status = await handler.getStatus();

      expect(status).toEqual({
        status: 'unknown',
        is_stopped: false,
        engine: 'unknown',
        engine_version: 'unknown',
        instance_class: 'unknown',
      });
    });

    it('should return status with is_stopped=true when stopped', async () => {
      rdsMock.on(DescribeDBInstancesCommand).resolves({
        DBInstances: [
          {
            DBInstanceIdentifier: 'test-database',
            DBInstanceStatus: 'stopped',
            Engine: 'mysql',
            EngineVersion: '8.0',
            DBInstanceClass: 'db.t3.small',
          },
        ],
      });

      const handler = new RDSInstanceHandler(sampleResource, sampleConfig);
      const status = await handler.getStatus();

      expect(status.status).toBe('stopped');
      expect(status.is_stopped).toBe(true);
    });

    it('should throw error when DB instance not found', async () => {
      rdsMock.on(DescribeDBInstancesCommand).resolves({
        DBInstances: [],
      });

      const handler = new RDSInstanceHandler(sampleResource, sampleConfig);

      await expect(handler.getStatus()).rejects.toThrow('DB Instance test-database not found');
    });

    it('should call DescribeDBInstancesCommand with correct parameters', async () => {
      rdsMock.on(DescribeDBInstancesCommand).resolves({
        DBInstances: [
          {
            DBInstanceStatus: 'available',
          },
        ],
      });

      const handler = new RDSInstanceHandler(sampleResource, sampleConfig);
      await handler.getStatus();

      expect(rdsMock.calls()).toHaveLength(1);
      expect(rdsMock.call(0).args[0].input).toEqual({
        DBInstanceIdentifier: 'test-database',
      });
    });
  });

  describe('stop', () => {
    it('should stop DB instance when available (fire-and-forget)', async () => {
      rdsMock
        .on(DescribeDBInstancesCommand)
        .resolvesOnce({
          DBInstances: [{ DBInstanceStatus: 'available', Engine: 'postgres' }],
        }) // Initial status check
        .resolvesOnce({
          DBInstances: [{ DBInstanceStatus: 'stopping' }],
        }); // Status check after waitAfterCommand

      rdsMock.on(StopDBInstanceCommand).resolves({
        DBInstance: { DBInstanceStatus: 'stopping' },
      });

      const handler = new RDSInstanceHandler(sampleResource, sampleConfig);
      const result = await handler.stop();

      expect(result.success).toBe(true);
      expect(result.action).toBe('stop');
      expect(result.message).toContain('stop initiated');
      expect(result.message).toContain('stopping');

      const stopCalls = rdsMock.commandCalls(StopDBInstanceCommand);
      expect(stopCalls).toHaveLength(1);
      // With skipSnapshot: true, no DBSnapshotIdentifier should be passed
      expect(stopCalls[0].args[0].input).toEqual({
        DBInstanceIdentifier: 'test-database',
      });
    });

    it('should create snapshot when skipSnapshot is false', async () => {
      const configWithSnapshot: Config = {
        ...sampleConfig,
        resource_defaults: {
          'rds-db': {
            waitAfterCommand: 0,
            skipSnapshot: false,
          },
        },
      };

      rdsMock
        .on(DescribeDBInstancesCommand)
        .resolvesOnce({ DBInstances: [{ DBInstanceStatus: 'available' }] })
        .resolvesOnce({ DBInstances: [{ DBInstanceStatus: 'stopping' }] });

      rdsMock.on(StopDBInstanceCommand).resolves({
        DBInstance: { DBInstanceStatus: 'stopping' },
      });

      const handler = new RDSInstanceHandler(sampleResource, configWithSnapshot);
      const result = await handler.stop();

      expect(result.success).toBe(true);

      const stopCalls = rdsMock.commandCalls(StopDBInstanceCommand);
      expect(stopCalls).toHaveLength(1);
      // With skipSnapshot: false, DBSnapshotIdentifier should be passed
      expect(stopCalls[0].args[0].input.DBSnapshotIdentifier).toMatch(
        /^lights-out-test-database-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/
      );
    });

    it('should warn if status does not change to stopping after wait', async () => {
      rdsMock
        .on(DescribeDBInstancesCommand)
        .resolvesOnce({ DBInstances: [{ DBInstanceStatus: 'available' }] })
        .resolvesOnce({ DBInstances: [{ DBInstanceStatus: 'available' }] }); // Unexpected - still available

      rdsMock.on(StopDBInstanceCommand).resolves({
        DBInstance: { DBInstanceStatus: 'stopping' },
      });

      const handler = new RDSInstanceHandler(sampleResource, sampleConfig);
      const result = await handler.stop();

      // Should still succeed (fire-and-forget), but message reflects current status
      expect(result.success).toBe(true);
      expect(result.message).toContain('stop initiated');
    });

    it('should be idempotent - return success if already stopped', async () => {
      rdsMock.on(DescribeDBInstancesCommand).resolves({
        DBInstances: [
          {
            DBInstanceStatus: 'stopped',
          },
        ],
      });

      const handler = new RDSInstanceHandler(sampleResource, sampleConfig);
      const result = await handler.stop();

      expect(result.success).toBe(true);
      expect(result.message).toContain('DB instance already stopped');

      const stopCalls = rdsMock.commandCalls(StopDBInstanceCommand);
      expect(stopCalls).toHaveLength(0);
    });

    it('should be idempotent - return success if already stopping', async () => {
      rdsMock.on(DescribeDBInstancesCommand).resolves({
        DBInstances: [
          {
            DBInstanceStatus: 'stopping',
          },
        ],
      });

      const handler = new RDSInstanceHandler(sampleResource, sampleConfig);
      const result = await handler.stop();

      expect(result.success).toBe(true);
      expect(result.message).toContain('DB instance already stopping');

      const stopCalls = rdsMock.commandCalls(StopDBInstanceCommand);
      expect(stopCalls).toHaveLength(0);
    });

    it('should return failure when instance is not in available state', async () => {
      rdsMock.on(DescribeDBInstancesCommand).resolves({
        DBInstances: [
          {
            DBInstanceStatus: 'modifying',
          },
        ],
      });

      const handler = new RDSInstanceHandler(sampleResource, sampleConfig);
      const result = await handler.stop();

      expect(result.success).toBe(false);
      expect(result.message).toContain('Cannot stop DB instance in status: modifying');

      const stopCalls = rdsMock.commandCalls(StopDBInstanceCommand);
      expect(stopCalls).toHaveLength(0);
    });

    it('should return failure result on error', async () => {
      rdsMock.on(DescribeDBInstancesCommand).rejects(new Error('Network error'));

      const handler = new RDSInstanceHandler(sampleResource, sampleConfig);
      const result = await handler.stop();

      expect(result.success).toBe(false);
      expect(result.message).toBe('Stop operation failed');
      expect(result.error).toContain('Network error');
    });
  });

  describe('start', () => {
    it('should start DB instance when stopped (fire-and-forget)', async () => {
      rdsMock
        .on(DescribeDBInstancesCommand)
        .resolvesOnce({
          DBInstances: [{ DBInstanceStatus: 'stopped', Engine: 'mysql' }],
        }) // Initial status check
        .resolvesOnce({
          DBInstances: [{ DBInstanceStatus: 'starting' }],
        }); // Status check after waitAfterCommand

      rdsMock.on(StartDBInstanceCommand).resolves({
        DBInstance: { DBInstanceStatus: 'starting' },
      });

      const handler = new RDSInstanceHandler(sampleResource, sampleConfig);
      const result = await handler.start();

      expect(result.success).toBe(true);
      expect(result.action).toBe('start');
      expect(result.message).toContain('start initiated');
      expect(result.message).toContain('starting');

      const startCalls = rdsMock.commandCalls(StartDBInstanceCommand);
      expect(startCalls).toHaveLength(1);
      expect(startCalls[0].args[0].input).toEqual({
        DBInstanceIdentifier: 'test-database',
      });
    });

    it('should warn if status does not change to starting after wait', async () => {
      rdsMock
        .on(DescribeDBInstancesCommand)
        .resolvesOnce({ DBInstances: [{ DBInstanceStatus: 'stopped' }] })
        .resolvesOnce({ DBInstances: [{ DBInstanceStatus: 'stopped' }] }); // Unexpected - still stopped

      rdsMock.on(StartDBInstanceCommand).resolves({
        DBInstance: { DBInstanceStatus: 'starting' },
      });

      const handler = new RDSInstanceHandler(sampleResource, sampleConfig);
      const result = await handler.start();

      // Should still succeed (fire-and-forget), but message reflects current status
      expect(result.success).toBe(true);
      expect(result.message).toContain('start initiated');
    });

    it('should be idempotent - return success if already available', async () => {
      rdsMock.on(DescribeDBInstancesCommand).resolves({
        DBInstances: [
          {
            DBInstanceStatus: 'available',
          },
        ],
      });

      const handler = new RDSInstanceHandler(sampleResource, sampleConfig);
      const result = await handler.start();

      expect(result.success).toBe(true);
      expect(result.message).toContain('DB instance already available');

      const startCalls = rdsMock.commandCalls(StartDBInstanceCommand);
      expect(startCalls).toHaveLength(0);
    });

    it('should be idempotent - return success if already starting', async () => {
      rdsMock.on(DescribeDBInstancesCommand).resolves({
        DBInstances: [
          {
            DBInstanceStatus: 'starting',
          },
        ],
      });

      const handler = new RDSInstanceHandler(sampleResource, sampleConfig);
      const result = await handler.start();

      expect(result.success).toBe(true);
      expect(result.message).toContain('DB instance already starting');

      const startCalls = rdsMock.commandCalls(StartDBInstanceCommand);
      expect(startCalls).toHaveLength(0);
    });

    it('should return failure when instance is not in stopped state', async () => {
      rdsMock.on(DescribeDBInstancesCommand).resolves({
        DBInstances: [
          {
            DBInstanceStatus: 'backing-up',
          },
        ],
      });

      const handler = new RDSInstanceHandler(sampleResource, sampleConfig);
      const result = await handler.start();

      expect(result.success).toBe(false);
      expect(result.message).toContain('Cannot start DB instance in status: backing-up');

      const startCalls = rdsMock.commandCalls(StartDBInstanceCommand);
      expect(startCalls).toHaveLength(0);
    });

    it('should return failure result on error', async () => {
      rdsMock
        .on(DescribeDBInstancesCommand)
        .resolvesOnce({ DBInstances: [{ DBInstanceStatus: 'stopped' }] })
        .resolvesOnce({ DBInstances: [{ DBInstanceStatus: 'stopped' }] });

      rdsMock.on(StartDBInstanceCommand).rejects(new Error('Permission denied'));

      const handler = new RDSInstanceHandler(sampleResource, sampleConfig);
      const result = await handler.start();

      expect(result.success).toBe(false);
      expect(result.message).toBe('Start operation failed');
      expect(result.error).toContain('Permission denied');
    });
  });

  describe('isReady', () => {
    it('should return true when status is available', async () => {
      rdsMock.on(DescribeDBInstancesCommand).resolves({
        DBInstances: [
          {
            DBInstanceStatus: 'available',
          },
        ],
      });

      const handler = new RDSInstanceHandler(sampleResource, sampleConfig);
      const ready = await handler.isReady();

      expect(ready).toBe(true);
    });

    it('should return true when status is stopped', async () => {
      rdsMock.on(DescribeDBInstancesCommand).resolves({
        DBInstances: [
          {
            DBInstanceStatus: 'stopped',
          },
        ],
      });

      const handler = new RDSInstanceHandler(sampleResource, sampleConfig);
      const ready = await handler.isReady();

      expect(ready).toBe(true);
    });

    it('should return false when status is transitioning', async () => {
      rdsMock.on(DescribeDBInstancesCommand).resolves({
        DBInstances: [
          {
            DBInstanceStatus: 'starting',
          },
        ],
      });

      const handler = new RDSInstanceHandler(sampleResource, sampleConfig);
      const ready = await handler.isReady();

      expect(ready).toBe(false);
    });

    it('should return false on error', async () => {
      rdsMock.on(DescribeDBInstancesCommand).rejects(new Error('API Error'));

      const handler = new RDSInstanceHandler(sampleResource, sampleConfig);
      const ready = await handler.isReady();

      expect(ready).toBe(false);
    });
  });

  describe('Teams notifications', () => {
    describe('start() with notifications', () => {
      it('should send Teams notification on successful start', async () => {
        const configWithTeams: Config = {
          ...sampleConfig,
          notifications: {
            teams: {
              enabled: true,
              webhook_url: 'https://example.com/webhook',
              description: 'Test Channel',
            },
          },
        };

        rdsMock
          .on(DescribeDBInstancesCommand)
          .resolvesOnce({
            DBInstances: [{ DBInstanceStatus: 'stopped', Engine: 'postgres' }],
          })
          .resolvesOnce({
            DBInstances: [{ DBInstanceStatus: 'starting' }],
          });

        rdsMock.on(StartDBInstanceCommand).resolves({
          DBInstance: { DBInstanceStatus: 'starting' },
        });

        const handler = new RDSInstanceHandler(sampleResource, configWithTeams);
        const result = await handler.start();

        expect(result.success).toBe(true);
        expect(mockSendTeamsNotification).toHaveBeenCalledWith(
          configWithTeams.notifications!.teams,
          expect.objectContaining({
            success: true,
            action: 'start',
            resourceType: 'rds-db',
            resourceId: 'test-database',
            message: expect.stringContaining('start initiated'),
          }),
          'test'
        );
        expect(mockSendTeamsNotification).toHaveBeenCalledTimes(1);
      });

      it('should send Teams notification on failed start', async () => {
        const configWithTeams: Config = {
          ...sampleConfig,
          notifications: {
            teams: {
              enabled: true,
              webhook_url: 'https://example.com/webhook',
            },
          },
        };

        rdsMock
          .on(DescribeDBInstancesCommand)
          .resolvesOnce({ DBInstances: [{ DBInstanceStatus: 'stopped' }] })
          .resolvesOnce({ DBInstances: [{ DBInstanceStatus: 'stopped' }] });

        rdsMock.on(StartDBInstanceCommand).rejects(new Error('Permission denied'));

        const handler = new RDSInstanceHandler(sampleResource, configWithTeams);
        const result = await handler.start();

        expect(result.success).toBe(false);
        expect(mockSendTeamsNotification).toHaveBeenCalledWith(
          configWithTeams.notifications!.teams,
          expect.objectContaining({
            success: false,
            action: 'start',
            message: 'Start operation failed',
            error: 'Permission denied',
          }),
          'test'
        );
      });

      it('should not send notification when Teams is not configured', async () => {
        rdsMock
          .on(DescribeDBInstancesCommand)
          .resolvesOnce({ DBInstances: [{ DBInstanceStatus: 'stopped' }] })
          .resolvesOnce({ DBInstances: [{ DBInstanceStatus: 'starting' }] });

        rdsMock.on(StartDBInstanceCommand).resolves({
          DBInstance: { DBInstanceStatus: 'starting' },
        });

        const handler = new RDSInstanceHandler(sampleResource, sampleConfig);
        await handler.start();

        expect(mockSendTeamsNotification).not.toHaveBeenCalled();
      });

      it('should not send notification when Teams is disabled', async () => {
        const configWithDisabledTeams: Config = {
          ...sampleConfig,
          notifications: {
            teams: {
              enabled: false,
              webhook_url: 'https://example.com/webhook',
            },
          },
        };

        rdsMock
          .on(DescribeDBInstancesCommand)
          .resolvesOnce({ DBInstances: [{ DBInstanceStatus: 'stopped' }] })
          .resolvesOnce({ DBInstances: [{ DBInstanceStatus: 'starting' }] });

        rdsMock.on(StartDBInstanceCommand).resolves({
          DBInstance: { DBInstanceStatus: 'starting' },
        });

        const handler = new RDSInstanceHandler(sampleResource, configWithDisabledTeams);
        await handler.start();

        // sendTeamsNotification is called but should exit early due to enabled=false
        expect(mockSendTeamsNotification).toHaveBeenCalledTimes(1);
      });

      it('should continue operation even if notification fails', async () => {
        const configWithTeams: Config = {
          ...sampleConfig,
          notifications: {
            teams: {
              enabled: true,
              webhook_url: 'https://example.com/webhook',
            },
          },
        };

        mockSendTeamsNotification.mockRejectedValueOnce(new Error('Webhook timeout'));

        rdsMock
          .on(DescribeDBInstancesCommand)
          .resolvesOnce({ DBInstances: [{ DBInstanceStatus: 'stopped' }] })
          .resolvesOnce({ DBInstances: [{ DBInstanceStatus: 'starting' }] });

        rdsMock.on(StartDBInstanceCommand).resolves({
          DBInstance: { DBInstanceStatus: 'starting' },
        });

        const handler = new RDSInstanceHandler(sampleResource, configWithTeams);
        const result = await handler.start();

        // Main operation should still succeed
        expect(result.success).toBe(true);
        expect(mockSendTeamsNotification).toHaveBeenCalledTimes(1);
      });
    });

    describe('stop() with notifications', () => {
      it('should send Teams notification on successful stop', async () => {
        const configWithTeams: Config = {
          ...sampleConfig,
          notifications: {
            teams: {
              enabled: true,
              webhook_url: 'https://example.com/webhook',
            },
          },
        };

        rdsMock
          .on(DescribeDBInstancesCommand)
          .resolvesOnce({
            DBInstances: [{ DBInstanceStatus: 'available', Engine: 'postgres' }],
          })
          .resolvesOnce({
            DBInstances: [{ DBInstanceStatus: 'stopping' }],
          });

        rdsMock.on(StopDBInstanceCommand).resolves({
          DBInstance: { DBInstanceStatus: 'stopping' },
        });

        const handler = new RDSInstanceHandler(sampleResource, configWithTeams);
        const result = await handler.stop();

        expect(result.success).toBe(true);
        expect(mockSendTeamsNotification).toHaveBeenCalledWith(
          configWithTeams.notifications!.teams,
          expect.objectContaining({
            success: true,
            action: 'stop',
            resourceType: 'rds-db',
            message: expect.stringContaining('stop initiated'),
          }),
          'test'
        );
      });

      it('should send Teams notification on failed stop', async () => {
        const configWithTeams: Config = {
          ...sampleConfig,
          notifications: {
            teams: {
              enabled: true,
              webhook_url: 'https://example.com/webhook',
            },
          },
        };

        rdsMock.on(DescribeDBInstancesCommand).rejects(new Error('Network timeout'));

        const handler = new RDSInstanceHandler(sampleResource, configWithTeams);
        const result = await handler.stop();

        expect(result.success).toBe(false);
        expect(mockSendTeamsNotification).toHaveBeenCalledWith(
          configWithTeams.notifications!.teams,
          expect.objectContaining({
            success: false,
            action: 'stop',
            message: 'Stop operation failed',
            error: 'Network timeout',
          }),
          'test'
        );
      });
    });
  });
});

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
import { RDSInstanceHandler } from '@handlers/rdsInstance';
import type { DiscoveredResource, Config } from '@/types';

const rdsMock = mockClient(RDSClient);

describe('RDSInstanceHandler', () => {
  let sampleResource: DiscoveredResource;
  let sampleConfig: Config;

  beforeEach(() => {
    rdsMock.reset();

    sampleResource = {
      resourceType: 'rds-instance',
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
        'rds-instance': {
          wait_for_stable: false, // Disable for faster tests
          stable_timeout_seconds: 600,
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

      await expect(handler.getStatus()).rejects.toThrow(
        'DB Instance test-database not found'
      );
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
    it('should stop DB instance when available', async () => {
      rdsMock.on(DescribeDBInstancesCommand).resolves({
        DBInstances: [
          {
            DBInstanceStatus: 'available',
            Engine: 'postgres',
          },
        ],
      });

      rdsMock.on(StopDBInstanceCommand).resolves({
        DBInstance: {
          DBInstanceStatus: 'stopping',
        },
      });

      const handler = new RDSInstanceHandler(sampleResource, sampleConfig);
      const result = await handler.stop();

      expect(result.success).toBe(true);
      expect(result.action).toBe('stop');
      expect(result.message).toContain('DB instance stopped (was available)');

      const stopCalls = rdsMock.commandCalls(StopDBInstanceCommand);
      expect(stopCalls).toHaveLength(1);
      expect(stopCalls[0].args[0].input).toEqual({
        DBInstanceIdentifier: 'test-database',
      });
    });

    it('should wait for stopped state when configured', async () => {
      vi.useFakeTimers();
      const configWithWait: Config = {
        ...sampleConfig,
        resource_defaults: {
          'rds-instance': {
            wait_for_stable: true,
            stable_timeout_seconds: 40,
          },
        },
      };

      rdsMock.on(DescribeDBInstancesCommand)
        .resolvesOnce({ DBInstances: [{ DBInstanceStatus: 'available' }] }) // Initial status
        .resolvesOnce({ DBInstances: [{ DBInstanceStatus: 'stopping' }] })  // First poll
        .resolves({ DBInstances: [{ DBInstanceStatus: 'stopped' }] });      // Second poll (success)

      rdsMock.on(StopDBInstanceCommand).resolves({
        DBInstance: { DBInstanceStatus: 'stopping' },
      });

      const handler = new RDSInstanceHandler(sampleResource, configWithWait);
      
      const stopPromise = handler.stop();
      await vi.advanceTimersByTimeAsync(30000);
      const result = await stopPromise;
      vi.useRealTimers();

      expect(result.success).toBe(true);
      expect(result.message).toContain('DB instance stopped');
      expect(rdsMock.commandCalls(DescribeDBInstancesCommand).length).toBeGreaterThanOrEqual(2);
    });

    it('should wait for stopped state (immediate success)', async () => {
         const configWithWait: Config = {
        ...sampleConfig,
        resource_defaults: {
          'rds-instance': {
            wait_for_stable: true,
            stable_timeout_seconds: 5,
          },
        },
      };

      rdsMock.on(DescribeDBInstancesCommand)
        .resolvesOnce({ DBInstances: [{ DBInstanceStatus: 'available' }] }) // Initial status
        .resolves({ DBInstances: [{ DBInstanceStatus: 'stopped' }] });      // First poll (success)

      rdsMock.on(StopDBInstanceCommand).resolves({
        DBInstance: { DBInstanceStatus: 'stopping' },
      });

      const handler = new RDSInstanceHandler(sampleResource, configWithWait);
      const result = await handler.stop();

      expect(result.success).toBe(true);
      expect(result.message).toContain('DB instance stopped');
      // Ensure DescribeDBInstancesCommand was called at least twice (initial + polling)
      expect(rdsMock.commandCalls(DescribeDBInstancesCommand).length).toBeGreaterThanOrEqual(2);
    });
    
    it('should throw error if status becomes unexpected during stop wait', async () => {
       const configWithWait: Config = {
        ...sampleConfig,
        resource_defaults: {
          'rds-instance': {
            wait_for_stable: true,
            stable_timeout_seconds: 5,
          },
        },
      };

      rdsMock.on(DescribeDBInstancesCommand)
        .resolvesOnce({ DBInstances: [{ DBInstanceStatus: 'available' }] }) // Initial status
        .resolves({ DBInstances: [{ DBInstanceStatus: 'available' }] });    // Unexpected status during stop

      rdsMock.on(StopDBInstanceCommand).resolves({
        DBInstance: { DBInstanceStatus: 'stopping' },
      });

      const handler = new RDSInstanceHandler(sampleResource, configWithWait);
      const result = await handler.stop();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unexpected DB instance status during stop: available');
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
    it('should start DB instance when stopped', async () => {
      rdsMock.on(DescribeDBInstancesCommand).resolves({
        DBInstances: [
          {
            DBInstanceStatus: 'stopped',
            Engine: 'mysql',
          },
        ],
      });

      rdsMock.on(StartDBInstanceCommand).resolves({
        DBInstance: {
          DBInstanceStatus: 'starting',
        },
      });

      const handler = new RDSInstanceHandler(sampleResource, sampleConfig);
      const result = await handler.start();

      expect(result.success).toBe(true);
      expect(result.action).toBe('start');
      expect(result.message).toContain('DB instance started (was stopped)');

      const startCalls = rdsMock.commandCalls(StartDBInstanceCommand);
      expect(startCalls).toHaveLength(1);
      expect(startCalls[0].args[0].input).toEqual({
        DBInstanceIdentifier: 'test-database',
      });
    });

    it('should wait for available state when configured', async () => {
      const configWithWait: Config = {
        ...sampleConfig,
        resource_defaults: {
          'rds-instance': {
            wait_for_stable: true,
            stable_timeout_seconds: 40, // Must be > minDelay (30s)
          },
        },
      };

      rdsMock.on(DescribeDBInstancesCommand)
        .resolvesOnce({ DBInstances: [{ DBInstanceStatus: 'stopped' }] })
        .resolves({ DBInstances: [{ DBInstanceStatus: 'available' }] });

      rdsMock.on(StartDBInstanceCommand).resolves({
        DBInstance: { DBInstanceStatus: 'starting' },
      });

      const handler = new RDSInstanceHandler(sampleResource, configWithWait);
      const result = await handler.start();

      expect(result.success).toBe(true);
      expect(result.message).toContain('DB instance started');
      expect(rdsMock.commandCalls(DescribeDBInstancesCommand).length).toBeGreaterThan(1);
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
        .resolves({
          DBInstances: [{ DBInstanceStatus: 'stopped' }],
        });

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
});
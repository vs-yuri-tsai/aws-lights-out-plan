/**
 * Unit tests for handlers/ecsService.ts
 *
 * Tests ECS Service Handler implementation using aws-sdk-client-mock
 * to mock AWS SDK v3 calls.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { ECSClient, DescribeServicesCommand, UpdateServiceCommand } from '@aws-sdk/client-ecs';
import {
  ApplicationAutoScalingClient,
  DescribeScalableTargetsCommand,
  RegisterScalableTargetCommand,
} from '@aws-sdk/client-application-auto-scaling';
import { ECSServiceHandler } from '@functions/handler/handlers/ecsService';
import type { DiscoveredResource, Config } from '@shared/types';

const ecsMock = mockClient(ECSClient);
const autoScalingMock = mockClient(ApplicationAutoScalingClient);

describe('ECSServiceHandler', () => {
  let sampleResource: DiscoveredResource;
  let sampleConfig: Config;

  beforeEach(() => {
    ecsMock.reset();
    autoScalingMock.reset();

    // Mock Auto Scaling API to return no scaling targets by default
    autoScalingMock.on(DescribeScalableTargetsCommand).resolves({
      ScalableTargets: [],
    });

    sampleResource = {
      resourceType: 'ecs-service',
      arn: 'arn:aws:ecs:us-east-1:123456789012:service/test-cluster/test-service',
      resourceId: 'test-cluster/test-service',
      priority: 50,
      group: 'default',
      tags: {
        'lights-out:managed': 'true',
      },
      metadata: {
        cluster_name: 'test-cluster',
      },
    };

    sampleConfig = {
      version: '1.0',
      environment: 'test',
      discovery: {
        method: 'tags',
      },
      resource_defaults: {
        'ecs-service': {
          waitForStable: false, // Disable for faster tests
          stableTimeoutSeconds: 300,
          start: {
            desiredCount: 2,
          },
          stop: {
            desiredCount: 0,
          },
        },
      },
    };
  });

  describe('constructor', () => {
    it('should extract region from ARN', async () => {
      const handler = new ECSServiceHandler(sampleResource, sampleConfig);

      expect(handler).toBeDefined();
      expect(await handler['ecsClient'].config.region()).toBe('us-east-1');
    });

    it('should extract cluster and service names correctly', () => {
      const handler = new ECSServiceHandler(sampleResource, sampleConfig);

      expect(handler['clusterName']).toBe('test-cluster');
      expect(handler['serviceName']).toBe('test-service');
    });

    it('should handle resource_id without cluster prefix', () => {
      const resourceWithoutCluster: DiscoveredResource = {
        ...sampleResource,
        resourceId: 'my-service',
        metadata: {},
      };

      const handler = new ECSServiceHandler(resourceWithoutCluster, sampleConfig);

      expect(handler['clusterName']).toBe('default');
      expect(handler['serviceName']).toBe('my-service');
    });

    it('should use default region when ARN is missing', async () => {
      const resourceWithoutArn: DiscoveredResource = {
        ...sampleResource,
        arn: '',
      };

      const handler = new ECSServiceHandler(resourceWithoutArn, sampleConfig);
      expect(handler).toBeDefined();
    });
  });

  describe('getStatus', () => {
    it('should return service status with running tasks', async () => {
      ecsMock.on(DescribeServicesCommand).resolves({
        services: [
          {
            serviceName: 'test-service',
            desiredCount: 2,
            runningCount: 2,
            status: 'ACTIVE',
          },
        ],
      });

      const handler = new ECSServiceHandler(sampleResource, sampleConfig);
      const status = await handler.getStatus();

      expect(status).toEqual({
        desired_count: 2,
        running_count: 2,
        status: 'ACTIVE',
        is_stopped: false,
      });
    });

    it('should handle missing fields in service response', async () => {
      ecsMock.on(DescribeServicesCommand).resolves({
        services: [
          {
            serviceName: 'test-service',
            // Missing counts and status
          },
        ],
      });

      const handler = new ECSServiceHandler(sampleResource, sampleConfig);
      const status = await handler.getStatus();

      expect(status).toEqual({
        desired_count: 0,
        running_count: 0,
        status: 'UNKNOWN',
        is_stopped: true, // 0 === 0
      });
    });

    it('should return status with is_stopped=true when desiredCount is 0', async () => {
      ecsMock.on(DescribeServicesCommand).resolves({
        services: [
          {
            serviceName: 'test-service',
            desiredCount: 0,
            runningCount: 0,
            status: 'ACTIVE',
          },
        ],
      });

      const handler = new ECSServiceHandler(sampleResource, sampleConfig);
      const status = await handler.getStatus();

      expect(status.is_stopped).toBe(true);
      expect(status.desired_count).toBe(0);
    });

    it('should throw error when service not found', async () => {
      ecsMock.on(DescribeServicesCommand).resolves({
        services: [],
      });

      const handler = new ECSServiceHandler(sampleResource, sampleConfig);

      await expect(handler.getStatus()).rejects.toThrow(
        'Service test-service not found in cluster test-cluster'
      );
    });

    it('should call DescribeServicesCommand with correct parameters', async () => {
      ecsMock.on(DescribeServicesCommand).resolves({
        services: [
          {
            serviceName: 'test-service',
            desiredCount: 1,
            runningCount: 1,
            status: 'ACTIVE',
          },
        ],
      });

      const handler = new ECSServiceHandler(sampleResource, sampleConfig);
      await handler.getStatus();

      expect(ecsMock.calls()).toHaveLength(1);
      expect(ecsMock.call(0).args[0].input).toEqual({
        cluster: 'test-cluster',
        services: ['test-service'],
      });
    });
  });

  describe('stop', () => {
    describe('direct mode (no Auto Scaling)', () => {
      it('should stop service by setting desiredCount to 0', async () => {
        ecsMock.on(DescribeServicesCommand).resolves({
          services: [
            {
              serviceName: 'test-service',
              desiredCount: 2,
              runningCount: 2,
              status: 'ACTIVE',
            },
          ],
        });

        ecsMock.on(UpdateServiceCommand).resolves({
          service: {
            serviceName: 'test-service',
            desiredCount: 0,
          },
        });

        const handler = new ECSServiceHandler(sampleResource, sampleConfig);
        const result = await handler.stop();

        expect(result.success).toBe(true);
        expect(result.action).toBe('stop');
        expect(result.message).toContain('Service stopped');
        expect(result.message).toContain('desired=0');
        expect(result.message).toContain('was 2');
        expect(result.previousState).toMatchObject({
          desired_count: 2,
          running_count: 2,
        });

        // Verify UpdateServiceCommand was called
        const updateCalls = ecsMock.commandCalls(UpdateServiceCommand);
        expect(updateCalls).toHaveLength(1);
        expect(updateCalls[0].args[0].input).toEqual({
          cluster: 'test-cluster',
          service: 'test-service',
          desiredCount: 0,
        });
      });

      it('should be idempotent - return success if already at target count', async () => {
        ecsMock.on(DescribeServicesCommand).resolves({
          services: [
            {
              serviceName: 'test-service',
              desiredCount: 0,
              runningCount: 0,
              status: 'ACTIVE',
            },
          ],
        });

        const handler = new ECSServiceHandler(sampleResource, sampleConfig);
        const result = await handler.stop();

        expect(result.success).toBe(true);
        expect(result.message).toContain('Service already at target count 0');

        // UpdateServiceCommand should NOT be called
        const updateCalls = ecsMock.commandCalls(UpdateServiceCommand);
        expect(updateCalls).toHaveLength(0);
      });

      it('should support custom stop desiredCount', async () => {
        const configWithCustomStop: Config = {
          ...sampleConfig,
          resource_defaults: {
            'ecs-service': {
              waitForStable: false,
              start: {
                desiredCount: 3,
              },
              stop: {
                desiredCount: 1, // Reduce to 1 instead of 0
              },
            },
          },
        };

        ecsMock.on(DescribeServicesCommand).resolves({
          services: [
            {
              serviceName: 'test-service',
              desiredCount: 3,
              runningCount: 3,
              status: 'ACTIVE',
            },
          ],
        });

        ecsMock.on(UpdateServiceCommand).resolves({
          service: { serviceName: 'test-service', desiredCount: 1 },
        });

        const handler = new ECSServiceHandler(sampleResource, configWithCustomStop);
        const result = await handler.stop();

        expect(result.success).toBe(true);
        expect(result.message).toContain('desired=1');
        expect(result.message).toContain('was 3');

        const updateCalls = ecsMock.commandCalls(UpdateServiceCommand);
        expect(updateCalls[0].args[0].input.desiredCount).toBe(1);
      });
    });

    describe('Auto Scaling mode', () => {
      it('should manage via Auto Scaling when minCapacity and maxCapacity are configured', async () => {
        const configWithAutoScaling: Config = {
          ...sampleConfig,
          resource_defaults: {
            'ecs-service': {
              waitForStable: false,
              start: {
                minCapacity: 2,
                maxCapacity: 6,
                desiredCount: 2,
              },
              stop: {
                minCapacity: 0,
                maxCapacity: 0,
                desiredCount: 0,
              },
            },
          },
        };

        ecsMock.on(DescribeServicesCommand).resolves({
          services: [
            {
              serviceName: 'test-service',
              desiredCount: 2,
              runningCount: 2,
              status: 'ACTIVE',
            },
          ],
        });

        autoScalingMock.on(RegisterScalableTargetCommand).resolves({});
        ecsMock.on(UpdateServiceCommand).resolves({
          service: { serviceName: 'test-service', desiredCount: 0 },
        });

        const handler = new ECSServiceHandler(sampleResource, configWithAutoScaling);
        const result = await handler.stop();

        expect(result.success).toBe(true);
        expect(result.message).toContain('Service stopped via Auto Scaling');
        expect(result.message).toContain('min=0');
        expect(result.message).toContain('max=0');
        expect(result.message).toContain('desired=0');

        // Verify Auto Scaling API was called
        const autoScalingCalls = autoScalingMock.commandCalls(RegisterScalableTargetCommand);
        expect(autoScalingCalls).toHaveLength(1);
        expect(autoScalingCalls[0].args[0].input).toMatchObject({
          MinCapacity: 0,
          MaxCapacity: 0,
        });

        // Verify ECS UpdateService was also called
        const updateCalls = ecsMock.commandCalls(UpdateServiceCommand);
        expect(updateCalls).toHaveLength(1);
        expect(updateCalls[0].args[0].input.desiredCount).toBe(0);
      });
    });

    it('should wait for stable when configured', async () => {
      const configWithWait: Config = {
        ...sampleConfig,
        resource_defaults: {
          'ecs-service': {
            waitForStable: true,
            stableTimeoutSeconds: 20, // Must be > minDelay (15s)
            start: {
              desiredCount: 2,
            },
            stop: {
              desiredCount: 0,
            },
          },
        },
      };

      // 1. Initial status check
      ecsMock
        .on(DescribeServicesCommand)
        .resolvesOnce({
          services: [
            {
              serviceName: 'test-service',
              desiredCount: 2,
              runningCount: 2,
              status: 'ACTIVE',
            },
          ],
        })
        // 2. Waiter checks (multiple calls possible)
        .resolves({
          services: [
            {
              serviceName: 'test-service',
              desiredCount: 0,
              runningCount: 0, // Matched desiredCount
              status: 'ACTIVE',
              deployments: [
                {
                  status: 'PRIMARY',
                  desiredCount: 0,
                  runningCount: 0,
                  pendingCount: 0,
                },
              ],
            },
          ],
        });

      ecsMock.on(UpdateServiceCommand).resolves({
        service: { serviceName: 'test-service', desiredCount: 0 },
      });

      const handler = new ECSServiceHandler(sampleResource, configWithWait);
      const result = await handler.stop();

      expect(result.success).toBe(true);
      expect(result.message).toContain('Service stopped');
      // Verify waiter was engaged (DescribeServicesCommand called more than once)
      expect(ecsMock.commandCalls(DescribeServicesCommand).length).toBeGreaterThan(1);
    });

    it('should return failure result on error', async () => {
      ecsMock.on(DescribeServicesCommand).rejects(new Error('Network error'));

      const handler = new ECSServiceHandler(sampleResource, sampleConfig);
      const result = await handler.stop();

      expect(result.success).toBe(false);
      expect(result.action).toBe('stop');
      expect(result.message).toBe('Stop operation failed');
      expect(result.error).toContain('Network error');
    });

    it('should throw error when stop config is missing', async () => {
      const configWithoutStop: Config = {
        ...sampleConfig,
        resource_defaults: {
          'ecs-service': {
            start: {
              desiredCount: 2,
            },
          },
        },
      };

      ecsMock.on(DescribeServicesCommand).resolves({
        services: [{ desiredCount: 2, runningCount: 2, status: 'ACTIVE' }],
      });

      const handler = new ECSServiceHandler(sampleResource, configWithoutStop);
      const result = await handler.stop();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Missing required stop configuration');
    });
  });

  describe('start', () => {
    describe('direct mode (no Auto Scaling)', () => {
      it('should start service by setting desiredCount to configured value', async () => {
        ecsMock.on(DescribeServicesCommand).resolves({
          services: [
            {
              serviceName: 'test-service',
              desiredCount: 0,
              runningCount: 0,
              status: 'ACTIVE',
            },
          ],
        });

        ecsMock.on(UpdateServiceCommand).resolves({
          service: {
            serviceName: 'test-service',
            desiredCount: 2,
          },
        });

        const handler = new ECSServiceHandler(sampleResource, sampleConfig);
        const result = await handler.start();

        expect(result.success).toBe(true);
        expect(result.action).toBe('start');
        expect(result.message).toContain('Service started');
        expect(result.message).toContain('desired=2');
        expect(result.message).toContain('was 0');

        const updateCalls = ecsMock.commandCalls(UpdateServiceCommand);
        expect(updateCalls).toHaveLength(1);
        expect(updateCalls[0].args[0].input).toMatchObject({
          cluster: 'test-cluster',
          service: 'test-service',
          desiredCount: 2,
        });
      });

      it('should be idempotent - return success if already at target count', async () => {
        ecsMock.on(DescribeServicesCommand).resolves({
          services: [
            {
              serviceName: 'test-service',
              desiredCount: 2,
              runningCount: 2,
              status: 'ACTIVE',
            },
          ],
        });

        const handler = new ECSServiceHandler(sampleResource, sampleConfig);
        const result = await handler.start();

        expect(result.success).toBe(true);
        expect(result.message).toContain('Service already at desired count 2');

        const updateCalls = ecsMock.commandCalls(UpdateServiceCommand);
        expect(updateCalls).toHaveLength(0);
      });

      it('should use configured start desiredCount', async () => {
        const configWithCustomStart: Config = {
          ...sampleConfig,
          resource_defaults: {
            'ecs-service': {
              waitForStable: false,
              start: {
                desiredCount: 3,
              },
              stop: {
                desiredCount: 0,
              },
            },
          },
        };

        ecsMock.on(DescribeServicesCommand).resolves({
          services: [
            {
              serviceName: 'test-service',
              desiredCount: 0,
              runningCount: 0,
              status: 'ACTIVE',
            },
          ],
        });

        ecsMock.on(UpdateServiceCommand).resolves({
          service: { desiredCount: 3 },
        });

        const handler = new ECSServiceHandler(sampleResource, configWithCustomStart);
        const result = await handler.start();

        expect(result.success).toBe(true);
        expect(result.message).toContain('desired=3');

        const updateCalls = ecsMock.commandCalls(UpdateServiceCommand);
        expect(updateCalls[0].args[0].input.desiredCount).toBe(3);
      });
    });

    describe('Auto Scaling mode', () => {
      it('should manage via Auto Scaling when minCapacity and maxCapacity are configured', async () => {
        const configWithAutoScaling: Config = {
          ...sampleConfig,
          resource_defaults: {
            'ecs-service': {
              waitForStable: false,
              start: {
                minCapacity: 2,
                maxCapacity: 6,
                desiredCount: 3,
              },
              stop: {
                minCapacity: 0,
                maxCapacity: 0,
                desiredCount: 0,
              },
            },
          },
        };

        ecsMock.on(DescribeServicesCommand).resolves({
          services: [
            {
              serviceName: 'test-service',
              desiredCount: 0,
              runningCount: 0,
              status: 'ACTIVE',
            },
          ],
        });

        autoScalingMock.on(RegisterScalableTargetCommand).resolves({});
        ecsMock.on(UpdateServiceCommand).resolves({
          service: { serviceName: 'test-service', desiredCount: 3 },
        });

        const handler = new ECSServiceHandler(sampleResource, configWithAutoScaling);
        const result = await handler.start();

        expect(result.success).toBe(true);
        expect(result.message).toContain('Service started via Auto Scaling');
        expect(result.message).toContain('min=2');
        expect(result.message).toContain('max=6');
        expect(result.message).toContain('desired=3');

        // Verify Auto Scaling API was called
        const autoScalingCalls = autoScalingMock.commandCalls(RegisterScalableTargetCommand);
        expect(autoScalingCalls).toHaveLength(1);
        expect(autoScalingCalls[0].args[0].input).toMatchObject({
          MinCapacity: 2,
          MaxCapacity: 6,
        });

        // Verify ECS UpdateService was also called
        const updateCalls = ecsMock.commandCalls(UpdateServiceCommand);
        expect(updateCalls).toHaveLength(1);
        expect(updateCalls[0].args[0].input.desiredCount).toBe(3);
      });
    });

    it('should wait for stable when configured', async () => {
      const configWithWait: Config = {
        ...sampleConfig,
        resource_defaults: {
          'ecs-service': {
            waitForStable: true,
            stableTimeoutSeconds: 20, // Must be > minDelay (15s)
            start: {
              desiredCount: 2,
            },
            stop: {
              desiredCount: 0,
            },
          },
        },
      };

      // 1. Initial status check
      ecsMock
        .on(DescribeServicesCommand)
        .resolvesOnce({
          services: [
            {
              serviceName: 'test-service',
              desiredCount: 0,
              runningCount: 0,
              status: 'ACTIVE',
            },
          ],
        })
        // 2. Waiter checks
        .resolves({
          services: [
            {
              serviceName: 'test-service',
              desiredCount: 2,
              runningCount: 2, // Matched target count
              status: 'ACTIVE',
              deployments: [
                {
                  status: 'PRIMARY',
                  desiredCount: 2,
                  runningCount: 2,
                  pendingCount: 0,
                },
              ],
            },
          ],
        });

      ecsMock.on(UpdateServiceCommand).resolves({
        service: { desiredCount: 2 },
      });

      const handler = new ECSServiceHandler(sampleResource, configWithWait);
      const result = await handler.start();

      expect(result.success).toBe(true);
      expect(ecsMock.commandCalls(DescribeServicesCommand).length).toBeGreaterThan(1);
    });

    it('should return failure result on error', async () => {
      ecsMock.on(DescribeServicesCommand).resolves({
        services: [{ desiredCount: 0, runningCount: 0, status: 'ACTIVE' }],
      });

      ecsMock.on(UpdateServiceCommand).rejects(new Error('Permission denied'));

      const handler = new ECSServiceHandler(sampleResource, sampleConfig);
      const result = await handler.start();

      expect(result.success).toBe(false);
      expect(result.message).toBe('Start operation failed');
      expect(result.error).toContain('Permission denied');
    });

    it('should throw error when start config is missing', async () => {
      const configWithoutStart: Config = {
        ...sampleConfig,
        resource_defaults: {
          'ecs-service': {
            stop: {
              desiredCount: 0,
            },
          },
        },
      };

      ecsMock.on(DescribeServicesCommand).resolves({
        services: [{ desiredCount: 0, runningCount: 0, status: 'ACTIVE' }],
      });

      const handler = new ECSServiceHandler(sampleResource, configWithoutStart);
      const result = await handler.start();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Missing required start configuration');
    });
  });

  describe('validation', () => {
    it('should throw error when desiredCount is out of range (below minCapacity)', async () => {
      const invalidConfig: Config = {
        ...sampleConfig,
        resource_defaults: {
          'ecs-service': {
            start: {
              minCapacity: 2,
              maxCapacity: 6,
              desiredCount: 1, // Below minCapacity
            },
            stop: {
              desiredCount: 0,
            },
          },
        },
      };

      ecsMock.on(DescribeServicesCommand).resolves({
        services: [{ desiredCount: 0, runningCount: 0, status: 'ACTIVE' }],
      });

      const handler = new ECSServiceHandler(sampleResource, invalidConfig);
      const result = await handler.start();

      expect(result.success).toBe(false);
      expect(result.error).toContain(
        'desiredCount (1) must be between minCapacity (2) and maxCapacity (6)'
      );
    });

    it('should throw error when desiredCount is out of range (above maxCapacity)', async () => {
      const invalidConfig: Config = {
        ...sampleConfig,
        resource_defaults: {
          'ecs-service': {
            start: {
              minCapacity: 2,
              maxCapacity: 6,
              desiredCount: 10, // Above maxCapacity
            },
            stop: {
              desiredCount: 0,
            },
          },
        },
      };

      ecsMock.on(DescribeServicesCommand).resolves({
        services: [{ desiredCount: 0, runningCount: 0, status: 'ACTIVE' }],
      });

      const handler = new ECSServiceHandler(sampleResource, invalidConfig);
      const result = await handler.start();

      expect(result.success).toBe(false);
      expect(result.error).toContain(
        'desiredCount (10) must be between minCapacity (2) and maxCapacity (6)'
      );
    });

    it('should throw error when minCapacity > maxCapacity', async () => {
      const invalidConfig: Config = {
        ...sampleConfig,
        resource_defaults: {
          'ecs-service': {
            start: {
              minCapacity: 6,
              maxCapacity: 2, // Invalid: min > max
              desiredCount: 4,
            },
            stop: {
              desiredCount: 0,
            },
          },
        },
      };

      ecsMock.on(DescribeServicesCommand).resolves({
        services: [{ desiredCount: 0, runningCount: 0, status: 'ACTIVE' }],
      });

      const handler = new ECSServiceHandler(sampleResource, invalidConfig);
      const result = await handler.start();

      expect(result.success).toBe(false);
      expect(result.error).toContain('minCapacity (6) must be <= maxCapacity (2)');
    });

    it('should throw error when desiredCount is negative', async () => {
      const invalidConfig: Config = {
        ...sampleConfig,
        resource_defaults: {
          'ecs-service': {
            start: {
              desiredCount: -1, // Invalid: negative
            },
            stop: {
              desiredCount: 0,
            },
          },
        },
      };

      ecsMock.on(DescribeServicesCommand).resolves({
        services: [{ desiredCount: 0, runningCount: 0, status: 'ACTIVE' }],
      });

      const handler = new ECSServiceHandler(sampleResource, invalidConfig);
      const result = await handler.start();

      expect(result.success).toBe(false);
      expect(result.error).toContain('desiredCount must be >= 0');
    });
  });

  describe('isReady', () => {
    it('should return true when desired_count equals running_count', async () => {
      ecsMock.on(DescribeServicesCommand).resolves({
        services: [
          {
            desiredCount: 2,
            runningCount: 2,
            status: 'ACTIVE',
          },
        ],
      });

      const handler = new ECSServiceHandler(sampleResource, sampleConfig);
      const ready = await handler.isReady();

      expect(ready).toBe(true);
    });

    it('should return false when counts do not match', async () => {
      ecsMock.on(DescribeServicesCommand).resolves({
        services: [
          {
            desiredCount: 2,
            runningCount: 1,
            status: 'ACTIVE',
          },
        ],
      });

      const handler = new ECSServiceHandler(sampleResource, sampleConfig);
      const ready = await handler.isReady();

      expect(ready).toBe(false);
    });

    it('should return false on error', async () => {
      ecsMock.on(DescribeServicesCommand).rejects(new Error('API Error'));

      const handler = new ECSServiceHandler(sampleResource, sampleConfig);
      const ready = await handler.isReady();

      expect(ready).toBe(false);
    });
  });
});

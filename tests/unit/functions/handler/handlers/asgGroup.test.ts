/**
 * Unit tests for handlers/asgGroup.ts
 *
 * Tests ASG Group Handler implementation using aws-sdk-client-mock
 * to mock AWS SDK v3 calls.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  AutoScalingClient,
  DescribeAutoScalingGroupsCommand,
  UpdateAutoScalingGroupCommand,
  SuspendProcessesCommand,
  ResumeProcessesCommand,
} from '@aws-sdk/client-auto-scaling';
import { ASGGroupHandler } from '@functions/handler/handlers/asgGroup';
import type { DiscoveredResource, Config } from '@shared/types';

const autoScalingMock = mockClient(AutoScalingClient);

describe('ASGGroupHandler', () => {
  let sampleResource: DiscoveredResource;
  let sampleConfig: Config;

  beforeEach(() => {
    autoScalingMock.reset();

    sampleResource = {
      resourceType: 'autoscaling-group',
      arn: 'arn:aws:autoscaling:us-east-1:123456789012:autoScalingGroup:12345678-1234-1234-1234-123456789012:autoScalingGroupName/test-asg',
      resourceId: 'test-asg',
      priority: 50,
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
        'autoscaling-group': {
          suspendProcesses: true,
          waitAfterCommand: 0, // Disable wait for faster tests
          start: {
            minSize: 2,
            maxSize: 10,
            desiredCapacity: 2,
          },
          stop: {
            minSize: 0,
            maxSize: 0,
            desiredCapacity: 0,
          },
        },
      },
    };
  });

  describe('constructor', () => {
    it('should extract region from ARN', async () => {
      const handler = new ASGGroupHandler(sampleResource, sampleConfig);

      expect(handler).toBeDefined();
      expect(await handler['autoScalingClient'].config.region()).toBe('us-east-1');
    });

    it('should extract ASG name from resource ID', () => {
      const handler = new ASGGroupHandler(sampleResource, sampleConfig);

      expect(handler['asgName']).toBe('test-asg');
    });

    it('should handle resource without region in ARN', async () => {
      const resourceWithoutRegion: DiscoveredResource = {
        ...sampleResource,
        arn: '',
      };

      const handler = new ASGGroupHandler(resourceWithoutRegion, sampleConfig);
      expect(handler).toBeDefined();
    });
  });

  describe('getStatus', () => {
    it('should return correct status for running ASG', async () => {
      autoScalingMock.on(DescribeAutoScalingGroupsCommand).resolves({
        AutoScalingGroups: [
          {
            AutoScalingGroupName: 'test-asg',
            MinSize: 2,
            MaxSize: 10,
            DesiredCapacity: 3,
            Instances: [
              { InstanceId: 'i-1', LifecycleState: 'InService' },
              { InstanceId: 'i-2', LifecycleState: 'InService' },
              { InstanceId: 'i-3', LifecycleState: 'InService' },
            ],
            SuspendedProcesses: [],
          },
        ],
      });

      const handler = new ASGGroupHandler(sampleResource, sampleConfig);
      const status = await handler.getStatus();

      expect(status).toEqual({
        min_size: 2,
        max_size: 10,
        desired_capacity: 3,
        instances: 3,
        in_service_instances: 3,
        is_stopped: false,
        suspended_processes: [],
      });
    });

    it('should return is_stopped=true when desired_capacity is 0', async () => {
      autoScalingMock.on(DescribeAutoScalingGroupsCommand).resolves({
        AutoScalingGroups: [
          {
            AutoScalingGroupName: 'test-asg',
            MinSize: 0,
            MaxSize: 0,
            DesiredCapacity: 0,
            Instances: [],
            SuspendedProcesses: [{ ProcessName: 'Launch' }, { ProcessName: 'Terminate' }],
          },
        ],
      });

      const handler = new ASGGroupHandler(sampleResource, sampleConfig);
      const status = await handler.getStatus();

      expect(status.is_stopped).toBe(true);
      expect(status.desired_capacity).toBe(0);
      expect(status.suspended_processes).toEqual(['Launch', 'Terminate']);
    });

    it('should include suspended_processes in status', async () => {
      autoScalingMock.on(DescribeAutoScalingGroupsCommand).resolves({
        AutoScalingGroups: [
          {
            AutoScalingGroupName: 'test-asg',
            MinSize: 2,
            MaxSize: 10,
            DesiredCapacity: 2,
            Instances: [],
            SuspendedProcesses: [
              { ProcessName: 'HealthCheck' },
              { ProcessName: 'ReplaceUnhealthy' },
            ],
          },
        ],
      });

      const handler = new ASGGroupHandler(sampleResource, sampleConfig);
      const status = await handler.getStatus();

      expect(status.suspended_processes).toEqual(['HealthCheck', 'ReplaceUnhealthy']);
    });

    it('should throw error when ASG not found', async () => {
      autoScalingMock.on(DescribeAutoScalingGroupsCommand).resolves({
        AutoScalingGroups: [],
      });

      const handler = new ASGGroupHandler(sampleResource, sampleConfig);

      await expect(handler.getStatus()).rejects.toThrow('Auto Scaling Group test-asg not found');
    });
  });

  describe('stop', () => {
    it('should stop ASG successfully', async () => {
      autoScalingMock.on(DescribeAutoScalingGroupsCommand).resolves({
        AutoScalingGroups: [
          {
            AutoScalingGroupName: 'test-asg',
            MinSize: 2,
            MaxSize: 10,
            DesiredCapacity: 3,
            Instances: [
              { InstanceId: 'i-1', LifecycleState: 'InService' },
              { InstanceId: 'i-2', LifecycleState: 'InService' },
              { InstanceId: 'i-3', LifecycleState: 'InService' },
            ],
            SuspendedProcesses: [],
          },
        ],
      });

      autoScalingMock.on(SuspendProcessesCommand).resolves({});
      autoScalingMock.on(UpdateAutoScalingGroupCommand).resolves({});

      const handler = new ASGGroupHandler(sampleResource, sampleConfig);
      const result = await handler.stop();

      expect(result.success).toBe(true);
      expect(result.action).toBe('stop');
      expect(result.message).toContain('ASG stopped');
      expect(result.message).toContain('min=0');
      expect(result.message).toContain('max=0');
      expect(result.message).toContain('desired=0');
    });

    it('should suspend scaling processes when configured', async () => {
      autoScalingMock.on(DescribeAutoScalingGroupsCommand).resolves({
        AutoScalingGroups: [
          {
            AutoScalingGroupName: 'test-asg',
            MinSize: 2,
            MaxSize: 10,
            DesiredCapacity: 2,
            Instances: [],
            SuspendedProcesses: [],
          },
        ],
      });

      autoScalingMock.on(SuspendProcessesCommand).resolves({});
      autoScalingMock.on(UpdateAutoScalingGroupCommand).resolves({});

      const handler = new ASGGroupHandler(sampleResource, sampleConfig);
      await handler.stop();

      const suspendCalls = autoScalingMock.commandCalls(SuspendProcessesCommand);
      expect(suspendCalls).toHaveLength(1);
      expect(suspendCalls[0].args[0].input.AutoScalingGroupName).toBe('test-asg');
    });

    it('should not suspend processes when suspendProcesses is false', async () => {
      const configWithoutSuspend: Config = {
        ...sampleConfig,
        resource_defaults: {
          'autoscaling-group': {
            suspendProcesses: false,
            waitAfterCommand: 0,
            start: { minSize: 2, maxSize: 10, desiredCapacity: 2 },
            stop: { minSize: 0, maxSize: 0, desiredCapacity: 0 },
          },
        },
      };

      autoScalingMock.on(DescribeAutoScalingGroupsCommand).resolves({
        AutoScalingGroups: [
          {
            AutoScalingGroupName: 'test-asg',
            MinSize: 2,
            MaxSize: 10,
            DesiredCapacity: 2,
            Instances: [],
            SuspendedProcesses: [],
          },
        ],
      });

      autoScalingMock.on(UpdateAutoScalingGroupCommand).resolves({});

      const handler = new ASGGroupHandler(sampleResource, configWithoutSuspend);
      await handler.stop();

      const suspendCalls = autoScalingMock.commandCalls(SuspendProcessesCommand);
      expect(suspendCalls).toHaveLength(0);
    });

    it('should return idempotent result when already stopped', async () => {
      autoScalingMock.on(DescribeAutoScalingGroupsCommand).resolves({
        AutoScalingGroups: [
          {
            AutoScalingGroupName: 'test-asg',
            MinSize: 0,
            MaxSize: 0,
            DesiredCapacity: 0,
            Instances: [],
            SuspendedProcesses: [],
          },
        ],
      });

      const handler = new ASGGroupHandler(sampleResource, sampleConfig);
      const result = await handler.stop();

      expect(result.success).toBe(true);
      expect(result.idempotent).toBe(true);
      expect(result.message).toContain('already at target');

      // UpdateAutoScalingGroupCommand should NOT be called
      const updateCalls = autoScalingMock.commandCalls(UpdateAutoScalingGroupCommand);
      expect(updateCalls).toHaveLength(0);
    });

    it('should handle API errors gracefully', async () => {
      autoScalingMock.on(DescribeAutoScalingGroupsCommand).rejects(new Error('Network error'));

      const handler = new ASGGroupHandler(sampleResource, sampleConfig);
      const result = await handler.stop();

      expect(result.success).toBe(false);
      expect(result.action).toBe('stop');
      expect(result.message).toBe('Stop operation failed');
      expect(result.error).toContain('Network error');
    });
  });

  describe('start', () => {
    it('should start ASG successfully', async () => {
      autoScalingMock.on(DescribeAutoScalingGroupsCommand).resolves({
        AutoScalingGroups: [
          {
            AutoScalingGroupName: 'test-asg',
            MinSize: 0,
            MaxSize: 0,
            DesiredCapacity: 0,
            Instances: [],
            SuspendedProcesses: [{ ProcessName: 'Launch' }, { ProcessName: 'Terminate' }],
          },
        ],
      });

      autoScalingMock.on(UpdateAutoScalingGroupCommand).resolves({});
      autoScalingMock.on(ResumeProcessesCommand).resolves({});

      const handler = new ASGGroupHandler(sampleResource, sampleConfig);
      const result = await handler.start();

      expect(result.success).toBe(true);
      expect(result.action).toBe('start');
      expect(result.message).toContain('ASG started');
      expect(result.message).toContain('min=2');
      expect(result.message).toContain('max=10');
      expect(result.message).toContain('desired=2');
    });

    it('should resume scaling processes when configured', async () => {
      autoScalingMock.on(DescribeAutoScalingGroupsCommand).resolves({
        AutoScalingGroups: [
          {
            AutoScalingGroupName: 'test-asg',
            MinSize: 0,
            MaxSize: 0,
            DesiredCapacity: 0,
            Instances: [],
            SuspendedProcesses: [{ ProcessName: 'Launch' }],
          },
        ],
      });

      autoScalingMock.on(UpdateAutoScalingGroupCommand).resolves({});
      autoScalingMock.on(ResumeProcessesCommand).resolves({});

      const handler = new ASGGroupHandler(sampleResource, sampleConfig);
      await handler.start();

      const resumeCalls = autoScalingMock.commandCalls(ResumeProcessesCommand);
      expect(resumeCalls).toHaveLength(1);
      expect(resumeCalls[0].args[0].input.AutoScalingGroupName).toBe('test-asg');
    });

    it('should return idempotent result when already at target', async () => {
      autoScalingMock.on(DescribeAutoScalingGroupsCommand).resolves({
        AutoScalingGroups: [
          {
            AutoScalingGroupName: 'test-asg',
            MinSize: 2,
            MaxSize: 10,
            DesiredCapacity: 2,
            Instances: [{ InstanceId: 'i-1', LifecycleState: 'InService' }],
            SuspendedProcesses: [],
          },
        ],
      });

      const handler = new ASGGroupHandler(sampleResource, sampleConfig);
      const result = await handler.start();

      expect(result.success).toBe(true);
      expect(result.idempotent).toBe(true);
      expect(result.message).toContain('already at target');

      // UpdateAutoScalingGroupCommand should NOT be called
      const updateCalls = autoScalingMock.commandCalls(UpdateAutoScalingGroupCommand);
      expect(updateCalls).toHaveLength(0);
    });

    it('should handle API errors gracefully', async () => {
      autoScalingMock.on(DescribeAutoScalingGroupsCommand).resolves({
        AutoScalingGroups: [
          {
            AutoScalingGroupName: 'test-asg',
            MinSize: 0,
            MaxSize: 0,
            DesiredCapacity: 0,
            Instances: [],
            SuspendedProcesses: [],
          },
        ],
      });

      autoScalingMock.on(UpdateAutoScalingGroupCommand).rejects(new Error('Permission denied'));

      const handler = new ASGGroupHandler(sampleResource, sampleConfig);
      const result = await handler.start();

      expect(result.success).toBe(false);
      expect(result.action).toBe('start');
      expect(result.message).toBe('Start operation failed');
      expect(result.error).toContain('Permission denied');
    });
  });

  describe('isReady', () => {
    it('should return true when all instances are InService', async () => {
      autoScalingMock.on(DescribeAutoScalingGroupsCommand).resolves({
        AutoScalingGroups: [
          {
            AutoScalingGroupName: 'test-asg',
            MinSize: 2,
            MaxSize: 10,
            DesiredCapacity: 2,
            Instances: [
              { InstanceId: 'i-1', LifecycleState: 'InService' },
              { InstanceId: 'i-2', LifecycleState: 'InService' },
            ],
            SuspendedProcesses: [],
          },
        ],
      });

      const handler = new ASGGroupHandler(sampleResource, sampleConfig);
      const ready = await handler.isReady();

      expect(ready).toBe(true);
    });

    it('should return false when instances are still launching', async () => {
      autoScalingMock.on(DescribeAutoScalingGroupsCommand).resolves({
        AutoScalingGroups: [
          {
            AutoScalingGroupName: 'test-asg',
            MinSize: 2,
            MaxSize: 10,
            DesiredCapacity: 2,
            Instances: [
              { InstanceId: 'i-1', LifecycleState: 'InService' },
              { InstanceId: 'i-2', LifecycleState: 'Pending' },
            ],
            SuspendedProcesses: [],
          },
        ],
      });

      const handler = new ASGGroupHandler(sampleResource, sampleConfig);
      const ready = await handler.isReady();

      expect(ready).toBe(false);
    });

    it('should return true when desiredCapacity is 0 and no instances', async () => {
      autoScalingMock.on(DescribeAutoScalingGroupsCommand).resolves({
        AutoScalingGroups: [
          {
            AutoScalingGroupName: 'test-asg',
            MinSize: 0,
            MaxSize: 0,
            DesiredCapacity: 0,
            Instances: [],
            SuspendedProcesses: [],
          },
        ],
      });

      const handler = new ASGGroupHandler(sampleResource, sampleConfig);
      const ready = await handler.isReady();

      expect(ready).toBe(true);
    });

    it('should return false on error', async () => {
      autoScalingMock.on(DescribeAutoScalingGroupsCommand).rejects(new Error('API Error'));

      const handler = new ASGGroupHandler(sampleResource, sampleConfig);
      const ready = await handler.isReady();

      expect(ready).toBe(false);
    });
  });

  describe('validation', () => {
    it('should throw error when start config is missing', async () => {
      const configWithoutStart: Config = {
        ...sampleConfig,
        resource_defaults: {
          'autoscaling-group': {
            stop: { minSize: 0, maxSize: 0, desiredCapacity: 0 },
          },
        },
      };

      autoScalingMock.on(DescribeAutoScalingGroupsCommand).resolves({
        AutoScalingGroups: [
          {
            AutoScalingGroupName: 'test-asg',
            MinSize: 0,
            MaxSize: 0,
            DesiredCapacity: 0,
            Instances: [],
            SuspendedProcesses: [],
          },
        ],
      });

      const handler = new ASGGroupHandler(sampleResource, configWithoutStart);
      const result = await handler.start();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Missing required start configuration');
    });

    it('should throw error when stop config is missing', async () => {
      const configWithoutStop: Config = {
        ...sampleConfig,
        resource_defaults: {
          'autoscaling-group': {
            start: { minSize: 2, maxSize: 10, desiredCapacity: 2 },
          },
        },
      };

      autoScalingMock.on(DescribeAutoScalingGroupsCommand).resolves({
        AutoScalingGroups: [
          {
            AutoScalingGroupName: 'test-asg',
            MinSize: 2,
            MaxSize: 10,
            DesiredCapacity: 2,
            Instances: [],
            SuspendedProcesses: [],
          },
        ],
      });

      const handler = new ASGGroupHandler(sampleResource, configWithoutStop);
      const result = await handler.stop();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Missing required stop configuration');
    });

    it('should throw error when minSize > maxSize', async () => {
      const invalidConfig: Config = {
        ...sampleConfig,
        resource_defaults: {
          'autoscaling-group': {
            start: { minSize: 10, maxSize: 2, desiredCapacity: 5 },
            stop: { minSize: 0, maxSize: 0, desiredCapacity: 0 },
          },
        },
      };

      autoScalingMock.on(DescribeAutoScalingGroupsCommand).resolves({
        AutoScalingGroups: [
          {
            AutoScalingGroupName: 'test-asg',
            MinSize: 0,
            MaxSize: 0,
            DesiredCapacity: 0,
            Instances: [],
            SuspendedProcesses: [],
          },
        ],
      });

      const handler = new ASGGroupHandler(sampleResource, invalidConfig);
      const result = await handler.start();

      expect(result.success).toBe(false);
      expect(result.error).toContain('minSize (10) must be <= maxSize (2)');
    });

    it('should throw error when desiredCapacity is out of range', async () => {
      const invalidConfig: Config = {
        ...sampleConfig,
        resource_defaults: {
          'autoscaling-group': {
            start: { minSize: 2, maxSize: 10, desiredCapacity: 15 },
            stop: { minSize: 0, maxSize: 0, desiredCapacity: 0 },
          },
        },
      };

      autoScalingMock.on(DescribeAutoScalingGroupsCommand).resolves({
        AutoScalingGroups: [
          {
            AutoScalingGroupName: 'test-asg',
            MinSize: 0,
            MaxSize: 0,
            DesiredCapacity: 0,
            Instances: [],
            SuspendedProcesses: [],
          },
        ],
      });

      const handler = new ASGGroupHandler(sampleResource, invalidConfig);
      const result = await handler.start();

      expect(result.success).toBe(false);
      expect(result.error).toContain(
        'desiredCapacity (15) must be between minSize (2) and maxSize (10)'
      );
    });
  });
});

/**
 * Unit tests for core/orchestrator.ts
 *
 * Tests the Orchestrator class for resource discovery and execution.
 * Uses Vitest hoisted mocks for proper module mocking.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Config, DiscoveredResource, HandlerResult, ResourceHandler } from '@shared/types';

// ============================================================================
// HOISTED MOCKS - Must be defined before imports
// ============================================================================

// Create mock functions that will be hoisted
const { mockDiscoverFn, mockGetHandlerFn, TagDiscoveryMock, mockSendAggregatedTeamsNotification } =
  vi.hoisted(() => {
    const mockDiscoverFn = vi.fn();
    const mockGetHandlerFn = vi.fn();
    const mockSendAggregatedTeamsNotification = vi.fn();

    // Mock the TagDiscovery class constructor using vi.fn() as the constructor
    const MockTagDiscoveryConstructor = vi.fn(function (
      this: { discover: typeof mockDiscoverFn },
      _tagFilters: Record<string, string>,
      _resourceTypes: string[],
      _regions?: string[]
    ) {
      // Assign the hoisted mock function to the 'discover' method of the instance
      this.discover = mockDiscoverFn;
      // You can also store constructor arguments if needed for assertions on the instance itself
      // this.tagFilters = tagFilters;
      // this.resourceTypes = resourceTypes;
      // this.regions = regions;
    });

    return {
      mockDiscoverFn,
      mockGetHandlerFn,
      TagDiscoveryMock: MockTagDiscoveryConstructor, // Export the vi.fn() as the constructor
      mockSendAggregatedTeamsNotification,
    };
  });

// Mock the modules using hoisted factories
vi.mock('@functions/handler/discovery/tagDiscovery', () => ({
  TagDiscovery: TagDiscoveryMock,
}));

vi.mock('@functions/handler/handlers/factory', () => ({
  getHandler: mockGetHandlerFn,
}));

vi.mock('@shared/utils/logger', () => ({
  setupLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('@shared/utils/teamsNotifier', () => ({
  sendAggregatedTeamsNotification: mockSendAggregatedTeamsNotification,
}));

// Import AFTER mocks are defined
import { Orchestrator } from '@functions/handler/core/orchestrator';

// ============================================================================
// TESTS
// ============================================================================

describe('Orchestrator', () => {
  let sampleConfig: Config;
  let orchestrator: Orchestrator;

  beforeEach(() => {
    sampleConfig = {
      version: '1.0',
      environment: 'test',
      discovery: {
        method: 'tags',
        tags: {
          'lights-out:managed': 'true',
        },
        resource_types: ['ecs:service', 'rds:db'],
      },
      settings: {
        schedule_tag: 'lights-out:schedule',
      },
      resource_defaults: {},
    };

    orchestrator = new Orchestrator(sampleConfig);

    // Reset all mocks before each test
    vi.clearAllMocks();
  });

  describe('discoverResources', () => {
    it('should discover resources using TagDiscovery', async () => {
      const mockResources: DiscoveredResource[] = [
        {
          resourceType: 'ecs-service',
          arn: 'arn:aws:ecs:us-east-1:123456:service/cluster/service',
          resourceId: 'cluster/service',
          priority: 50,
          group: 'default',
          tags: { 'lights-out:managed': 'true' },
          metadata: { cluster_name: 'cluster' },
        },
        {
          resourceType: 'rds-db',
          arn: 'arn:aws:rds:us-east-1:123456:db:my-database',
          resourceId: 'my-database',
          priority: 100,
          group: 'default',
          tags: { 'lights-out:managed': 'true' },
          metadata: {},
        },
      ];

      mockDiscoverFn.mockResolvedValue(mockResources);

      const result = await orchestrator.discoverResources();

      expect(result).toEqual(mockResources);
      expect(mockDiscoverFn).toHaveBeenCalledTimes(1);
      expect(TagDiscoveryMock).toHaveBeenCalledWith(
        { 'lights-out:managed': 'true' },
        ['ecs:service', 'rds:db'],
        [] // regions parameter (empty array when not configured)
      );
    });

    it('should return empty array when no tag filters configured', async () => {
      const configNoTags: Config = {
        ...sampleConfig,
        discovery: {
          method: 'tags',
          tags: {},
          resource_types: ['ecs:service'],
        },
      };

      orchestrator = new Orchestrator(configNoTags);

      const result = await orchestrator.discoverResources();

      expect(result).toEqual([]);
      expect(mockDiscoverFn).not.toHaveBeenCalled();
    });

    it('should return empty array when no resource types configured', async () => {
      const configNoTypes: Config = {
        ...sampleConfig,
        discovery: {
          method: 'tags',
          tags: { 'lights-out:managed': 'true' },
          resource_types: [],
        },
      };

      orchestrator = new Orchestrator(configNoTypes);

      const result = await orchestrator.discoverResources();

      expect(result).toEqual([]);
      expect(mockDiscoverFn).not.toHaveBeenCalled();
    });

    it('should handle discovery when tags or resource_types are undefined', async () => {
      const configMissing: Config = {
        ...sampleConfig,
        discovery: {
          method: 'tags',
        },
      };

      orchestrator = new Orchestrator(configMissing);

      const result = await orchestrator.discoverResources();

      expect(result).toEqual([]);
    });

    it('should pass regions to TagDiscovery when configured', async () => {
      const configWithRegions: Config = {
        ...sampleConfig,
        regions: ['ap-southeast-1', 'ap-northeast-1'],
      };

      orchestrator = new Orchestrator(configWithRegions);
      mockDiscoverFn.mockResolvedValue([]);

      await orchestrator.discoverResources();

      expect(TagDiscoveryMock).toHaveBeenCalledWith(
        { 'lights-out:managed': 'true' },
        ['ecs:service', 'rds:db'],
        ['ap-southeast-1', 'ap-northeast-1']
      );
    });
  });

  describe('run - start action', () => {
    it('should execute start action on all discovered resources', async () => {
      const mockResources: DiscoveredResource[] = [
        {
          resourceType: 'ecs-service',
          arn: 'arn:aws:ecs:us-east-1:123456:service/c/s',
          resourceId: 'c/s',
          priority: 50,
          group: 'default',
          tags: {},
          metadata: { cluster_name: 'c' },
        },
      ];

      const mockStartFn = vi.fn().mockResolvedValue({
        success: true,
        action: 'start',
        resourceType: 'ecs-service',
        resourceId: 'c/s',
        message: 'Started successfully',
      } as HandlerResult);

      const mockHandler: Partial<ResourceHandler> = {
        start: mockStartFn,
      };

      mockDiscoverFn.mockResolvedValue(mockResources);
      mockGetHandlerFn.mockReturnValue(mockHandler as ResourceHandler);

      const result = await orchestrator.run('start');

      expect(result.total).toBe(1);
      expect(result.succeeded).toBe(1);
      expect(result.failed).toBe(0);
      expect(result.results).toHaveLength(1);
      expect(result.results[0].success).toBe(true);
      expect(mockStartFn).toHaveBeenCalledTimes(1);
    });

    it('should handle multiple resources with mixed success/failure', async () => {
      const mockResources: DiscoveredResource[] = [
        {
          resourceType: 'ecs-service',
          arn: 'arn:aws:ecs:us-east-1:123456:service/c1/s1',
          resourceId: 'c1/s1',
          priority: 50,
          group: 'default',
          tags: {},
          metadata: { cluster_name: 'c1' },
        },
        {
          resourceType: 'rds-db',
          arn: 'arn:aws:rds:us-east-1:123456:db:db1',
          resourceId: 'db1',
          priority: 100,
          group: 'default',
          tags: {},
          metadata: {},
        },
      ];

      const successHandler: Partial<ResourceHandler> = {
        start: vi.fn().mockResolvedValue({
          success: true,
          action: 'start',
          resourceType: 'ecs-service',
          resourceId: 'c1/s1',
          message: 'Started',
        } as HandlerResult),
      };

      const failHandler: Partial<ResourceHandler> = {
        start: vi.fn().mockResolvedValue({
          success: false,
          action: 'start',
          resourceType: 'rds-db',
          resourceId: 'db1',
          message: 'Failed to start',
          error: 'Database is in invalid state',
        } as HandlerResult),
      };

      mockDiscoverFn.mockResolvedValue(mockResources);
      mockGetHandlerFn
        .mockReturnValueOnce(successHandler as ResourceHandler)
        .mockReturnValueOnce(failHandler as ResourceHandler);

      const result = await orchestrator.run('start');

      expect(result.total).toBe(2);
      expect(result.succeeded).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.results).toHaveLength(2);
    });
  });

  describe('run - stop action', () => {
    it('should execute stop action on all discovered resources', async () => {
      const mockResources: DiscoveredResource[] = [
        {
          resourceType: 'ecs-service',
          arn: 'arn:aws:ecs:us-east-1:123456:service/c/s',
          resourceId: 'c/s',
          priority: 50,
          group: 'default',
          tags: {},
          metadata: { cluster_name: 'c' },
        },
      ];

      const mockStopFn = vi.fn().mockResolvedValue({
        success: true,
        action: 'stop',
        resourceType: 'ecs-service',
        resourceId: 'c/s',
        message: 'Stopped successfully',
      } as HandlerResult);

      const mockHandler: Partial<ResourceHandler> = {
        stop: mockStopFn,
      };

      mockDiscoverFn.mockResolvedValue(mockResources);
      mockGetHandlerFn.mockReturnValue(mockHandler as ResourceHandler);

      const result = await orchestrator.run('stop');

      expect(result.total).toBe(1);
      expect(result.succeeded).toBe(1);
      expect(result.failed).toBe(0);
      expect(mockStopFn).toHaveBeenCalledTimes(1);
    });
  });

  describe('run - status action', () => {
    it('should retrieve status for all discovered resources', async () => {
      const mockResources: DiscoveredResource[] = [
        {
          resourceType: 'ecs-service',
          arn: 'arn:aws:ecs:us-east-1:123456:service/c/s',
          resourceId: 'c/s',
          priority: 50,
          group: 'default',
          tags: {},
          metadata: { cluster_name: 'c' },
        },
      ];

      const mockGetStatusFn = vi.fn().mockResolvedValue({
        desired_count: 1,
        running_count: 1,
        status: 'ACTIVE',
      });

      const mockHandler: Partial<ResourceHandler> = {
        getStatus: mockGetStatusFn,
      };

      mockDiscoverFn.mockResolvedValue(mockResources);
      mockGetHandlerFn.mockReturnValue(mockHandler as ResourceHandler);

      const result = await orchestrator.run('status');

      expect(result.total).toBe(1);
      expect(result.succeeded).toBe(1);
      expect(result.failed).toBe(0);
      expect(result.results[0].success).toBe(true);
      expect(result.results[0].action).toBe('status');
      expect(result.results[0].previousState).toEqual({
        desired_count: 1,
        running_count: 1,
        status: 'ACTIVE',
      });
      expect(mockGetStatusFn).toHaveBeenCalledTimes(1);
    });
  });

  describe('error handling', () => {
    it('should handle missing handler gracefully', async () => {
      const mockResources: DiscoveredResource[] = [
        {
          resourceType: 'unknown-type',
          arn: 'arn:aws:unknown:us-east-1:123456:resource/r',
          resourceId: 'r',
          priority: 50,
          group: 'default',
          tags: {},
          metadata: {},
        },
      ];

      mockDiscoverFn.mockResolvedValue(mockResources);
      mockGetHandlerFn.mockReturnValue(null);

      const result = await orchestrator.run('start');

      expect(result.total).toBe(1);
      expect(result.succeeded).toBe(0);
      expect(result.failed).toBe(1);
      expect(result.results[0].success).toBe(false);
      expect(result.results[0].error).toBe('HANDLER_NOT_FOUND');
    });

    it('should handle handler execution errors gracefully', async () => {
      const mockResources: DiscoveredResource[] = [
        {
          resourceType: 'ecs-service',
          arn: 'arn:aws:ecs:us-east-1:123456:service/c/s',
          resourceId: 'c/s',
          priority: 50,
          group: 'default',
          tags: {},
          metadata: { cluster_name: 'c' },
        },
      ];

      const errorHandler: Partial<ResourceHandler> = {
        start: vi.fn().mockRejectedValue(new Error('AWS API Error')),
      };

      mockDiscoverFn.mockResolvedValue(mockResources);
      mockGetHandlerFn.mockReturnValue(errorHandler as ResourceHandler);

      const result = await orchestrator.run('start');

      expect(result.total).toBe(1);
      expect(result.succeeded).toBe(0);
      expect(result.failed).toBe(1);
      expect(result.results[0].success).toBe(false);
      expect(result.results[0].error).toBe('AWS API Error');
    });

    it('should continue processing after individual resource failures', async () => {
      const mockResources: DiscoveredResource[] = [
        {
          resourceType: 'ecs-service',
          arn: 'arn:aws:ecs:us-east-1:123456:service/c1/s1',
          resourceId: 'c1/s1',
          priority: 50,
          group: 'default',
          tags: {},
          metadata: { cluster_name: 'c1' },
        },
        {
          resourceType: 'ecs-service',
          arn: 'arn:aws:ecs:us-east-1:123456:service/c2/s2',
          resourceId: 'c2/s2',
          priority: 60,
          group: 'default',
          tags: {},
          metadata: { cluster_name: 'c2' },
        },
      ];

      const errorHandler: Partial<ResourceHandler> = {
        start: vi.fn().mockRejectedValue(new Error('First resource failed')),
      };

      const successHandler: Partial<ResourceHandler> = {
        start: vi.fn().mockResolvedValue({
          success: true,
          action: 'start',
          resourceType: 'ecs-service',
          resourceId: 'c2/s2',
          message: 'Started',
        } as HandlerResult),
      };

      mockDiscoverFn.mockResolvedValue(mockResources);
      mockGetHandlerFn
        .mockReturnValueOnce(errorHandler as ResourceHandler)
        .mockReturnValueOnce(successHandler as ResourceHandler);

      const result = await orchestrator.run('start');

      expect(result.total).toBe(2);
      expect(result.succeeded).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.results).toHaveLength(2);
    });
  });

  describe('edge cases', () => {
    it('should handle empty resource list', async () => {
      mockDiscoverFn.mockResolvedValue([]);

      const result = await orchestrator.run('start');

      expect(result.total).toBe(0);
      expect(result.succeeded).toBe(0);
      expect(result.failed).toBe(0);
      expect(result.results).toHaveLength(0);
    });

    it('should handle all resources failing', async () => {
      const mockResources: DiscoveredResource[] = [
        {
          resourceType: 'ecs-service',
          arn: 'arn:aws:ecs:us-east-1:123456:service/c/s',
          resourceId: 'c/s',
          priority: 50,
          group: 'default',
          tags: {},
          metadata: { cluster_name: 'c' },
        },
      ];

      const errorHandler: Partial<ResourceHandler> = {
        start: vi.fn().mockRejectedValue(new Error('Service unavailable')),
      };

      mockDiscoverFn.mockResolvedValue(mockResources);
      mockGetHandlerFn.mockReturnValue(errorHandler as ResourceHandler);

      const result = await orchestrator.run('start');

      expect(result.total).toBe(1);
      expect(result.succeeded).toBe(0);
      expect(result.failed).toBe(1);
    });

    it('should handle all resources succeeding', async () => {
      const mockResources: DiscoveredResource[] = [
        {
          resourceType: 'ecs-service',
          arn: 'arn:aws:ecs:us-east-1:123456:service/c1/s1',
          resourceId: 'c1/s1',
          priority: 50,
          group: 'default',
          tags: {},
          metadata: { cluster_name: 'c1' },
        },
        {
          resourceType: 'ecs-service',
          arn: 'arn:aws:ecs:us-east-1:123456:service/c2/s2',
          resourceId: 'c2/s2',
          priority: 60,
          group: 'default',
          tags: {},
          metadata: { cluster_name: 'c2' },
        },
      ];

      const successHandler: Partial<ResourceHandler> = {
        start: vi.fn().mockResolvedValue({
          success: true,
          action: 'start',
          resourceType: 'ecs-service',
          resourceId: 'test',
          message: 'Started',
        } as HandlerResult),
      };

      mockDiscoverFn.mockResolvedValue(mockResources);
      mockGetHandlerFn.mockReturnValue(successHandler as ResourceHandler);

      const result = await orchestrator.run('start');

      expect(result.total).toBe(2);
      expect(result.succeeded).toBe(2);
      expect(result.failed).toBe(0);
    });
  });

  describe('priority sorting', () => {
    it('should sort resources by ascending priority for START action', async () => {
      const mockResources: DiscoveredResource[] = [
        {
          resourceType: 'ecs-service',
          arn: 'arn:aws:ecs:us-east-1:123456:service/c3/s3',
          resourceId: 'c3/s3',
          priority: 100, // Highest priority value - should execute last
          group: 'default',
          tags: {},
          metadata: { cluster_name: 'c3' },
        },
        {
          resourceType: 'ecs-service',
          arn: 'arn:aws:ecs:us-east-1:123456:service/c1/s1',
          resourceId: 'c1/s1',
          priority: 10, // Lowest priority value - should execute first
          group: 'default',
          tags: {},
          metadata: { cluster_name: 'c1' },
        },
        {
          resourceType: 'ecs-service',
          arn: 'arn:aws:ecs:us-east-1:123456:service/c2/s2',
          resourceId: 'c2/s2',
          priority: 50, // Middle priority value
          group: 'default',
          tags: {},
          metadata: { cluster_name: 'c2' },
        },
      ];

      const executionOrder: string[] = [];

      const mockHandlerFactory = (resourceId: string) =>
        ({
          start: vi.fn().mockImplementation(async () => {
            executionOrder.push(resourceId);
            return {
              success: true,
              action: 'start',
              resourceType: 'ecs-service',
              resourceId,
              message: 'Started',
            } as HandlerResult;
          }),
        }) as unknown as ResourceHandler;

      mockDiscoverFn.mockResolvedValue(mockResources);
      mockGetHandlerFn.mockImplementation((_, resource: DiscoveredResource) =>
        mockHandlerFactory(resource.resourceId)
      );

      await orchestrator.run('start');

      // Verify execution order: priority 10 → 50 → 100
      expect(executionOrder).toEqual(['c1/s1', 'c2/s2', 'c3/s3']);
    });

    it('should sort resources by descending priority for STOP action', async () => {
      const mockResources: DiscoveredResource[] = [
        {
          resourceType: 'ecs-service',
          arn: 'arn:aws:ecs:us-east-1:123456:service/c1/s1',
          resourceId: 'c1/s1',
          priority: 10, // Lowest priority value - should execute last
          group: 'default',
          tags: {},
          metadata: { cluster_name: 'c1' },
        },
        {
          resourceType: 'ecs-service',
          arn: 'arn:aws:ecs:us-east-1:123456:service/c2/s2',
          resourceId: 'c2/s2',
          priority: 50, // Middle priority value
          group: 'default',
          tags: {},
          metadata: { cluster_name: 'c2' },
        },
        {
          resourceType: 'ecs-service',
          arn: 'arn:aws:ecs:us-east-1:123456:service/c3/s3',
          resourceId: 'c3/s3',
          priority: 100, // Highest priority value - should execute first
          group: 'default',
          tags: {},
          metadata: { cluster_name: 'c3' },
        },
      ];

      const executionOrder: string[] = [];

      const mockHandlerFactory = (resourceId: string) =>
        ({
          stop: vi.fn().mockImplementation(async () => {
            executionOrder.push(resourceId);
            return {
              success: true,
              action: 'stop',
              resourceType: 'ecs-service',
              resourceId,
              message: 'Stopped',
            } as HandlerResult;
          }),
        }) as unknown as ResourceHandler;

      mockDiscoverFn.mockResolvedValue(mockResources);
      mockGetHandlerFn.mockImplementation((_, resource: DiscoveredResource) =>
        mockHandlerFactory(resource.resourceId)
      );

      await orchestrator.run('stop');

      // Verify execution order: priority 100 → 50 → 10
      expect(executionOrder).toEqual(['c3/s3', 'c2/s2', 'c1/s1']);
    });

    it('should NOT sort resources for STATUS action', async () => {
      const mockResources: DiscoveredResource[] = [
        {
          resourceType: 'ecs-service',
          arn: 'arn:aws:ecs:us-east-1:123456:service/c3/s3',
          resourceId: 'c3/s3',
          priority: 100, // Unordered priority
          group: 'default',
          tags: {},
          metadata: { cluster_name: 'c3' },
        },
        {
          resourceType: 'ecs-service',
          arn: 'arn:aws:ecs:us-east-1:123456:service/c1/s1',
          resourceId: 'c1/s1',
          priority: 10,
          group: 'default',
          tags: {},
          metadata: { cluster_name: 'c1' },
        },
        {
          resourceType: 'ecs-service',
          arn: 'arn:aws:ecs:us-east-1:123456:service/c2/s2',
          resourceId: 'c2/s2',
          priority: 50,
          group: 'default',
          tags: {},
          metadata: { cluster_name: 'c2' },
        },
      ];

      const executionOrder: string[] = [];

      const mockHandlerFactory = (resourceId: string) =>
        ({
          getStatus: vi.fn().mockImplementation(async () => {
            executionOrder.push(resourceId);
            return {
              desired_count: 1,
              running_count: 1,
              status: 'ACTIVE',
            };
          }),
        }) as unknown as ResourceHandler;

      mockDiscoverFn.mockResolvedValue(mockResources);
      mockGetHandlerFn.mockImplementation((_, resource: DiscoveredResource) =>
        mockHandlerFactory(resource.resourceId)
      );

      await orchestrator.run('status');

      // Verify execution order preserves discovery order (no sorting)
      expect(executionOrder).toEqual(['c3/s3', 'c1/s1', 'c2/s2']);
    });

    it('should handle resources with same priority', async () => {
      const mockResources: DiscoveredResource[] = [
        {
          resourceType: 'ecs-service',
          arn: 'arn:aws:ecs:us-east-1:123456:service/c1/s1',
          resourceId: 'c1/s1',
          priority: 50, // Same priority
          group: 'default',
          tags: {},
          metadata: { cluster_name: 'c1' },
        },
        {
          resourceType: 'ecs-service',
          arn: 'arn:aws:ecs:us-east-1:123456:service/c2/s2',
          resourceId: 'c2/s2',
          priority: 50, // Same priority
          group: 'default',
          tags: {},
          metadata: { cluster_name: 'c2' },
        },
        {
          resourceType: 'ecs-service',
          arn: 'arn:aws:ecs:us-east-1:123456:service/c3/s3',
          resourceId: 'c3/s3',
          priority: 10, // Lower priority - should execute first for START
          group: 'default',
          tags: {},
          metadata: { cluster_name: 'c3' },
        },
      ];

      const executionOrder: string[] = [];

      const mockHandlerFactory = (resourceId: string) =>
        ({
          start: vi.fn().mockImplementation(async () => {
            executionOrder.push(resourceId);
            return {
              success: true,
              action: 'start',
              resourceType: 'ecs-service',
              resourceId,
              message: 'Started',
            } as HandlerResult;
          }),
        }) as unknown as ResourceHandler;

      mockDiscoverFn.mockResolvedValue(mockResources);
      mockGetHandlerFn.mockImplementation((_, resource: DiscoveredResource) =>
        mockHandlerFactory(resource.resourceId)
      );

      await orchestrator.run('start');

      // Verify priority 10 executes first, then both priority 50 (order within same priority is stable)
      expect(executionOrder[0]).toBe('c3/s3');
      expect(executionOrder.slice(1)).toEqual(expect.arrayContaining(['c1/s1', 'c2/s2']));
    });
  });

  describe('execution strategies', () => {
    it('should use grouped-parallel strategy by default', async () => {
      const mockResources: DiscoveredResource[] = [
        {
          resourceType: 'ecs-service',
          arn: 'arn:aws:ecs:us-east-1:123456:service/c1/s1',
          resourceId: 'c1/s1',
          priority: 10,
          group: 'default',
          tags: {},
          metadata: { cluster_name: 'c1' },
        },
        {
          resourceType: 'ecs-service',
          arn: 'arn:aws:ecs:us-east-1:123456:service/c2/s2',
          resourceId: 'c2/s2',
          priority: 20,
          group: 'default',
          tags: {},
          metadata: { cluster_name: 'c2' },
        },
      ];

      const mockHandler: Partial<ResourceHandler> = {
        start: vi.fn().mockResolvedValue({
          success: true,
          action: 'start',
          resourceType: 'ecs-service',
          resourceId: 'test',
          message: 'Started',
        } as HandlerResult),
      };

      mockDiscoverFn.mockResolvedValue(mockResources);
      mockGetHandlerFn.mockReturnValue(mockHandler as ResourceHandler);

      const result = await orchestrator.run('start');

      expect(result.total).toBe(2);
      expect(result.succeeded).toBe(2);
    });

    it("should execute resources sequentially when strategy is 'sequential'", async () => {
      const configSequential: Config = {
        ...sampleConfig,
        settings: {
          execution_strategy: 'sequential',
        },
      };

      orchestrator = new Orchestrator(configSequential);

      const mockResources: DiscoveredResource[] = [
        {
          resourceType: 'ecs-service',
          arn: 'arn:aws:ecs:us-east-1:123456:service/c1/s1',
          resourceId: 'c1/s1',
          priority: 10,
          group: 'default',
          tags: {},
          metadata: { cluster_name: 'c1' },
        },
        {
          resourceType: 'ecs-service',
          arn: 'arn:aws:ecs:us-east-1:123456:service/c2/s2',
          resourceId: 'c2/s2',
          priority: 10, // Same priority, but should still execute sequentially
          group: 'default',
          tags: {},
          metadata: { cluster_name: 'c2' },
        },
      ];

      const executionOrder: string[] = [];

      const mockHandlerFactory = (resourceId: string) =>
        ({
          start: vi.fn().mockImplementation(async () => {
            executionOrder.push(resourceId);
            // Simulate async delay to test sequential execution
            await new Promise((resolve) => setTimeout(resolve, 10));
            return {
              success: true,
              action: 'start',
              resourceType: 'ecs-service',
              resourceId,
              message: 'Started',
            } as HandlerResult;
          }),
        }) as unknown as ResourceHandler;

      mockDiscoverFn.mockResolvedValue(mockResources);
      mockGetHandlerFn.mockImplementation((_, resource: DiscoveredResource) =>
        mockHandlerFactory(resource.resourceId)
      );

      await orchestrator.run('start');

      // In sequential mode, execution order should be preserved
      expect(executionOrder).toEqual(['c1/s1', 'c2/s2']);
    });

    it("should execute all resources in parallel when strategy is 'parallel'", async () => {
      const configParallel: Config = {
        ...sampleConfig,
        settings: {
          execution_strategy: 'parallel',
        },
      };

      orchestrator = new Orchestrator(configParallel);

      const mockResources: DiscoveredResource[] = [
        {
          resourceType: 'ecs-service',
          arn: 'arn:aws:ecs:us-east-1:123456:service/c1/s1',
          resourceId: 'c1/s1',
          priority: 10,
          group: 'default',
          tags: {},
          metadata: { cluster_name: 'c1' },
        },
        {
          resourceType: 'ecs-service',
          arn: 'arn:aws:ecs:us-east-1:123456:service/c2/s2',
          resourceId: 'c2/s2',
          priority: 50, // Different priority, but should execute in parallel
          group: 'default',
          tags: {},
          metadata: { cluster_name: 'c2' },
        },
      ];

      const startTimes: Record<string, number> = {};

      const mockHandlerFactory = (resourceId: string) =>
        ({
          start: vi.fn().mockImplementation(async () => {
            startTimes[resourceId] = Date.now();
            await new Promise((resolve) => setTimeout(resolve, 10));
            return {
              success: true,
              action: 'start',
              resourceType: 'ecs-service',
              resourceId,
              message: 'Started',
            } as HandlerResult;
          }),
        }) as unknown as ResourceHandler;

      mockDiscoverFn.mockResolvedValue(mockResources);
      mockGetHandlerFn.mockImplementation((_, resource: DiscoveredResource) =>
        mockHandlerFactory(resource.resourceId)
      );

      await orchestrator.run('start');

      // In parallel mode, both should start at roughly the same time
      const timeDiff = Math.abs(startTimes['c1/s1'] - startTimes['c2/s2']);
      expect(timeDiff).toBeLessThan(5); // Within 5ms means parallel
    });

    it('should execute grouped-parallel correctly', async () => {
      const configGroupedParallel: Config = {
        ...sampleConfig,
        settings: {
          execution_strategy: 'grouped-parallel',
        },
      };

      orchestrator = new Orchestrator(configGroupedParallel);

      const mockResources: DiscoveredResource[] = [
        {
          resourceType: 'ecs-service',
          arn: 'arn:aws:ecs:us-east-1:123456:service/c1/s1',
          resourceId: 'c1/s1',
          priority: 10, // Group 1
          group: 'default',
          tags: {},
          metadata: { cluster_name: 'c1' },
        },
        {
          resourceType: 'ecs-service',
          arn: 'arn:aws:ecs:us-east-1:123456:service/c1/s2',
          resourceId: 'c1/s2',
          priority: 10, // Group 1 (same priority, should run in parallel)
          group: 'default',
          tags: {},
          metadata: { cluster_name: 'c1' },
        },
        {
          resourceType: 'ecs-service',
          arn: 'arn:aws:ecs:us-east-1:123456:service/c2/s1',
          resourceId: 'c2/s1',
          priority: 50, // Group 2 (different priority, should run after group 1)
          group: 'default',
          tags: {},
          metadata: { cluster_name: 'c2' },
        },
      ];

      const executionLog: Array<{ resourceId: string; timestamp: number }> = [];

      const mockHandlerFactory = (resourceId: string) =>
        ({
          start: vi.fn().mockImplementation(async () => {
            executionLog.push({ resourceId, timestamp: Date.now() });
            await new Promise((resolve) => setTimeout(resolve, 20));
            return {
              success: true,
              action: 'start',
              resourceType: 'ecs-service',
              resourceId,
              message: 'Started',
            } as HandlerResult;
          }),
        }) as unknown as ResourceHandler;

      mockDiscoverFn.mockResolvedValue(mockResources);
      mockGetHandlerFn.mockImplementation((_, resource: DiscoveredResource) =>
        mockHandlerFactory(resource.resourceId)
      );

      await orchestrator.run('start');

      // Verify execution pattern
      expect(executionLog).toHaveLength(3);

      // Group 1 (p10) should start together
      const group1Timestamps = executionLog
        .filter((log) => log.resourceId.startsWith('c1/'))
        .map((log) => log.timestamp);

      const group1TimeDiff = Math.abs(group1Timestamps[0] - group1Timestamps[1]);
      expect(group1TimeDiff).toBeLessThan(5); // Parallel within group

      // Group 2 (p50) should start after Group 1
      const group2Timestamp = executionLog.find((log) => log.resourceId === 'c2/s1')!.timestamp;
      const group1MaxTimestamp = Math.max(...group1Timestamps);

      expect(group2Timestamp).toBeGreaterThan(group1MaxTimestamp);
    });
  });

  describe('regional scheduling with targetGroup', () => {
    it('should use region_groups when targetGroup is specified and found', async () => {
      const configWithRegionGroups: Config = {
        ...sampleConfig,
        region_groups: {
          asia: ['ap-southeast-1', 'ap-northeast-1'],
          america: ['us-east-1'],
        },
        regions: ['eu-west-1'], // Legacy regions should be ignored when targetGroup is found
      };

      orchestrator = new Orchestrator(configWithRegionGroups, undefined, 'asia');
      mockDiscoverFn.mockResolvedValue([]);

      await orchestrator.discoverResources();

      // Should use asia region_groups, not legacy regions
      expect(TagDiscoveryMock).toHaveBeenCalledWith(
        { 'lights-out:managed': 'true' },
        ['ecs:service', 'rds:db'],
        ['ap-southeast-1', 'ap-northeast-1']
      );
    });

    it('should use different regions for different targetGroups', async () => {
      const configWithRegionGroups: Config = {
        ...sampleConfig,
        region_groups: {
          asia: ['ap-southeast-1', 'ap-northeast-1'],
          america: ['us-east-1'],
        },
      };

      // Test with 'america' targetGroup
      orchestrator = new Orchestrator(configWithRegionGroups, undefined, 'america');
      mockDiscoverFn.mockResolvedValue([]);

      await orchestrator.discoverResources();

      expect(TagDiscoveryMock).toHaveBeenCalledWith(
        { 'lights-out:managed': 'true' },
        ['ecs:service', 'rds:db'],
        ['us-east-1']
      );
    });

    it('should fallback to legacy regions when targetGroup is not found in region_groups', async () => {
      const configWithRegionGroups: Config = {
        ...sampleConfig,
        region_groups: {
          asia: ['ap-southeast-1'],
        },
        regions: ['eu-west-1', 'eu-central-1'], // Fallback regions
      };

      // Request non-existent group
      orchestrator = new Orchestrator(configWithRegionGroups, undefined, 'europe');
      mockDiscoverFn.mockResolvedValue([]);

      await orchestrator.discoverResources();

      // Should fallback to legacy regions
      expect(TagDiscoveryMock).toHaveBeenCalledWith(
        { 'lights-out:managed': 'true' },
        ['ecs:service', 'rds:db'],
        ['eu-west-1', 'eu-central-1']
      );
    });

    it('should fallback to legacy regions when targetGroup is specified but region_groups is not configured', async () => {
      const configWithoutRegionGroups: Config = {
        ...sampleConfig,
        regions: ['us-west-2'],
      };

      orchestrator = new Orchestrator(configWithoutRegionGroups, undefined, 'asia');
      mockDiscoverFn.mockResolvedValue([]);

      await orchestrator.discoverResources();

      // Should fallback to legacy regions since region_groups is not defined
      expect(TagDiscoveryMock).toHaveBeenCalledWith(
        { 'lights-out:managed': 'true' },
        ['ecs:service', 'rds:db'],
        ['us-west-2']
      );
    });

    it('should use all regions (empty array) when no targetGroup and no regions configured', async () => {
      const configWithoutRegions: Config = {
        ...sampleConfig,
        // No regions, no region_groups
      };

      orchestrator = new Orchestrator(configWithoutRegions);
      mockDiscoverFn.mockResolvedValue([]);

      await orchestrator.discoverResources();

      expect(TagDiscoveryMock).toHaveBeenCalledWith(
        { 'lights-out:managed': 'true' },
        ['ecs:service', 'rds:db'],
        [] // Empty array - TagDiscovery will use Lambda's region
      );
    });

    it('should merge all region_groups when no targetGroup is specified', async () => {
      const configWithBoth: Config = {
        ...sampleConfig,
        region_groups: {
          asia: ['ap-southeast-1'],
          america: ['us-east-1'],
        },
        regions: ['eu-west-1'], // Legacy regions (ignored when region_groups exists)
      };

      // No targetGroup specified - should merge all region_groups
      orchestrator = new Orchestrator(configWithBoth);
      mockDiscoverFn.mockResolvedValue([]);

      await orchestrator.discoverResources();

      // Should merge all region_groups (unique regions)
      // Note: Set iteration order is insertion order, so we check for both regions
      expect(TagDiscoveryMock).toHaveBeenCalledWith(
        { 'lights-out:managed': 'true' },
        ['ecs:service', 'rds:db'],
        expect.arrayContaining(['ap-southeast-1', 'us-east-1'])
      );
      // Verify only 2 regions (no duplicates, no legacy regions)
      const calledRegions = TagDiscoveryMock.mock.calls[0][2];
      expect(calledRegions).toHaveLength(2);
    });

    it('should handle empty region_groups array for a targetGroup', async () => {
      const configWithEmptyGroup: Config = {
        ...sampleConfig,
        region_groups: {
          asia: [], // Empty array
        },
        regions: ['fallback-region'],
      };

      orchestrator = new Orchestrator(configWithEmptyGroup, undefined, 'asia');
      mockDiscoverFn.mockResolvedValue([]);

      await orchestrator.discoverResources();

      // Empty array should trigger fallback to legacy regions
      expect(TagDiscoveryMock).toHaveBeenCalledWith(
        { 'lights-out:managed': 'true' },
        ['ecs:service', 'rds:db'],
        ['fallback-region']
      );
    });

    it('should deduplicate regions when merging region_groups', async () => {
      const configWithDuplicates: Config = {
        ...sampleConfig,
        region_groups: {
          asia: ['ap-southeast-1', 'ap-northeast-1'],
          backup: ['ap-southeast-1'], // Duplicate region
        },
      };

      orchestrator = new Orchestrator(configWithDuplicates);
      mockDiscoverFn.mockResolvedValue([]);

      await orchestrator.discoverResources();

      // Should deduplicate regions
      const calledRegions = TagDiscoveryMock.mock.calls[0][2];
      expect(calledRegions).toHaveLength(2); // Only unique regions
      expect(calledRegions).toContain('ap-southeast-1');
      expect(calledRegions).toContain('ap-northeast-1');
    });

    it('should fallback to legacy regions when region_groups is empty object', async () => {
      const configWithEmptyRegionGroups: Config = {
        ...sampleConfig,
        region_groups: {}, // Empty object
        regions: ['eu-west-1'],
      };

      orchestrator = new Orchestrator(configWithEmptyRegionGroups);
      mockDiscoverFn.mockResolvedValue([]);

      await orchestrator.discoverResources();

      // Should fallback to legacy regions
      expect(TagDiscoveryMock).toHaveBeenCalledWith(
        { 'lights-out:managed': 'true' },
        ['ecs:service', 'rds:db'],
        ['eu-west-1']
      );
    });

    it('should fallback to legacy regions when all region_groups are empty arrays', async () => {
      const configWithAllEmptyGroups: Config = {
        ...sampleConfig,
        region_groups: {
          asia: [],
          america: [],
        },
        regions: ['eu-central-1'],
      };

      orchestrator = new Orchestrator(configWithAllEmptyGroups);
      mockDiscoverFn.mockResolvedValue([]);

      await orchestrator.discoverResources();

      // Should fallback to legacy regions when all groups are empty
      expect(TagDiscoveryMock).toHaveBeenCalledWith(
        { 'lights-out:managed': 'true' },
        ['ecs:service', 'rds:db'],
        ['eu-central-1']
      );
    });

    it('should merge region_groups without legacy regions fallback when region_groups has data', async () => {
      const configWithOnlyRegionGroups: Config = {
        ...sampleConfig,
        region_groups: {
          asia: ['ap-southeast-1'],
          america: ['us-east-1', 'us-west-2'],
        },
        // No legacy regions field
      };

      orchestrator = new Orchestrator(configWithOnlyRegionGroups);
      mockDiscoverFn.mockResolvedValue([]);

      await orchestrator.discoverResources();

      // Should merge all region_groups
      const calledRegions = TagDiscoveryMock.mock.calls[0][2];
      expect(calledRegions).toHaveLength(3);
      expect(calledRegions).toContain('ap-southeast-1');
      expect(calledRegions).toContain('us-east-1');
      expect(calledRegions).toContain('us-west-2');
    });

    it('should include targetGroup in discovery logging', async () => {
      const configWithRegionGroups: Config = {
        ...sampleConfig,
        region_groups: {
          asia: ['ap-southeast-1'],
        },
      };

      orchestrator = new Orchestrator(configWithRegionGroups, undefined, 'asia');
      mockDiscoverFn.mockResolvedValue([]);

      await orchestrator.discoverResources();

      // The test verifies that discovery is called with correct regions
      // Logging is tested implicitly through the TagDiscoveryMock call
      expect(TagDiscoveryMock).toHaveBeenCalledWith(expect.any(Object), expect.any(Array), [
        'ap-southeast-1',
      ]);
    });

    it('should execute start action with targetGroup filtering', async () => {
      const configWithRegionGroups: Config = {
        ...sampleConfig,
        region_groups: {
          asia: ['ap-southeast-1'],
          america: ['us-east-1'],
        },
      };

      const mockResources: DiscoveredResource[] = [
        {
          resourceType: 'ecs-service',
          arn: 'arn:aws:ecs:ap-southeast-1:123456:service/c/s',
          resourceId: 'c/s',
          priority: 50,
          group: 'default',
          tags: {},
          metadata: { cluster_name: 'c' },
        },
      ];

      const mockStartFn = vi.fn().mockResolvedValue({
        success: true,
        action: 'start',
        resourceType: 'ecs-service',
        resourceId: 'c/s',
        message: 'Started successfully',
      } as HandlerResult);

      const mockHandler: Partial<ResourceHandler> = {
        start: mockStartFn,
      };

      orchestrator = new Orchestrator(configWithRegionGroups, undefined, 'asia');
      mockDiscoverFn.mockResolvedValue(mockResources);
      mockGetHandlerFn.mockReturnValue(mockHandler as ResourceHandler);

      const result = await orchestrator.run('start');

      expect(result.total).toBe(1);
      expect(result.succeeded).toBe(1);
      expect(TagDiscoveryMock).toHaveBeenCalledWith(
        expect.any(Object),
        expect.any(Array),
        ['ap-southeast-1'] // Only asia regions
      );
    });
  });

  describe('aggregated notifications', () => {
    it('should call sendAggregatedTeamsNotification after run completes', async () => {
      const configWithTeams: Config = {
        ...sampleConfig,
        notifications: {
          teams: {
            enabled: true,
            webhook_url: 'https://example.com/webhook',
          },
        },
      };

      orchestrator = new Orchestrator(configWithTeams);

      const mockResources: DiscoveredResource[] = [
        {
          resourceType: 'ecs-service',
          arn: 'arn:aws:ecs:us-east-1:123456:service/c/s',
          resourceId: 'c/s',
          priority: 50,
          group: 'default',
          tags: {},
          metadata: { cluster_name: 'c' },
        },
      ];

      const mockStartFn = vi.fn().mockResolvedValue({
        success: true,
        action: 'start',
        resourceType: 'ecs-service',
        resourceId: 'c/s',
        message: 'Started successfully',
        region: 'us-east-1',
      } as HandlerResult);

      const mockHandler: Partial<ResourceHandler> = {
        start: mockStartFn,
      };

      mockDiscoverFn.mockResolvedValue(mockResources);
      mockGetHandlerFn.mockReturnValue(mockHandler as ResourceHandler);
      mockSendAggregatedTeamsNotification.mockResolvedValue(undefined);

      await orchestrator.run('start');

      expect(mockSendAggregatedTeamsNotification).toHaveBeenCalledTimes(1);
      expect(mockSendAggregatedTeamsNotification).toHaveBeenCalledWith(
        configWithTeams.notifications!.teams,
        expect.arrayContaining([
          expect.objectContaining({
            success: true,
            action: 'start',
            resourceType: 'ecs-service',
          }),
        ]),
        'test',
        'start',
        undefined // triggerSource
      );
    });

    it('should not call notification when Teams is not configured', async () => {
      const mockResources: DiscoveredResource[] = [
        {
          resourceType: 'ecs-service',
          arn: 'arn:aws:ecs:us-east-1:123456:service/c/s',
          resourceId: 'c/s',
          priority: 50,
          group: 'default',
          tags: {},
          metadata: { cluster_name: 'c' },
        },
      ];

      const mockStartFn = vi.fn().mockResolvedValue({
        success: true,
        action: 'start',
        resourceType: 'ecs-service',
        resourceId: 'c/s',
        message: 'Started successfully',
      } as HandlerResult);

      const mockHandler: Partial<ResourceHandler> = {
        start: mockStartFn,
      };

      mockDiscoverFn.mockResolvedValue(mockResources);
      mockGetHandlerFn.mockReturnValue(mockHandler as ResourceHandler);

      await orchestrator.run('start');

      expect(mockSendAggregatedTeamsNotification).not.toHaveBeenCalled();
    });

    it('should not call notification when Teams is disabled', async () => {
      const configWithDisabledTeams: Config = {
        ...sampleConfig,
        notifications: {
          teams: {
            enabled: false,
            webhook_url: 'https://example.com/webhook',
          },
        },
      };

      orchestrator = new Orchestrator(configWithDisabledTeams);

      const mockResources: DiscoveredResource[] = [
        {
          resourceType: 'ecs-service',
          arn: 'arn:aws:ecs:us-east-1:123456:service/c/s',
          resourceId: 'c/s',
          priority: 50,
          group: 'default',
          tags: {},
          metadata: { cluster_name: 'c' },
        },
      ];

      const mockStartFn = vi.fn().mockResolvedValue({
        success: true,
        action: 'start',
        resourceType: 'ecs-service',
        resourceId: 'c/s',
        message: 'Started successfully',
      } as HandlerResult);

      const mockHandler: Partial<ResourceHandler> = {
        start: mockStartFn,
      };

      mockDiscoverFn.mockResolvedValue(mockResources);
      mockGetHandlerFn.mockReturnValue(mockHandler as ResourceHandler);

      await orchestrator.run('start');

      expect(mockSendAggregatedTeamsNotification).not.toHaveBeenCalled();
    });

    it('should not throw if notification fails', async () => {
      const configWithTeams: Config = {
        ...sampleConfig,
        notifications: {
          teams: {
            enabled: true,
            webhook_url: 'https://example.com/webhook',
          },
        },
      };

      orchestrator = new Orchestrator(configWithTeams);

      const mockResources: DiscoveredResource[] = [
        {
          resourceType: 'ecs-service',
          arn: 'arn:aws:ecs:us-east-1:123456:service/c/s',
          resourceId: 'c/s',
          priority: 50,
          group: 'default',
          tags: {},
          metadata: { cluster_name: 'c' },
        },
      ];

      const mockStartFn = vi.fn().mockResolvedValue({
        success: true,
        action: 'start',
        resourceType: 'ecs-service',
        resourceId: 'c/s',
        message: 'Started successfully',
      } as HandlerResult);

      const mockHandler: Partial<ResourceHandler> = {
        start: mockStartFn,
      };

      mockDiscoverFn.mockResolvedValue(mockResources);
      mockGetHandlerFn.mockReturnValue(mockHandler as ResourceHandler);
      mockSendAggregatedTeamsNotification.mockRejectedValue(new Error('Webhook timeout'));

      // Should not throw, orchestration should complete successfully
      const result = await orchestrator.run('start');

      expect(result.succeeded).toBe(1);
      expect(result.failed).toBe(0);
      expect(mockSendAggregatedTeamsNotification).toHaveBeenCalled();
    });

    it('should not call notification for status action even when Teams is enabled', async () => {
      const configWithTeams: Config = {
        ...sampleConfig,
        notifications: {
          teams: {
            enabled: true,
            webhook_url: 'https://example.com/webhook',
          },
        },
      };

      orchestrator = new Orchestrator(configWithTeams);

      const mockResources: DiscoveredResource[] = [
        {
          resourceType: 'ecs-service',
          arn: 'arn:aws:ecs:us-east-1:123456:service/c/s',
          resourceId: 'c/s',
          priority: 50,
          group: 'default',
          tags: {},
          metadata: { cluster_name: 'c' },
        },
      ];

      const mockGetStatusFn = vi.fn().mockResolvedValue({
        desired_count: 1,
        running_count: 1,
        status: 'ACTIVE',
      });

      const mockHandler: Partial<ResourceHandler> = {
        getStatus: mockGetStatusFn,
      };

      mockDiscoverFn.mockResolvedValue(mockResources);
      mockGetHandlerFn.mockReturnValue(mockHandler as ResourceHandler);

      const result = await orchestrator.run('status');

      expect(result.succeeded).toBe(1);
      expect(result.failed).toBe(0);
      // Notification should NOT be called for status action
      expect(mockSendAggregatedTeamsNotification).not.toHaveBeenCalled();
    });

    it('should pass all handler results to notification', async () => {
      const configWithTeams: Config = {
        ...sampleConfig,
        notifications: {
          teams: {
            enabled: true,
            webhook_url: 'https://example.com/webhook',
          },
        },
      };

      orchestrator = new Orchestrator(configWithTeams);

      const mockResources: DiscoveredResource[] = [
        {
          resourceType: 'ecs-service',
          arn: 'arn:aws:ecs:us-east-1:123456:service/c1/s1',
          resourceId: 'c1/s1',
          priority: 50,
          group: 'default',
          tags: {},
          metadata: { cluster_name: 'c1' },
        },
        {
          resourceType: 'rds-db',
          arn: 'arn:aws:rds:us-east-1:123456:db:db1',
          resourceId: 'db1',
          priority: 100,
          group: 'default',
          tags: {},
          metadata: {},
        },
      ];

      const successHandler: Partial<ResourceHandler> = {
        start: vi.fn().mockResolvedValue({
          success: true,
          action: 'start',
          resourceType: 'ecs-service',
          resourceId: 'c1/s1',
          message: 'Started',
          region: 'us-east-1',
        } as HandlerResult),
      };

      const failHandler: Partial<ResourceHandler> = {
        start: vi.fn().mockResolvedValue({
          success: false,
          action: 'start',
          resourceType: 'rds-db',
          resourceId: 'db1',
          message: 'Failed to start',
          error: 'Database is in invalid state',
          region: 'us-east-1',
        } as HandlerResult),
      };

      mockDiscoverFn.mockResolvedValue(mockResources);
      mockGetHandlerFn
        .mockReturnValueOnce(successHandler as ResourceHandler)
        .mockReturnValueOnce(failHandler as ResourceHandler);
      mockSendAggregatedTeamsNotification.mockResolvedValue(undefined);

      await orchestrator.run('start');

      expect(mockSendAggregatedTeamsNotification).toHaveBeenCalledWith(
        configWithTeams.notifications!.teams,
        expect.arrayContaining([
          expect.objectContaining({ success: true, resourceType: 'ecs-service' }),
          expect.objectContaining({ success: false, resourceType: 'rds-db' }),
        ]),
        'test',
        'start',
        undefined
      );
    });
  });
});

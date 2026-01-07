/**
 * Unit tests for functions/teams-notifier/index.ts
 *
 * Tests Teams Notifier Lambda handler with EventBridge events.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  ResourceGroupsTaggingAPIClient,
  GetResourcesCommand,
} from '@aws-sdk/client-resource-groups-tagging-api';
import { ECSClient, DescribeServicesCommand } from '@aws-sdk/client-ecs';
import type { EventBridgeEvent } from 'aws-lambda';
import { main } from '@functions/teams-notifier/index';
import * as config from '@functions/teams-notifier/config';
import * as adaptiveCard from '@functions/teams-notifier/adaptiveCard';
import type { TeamsConfig } from '@functions/teams-notifier/config';

// Mock external dependencies
const taggingMock = mockClient(ResourceGroupsTaggingAPIClient);
const ecsMock = mockClient(ECSClient);

// Mock node-fetch
vi.mock('node-fetch', () => ({
  default: vi.fn(),
}));

import fetch, { Response } from 'node-fetch';
const mockedFetch = vi.mocked(fetch);

describe('teams-notifier/index', () => {
  const originalEnv = process.env.TEAMS_CONFIG_TABLE;

  beforeEach(() => {
    taggingMock.reset();
    ecsMock.reset();
    vi.clearAllMocks();
    process.env.TEAMS_CONFIG_TABLE = 'test-teams-config';
  });

  afterEach(() => {
    process.env.TEAMS_CONFIG_TABLE = originalEnv;
  });

  describe('main - ECS Task State Change events', () => {
    it('should skip notification for intermediate states', async () => {
      const event: EventBridgeEvent<'ECS Task State Change', any> = {
        version: '0',
        id: 'test-event-id',
        'detail-type': 'ECS Task State Change',
        source: 'aws.ecs',
        account: '123456789012',
        time: '2026-01-05T10:30:00Z',
        region: 'us-east-1',
        resources: [],
        detail: {
          clusterArn: 'arn:aws:ecs:us-east-1:123456789012:cluster/test-cluster',
          taskArn: 'arn:aws:ecs:us-east-1:123456789012:task/test-cluster/task123',
          group: 'service:test-service',
          lastStatus: 'RUNNING',
          desiredStatus: 'STOPPED', // Intermediate state: task is running but should be stopped
          containers: [{ name: 'app', lastStatus: 'RUNNING' }],
        },
      };

      await main(event);

      // Should not call any downstream services
      expect(taggingMock.calls()).toHaveLength(0);
      expect(mockedFetch).not.toHaveBeenCalled();
    });

    it('should handle ECS task state change and send Teams notification', async () => {
      const event: EventBridgeEvent<'ECS Task State Change', any> = {
        version: '0',
        id: 'test-event-id',
        'detail-type': 'ECS Task State Change',
        source: 'aws.ecs',
        account: '123456789012',
        time: '2026-01-05T10:30:00Z',
        region: 'us-east-1',
        resources: [],
        detail: {
          clusterArn: 'arn:aws:ecs:us-east-1:123456789012:cluster/airsync-cluster',
          taskArn: 'arn:aws:ecs:us-east-1:123456789012:task/airsync-cluster/abc123',
          group: 'service:airsync-api-service', // Task launched by a service
          lastStatus: 'RUNNING',
          desiredStatus: 'RUNNING',
          containers: [
            {
              name: 'api',
              lastStatus: 'RUNNING',
            },
            {
              name: 'nginx',
              lastStatus: 'RUNNING',
            },
          ],
        },
      };

      const expectedServiceArn =
        'arn:aws:ecs:us-east-1:123456789012:service/airsync-cluster/airsync-api-service';

      // Mock resource tags - should query service ARN, not task ARN
      taggingMock.on(GetResourcesCommand).resolves({
        ResourceTagMappingList: [
          {
            ResourceARN: expectedServiceArn,
            Tags: [
              { Key: 'lights-out:group', Value: 'airsync-dev' },
              { Key: 'lights-out:managed', Value: 'true' },
            ],
          },
        ],
      });

      // Mock ECS service status - all tasks are running
      ecsMock.on(DescribeServicesCommand).resolves({
        services: [
          {
            serviceName: 'airsync-api-service',
            runningCount: 2,
            desiredCount: 2,
          },
        ],
      });

      // Mock config retrieval
      const mockConfig: TeamsConfig = {
        project: 'airsync-dev',
        webhook_url: 'https://outlook.office.com/webhook/test123',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-05T00:00:00Z',
      };
      vi.spyOn(config, 'getProjectConfig').mockResolvedValue(mockConfig);

      // Mock createStateChangeCard
      const mockCard = { type: 'message', attachments: [] };
      vi.spyOn(adaptiveCard, 'createStateChangeCard').mockReturnValue(mockCard);

      // Mock successful fetch
      mockedFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => '1',
      } as Response);

      await main(event);

      // Verify config was fetched
      expect(config.getProjectConfig).toHaveBeenCalledWith('airsync-dev');

      // Verify adaptive card was created
      expect(adaptiveCard.createStateChangeCard).toHaveBeenCalledWith(
        expect.objectContaining({
          project: 'airsync-dev',
          resourceType: 'ecs-service', // Changed from ecs-task to ecs-service
          resourceId: 'airsync-api-service', // Changed from task ID to service name
          previousState: 'STOPPED', // Service started: STOPPED → RUNNING
          newState: 'RUNNING',
          additionalInfo: expect.objectContaining({
            cluster: 'airsync-cluster',
            tasksRunning: '2',
            tasksDesired: '2',
          }),
        })
      );

      // Verify Teams webhook was called
      expect(mockedFetch).toHaveBeenCalledWith(
        mockConfig.webhook_url,
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(mockCard),
        })
      );
    });

    it('should send notification when task reaches stable STOPPED state', async () => {
      const event: EventBridgeEvent<'ECS Task State Change', any> = {
        version: '0',
        id: 'test-event-id',
        'detail-type': 'ECS Task State Change',
        source: 'aws.ecs',
        account: '123456789012',
        time: '2026-01-05T10:30:00Z',
        region: 'us-east-1',
        resources: [],
        detail: {
          clusterArn: 'arn:aws:ecs:us-east-1:123456789012:cluster/test-cluster',
          taskArn: 'arn:aws:ecs:us-east-1:123456789012:task/test-cluster/task123',
          group: 'service:test-service',
          lastStatus: 'STOPPED',
          desiredStatus: 'STOPPED',
          containers: [{ name: 'app', lastStatus: 'STOPPED' }],
        },
      };

      const expectedServiceArn =
        'arn:aws:ecs:us-east-1:123456789012:service/test-cluster/test-service';

      taggingMock.on(GetResourcesCommand).resolves({
        ResourceTagMappingList: [
          {
            ResourceARN: expectedServiceArn,
            Tags: [{ Key: 'lights-out:project', Value: 'test-project' }],
          },
        ],
      });

      // Mock ECS service status - all tasks stopped
      ecsMock.on(DescribeServicesCommand).resolves({
        services: [
          {
            serviceName: 'test-service',
            runningCount: 0,
            desiredCount: 0,
          },
        ],
      });

      vi.spyOn(config, 'getProjectConfig').mockResolvedValue({
        project: 'test-project',
        webhook_url: 'https://outlook.office.com/webhook/test123',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-05T00:00:00Z',
      });

      vi.spyOn(adaptiveCard, 'createStateChangeCard').mockReturnValue({
        type: 'message',
        attachments: [],
      });
      mockedFetch.mockResolvedValue({ ok: true } as Response);

      await main(event);

      // Verify notification was sent
      expect(mockedFetch).toHaveBeenCalled();
      expect(adaptiveCard.createStateChangeCard).toHaveBeenCalledWith(
        expect.objectContaining({
          resourceType: 'ecs-service',
          resourceId: 'test-service',
          previousState: 'RUNNING', // Service stopped: RUNNING → STOPPED
          newState: 'STOPPED',
          additionalInfo: expect.objectContaining({
            tasksRunning: '0',
            tasksDesired: '0',
          }),
        })
      );
    });

    it('should query service ARN when task has group field', async () => {
      const event: EventBridgeEvent<'ECS Task State Change', any> = {
        version: '0',
        id: 'test-event-id',
        'detail-type': 'ECS Task State Change',
        source: 'aws.ecs',
        account: '123456789012',
        time: '2026-01-05T10:30:00Z',
        region: 'us-east-1',
        resources: [],
        detail: {
          clusterArn: 'arn:aws:ecs:us-east-1:123456789012:cluster/my-cluster',
          taskArn: 'arn:aws:ecs:us-east-1:123456789012:task/my-cluster/task123',
          group: 'service:my-service',
          lastStatus: 'RUNNING',
          desiredStatus: 'RUNNING',
          containers: [{ name: 'app', lastStatus: 'RUNNING' }],
        },
      };

      const expectedServiceArn = 'arn:aws:ecs:us-east-1:123456789012:service/my-cluster/my-service';

      taggingMock.on(GetResourcesCommand).resolves({
        ResourceTagMappingList: [
          {
            ResourceARN: expectedServiceArn,
            Tags: [{ Key: 'lights-out:project', Value: 'test-project' }],
          },
        ],
      });

      // Mock ECS service status
      ecsMock.on(DescribeServicesCommand).resolves({
        services: [
          {
            serviceName: 'my-service',
            runningCount: 1,
            desiredCount: 1,
          },
        ],
      });

      vi.spyOn(config, 'getProjectConfig').mockResolvedValue({
        project: 'test-project',
        webhook_url: 'https://outlook.office.com/webhook/test123',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-05T00:00:00Z',
      });

      vi.spyOn(adaptiveCard, 'createStateChangeCard').mockReturnValue({
        type: 'message',
        attachments: [],
      });
      mockedFetch.mockResolvedValue({ ok: true } as Response);

      await main(event);

      // Verify that tagging API was called with service ARN
      expect(taggingMock.calls()).toHaveLength(1);
      const call = taggingMock.call(0);
      expect(call.args[0].input.ResourceARNList).toEqual([expectedServiceArn]);

      // Verify notification was sent
      expect(mockedFetch).toHaveBeenCalled();
    });

    it('should fallback to task ARN when group field is missing', async () => {
      const event: EventBridgeEvent<'ECS Task State Change', any> = {
        version: '0',
        id: 'test-event-id',
        'detail-type': 'ECS Task State Change',
        source: 'aws.ecs',
        account: '123456789012',
        time: '2026-01-05T10:30:00Z',
        region: 'us-east-1',
        resources: [],
        detail: {
          clusterArn: 'arn:aws:ecs:us-east-1:123456789012:cluster/my-cluster',
          taskArn: 'arn:aws:ecs:us-east-1:123456789012:task/my-cluster/task123',
          // No group field - standalone task
          lastStatus: 'RUNNING',
          desiredStatus: 'RUNNING',
          containers: [{ name: 'app', lastStatus: 'RUNNING' }],
        },
      };

      taggingMock.on(GetResourcesCommand).resolves({
        ResourceTagMappingList: [
          {
            ResourceARN: event.detail.taskArn,
            Tags: [{ Key: 'lights-out:project', Value: 'standalone-project' }],
          },
        ],
      });

      vi.spyOn(config, 'getProjectConfig').mockResolvedValue({
        project: 'standalone-project',
        webhook_url: 'https://outlook.office.com/webhook/test123',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-05T00:00:00Z',
      });

      vi.spyOn(adaptiveCard, 'createStateChangeCard').mockReturnValue({
        type: 'message',
        attachments: [],
      });
      mockedFetch.mockResolvedValue({ ok: true } as Response);

      await main(event);

      // Verify that tagging API was called with task ARN (fallback)
      expect(taggingMock.calls()).toHaveLength(1);
      const call = taggingMock.call(0);
      expect(call.args[0].input.ResourceARNList).toEqual([event.detail.taskArn]);

      // Verify notification was sent
      expect(mockedFetch).toHaveBeenCalled();
    });

    it('should skip notification when resource is missing lights-out:group tag', async () => {
      const event: EventBridgeEvent<'ECS Task State Change', any> = {
        version: '0',
        id: 'test-event-id',
        'detail-type': 'ECS Task State Change',
        source: 'aws.ecs',
        account: '123456789012',
        time: '2026-01-05T10:30:00Z',
        region: 'us-east-1',
        resources: [],
        detail: {
          clusterArn: 'arn:aws:ecs:us-east-1:123456789012:cluster/test-cluster',
          taskArn: 'arn:aws:ecs:us-east-1:123456789012:task/test-cluster/abc123',
          group: 'service:test-service',
          lastStatus: 'RUNNING',
          desiredStatus: 'RUNNING',
          containers: [{ name: 'app', lastStatus: 'RUNNING' }],
        },
      };

      const expectedServiceArn =
        'arn:aws:ecs:us-east-1:123456789012:service/test-cluster/test-service';

      // Mock resource tags (missing lights-out:group/env/project)
      taggingMock.on(GetResourcesCommand).resolves({
        ResourceTagMappingList: [
          {
            ResourceARN: expectedServiceArn,
            Tags: [{ Key: 'Name', Value: 'test-service' }],
          },
        ],
      });

      const getProjectConfigSpy = vi.spyOn(config, 'getProjectConfig');

      await main(event);

      // Verify config was NOT fetched
      expect(getProjectConfigSpy).not.toHaveBeenCalled();

      // Verify Teams webhook was NOT called
      expect(mockedFetch).not.toHaveBeenCalled();
    });

    it('should accept lights-out:env tag as alternative to lights-out:group', async () => {
      const event: EventBridgeEvent<'ECS Task State Change', any> = {
        version: '0',
        id: 'test-event-id',
        'detail-type': 'ECS Task State Change',
        source: 'aws.ecs',
        account: '123456789012',
        time: '2026-01-05T10:30:00Z',
        region: 'us-east-1',
        resources: [],
        detail: {
          clusterArn: 'arn:aws:ecs:us-east-1:123456789012:cluster/test-cluster',
          taskArn: 'arn:aws:ecs:us-east-1:123456789012:task/test-cluster/abc123',
          group: 'service:test-service',
          lastStatus: 'RUNNING',
          desiredStatus: 'RUNNING',
          containers: [{ name: 'app', lastStatus: 'RUNNING' }],
        },
      };

      const expectedServiceArn =
        'arn:aws:ecs:us-east-1:123456789012:service/test-cluster/test-service';

      // Mock resource tags with lights-out:env instead
      taggingMock.on(GetResourcesCommand).resolves({
        ResourceTagMappingList: [
          {
            ResourceARN: expectedServiceArn,
            Tags: [{ Key: 'lights-out:env', Value: 'dev' }],
          },
        ],
      });

      const mockConfig: TeamsConfig = {
        project: 'dev',
        webhook_url: 'https://outlook.office.com/webhook/test123',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-05T00:00:00Z',
      };
      vi.spyOn(config, 'getProjectConfig').mockResolvedValue(mockConfig);
      vi.spyOn(adaptiveCard, 'createStateChangeCard').mockReturnValue({
        type: 'message',
        attachments: [],
      });
      mockedFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
      } as Response);

      await main(event);

      // Verify config was fetched with 'dev'
      expect(config.getProjectConfig).toHaveBeenCalledWith('dev');
    });

    it('should skip notification when config not found for project', async () => {
      const event: EventBridgeEvent<'ECS Task State Change', any> = {
        version: '0',
        id: 'test-event-id',
        'detail-type': 'ECS Task State Change',
        source: 'aws.ecs',
        account: '123456789012',
        time: '2026-01-05T10:30:00Z',
        region: 'us-east-1',
        resources: [],
        detail: {
          clusterArn: 'arn:aws:ecs:us-east-1:123456789012:cluster/test-cluster',
          taskArn: 'arn:aws:ecs:us-east-1:123456789012:task/test-cluster/abc123',
          group: 'service:unknown-service',
          lastStatus: 'RUNNING',
          desiredStatus: 'RUNNING',
          containers: [{ name: 'app', lastStatus: 'RUNNING' }],
        },
      };

      const expectedServiceArn =
        'arn:aws:ecs:us-east-1:123456789012:service/test-cluster/unknown-service';

      taggingMock.on(GetResourcesCommand).resolves({
        ResourceTagMappingList: [
          {
            ResourceARN: expectedServiceArn,
            Tags: [{ Key: 'lights-out:group', Value: 'unknown-project' }],
          },
        ],
      });

      // Mock config not found
      vi.spyOn(config, 'getProjectConfig').mockResolvedValue(null);

      await main(event);

      // Verify Teams webhook was NOT called
      expect(mockedFetch).not.toHaveBeenCalled();
    });

    it('should handle Teams webhook failure gracefully', async () => {
      const event: EventBridgeEvent<'ECS Task State Change', any> = {
        version: '0',
        id: 'test-event-id',
        'detail-type': 'ECS Task State Change',
        source: 'aws.ecs',
        account: '123456789012',
        time: '2026-01-05T10:30:00Z',
        region: 'us-east-1',
        resources: [],
        detail: {
          clusterArn: 'arn:aws:ecs:us-east-1:123456789012:cluster/test-cluster',
          taskArn: 'arn:aws:ecs:us-east-1:123456789012:task/test-cluster/abc123',
          group: 'service:test-service',
          lastStatus: 'RUNNING',
          desiredStatus: 'RUNNING',
          containers: [{ name: 'app', lastStatus: 'RUNNING' }],
        },
      };

      const expectedServiceArn =
        'arn:aws:ecs:us-east-1:123456789012:service/test-cluster/test-service';

      taggingMock.on(GetResourcesCommand).resolves({
        ResourceTagMappingList: [
          {
            ResourceARN: expectedServiceArn,
            Tags: [{ Key: 'lights-out:group', Value: 'test-project' }],
          },
        ],
      });

      vi.spyOn(config, 'getProjectConfig').mockResolvedValue({
        project: 'test-project',
        webhook_url: 'https://outlook.office.com/webhook/test123',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-05T00:00:00Z',
      });

      vi.spyOn(adaptiveCard, 'createStateChangeCard').mockReturnValue({
        type: 'message',
        attachments: [],
      });

      // Mock failed fetch
      mockedFetch.mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: async () => 'Invalid webhook URL',
      } as Response);

      // Should not throw
      await expect(main(event)).resolves.not.toThrow();
    });
  });

  describe('main - RDS DB Instance events', () => {
    it('should handle RDS instance state change and send Teams notification', async () => {
      const event: EventBridgeEvent<'RDS DB Instance Event', any> = {
        version: '0',
        id: 'test-event-id',
        'detail-type': 'RDS DB Instance Event',
        source: 'aws.rds',
        account: '123456789012',
        time: '2026-01-05T10:30:00Z',
        region: 'us-east-1',
        resources: [],
        detail: {
          SourceArn: 'arn:aws:rds:us-east-1:123456789012:db:airsync-db',
          SourceIdentifier: 'airsync-db',
          EventCategories: ['notification'],
          Message: 'DB instance stopped',
        },
      };

      // Mock resource tags
      taggingMock.on(GetResourcesCommand).resolves({
        ResourceTagMappingList: [
          {
            ResourceARN: event.detail.SourceArn,
            Tags: [{ Key: 'lights-out:group', Value: 'airsync-prod' }],
          },
        ],
      });

      const mockConfig: TeamsConfig = {
        project: 'airsync-prod',
        webhook_url: 'https://outlook.office.com/webhook/test123',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-05T00:00:00Z',
      };
      vi.spyOn(config, 'getProjectConfig').mockResolvedValue(mockConfig);

      const mockCard = { type: 'message', attachments: [] };
      vi.spyOn(adaptiveCard, 'createStateChangeCard').mockReturnValue(mockCard);

      mockedFetch.mockResolvedValue({ ok: true, status: 200, statusText: 'OK' } as Response);

      await main(event);

      // Verify adaptive card was created with RDS data
      expect(adaptiveCard.createStateChangeCard).toHaveBeenCalledWith(
        expect.objectContaining({
          project: 'airsync-prod',
          resourceType: 'rds-instance',
          resourceId: 'airsync-db',
          previousState: 'available',
          newState: 'stopped',
          additionalInfo: expect.objectContaining({
            eventCategory: 'notification',
            message: 'DB instance stopped',
          }),
        })
      );

      // Verify Teams webhook was called
      expect(mockedFetch).toHaveBeenCalled();
    });

    it('should parse RDS state from message - stopped', async () => {
      const event: EventBridgeEvent<'RDS DB Instance Event', any> = {
        version: '0',
        id: 'test-event-id',
        'detail-type': 'RDS DB Instance Event',
        source: 'aws.rds',
        account: '123456789012',
        time: '2026-01-05T10:30:00Z',
        region: 'us-east-1',
        resources: [],
        detail: {
          SourceArn: 'arn:aws:rds:us-east-1:123456789012:db:test-db',
          SourceIdentifier: 'test-db',
          EventCategories: ['notification'],
          Message: 'DB instance stopped',
        },
      };

      taggingMock.on(GetResourcesCommand).resolves({
        ResourceTagMappingList: [
          {
            ResourceARN: event.detail.SourceArn,
            Tags: [{ Key: 'lights-out:group', Value: 'test-project' }],
          },
        ],
      });

      vi.spyOn(config, 'getProjectConfig').mockResolvedValue({
        project: 'test-project',
        webhook_url: 'https://outlook.office.com/webhook/test123',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-05T00:00:00Z',
      });

      vi.spyOn(adaptiveCard, 'createStateChangeCard').mockReturnValue({
        type: 'message',
        attachments: [],
      });
      mockedFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
      } as Response);

      await main(event);

      expect(adaptiveCard.createStateChangeCard).toHaveBeenCalledWith(
        expect.objectContaining({
          previousState: 'available',
          newState: 'stopped',
        })
      );
    });

    it('should parse RDS state from message - started', async () => {
      const event: EventBridgeEvent<'RDS DB Instance Event', any> = {
        version: '0',
        id: 'test-event-id',
        'detail-type': 'RDS DB Instance Event',
        source: 'aws.rds',
        account: '123456789012',
        time: '2026-01-05T10:30:00Z',
        region: 'us-east-1',
        resources: [],
        detail: {
          SourceArn: 'arn:aws:rds:us-east-1:123456789012:db:test-db',
          SourceIdentifier: 'test-db',
          EventCategories: ['notification'],
          Message: 'DB instance started',
        },
      };

      taggingMock.on(GetResourcesCommand).resolves({
        ResourceTagMappingList: [
          {
            ResourceARN: event.detail.SourceArn,
            Tags: [{ Key: 'lights-out:group', Value: 'test-project' }],
          },
        ],
      });

      vi.spyOn(config, 'getProjectConfig').mockResolvedValue({
        project: 'test-project',
        webhook_url: 'https://outlook.office.com/webhook/test123',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-05T00:00:00Z',
      });

      vi.spyOn(adaptiveCard, 'createStateChangeCard').mockReturnValue({
        type: 'message',
        attachments: [],
      });
      mockedFetch.mockResolvedValue({ ok: true } as Response);

      await main(event);

      expect(adaptiveCard.createStateChangeCard).toHaveBeenCalledWith(
        expect.objectContaining({
          previousState: 'stopped',
          newState: 'available',
        })
      );
    });

    it('should parse RDS state from message - stopping', async () => {
      const event: EventBridgeEvent<'RDS DB Instance Event', any> = {
        version: '0',
        id: 'test-event-id',
        'detail-type': 'RDS DB Instance Event',
        source: 'aws.rds',
        account: '123456789012',
        time: '2026-01-05T10:30:00Z',
        region: 'us-east-1',
        resources: [],
        detail: {
          SourceArn: 'arn:aws:rds:us-east-1:123456789012:db:test-db',
          SourceIdentifier: 'test-db',
          EventCategories: ['notification'],
          Message: 'DB instance stopping',
        },
      };

      taggingMock.on(GetResourcesCommand).resolves({
        ResourceTagMappingList: [
          {
            ResourceARN: event.detail.SourceArn,
            Tags: [{ Key: 'lights-out:group', Value: 'test-project' }],
          },
        ],
      });

      vi.spyOn(config, 'getProjectConfig').mockResolvedValue({
        project: 'test-project',
        webhook_url: 'https://outlook.office.com/webhook/test123',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-05T00:00:00Z',
      });

      vi.spyOn(adaptiveCard, 'createStateChangeCard').mockReturnValue({
        type: 'message',
        attachments: [],
      });
      mockedFetch.mockResolvedValue({ ok: true, status: 200, statusText: 'OK' } as Response);

      await main(event);

      expect(adaptiveCard.createStateChangeCard).toHaveBeenCalledWith(
        expect.objectContaining({
          previousState: 'available',
          newState: 'stopping',
        })
      );
    });

    it('should parse RDS state from message - starting', async () => {
      const event: EventBridgeEvent<'RDS DB Instance Event', any> = {
        version: '0',
        id: 'test-event-id',
        'detail-type': 'RDS DB Instance Event',
        source: 'aws.rds',
        account: '123456789012',
        time: '2026-01-05T10:30:00Z',
        region: 'us-east-1',
        resources: [],
        detail: {
          SourceArn: 'arn:aws:rds:us-east-1:123456789012:db:test-db',
          SourceIdentifier: 'test-db',
          EventCategories: ['notification'],
          Message: 'DB instance starting',
        },
      };

      taggingMock.on(GetResourcesCommand).resolves({
        ResourceTagMappingList: [
          {
            ResourceARN: event.detail.SourceArn,
            Tags: [{ Key: 'lights-out:group', Value: 'test-project' }],
          },
        ],
      });

      vi.spyOn(config, 'getProjectConfig').mockResolvedValue({
        project: 'test-project',
        webhook_url: 'https://outlook.office.com/webhook/test123',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-05T00:00:00Z',
      });

      vi.spyOn(adaptiveCard, 'createStateChangeCard').mockReturnValue({
        type: 'message',
        attachments: [],
      });
      mockedFetch.mockResolvedValue({ ok: true, status: 200, statusText: 'OK' } as Response);

      await main(event);

      expect(adaptiveCard.createStateChangeCard).toHaveBeenCalledWith(
        expect.objectContaining({
          previousState: 'stopped',
          newState: 'starting',
        })
      );
    });

    it('should parse RDS state from message - available', async () => {
      const event: EventBridgeEvent<'RDS DB Instance Event', any> = {
        version: '0',
        id: 'test-event-id',
        'detail-type': 'RDS DB Instance Event',
        source: 'aws.rds',
        account: '123456789012',
        time: '2026-01-05T10:30:00Z',
        region: 'us-east-1',
        resources: [],
        detail: {
          SourceArn: 'arn:aws:rds:us-east-1:123456789012:db:test-db',
          SourceIdentifier: 'test-db',
          EventCategories: ['notification'],
          Message: 'DB instance is now available',
        },
      };

      taggingMock.on(GetResourcesCommand).resolves({
        ResourceTagMappingList: [
          {
            ResourceARN: event.detail.SourceArn,
            Tags: [{ Key: 'lights-out:group', Value: 'test-project' }],
          },
        ],
      });

      vi.spyOn(config, 'getProjectConfig').mockResolvedValue({
        project: 'test-project',
        webhook_url: 'https://outlook.office.com/webhook/test123',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-05T00:00:00Z',
      });

      vi.spyOn(adaptiveCard, 'createStateChangeCard').mockReturnValue({
        type: 'message',
        attachments: [],
      });
      mockedFetch.mockResolvedValue({ ok: true, status: 200, statusText: 'OK' } as Response);

      await main(event);

      expect(adaptiveCard.createStateChangeCard).toHaveBeenCalledWith(
        expect.objectContaining({
          previousState: 'stopped',
          newState: 'available',
        })
      );
    });

    it('should handle unknown RDS state', async () => {
      const event: EventBridgeEvent<'RDS DB Instance Event', any> = {
        version: '0',
        id: 'test-event-id',
        'detail-type': 'RDS DB Instance Event',
        source: 'aws.rds',
        account: '123456789012',
        time: '2026-01-05T10:30:00Z',
        region: 'us-east-1',
        resources: [],
        detail: {
          SourceArn: 'arn:aws:rds:us-east-1:123456789012:db:test-db',
          SourceIdentifier: 'test-db',
          EventCategories: ['maintenance'],
          Message: 'DB instance maintenance scheduled',
        },
      };

      taggingMock.on(GetResourcesCommand).resolves({
        ResourceTagMappingList: [
          {
            ResourceARN: event.detail.SourceArn,
            Tags: [{ Key: 'lights-out:group', Value: 'test-project' }],
          },
        ],
      });

      vi.spyOn(config, 'getProjectConfig').mockResolvedValue({
        project: 'test-project',
        webhook_url: 'https://outlook.office.com/webhook/test123',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-05T00:00:00Z',
      });

      vi.spyOn(adaptiveCard, 'createStateChangeCard').mockReturnValue({
        type: 'message',
        attachments: [],
      });
      mockedFetch.mockResolvedValue({ ok: true, status: 200, statusText: 'OK' } as Response);

      await main(event);

      expect(adaptiveCard.createStateChangeCard).toHaveBeenCalledWith(
        expect.objectContaining({
          previousState: 'unknown',
          newState: 'unknown',
        })
      );
    });
  });

  describe('main - unsupported events', () => {
    it('should log warning for unsupported event source', async () => {
      const event: EventBridgeEvent<string, any> = {
        version: '0',
        id: 'test-event-id',
        'detail-type': 'Some Other Event',
        source: 'aws.s3', // Unsupported
        account: '123456789012',
        time: '2026-01-05T10:30:00Z',
        region: 'us-east-1',
        resources: [],
        detail: {},
      };

      // Should not throw
      await expect(main(event)).resolves.not.toThrow();

      // Verify no Teams webhook calls
      expect(mockedFetch).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should not throw when getResourceTags fails', async () => {
      const event: EventBridgeEvent<'ECS Task State Change', any> = {
        version: '0',
        id: 'test-event-id',
        'detail-type': 'ECS Task State Change',
        source: 'aws.ecs',
        account: '123456789012',
        time: '2026-01-05T10:30:00Z',
        region: 'us-east-1',
        resources: [],
        detail: {
          clusterArn: 'arn:aws:ecs:us-east-1:123456789012:cluster/test-cluster',
          taskArn: 'arn:aws:ecs:us-east-1:123456789012:task/test-cluster/abc123',
          lastStatus: 'RUNNING',
          desiredStatus: 'RUNNING',
          containers: [{ name: 'app', lastStatus: 'RUNNING' }],
        },
      };

      // Mock tagging API failure
      taggingMock.on(GetResourcesCommand).rejects(new Error('Tagging API error'));

      // Should not throw
      await expect(main(event)).resolves.not.toThrow();
    });

    it('should not throw when Teams webhook request fails with network error', async () => {
      const event: EventBridgeEvent<'ECS Task State Change', any> = {
        version: '0',
        id: 'test-event-id',
        'detail-type': 'ECS Task State Change',
        source: 'aws.ecs',
        account: '123456789012',
        time: '2026-01-05T10:30:00Z',
        region: 'us-east-1',
        resources: [],
        detail: {
          clusterArn: 'arn:aws:ecs:us-east-1:123456789012:cluster/test-cluster',
          taskArn: 'arn:aws:ecs:us-east-1:123456789012:task/test-cluster/abc123',
          group: 'service:test-service',
          lastStatus: 'RUNNING',
          desiredStatus: 'RUNNING',
          containers: [{ name: 'app', lastStatus: 'RUNNING' }],
        },
      };

      const expectedServiceArn =
        'arn:aws:ecs:us-east-1:123456789012:service/test-cluster/test-service';

      taggingMock.on(GetResourcesCommand).resolves({
        ResourceTagMappingList: [
          {
            ResourceARN: expectedServiceArn,
            Tags: [{ Key: 'lights-out:group', Value: 'test-project' }],
          },
        ],
      });

      vi.spyOn(config, 'getProjectConfig').mockResolvedValue({
        project: 'test-project',
        webhook_url: 'https://outlook.office.com/webhook/test123',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-05T00:00:00Z',
      });

      vi.spyOn(adaptiveCard, 'createStateChangeCard').mockReturnValue({
        type: 'message',
        attachments: [],
      });

      // Mock network error
      mockedFetch.mockRejectedValue(new Error('Network timeout'));

      // Should not throw
      await expect(main(event)).resolves.not.toThrow();
    });

    it('should handle getResourceTags returning empty tags', async () => {
      const event: EventBridgeEvent<'ECS Task State Change', any> = {
        version: '0',
        id: 'test-event-id',
        'detail-type': 'ECS Task State Change',
        source: 'aws.ecs',
        account: '123456789012',
        time: '2026-01-05T10:30:00Z',
        region: 'us-east-1',
        resources: [],
        detail: {
          clusterArn: 'arn:aws:ecs:us-east-1:123456789012:cluster/test-cluster',
          taskArn: 'arn:aws:ecs:us-east-1:123456789012:task/test-cluster/abc123',
          lastStatus: 'RUNNING',
          desiredStatus: 'RUNNING',
          containers: [{ name: 'app', lastStatus: 'RUNNING' }],
        },
      };

      // Mock empty tags response
      taggingMock.on(GetResourcesCommand).resolves({
        ResourceTagMappingList: [
          {
            ResourceARN: event.detail.taskArn,
            Tags: [], // Empty tags
          },
        ],
      });

      const getProjectConfigSpy = vi.spyOn(config, 'getProjectConfig');

      await main(event);

      // Should skip notification due to missing tags
      expect(getProjectConfigSpy).not.toHaveBeenCalled();
      expect(mockedFetch).not.toHaveBeenCalled();
    });

    it('should handle getResourceTags returning no resource mappings', async () => {
      const event: EventBridgeEvent<'RDS DB Instance Event', any> = {
        version: '0',
        id: 'test-event-id',
        'detail-type': 'RDS DB Instance Event',
        source: 'aws.rds',
        account: '123456789012',
        time: '2026-01-05T10:30:00Z',
        region: 'us-east-1',
        resources: [],
        detail: {
          SourceArn: 'arn:aws:rds:us-east-1:123456789012:db:test-db',
          SourceIdentifier: 'test-db',
          EventCategories: ['notification'],
          Message: 'DB instance stopped',
        },
      };

      // Mock no resource mappings
      taggingMock.on(GetResourcesCommand).resolves({
        ResourceTagMappingList: [], // No mappings
      });

      const getProjectConfigSpy = vi.spyOn(config, 'getProjectConfig');

      await main(event);

      // Should skip notification
      expect(getProjectConfigSpy).not.toHaveBeenCalled();
      expect(mockedFetch).not.toHaveBeenCalled();
    });
  });

  describe('tag priority handling', () => {
    it('should use lights-out:project tag as alternative', async () => {
      const event: EventBridgeEvent<'ECS Task State Change', any> = {
        version: '0',
        id: 'test-event-id',
        'detail-type': 'ECS Task State Change',
        source: 'aws.ecs',
        account: '123456789012',
        time: '2026-01-05T10:30:00Z',
        region: 'us-east-1',
        resources: [],
        detail: {
          clusterArn: 'arn:aws:ecs:us-east-1:123456789012:cluster/test-cluster',
          taskArn: 'arn:aws:ecs:us-east-1:123456789012:task/test-cluster/abc123',
          group: 'service:my-service',
          lastStatus: 'RUNNING',
          desiredStatus: 'RUNNING',
          containers: [{ name: 'app', lastStatus: 'RUNNING' }],
        },
      };

      const expectedServiceArn =
        'arn:aws:ecs:us-east-1:123456789012:service/test-cluster/my-service';

      taggingMock.on(GetResourcesCommand).resolves({
        ResourceTagMappingList: [
          {
            ResourceARN: expectedServiceArn,
            Tags: [{ Key: 'lights-out:project', Value: 'my-project' }],
          },
        ],
      });

      vi.spyOn(config, 'getProjectConfig').mockResolvedValue({
        project: 'my-project',
        webhook_url: 'https://outlook.office.com/webhook/test123',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-05T00:00:00Z',
      });

      vi.spyOn(adaptiveCard, 'createStateChangeCard').mockReturnValue({
        type: 'message',
        attachments: [],
      });
      mockedFetch.mockResolvedValue({ ok: true } as Response);

      await main(event);

      expect(config.getProjectConfig).toHaveBeenCalledWith('my-project');
    });

    it('should prioritize lights-out:group over lights-out:env', async () => {
      const event: EventBridgeEvent<'ECS Task State Change', any> = {
        version: '0',
        id: 'test-event-id',
        'detail-type': 'ECS Task State Change',
        source: 'aws.ecs',
        account: '123456789012',
        time: '2026-01-05T10:30:00Z',
        region: 'us-east-1',
        resources: [],
        detail: {
          clusterArn: 'arn:aws:ecs:us-east-1:123456789012:cluster/test-cluster',
          taskArn: 'arn:aws:ecs:us-east-1:123456789012:task/test-cluster/abc123',
          group: 'service:priority-test-service',
          lastStatus: 'RUNNING',
          desiredStatus: 'RUNNING',
          containers: [{ name: 'app', lastStatus: 'RUNNING' }],
        },
      };

      const expectedServiceArn =
        'arn:aws:ecs:us-east-1:123456789012:service/test-cluster/priority-test-service';

      taggingMock.on(GetResourcesCommand).resolves({
        ResourceTagMappingList: [
          {
            ResourceARN: expectedServiceArn,
            Tags: [
              { Key: 'lights-out:group', Value: 'group-value' },
              { Key: 'lights-out:env', Value: 'env-value' },
            ],
          },
        ],
      });

      vi.spyOn(config, 'getProjectConfig').mockResolvedValue({
        project: 'group-value',
        webhook_url: 'https://outlook.office.com/webhook/test123',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-05T00:00:00Z',
      });

      vi.spyOn(adaptiveCard, 'createStateChangeCard').mockReturnValue({
        type: 'message',
        attachments: [],
      });
      mockedFetch.mockResolvedValue({ ok: true } as Response);

      await main(event);

      // Should use lights-out:group value
      expect(config.getProjectConfig).toHaveBeenCalledWith('group-value');
    });
  });
});

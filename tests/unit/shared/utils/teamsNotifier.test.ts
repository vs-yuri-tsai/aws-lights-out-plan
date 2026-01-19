/**
 * Unit tests for shared/utils/teamsNotifier.ts
 *
 * Tests Teams notification utility for sending action results to Microsoft Teams.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  sendTeamsNotification,
  sendAggregatedTeamsNotification,
  extractRegionFromArn,
  groupResultsByRegionAndStatus,
} from '@shared/utils/teamsNotifier';
import type { HandlerResult, TeamsNotificationConfig, TriggerSource } from '@shared/types';

// Mock node-fetch
vi.mock('node-fetch', () => ({
  default: vi.fn(),
}));

import fetch, { Response } from 'node-fetch';
const mockedFetch = vi.mocked(fetch);

// Type definitions for Adaptive Card structure
interface AdaptiveCardFact {
  title: string;
  value: string;
}

interface AdaptiveCardElement {
  type: string;
  facts?: AdaptiveCardFact[];
}

describe('teamsNotifier', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('sendTeamsNotification', () => {
    const mockConfig: TeamsNotificationConfig = {
      enabled: true,
      webhook_url: 'https://outlook.office.com/webhook/test123',
    };

    const mockSuccessResult: HandlerResult = {
      success: true,
      action: 'start',
      resourceType: 'ecs-service',
      resourceId: 'my-service',
      message: 'Service started (desired=2, was 0)',
      previousState: {
        desired_count: 0,
        running_count: 0,
        status: 'ACTIVE',
        is_stopped: true,
      },
    };

    const mockFailureResult: HandlerResult = {
      success: false,
      action: 'stop',
      resourceType: 'rds-instance',
      resourceId: 'my-database',
      message: 'Stop operation failed',
      error: 'Database not found',
    };

    it('should send notification for successful action', async () => {
      mockedFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
      } as Response);

      await sendTeamsNotification(mockConfig, mockSuccessResult, 'workshop');

      // Verify fetch was called
      expect(mockedFetch).toHaveBeenCalledWith(
        mockConfig.webhook_url,
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
        })
      );

      // Verify message card structure
      const call = mockedFetch.mock.calls[0];
      const body = JSON.parse(call[1]?.body as string);

      expect(body.type).toBe('message');
      expect(body.attachments).toHaveLength(1);
      expect(body.attachments[0].contentType).toBe('application/vnd.microsoft.card.adaptive');
    });

    it('should send notification for failed action', async () => {
      mockedFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
      } as Response);

      await sendTeamsNotification(mockConfig, mockFailureResult, 'workshop');

      expect(mockedFetch).toHaveBeenCalled();

      // Verify error message is included
      const call = mockedFetch.mock.calls[0];
      const body = JSON.parse(call[1]?.body as string);
      const cardContent = body.attachments[0].content;

      // Should contain error information
      const bodyText = JSON.stringify(cardContent.body);
      expect(bodyText).toContain('Database not found');
    });

    it('should skip notification when disabled', async () => {
      const disabledConfig: TeamsNotificationConfig = {
        ...mockConfig,
        enabled: false,
      };

      await sendTeamsNotification(disabledConfig, mockSuccessResult, 'workshop');

      expect(mockedFetch).not.toHaveBeenCalled();
    });

    it('should handle webhook failure gracefully', async () => {
      mockedFetch.mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: async () => 'Invalid webhook URL',
      } as Response);

      // Should not throw
      await expect(
        sendTeamsNotification(mockConfig, mockSuccessResult, 'workshop')
      ).resolves.not.toThrow();
    });

    it('should handle network error gracefully', async () => {
      mockedFetch.mockRejectedValue(new Error('Network timeout'));

      // Should not throw
      await expect(
        sendTeamsNotification(mockConfig, mockSuccessResult, 'workshop')
      ).resolves.not.toThrow();
    });

    it('should include environment in notification', async () => {
      mockedFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
      } as Response);

      await sendTeamsNotification(mockConfig, mockSuccessResult, 'production');

      const call = mockedFetch.mock.calls[0];
      const body = JSON.parse(call[1]?.body as string);
      const cardContent = body.attachments[0].content;

      // Should contain environment information
      const bodyText = JSON.stringify(cardContent.body);
      expect(bodyText).toContain('production');
    });

    it('should format action names correctly', async () => {
      mockedFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
      } as Response);

      await sendTeamsNotification(mockConfig, mockSuccessResult, 'workshop');

      const call = mockedFetch.mock.calls[0];
      const body = JSON.parse(call[1]?.body as string);
      const cardContent = body.attachments[0].content;

      // Should format action as "START" (uppercase)
      const bodyText = JSON.stringify(cardContent.body);
      expect(bodyText).toContain('START');
    });

    it('should include Asia/Taipei localized timestamp', async () => {
      // Mock Date to a known value (2025-01-07 14:30:45 UTC = 2025-01-07 22:30:45 GMT+8)
      const mockDate = new Date('2025-01-07T14:30:45.000Z');
      vi.useFakeTimers();
      vi.setSystemTime(mockDate);

      mockedFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
      } as Response);

      await sendTeamsNotification(mockConfig, mockSuccessResult, 'workshop');

      const call = mockedFetch.mock.calls[0];
      const body = JSON.parse(call[1]?.body as string);
      const cardContent = body.attachments[0].content;

      // Find the Timestamp fact in the FactSet
      const factSet = (cardContent.body as AdaptiveCardElement[]).find(
        (item: AdaptiveCardElement) => item.type === 'FactSet'
      );
      const timestampFact = factSet?.facts?.find(
        (fact: AdaptiveCardFact) => fact.title === 'Timestamp'
      );

      expect(timestampFact).toBeDefined();
      // Should be in zh-TW locale format with Asia/Taipei timezone
      // Expected format: "2025/01/07 22:30:45" (UTC+8)
      expect(timestampFact!.value).toMatch(/2025\/01\/07.*22:30:45/);

      vi.useRealTimers();
    });

    it('should use 24-hour format for timestamp', async () => {
      // Mock Date to afternoon time (2025-01-07 06:00:00 UTC = 2025-01-07 14:00:00 GMT+8)
      const mockDate = new Date('2025-01-07T06:00:00.000Z');
      vi.useFakeTimers();
      vi.setSystemTime(mockDate);

      mockedFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
      } as Response);

      await sendTeamsNotification(mockConfig, mockSuccessResult, 'workshop');

      const call = mockedFetch.mock.calls[0];
      const body = JSON.parse(call[1]?.body as string);
      const cardContent = body.attachments[0].content;

      const factSet = (cardContent.body as AdaptiveCardElement[]).find(
        (item: AdaptiveCardElement) => item.type === 'FactSet'
      );
      const timestampFact = factSet?.facts?.find(
        (fact: AdaptiveCardFact) => fact.title === 'Timestamp'
      );

      expect(timestampFact).toBeDefined();
      // Should use 24-hour format (14:00), not 12-hour format (2:00 PM)
      expect(timestampFact!.value).toContain('14:00:00');
      expect(timestampFact!.value).not.toContain('PM');
      expect(timestampFact!.value).not.toContain('AM');

      vi.useRealTimers();
    });
  });

  describe('extractRegionFromArn', () => {
    it('should extract region from ECS service ARN', () => {
      const arn = 'arn:aws:ecs:us-east-1:123456789012:service/cluster/service-name';
      expect(extractRegionFromArn(arn)).toBe('us-east-1');
    });

    it('should extract region from RDS instance ARN', () => {
      const arn = 'arn:aws:rds:ap-northeast-1:123456789012:db:my-database';
      expect(extractRegionFromArn(arn)).toBe('ap-northeast-1');
    });

    it('should return unknown for invalid ARN format', () => {
      expect(extractRegionFromArn('invalid-arn')).toBe('unknown');
      expect(extractRegionFromArn('')).toBe('unknown');
      expect(extractRegionFromArn(undefined)).toBe('unknown');
    });

    it('should return unknown for ARN with missing region', () => {
      const arn = 'arn:aws:ecs::123456789012:service/cluster/service-name';
      expect(extractRegionFromArn(arn)).toBe('unknown');
    });
  });

  describe('groupResultsByRegionAndStatus', () => {
    it('should group results by success status and region', () => {
      const results: HandlerResult[] = [
        {
          success: true,
          action: 'start',
          resourceType: 'ecs-service',
          resourceId: 'cluster/service1',
          message: 'Service started',
          region: 'us-east-1',
        },
        {
          success: true,
          action: 'start',
          resourceType: 'ecs-service',
          resourceId: 'cluster/service2',
          message: 'Service started',
          region: 'us-east-1',
        },
        {
          success: false,
          action: 'start',
          resourceType: 'rds-db',
          resourceId: 'my-database',
          message: 'Failed to start',
          error: 'Database error',
          region: 'us-east-1',
        },
      ];

      const { success, failed } = groupResultsByRegionAndStatus(results);

      // Verify success group
      expect(success.size).toBe(1);
      expect(success.has('us-east-1')).toBe(true);
      const successRegionMap = success.get('us-east-1')!;
      expect(successRegionMap.get('ecs-service')).toHaveLength(2);

      // Verify failed group
      expect(failed.size).toBe(1);
      expect(failed.has('us-east-1')).toBe(true);
      const failedRegionMap = failed.get('us-east-1')!;
      expect(failedRegionMap.get('rds-db')).toHaveLength(1);
    });

    it('should handle multiple regions', () => {
      const results: HandlerResult[] = [
        {
          success: true,
          action: 'start',
          resourceType: 'ecs-service',
          resourceId: 'cluster/service1',
          message: 'Service started',
          region: 'us-east-1',
        },
        {
          success: true,
          action: 'start',
          resourceType: 'ecs-service',
          resourceId: 'cluster/service2',
          message: 'Service started',
          region: 'ap-northeast-1',
        },
      ];

      const { success, failed } = groupResultsByRegionAndStatus(results);

      expect(success.size).toBe(2);
      expect(success.has('us-east-1')).toBe(true);
      expect(success.has('ap-northeast-1')).toBe(true);
      expect(failed.size).toBe(0);
    });

    it('should handle results without region', () => {
      const results: HandlerResult[] = [
        {
          success: true,
          action: 'start',
          resourceType: 'ecs-service',
          resourceId: 'cluster/service1',
          message: 'Service started',
          // region is undefined
        },
      ];

      const { success } = groupResultsByRegionAndStatus(results);

      expect(success.has('unknown')).toBe(true);
    });

    it('should return empty maps for empty results', () => {
      const { success, failed } = groupResultsByRegionAndStatus([]);

      expect(success.size).toBe(0);
      expect(failed.size).toBe(0);
    });

    it('should skip idempotent results', () => {
      const results: HandlerResult[] = [
        {
          success: true,
          action: 'start',
          resourceType: 'ecs-service',
          resourceId: 'cluster/service1',
          message: 'Service started',
          region: 'us-east-1',
        },
        {
          success: true,
          action: 'start',
          resourceType: 'ecs-service',
          resourceId: 'cluster/service2',
          message: 'Service already at desired count 2',
          region: 'us-east-1',
          idempotent: true, // This should be skipped
        },
        {
          success: true,
          action: 'stop',
          resourceType: 'rds-db',
          resourceId: 'my-database',
          message: 'DB instance already stopped',
          region: 'ap-northeast-1',
          idempotent: true, // This should be skipped
        },
      ];

      const { success, failed } = groupResultsByRegionAndStatus(results);

      // Only non-idempotent result should be included
      expect(success.size).toBe(1);
      expect(success.has('us-east-1')).toBe(true);
      expect(success.has('ap-northeast-1')).toBe(false); // skipped because idempotent

      const successRegionMap = success.get('us-east-1')!;
      expect(successRegionMap.get('ecs-service')).toHaveLength(1);
      expect(successRegionMap.get('ecs-service')![0].resourceId).toBe('cluster/service1');

      expect(failed.size).toBe(0);
    });

    it('should return empty maps when all results are idempotent', () => {
      const results: HandlerResult[] = [
        {
          success: true,
          action: 'start',
          resourceType: 'ecs-service',
          resourceId: 'cluster/service1',
          message: 'Service already at desired count 2',
          region: 'us-east-1',
          idempotent: true,
        },
        {
          success: true,
          action: 'stop',
          resourceType: 'rds-db',
          resourceId: 'my-database',
          message: 'DB instance already stopped',
          region: 'us-east-1',
          idempotent: true,
        },
      ];

      const { success, failed } = groupResultsByRegionAndStatus(results);

      expect(success.size).toBe(0);
      expect(failed.size).toBe(0);
    });
  });

  describe('sendAggregatedTeamsNotification', () => {
    const mockConfig: TeamsNotificationConfig = {
      enabled: true,
      webhook_url: 'https://outlook.office.com/webhook/test123',
    };

    const mockTriggerSource: TriggerSource = {
      type: 'eventbridge-scheduled',
      identity: 'arn:aws:events:us-east-1:123456:rule/lights-out-test-start',
      displayName: 'lights-out-test-start',
    };

    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should send separate notifications for success and failure', async () => {
      mockedFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
      } as Response);

      const results: HandlerResult[] = [
        {
          success: true,
          action: 'start',
          resourceType: 'ecs-service',
          resourceId: 'cluster/service1',
          message: 'Service started',
          region: 'us-east-1',
        },
        {
          success: false,
          action: 'start',
          resourceType: 'rds-db',
          resourceId: 'my-database',
          message: 'Failed to start',
          error: 'Database error',
          region: 'us-east-1',
        },
      ];

      await sendAggregatedTeamsNotification(
        mockConfig,
        results,
        'test-env',
        'start',
        mockTriggerSource
      );

      // Should send 2 notifications: one for success, one for failure
      expect(mockedFetch).toHaveBeenCalledTimes(2);
    });

    it('should send separate notifications per region', async () => {
      mockedFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
      } as Response);

      const results: HandlerResult[] = [
        {
          success: true,
          action: 'start',
          resourceType: 'ecs-service',
          resourceId: 'cluster/service1',
          message: 'Service started',
          region: 'us-east-1',
        },
        {
          success: true,
          action: 'start',
          resourceType: 'ecs-service',
          resourceId: 'cluster/service2',
          message: 'Service started',
          region: 'ap-northeast-1',
        },
      ];

      await sendAggregatedTeamsNotification(
        mockConfig,
        results,
        'test-env',
        'start',
        mockTriggerSource
      );

      // Should send 2 notifications: one per region
      expect(mockedFetch).toHaveBeenCalledTimes(2);
    });

    it('should skip notification when disabled', async () => {
      const disabledConfig: TeamsNotificationConfig = {
        ...mockConfig,
        enabled: false,
      };

      const results: HandlerResult[] = [
        {
          success: true,
          action: 'start',
          resourceType: 'ecs-service',
          resourceId: 'cluster/service1',
          message: 'Service started',
          region: 'us-east-1',
        },
      ];

      await sendAggregatedTeamsNotification(disabledConfig, results, 'test-env', 'start');

      expect(mockedFetch).not.toHaveBeenCalled();
    });

    it('should skip notification when results are empty', async () => {
      await sendAggregatedTeamsNotification(mockConfig, [], 'test-env', 'start');

      expect(mockedFetch).not.toHaveBeenCalled();
    });

    it('should include correct card structure for success notification', async () => {
      mockedFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
      } as Response);

      const results: HandlerResult[] = [
        {
          success: true,
          action: 'start',
          resourceType: 'ecs-service',
          resourceId: 'cluster/service1',
          message: 'Service started via Auto Scaling',
          region: 'us-east-1',
        },
        {
          success: true,
          action: 'start',
          resourceType: 'ecs-service',
          resourceId: 'cluster/service2',
          message: 'Service started via Auto Scaling',
          region: 'us-east-1',
        },
      ];

      await sendAggregatedTeamsNotification(
        mockConfig,
        results,
        'test-env',
        'start',
        mockTriggerSource
      );

      expect(mockedFetch).toHaveBeenCalledTimes(1);

      const call = mockedFetch.mock.calls[0];
      const body = JSON.parse(call[1]?.body as string);

      expect(body.type).toBe('message');
      expect(body.attachments).toHaveLength(1);
      expect(body.attachments[0].contentType).toBe('application/vnd.microsoft.card.adaptive');

      const cardContent = body.attachments[0].content;
      const bodyText = JSON.stringify(cardContent.body);

      // Verify card contains expected content
      expect(bodyText).toContain('Lights-On - Success');
      expect(bodyText).toContain('test-env');
      expect(bodyText).toContain('us-east-1');
      expect(bodyText).toContain('cluster/service1');
      expect(bodyText).toContain('cluster/service2');
      expect(bodyText).toContain('Service started via Auto Scaling');
    });

    it('should include correct card structure for failure notification', async () => {
      mockedFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
      } as Response);

      const results: HandlerResult[] = [
        {
          success: false,
          action: 'start',
          resourceType: 'ecs-service',
          resourceId: 'cluster/service1',
          message: 'Start operation failed',
          error: 'Service not found',
          region: 'us-east-1',
        },
      ];

      await sendAggregatedTeamsNotification(
        mockConfig,
        results,
        'test-env',
        'start',
        mockTriggerSource
      );

      expect(mockedFetch).toHaveBeenCalledTimes(1);

      const call = mockedFetch.mock.calls[0];
      const body = JSON.parse(call[1]?.body as string);
      const cardContent = body.attachments[0].content;
      const bodyText = JSON.stringify(cardContent.body);

      // Verify card contains failure information
      expect(bodyText).toContain('Lights-On - Failed');
      expect(bodyText).toContain('Service not found');
    });

    it('should handle webhook failure gracefully', async () => {
      mockedFetch.mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: async () => 'Invalid webhook URL',
      } as Response);

      const results: HandlerResult[] = [
        {
          success: true,
          action: 'start',
          resourceType: 'ecs-service',
          resourceId: 'cluster/service1',
          message: 'Service started',
          region: 'us-east-1',
        },
      ];

      // Should not throw
      await expect(
        sendAggregatedTeamsNotification(mockConfig, results, 'test-env', 'start')
      ).resolves.not.toThrow();
    });

    it('should handle network error gracefully', async () => {
      mockedFetch.mockRejectedValue(new Error('Network timeout'));

      const results: HandlerResult[] = [
        {
          success: true,
          action: 'start',
          resourceType: 'ecs-service',
          resourceId: 'cluster/service1',
          message: 'Service started',
          region: 'us-east-1',
        },
      ];

      // Should not throw
      await expect(
        sendAggregatedTeamsNotification(mockConfig, results, 'test-env', 'start')
      ).resolves.not.toThrow();
    });

    it('should group multiple resource types in single notification', async () => {
      mockedFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
      } as Response);

      const results: HandlerResult[] = [
        {
          success: true,
          action: 'start',
          resourceType: 'ecs-service',
          resourceId: 'cluster/service1',
          message: 'Service started',
          region: 'us-east-1',
        },
        {
          success: true,
          action: 'start',
          resourceType: 'rds-db',
          resourceId: 'my-database',
          message: 'DB instance start initiated',
          region: 'us-east-1',
        },
      ];

      await sendAggregatedTeamsNotification(
        mockConfig,
        results,
        'test-env',
        'start',
        mockTriggerSource
      );

      // Should send only 1 notification (both success, same region)
      expect(mockedFetch).toHaveBeenCalledTimes(1);

      const call = mockedFetch.mock.calls[0];
      const body = JSON.parse(call[1]?.body as string);
      const cardContent = body.attachments[0].content;
      const bodyText = JSON.stringify(cardContent.body);

      // Verify both resource types are included
      expect(bodyText).toContain('ECS SERVICE');
      expect(bodyText).toContain('RDS DB');
      expect(bodyText).toContain('cluster/service1');
      expect(bodyText).toContain('my-database');
    });

    it('should format resource IDs with proper line breaks', async () => {
      mockedFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
      } as Response);

      const results: HandlerResult[] = [
        {
          success: true,
          action: 'start',
          resourceType: 'ecs-service',
          resourceId: 'cluster/service1',
          message: 'Service started',
          region: 'us-east-1',
        },
        {
          success: true,
          action: 'start',
          resourceType: 'ecs-service',
          resourceId: 'cluster/service2',
          message: 'Service started',
          region: 'us-east-1',
        },
      ];

      await sendAggregatedTeamsNotification(
        mockConfig,
        results,
        'test-env',
        'start',
        mockTriggerSource
      );

      const call = mockedFetch.mock.calls[0];
      const body = JSON.parse(call[1]?.body as string);
      const cardContent = body.attachments[0].content;
      const bodyText = JSON.stringify(cardContent.body);

      // Verify resource IDs are formatted with bullet points and double newlines
      expect(bodyText).toContain('• cluster/service1\\n\\n• cluster/service2');
      // Verify "Resources:" heading is NOT present
      expect(bodyText).not.toContain('**Resources:**');
    });

    it('should format trigger source correctly', async () => {
      mockedFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
      } as Response);

      const results: HandlerResult[] = [
        {
          success: true,
          action: 'start',
          resourceType: 'ecs-service',
          resourceId: 'cluster/service1',
          message: 'Service started',
          region: 'us-east-1',
        },
      ];

      await sendAggregatedTeamsNotification(
        mockConfig,
        results,
        'test-env',
        'start',
        mockTriggerSource
      );

      const call = mockedFetch.mock.calls[0];
      const body = JSON.parse(call[1]?.body as string);
      const cardContent = body.attachments[0].content;
      const bodyText = JSON.stringify(cardContent.body);

      // Verify trigger source is formatted correctly
      expect(bodyText).toContain('EventBridge');
      expect(bodyText).toContain('lights-out-test-start');
    });

    it('should skip notification when all results are idempotent', async () => {
      const results: HandlerResult[] = [
        {
          success: true,
          action: 'start',
          resourceType: 'ecs-service',
          resourceId: 'cluster/service1',
          message: 'Service already at desired count 2',
          region: 'us-east-1',
          idempotent: true,
        },
        {
          success: true,
          action: 'stop',
          resourceType: 'rds-db',
          resourceId: 'my-database',
          message: 'DB instance already stopped',
          region: 'ap-northeast-1',
          idempotent: true,
        },
      ];

      await sendAggregatedTeamsNotification(
        mockConfig,
        results,
        'test-env',
        'start',
        mockTriggerSource
      );

      // No notifications should be sent because all results are idempotent
      expect(mockedFetch).not.toHaveBeenCalled();
    });

    it('should only notify for non-idempotent results', async () => {
      mockedFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
      } as Response);

      const results: HandlerResult[] = [
        {
          success: true,
          action: 'start',
          resourceType: 'ecs-service',
          resourceId: 'cluster/service1',
          message: 'Service started',
          region: 'us-east-1',
        },
        {
          success: true,
          action: 'start',
          resourceType: 'ecs-service',
          resourceId: 'cluster/service2',
          message: 'Service already at desired count 2',
          region: 'us-east-1',
          idempotent: true, // This should be skipped
        },
        {
          success: true,
          action: 'start',
          resourceType: 'rds-db',
          resourceId: 'my-database',
          message: 'DB instance already available',
          region: 'us-east-1',
          idempotent: true, // This should be skipped
        },
      ];

      await sendAggregatedTeamsNotification(
        mockConfig,
        results,
        'test-env',
        'start',
        mockTriggerSource
      );

      // Only 1 notification for the non-idempotent result
      expect(mockedFetch).toHaveBeenCalledTimes(1);

      const call = mockedFetch.mock.calls[0];
      const body = JSON.parse(call[1]?.body as string);
      const cardContent = body.attachments[0].content;
      const bodyText = JSON.stringify(cardContent.body);

      // Should only contain the non-idempotent resource
      expect(bodyText).toContain('cluster/service1');
      expect(bodyText).not.toContain('cluster/service2');
      expect(bodyText).not.toContain('my-database');
    });
  });
});

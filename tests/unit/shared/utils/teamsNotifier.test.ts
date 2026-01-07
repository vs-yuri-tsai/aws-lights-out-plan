/**
 * Unit tests for shared/utils/teamsNotifier.ts
 *
 * Tests Teams notification utility for sending action results to Microsoft Teams.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { sendTeamsNotification } from '@shared/utils/teamsNotifier';
import type { HandlerResult, TeamsNotificationConfig } from '@shared/types';

// Mock node-fetch
vi.mock('node-fetch', () => ({
  default: vi.fn(),
}));

import fetch, { Response } from 'node-fetch';
const mockedFetch = vi.mocked(fetch);

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
  });
});

/**
 * Tests for triggerSourceDetector utility
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import type { Context } from 'aws-lambda';
import type { LambdaEvent } from '@shared/types';
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import { detectTriggerSource } from '@shared/utils/triggerSourceDetector';

const stsMock = mockClient(STSClient);

describe('triggerSourceDetector', () => {
  let mockContext: Context;

  beforeEach(() => {
    mockContext = {
      invokedFunctionArn: 'arn:aws:lambda:ap-southeast-1:123456789012:function:lights-out-test',
      awsRequestId: 'test-request-id-123',
      functionName: 'lights-out-test',
      functionVersion: '$LATEST',
      memoryLimitInMB: '512',
      logGroupName: '/aws/lambda/lights-out-test',
      logStreamName: '2025/01/07/[$LATEST]abc123',
      callbackWaitsForEmptyEventLoop: true,
      getRemainingTimeInMillis: () => 30000,
      done: () => {},
      fail: () => {},
      succeed: () => {},
    } as unknown as Context;

    // Reset STS mock
    stsMock.reset();
  });

  describe('EventBridge scheduled event', () => {
    it('should use pre-provided triggerSource from Serverless Framework schedule input (start)', async () => {
      const event: LambdaEvent = {
        action: 'start',
        triggerSource: {
          type: 'eventbridge-scheduled',
          identity: 'arn:aws:events:us-east-1:123456789012:rule/lights-out-pg-development-start',
          displayName: 'lights-out-pg-development-start',
          metadata: {
            eventDetailType: 'Scheduled Event',
          },
        },
      };

      const result = await detectTriggerSource(event, mockContext);

      expect(result.type).toBe('eventbridge-scheduled');
      expect(result.displayName).toBe('lights-out-pg-development-start');
      expect(result.identity).toBe(
        'arn:aws:events:us-east-1:123456789012:rule/lights-out-pg-development-start'
      );
      expect(result.metadata?.eventDetailType).toBe('Scheduled Event');
    });

    it('should use pre-provided triggerSource from Serverless Framework schedule input (stop)', async () => {
      const event: LambdaEvent = {
        action: 'stop',
        triggerSource: {
          type: 'eventbridge-scheduled',
          identity: 'arn:aws:events:us-east-1:123456789012:rule/lights-out-pg-development-stop',
          displayName: 'lights-out-pg-development-stop',
          metadata: {
            eventDetailType: 'Scheduled Event',
          },
        },
      };

      const result = await detectTriggerSource(event, mockContext);

      expect(result.type).toBe('eventbridge-scheduled');
      expect(result.displayName).toBe('lights-out-pg-development-stop');
      expect(result.identity).toBe(
        'arn:aws:events:us-east-1:123456789012:rule/lights-out-pg-development-stop'
      );
      expect(result.metadata?.eventDetailType).toBe('Scheduled Event');
    });

    it('should detect EventBridge scheduled trigger with rule ARN', async () => {
      const event: LambdaEvent = {
        action: 'start',
        source: 'aws.events',
        'detail-type': 'Scheduled Event',
        resources: ['arn:aws:events:ap-southeast-1:123456789012:rule/lights-out-sss-lab-start'],
      };

      const result = await detectTriggerSource(event, mockContext);

      expect(result.type).toBe('eventbridge-scheduled');
      expect(result.displayName).toBe('lights-out-sss-lab-start');
      expect(result.identity).toBe(
        'arn:aws:events:ap-southeast-1:123456789012:rule/lights-out-sss-lab-start'
      );
      expect(result.metadata?.eventDetailType).toBe('Scheduled Event');
    });

    it('should handle EventBridge event with missing rule ARN', async () => {
      const event: LambdaEvent = {
        action: 'start',
        source: 'aws.events',
        'detail-type': 'Scheduled Event',
        resources: [],
      };

      const result = await detectTriggerSource(event, mockContext);

      expect(result.type).toBe('eventbridge-scheduled');
      expect(result.displayName).toBe('EventBridge (Unknown Rule)');
      expect(result.identity).toBe('unknown');
      expect(result.metadata?.eventDetailType).toBe('Scheduled Event');
    });

    it('should extract rule name from complex ARN', async () => {
      const event: LambdaEvent = {
        action: 'stop',
        source: 'aws.events',
        'detail-type': 'Scheduled Event',
        resources: ['arn:aws:events:us-east-1:987654321098:rule/my-complex-rule-name-123'],
      };

      const result = await detectTriggerSource(event, mockContext);

      expect(result.type).toBe('eventbridge-scheduled');
      expect(result.displayName).toBe('my-complex-rule-name-123');
    });
  });

  describe('Manual invocation via STS', () => {
    it('should detect manual invoke for IAM user', async () => {
      const event: LambdaEvent = {
        action: 'start',
      };

      stsMock.on(GetCallerIdentityCommand).resolves({
        Arn: 'arn:aws:iam::123456789012:user/john.doe',
        Account: '123456789012',
        UserId: 'AIDAI1234567890EXAMPLE',
      });

      const result = await detectTriggerSource(event, mockContext);

      expect(result.type).toBe('manual-invoke');
      expect(result.displayName).toBe('john.doe');
      expect(result.identity).toBe('arn:aws:iam::123456789012:user/john.doe');
      expect(result.metadata?.accountId).toBe('123456789012');
      expect(result.metadata?.userId).toBe('AIDAI1234567890EXAMPLE');
    });

    it('should detect manual invoke for assumed IAM role', async () => {
      const event: LambdaEvent = {
        action: 'stop',
      };

      stsMock.on(GetCallerIdentityCommand).resolves({
        Arn: 'arn:aws:sts::123456789012:assumed-role/LightsOutExecutionRole/session-name',
        Account: '123456789012',
        UserId: 'AROAI1234567890EXAMPLE:session-name',
      });

      const result = await detectTriggerSource(event, mockContext);

      expect(result.type).toBe('manual-invoke');
      expect(result.displayName).toBe('LightsOutExecutionRole'); // Should extract role name, not session
      expect(result.identity).toBe(
        'arn:aws:sts::123456789012:assumed-role/LightsOutExecutionRole/session-name'
      );
    });

    it('should detect manual invoke for IAM role (not assumed)', async () => {
      const event: LambdaEvent = {
        action: 'status',
      };

      stsMock.on(GetCallerIdentityCommand).resolves({
        Arn: 'arn:aws:iam::123456789012:role/MyRole',
        Account: '123456789012',
        UserId: 'AROAI1234567890EXAMPLE',
      });

      const result = await detectTriggerSource(event, mockContext);

      expect(result.type).toBe('manual-invoke');
      expect(result.displayName).toBe('MyRole');
      expect(result.identity).toBe('arn:aws:iam::123456789012:role/MyRole');
    });

    it('should handle STS call failure gracefully', async () => {
      const event: LambdaEvent = {
        action: 'start',
      };

      stsMock.on(GetCallerIdentityCommand).rejects(new Error('STS service unavailable'));

      const result = await detectTriggerSource(event, mockContext);

      expect(result.type).toBe('unknown');
      expect(result.displayName).toBe('Unknown Source');
      expect(result.identity).toBe(mockContext.invokedFunctionArn);
    });

    it('should handle STS response with missing fields', async () => {
      const event: LambdaEvent = {
        action: 'start',
      };

      stsMock.on(GetCallerIdentityCommand).resolves({
        // Missing Arn, Account, UserId
      });

      const result = await detectTriggerSource(event, mockContext);

      expect(result.type).toBe('manual-invoke');
      expect(result.displayName).toBe('unknown');
      expect(result.identity).toBe('unknown');
      expect(result.metadata?.accountId).toBe('unknown');
    });
  });

  describe('Pre-provided trigger source', () => {
    it('should use trigger source from event if present (Teams Bot scenario)', async () => {
      const event: LambdaEvent = {
        action: 'start',
        triggerSource: {
          type: 'teams-bot',
          identity: 'teams-user-id-123',
          displayName: '@john.doe',
          metadata: {
            teamsMessageId: 'msg-456789',
          },
        },
      };

      const result = await detectTriggerSource(event, mockContext);

      expect(result.type).toBe('teams-bot');
      expect(result.displayName).toBe('@john.doe');
      expect(result.identity).toBe('teams-user-id-123');
      expect(result.metadata?.teamsMessageId).toBe('msg-456789');
    });

    it('should preserve all metadata from pre-provided trigger source', async () => {
      const event: LambdaEvent = {
        action: 'stop',
        triggerSource: {
          type: 'manual-invoke',
          identity: 'custom-identity',
          displayName: 'Custom Source',
          metadata: {
            customField1: 'value1',
            customField2: 42,
            customField3: true,
          },
        },
      };

      const result = await detectTriggerSource(event, mockContext);

      expect(result).toEqual(event.triggerSource);
      expect(result.metadata?.customField1).toBe('value1');
      expect(result.metadata?.customField2).toBe(42);
      expect(result.metadata?.customField3).toBe(true);
    });
  });

  describe('Unknown trigger source', () => {
    it('should fallback to unknown for unrecognized event structure', async () => {
      const event: LambdaEvent = {
        action: 'start',
        source: 'custom.source',
        'detail-type': 'Custom Event',
      };

      stsMock.on(GetCallerIdentityCommand).rejects(new Error('Access denied'));

      const result = await detectTriggerSource(event, mockContext);

      expect(result.type).toBe('unknown');
      expect(result.displayName).toBe('Unknown Source');
      expect(result.identity).toBe(mockContext.invokedFunctionArn);
    });

    it('should handle empty event gracefully', async () => {
      const event: LambdaEvent = {};

      stsMock.on(GetCallerIdentityCommand).rejects(new Error('Network error'));

      const result = await detectTriggerSource(event, mockContext);

      expect(result.type).toBe('unknown');
      expect(result.displayName).toBe('Unknown Source');
    });
  });

  describe('ARN parsing edge cases', () => {
    it('should handle malformed EventBridge ARN', async () => {
      const event: LambdaEvent = {
        action: 'start',
        source: 'aws.events',
        'detail-type': 'Scheduled Event',
        resources: ['malformed-arn-without-slashes'],
      };

      const result = await detectTriggerSource(event, mockContext);

      expect(result.type).toBe('eventbridge-scheduled');
      // Should still extract something from malformed ARN
      expect(result.displayName).toBe('malformed-arn-without-slashes');
    });

    it('should extract region from Lambda function ARN', async () => {
      const event: LambdaEvent = {
        action: 'start',
      };

      stsMock.on(GetCallerIdentityCommand).resolves({
        Arn: 'arn:aws:iam::123456789012:user/test-user',
        Account: '123456789012',
        UserId: 'AIDAI123',
      });

      const result = await detectTriggerSource(event, mockContext);

      // Verify result is manual-invoke
      expect(result.type).toBe('manual-invoke');
      expect(result.displayName).toBe('test-user');
    });

    it('should use default region if ARN parsing fails', async () => {
      const malformedContext = {
        ...mockContext,
        invokedFunctionArn: 'not-a-valid-arn',
      } as Context;

      const event: LambdaEvent = {
        action: 'start',
      };

      stsMock.on(GetCallerIdentityCommand).resolves({
        Arn: 'arn:aws:iam::123456789012:user/test-user',
        Account: '123456789012',
        UserId: 'AIDAI123',
      });

      const result = await detectTriggerSource(event, malformedContext);

      // Should still work with default region
      expect(result.type).toBe('manual-invoke');
      expect(result.displayName).toBe('test-user');
    });
  });
});

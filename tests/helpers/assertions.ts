/**
 * Custom assertion helpers for tests.
 *
 * Provides domain-specific assertions for common test scenarios.
 */

import { expect } from 'vitest';
import type {
  HandlerResult,
  OrchestrationResult,
  LambdaExecutionResult,
  DiscoveryResult,
} from '@shared/types';

/**
 * Asserts that a HandlerResult represents a successful operation.
 *
 * @param result - Handler result to check
 * @param action - Expected action
 * @param resourceId - Optional expected resource ID
 */
export function assertSuccessfulResult(
  result: HandlerResult,
  action: string,
  resourceId?: string
): void {
  expect(result.success).toBe(true);
  expect(result.action).toBe(action);
  expect(result.message).toBeDefined();
  expect(result.error).toBeUndefined();

  if (resourceId) {
    expect(result.resourceId).toBe(resourceId);
  }
}

/**
 * Asserts that a HandlerResult represents a failed operation.
 *
 * @param result - Handler result to check
 * @param action - Expected action
 * @param expectedError - Optional expected error message substring
 */
export function assertFailedResult(
  result: HandlerResult,
  action: string,
  expectedError?: string
): void {
  expect(result.success).toBe(false);
  expect(result.action).toBe(action);
  expect(result.error).toBeDefined();

  if (expectedError) {
    expect(result.error).toContain(expectedError);
  }
}

/**
 * Asserts that an OrchestrationResult has expected counts.
 *
 * @param result - Orchestration result to check
 * @param expected - Expected counts
 */
export function assertOrchestrationCounts(
  result: OrchestrationResult,
  expected: {
    total: number;
    succeeded: number;
    failed: number;
  }
): void {
  expect(result.total).toBe(expected.total);
  expect(result.succeeded).toBe(expected.succeeded);
  expect(result.failed).toBe(expected.failed);
  expect(result.results).toHaveLength(expected.total);
}

/**
 * Asserts that a Lambda response has expected structure and status.
 *
 * @param response - Lambda response object
 * @param expectedStatus - Expected HTTP status code
 */
export function assertLambdaResponse(
  response: { statusCode: number; body: string },
  expectedStatus: number
): void {
  expect(response).toBeDefined();
  expect(response.statusCode).toBe(expectedStatus);
  expect(response.body).toBeDefined();

  // Ensure body is valid JSON
  expect(() => JSON.parse(response.body) as unknown).not.toThrow();
}

/**
 * Asserts that a Lambda response body contains expected fields.
 *
 * @param responseBody - Parsed Lambda response body
 * @param expectedFields - Array of field names that should exist
 */
export function assertResponseFields(
  responseBody: Record<string, unknown>,
  expectedFields: string[]
): void {
  for (const field of expectedFields) {
    expect(responseBody).toHaveProperty(field);
  }
}

/**
 * Asserts that a successful Lambda execution result is valid.
 *
 * @param result - Lambda execution result
 * @param action - Expected action
 */
export function assertValidExecutionResult(result: LambdaExecutionResult, action: string): void {
  expect(result.action).toBe(action);
  expect(result.total).toBeGreaterThanOrEqual(0);
  expect(result.succeeded).toBeGreaterThanOrEqual(0);
  expect(result.failed).toBeGreaterThanOrEqual(0);
  expect(result.succeeded + result.failed).toBe(result.total);
  expect(result.results).toHaveLength(result.total);
  expect(result.timestamp).toBeDefined();
  expect(result.request_id).toBeDefined();

  // Validate timestamp is ISO format
  expect(() => new Date(result.timestamp)).not.toThrow();
}

/**
 * Asserts that a discovery result is valid.
 *
 * @param result - Discovery result
 */
export function assertValidDiscoveryResult(result: DiscoveryResult): void {
  expect(result.action).toBe('discover');
  expect(result.discovered_count).toBeGreaterThanOrEqual(0);
  expect(result.resources).toHaveLength(result.discovered_count);
  expect(result.timestamp).toBeDefined();
  expect(result.request_id).toBeDefined();

  // Validate each resource has required fields
  for (const resource of result.resources) {
    expect(resource.resource_type).toBeDefined();
    expect(resource.resource_id).toBeDefined();
    expect(resource.arn).toBeDefined();
    expect(resource.priority).toBeGreaterThanOrEqual(0);
    expect(resource.group).toBeDefined();
  }
}

/**
 * Asserts that an error response has expected structure.
 *
 * @param responseBody - Parsed error response body
 * @param expectedErrorSubstring - Optional expected error message substring
 */
export function assertErrorResponse(
  responseBody: Record<string, unknown>,
  expectedErrorSubstring?: string
): void {
  expect(responseBody).toHaveProperty('error');
  expect(responseBody).toHaveProperty('timestamp');
  expect(responseBody).toHaveProperty('request_id');

  if (expectedErrorSubstring) {
    expect(String(responseBody.error)).toContain(expectedErrorSubstring);
  }
}

/**
 * Asserts that all results in an orchestration have the same action.
 *
 * @param result - Orchestration result
 * @param expectedAction - Expected action
 */
export function assertAllResultsHaveAction(
  result: OrchestrationResult,
  expectedAction: string
): void {
  for (const handlerResult of result.results) {
    expect(handlerResult.action).toBe(expectedAction);
  }
}

/**
 * Asserts that a mix of success and failure results is present.
 *
 * @param result - Orchestration result
 */
export function assertMixedResults(result: OrchestrationResult): void {
  expect(result.succeeded).toBeGreaterThan(0);
  expect(result.failed).toBeGreaterThan(0);

  const successCount = result.results.filter((r) => r.success).length;
  const failCount = result.results.filter((r) => !r.success).length;

  expect(successCount).toBe(result.succeeded);
  expect(failCount).toBe(result.failed);
}

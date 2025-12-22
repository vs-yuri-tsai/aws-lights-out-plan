/**
 * Core types and utilities for resource handlers.
 *
 * Defines the common interface that all concrete resource handlers must implement.
 * Each handler is responsible for performing start, stop, and status operations
 * on a specific AWS resource type (e.g., ECS Service, RDS Instance).
 */

import type { HandlerResult, Config } from "@/types";

export type { HandlerResult, Config };

/**
 * Interface that all concrete resource handlers must implement.
 *
 * This interface defines the common operations that can be performed on
 * any managed resource. Each handler is responsible for implementing
 * these methods for their specific AWS resource type.
 */
export interface ResourceHandler {
  /**
   * Retrieve the current status of the resource.
   *
   * This method should query the AWS API to get the resource's current state.
   * The returned object structure is resource-type specific.
   *
   * @returns Promise resolving to resource status information
   * @throws Error if unable to retrieve status (e.g., resource not found)
   *
   * @example
   * // For ECS Service:
   * {
   *   desired_count: 1,
   *   running_count: 1,
   *   status: "ACTIVE",
   *   is_stopped: false
   * }
   */
  getStatus(): Promise<Record<string, unknown>>;

  /**
   * Start or enable the resource.
   *
   * This method should:
   * 1. Check current state (idempotent check)
   * 2. Perform the start operation via AWS API
   * 3. Optionally wait for the resource to reach ready state
   * 4. Return a HandlerResult with operation outcome
   *
   * @returns Promise resolving to HandlerResult object
   */
  start(): Promise<HandlerResult>;

  /**
   * Stop or disable the resource.
   *
   * This method should:
   * 1. Check current state (idempotent check)
   * 2. Perform the stop operation via AWS API
   * 3. Optionally wait for the resource to reach stopped state
   * 4. Return a HandlerResult with operation outcome
   *
   * @returns Promise resolving to HandlerResult object
   */
  stop(): Promise<HandlerResult>;

  /**
   * Check if the resource has reached its desired state.
   *
   * This method is used when wait_for_stable is enabled to determine
   * if the resource has completed its state transition.
   *
   * @returns Promise resolving to true if resource is ready/stable, false otherwise
   */
  isReady(): Promise<boolean>;
}

/**
 * Extract resource-type-specific defaults from configuration.
 *
 * Utility function to get default settings for a specific resource type.
 *
 * @param config - Configuration object
 * @param resourceType - Resource type identifier
 * @returns Dictionary of default settings, or empty object if not configured
 */
export function getResourceDefaults(
  config: Config,
  resourceType: string
): Record<string, unknown> {
  return config.resource_defaults?.[resourceType] ?? {};
}

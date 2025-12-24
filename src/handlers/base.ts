/**
 * Core types and utilities for resource handlers.
 *
 * Defines the common interface that all concrete resource handlers must implement.
 * Each handler is responsible for performing start, stop, and status operations
 * on a specific AWS resource type (e.g., ECS Service, RDS Instance).
 */

import type { Config } from "@/types";

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

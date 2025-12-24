/**
 * Configuration loader for AWS lights-out scheduler.
 *
 * Loads configuration from AWS Systems Manager (SSM) Parameter Store,
 * validates the structure, and provides caching for performance.
 */

import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";
import { LRUCache } from "lru-cache";
import yaml from "js-yaml";
import { z } from "zod";
import type { Config } from "@/types";
import { setupLogger } from "@utils/logger";

const logger = setupLogger("lights-out:config");

/**
 * Configuration schema validation using Zod.
 *
 * Ensures the loaded config has all required fields with proper types.
 */
const ConfigSchema = z.object({
  version: z.string(),
  environment: z.string(),
  regions: z.array(z.string()).optional(),  // Optional list of AWS regions to scan
  discovery: z.object({
    method: z.string(),
    tags: z.record(z.string()).optional(),
    resource_types: z.array(z.string()).optional(),
  }).passthrough(),
  settings: z.object({
    schedule_tag: z.string().optional(),
  }).passthrough().optional(),
  resource_defaults: z.record(z.record(z.unknown())).optional(),
}).passthrough();

/**
 * Base exception for configuration errors.
 */
export class ConfigError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ConfigError";
  }
}

/**
 * Raised when the SSM parameter is not found.
 */
export class ParameterNotFoundError extends ConfigError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ParameterNotFoundError";
  }
}

/**
 * Raised when the configuration is missing required fields or is invalid.
 */
export class ConfigValidationError extends ConfigError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ConfigValidationError";
  }
}

/**
 * LRU cache for configuration objects.
 * Prevents unnecessary SSM API calls for the same parameter.
 */
const configCache = new LRUCache<string, Config>({
  max: 128,
  ttl: 1000 * 60 * 5, // 5 minutes TTL
});

/**
 * Loads configuration from an AWS SSM parameter.
 *
 * @param parameterName - The name of the SSM parameter
 * @param client - Optional SSM client for testing
 * @returns Parsed and validated configuration object
 *
 * @throws {ParameterNotFoundError} If the parameter is not found
 * @throws {ConfigError} If the configuration cannot be retrieved or parsed
 * @throws {ConfigValidationError} If required fields are missing
 */
export async function loadConfigFromSsm(
  parameterName: string,
  client?: SSMClient
): Promise<Config> {
  // Check cache first
  const cached = configCache.get(parameterName);
  if (cached) {
    logger.debug(`Using cached config for parameter: ${parameterName}`);
    return cached;
  }

  logger.info(`Loading config from SSM: ${parameterName}`);

  const ssmClient = client ?? new SSMClient({});

  // Fetch parameter from SSM
  let parameterValue: string;
  try {
    const command = new GetParameterCommand({ Name: parameterName });
    const response = await ssmClient.send(command);
    parameterValue = response.Parameter?.Value ?? "";

    if (!parameterValue) {
      throw new ConfigError(
        `SSM parameter ${parameterName} exists but has no value`
      );
    }
  } catch (error) {
    // Type guard for AWS SDK errors
    if (
      error &&
      typeof error === "object" &&
      "name" in error &&
      error.name === "ParameterNotFound"
    ) {
      throw new ParameterNotFoundError(
        `Could not find SSM parameter: ${parameterName}`,
        { cause: error }
      );
    }
    throw new ConfigError(`Failed to retrieve SSM parameter: ${String(error)}`, {
      cause: error,
    });
  }

  // Parse YAML
  let config: unknown;
  try {
    config = yaml.load(parameterValue);
  } catch (error) {
    throw new ConfigError(
      `Failed to parse YAML configuration from parameter ${parameterName}: ${String(error)}`,
      { cause: error }
    );
  }

  // Validate schema
  let validatedConfig: Config;
  try {
    validatedConfig = ConfigSchema.parse(config);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const missingFields = error.errors
        .filter((e) => e.code === "invalid_type")
        .map((e) => e.path.join("."));

      throw new ConfigValidationError(
        `Configuration validation failed. Missing or invalid fields: ${missingFields.join(", ")}`,
        { cause: error }
      );
    }
    throw new ConfigValidationError(
      `Configuration validation failed: ${String(error)}`,
      { cause: error }
    );
  }

  // Cache the validated config
  configCache.set(parameterName, validatedConfig);

  logger.info("Config loaded successfully");
  return validatedConfig;
}

/**
 * Clears the configuration cache.
 * Useful for testing or forcing a fresh config reload.
 */
export function clearConfigCache(): void {
  configCache.clear();
  logger.debug("Config cache cleared");
}

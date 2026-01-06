/**
 * DynamoDB configuration management for Teams integration.
 *
 * Handles reading and caching of project-specific Teams configurations.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { setupLogger } from '@shared/utils/logger';

const logger = setupLogger('lights-out:teams:config');

// DynamoDB client (singleton)
const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

/**
 * Teams configuration for a single project.
 */
export interface TeamsConfig {
  project: string;
  webhook_url: string;
  created_at: string;
  updated_at: string;
}

/**
 * Simple in-memory cache for configurations.
 * TTL: 10 minutes (reduces DynamoDB reads)
 */
const configCache = new Map<
  string,
  {
    config: TeamsConfig;
    expiresAt: number;
  }
>();

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Retrieve Teams configuration for a project from DynamoDB.
 *
 * Uses in-memory cache to reduce DynamoDB reads.
 *
 * @param project - Project identifier (e.g., "airsync-dev")
 * @returns Teams configuration or null if not found
 *
 * @example
 * const config = await getProjectConfig('airsync-dev');
 * if (config) {
 *   await sendNotification(config.webhook_url, message);
 * }
 */
export async function getProjectConfig(project: string): Promise<TeamsConfig | null> {
  // Check cache first
  const cached = configCache.get(project);
  if (cached && cached.expiresAt > Date.now()) {
    logger.debug({ project }, 'Config cache hit');
    return cached.config;
  }

  // Cache miss, fetch from DynamoDB
  logger.debug({ project }, 'Config cache miss, fetching from DynamoDB');

  const tableName = process.env.TEAMS_CONFIG_TABLE;
  if (!tableName) {
    logger.error('TEAMS_CONFIG_TABLE environment variable not set');
    return null;
  }

  try {
    const command = new GetCommand({
      TableName: tableName,
      Key: { project },
    });

    const result = await docClient.send(command);

    if (!result.Item) {
      logger.warn({ project }, 'No Teams config found for project');
      return null;
    }

    const config = result.Item as TeamsConfig;

    // Validate required fields
    if (!config.webhook_url) {
      logger.error({ project }, 'Config missing webhook_url');
      return null;
    }

    // Update cache
    configCache.set(project, {
      config,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });

    logger.info({ project }, 'Config fetched and cached');
    return config;
  } catch (error) {
    logger.error(
      {
        project,
        error: String(error),
      },
      'Failed to fetch config from DynamoDB'
    );
    return null;
  }
}

/**
 * Clear cache for a specific project.
 * Useful for testing or after manual config updates.
 *
 * @param project - Project identifier
 */
export function clearConfigCache(project?: string): void {
  if (project) {
    configCache.delete(project);
    logger.debug({ project }, 'Config cache cleared');
  } else {
    configCache.clear();
    logger.debug('All config cache cleared');
  }
}

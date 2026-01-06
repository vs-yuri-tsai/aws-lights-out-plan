/**
 * Orchestrator for AWS Lights Out Plan.
 *
 * Coordinates resource discovery and handler execution.
 * Ensures single resource failures don't interrupt the overall flow.
 */

import type {
  Config,
  DiscoveredResource,
  OrchestrationResult,
  HandlerResult,
  LambdaAction,
  ExecutionStrategy,
} from '@shared/types';
import { TagDiscovery } from '../discovery/tagDiscovery';
import { getHandler } from '../handlers/factory';
import { setupLogger } from '@shared/utils/logger';

const logger = setupLogger('lights-out:orchestrator');

export class Orchestrator {
  private readonly config: Config;

  constructor(config: Config) {
    this.config = config;
  }

  /**
   * Discover resources using tag-based discovery.
   *
   * @returns List of discovered resources
   */
  async discoverResources(): Promise<DiscoveredResource[]> {
    const discoveryConfig = this.config.discovery;

    // Extract tag filters and resource types from config
    const tagFilters = (discoveryConfig.tags as Record<string, string>) ?? {};
    const resourceTypes = (discoveryConfig.resource_types as string[]) ?? [];
    const regions = this.config.regions ?? [];

    if (Object.keys(tagFilters).length === 0) {
      logger.warn('No tag filters configured for discovery');
      return [];
    }

    if (resourceTypes.length === 0) {
      logger.warn('No resource types configured for discovery');
      return [];
    }

    logger.info(
      {
        tagFilters,
        resourceTypes,
        regions: regions.length > 0 ? regions : ['default (Lambda region)'],
      },
      'Starting tag-based resource discovery'
    );

    const discovery = new TagDiscovery(tagFilters, resourceTypes, regions);
    const resources = await discovery.discover();

    logger.info(`Discovered ${resources.length} resources`);
    return resources;
  }

  /**
   * Execute the lights-out plan for all discovered resources.
   *
   * @param action - Operation to perform ("start", "stop", "status")
   * @returns Orchestration result summary
   */
  async run(action: LambdaAction): Promise<OrchestrationResult> {
    logger.info({ action }, 'Starting orchestration');

    const resources = await this.discoverResources();

    // Sort resources by priority based on action type
    // START: ascending (lower priority first)
    // STOP: descending (higher priority first, so lower priority stops last)
    const sortedResources = this.sortResourcesByPriority(resources, action);

    logger.info(`Processing ${sortedResources.length} resources`);

    // Determine execution strategy
    const strategy =
      (this.config.settings?.execution_strategy as ExecutionStrategy) ?? 'grouped-parallel';
    logger.info({ strategy }, 'Using execution strategy');

    // Execute based on strategy
    let results: HandlerResult[];
    switch (strategy) {
      case 'sequential':
        results = await this.executeSequential(sortedResources, action);
        break;
      case 'parallel':
        results = await this.executeParallel(sortedResources, action);
        break;
      case 'grouped-parallel':
      default:
        results = await this.executeGroupedParallel(sortedResources, action);
        break;
    }

    // Calculate summary
    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    const summary: OrchestrationResult = {
      total: sortedResources.length,
      succeeded,
      failed,
      results,
    };

    logger.info(summary, 'Orchestration completed');

    return summary;
  }

  /**
   * Execute resources sequentially (one by one).
   * Safest approach but slowest.
   *
   * @param resources - Sorted resources
   * @param action - Operation to perform
   * @returns Handler results
   */
  private async executeSequential(
    resources: DiscoveredResource[],
    action: LambdaAction
  ): Promise<HandlerResult[]> {
    const results: HandlerResult[] = [];

    for (const resource of resources) {
      const result = await this.processResource(resource, action);
      results.push(result);
    }

    return results;
  }

  /**
   * Execute all resources in parallel (simultaneously).
   * Fastest approach but ignores dependencies.
   *
   * @param resources - Sorted resources (sorting ignored in parallel mode)
   * @param action - Operation to perform
   * @returns Handler results
   */
  private async executeParallel(
    resources: DiscoveredResource[],
    action: LambdaAction
  ): Promise<HandlerResult[]> {
    logger.warn('Parallel execution ignores priority-based dependencies');

    const promises = resources.map((resource) => this.processResource(resource, action));

    return await Promise.all(promises);
  }

  /**
   * Execute resources grouped by priority.
   * Same-priority resources run in parallel, different priorities run sequentially.
   * Balanced approach (recommended).
   *
   * @param resources - Sorted resources
   * @param action - Operation to perform
   * @returns Handler results
   */
  private async executeGroupedParallel(
    resources: DiscoveredResource[],
    action: LambdaAction
  ): Promise<HandlerResult[]> {
    const groups = this.groupByPriority(resources);

    logger.info(
      {
        groupCount: groups.length,
        groupSizes: groups.map((g) => g.length),
      },
      'Grouped resources by priority'
    );

    const allResults: HandlerResult[] = [];

    // Process each priority group sequentially
    for (const group of groups) {
      logger.debug(
        {
          priority: group[0]?.priority,
          resourceCount: group.length,
        },
        'Processing priority group'
      );

      // Within each group, process resources in parallel
      const groupPromises = group.map((resource) => this.processResource(resource, action));

      const groupResults = await Promise.all(groupPromises);
      allResults.push(...groupResults);

      // Log group completion
      const groupSucceeded = groupResults.filter((r) => r.success).length;
      const groupFailed = groupResults.filter((r) => !r.success).length;

      logger.info(
        {
          priority: group[0]?.priority,
          total: group.length,
          succeeded: groupSucceeded,
          failed: groupFailed,
        },
        'Priority group completed'
      );
    }

    return allResults;
  }

  /**
   * Process a single resource with the given action.
   * Handles errors gracefully without throwing.
   *
   * @param resource - Resource to process
   * @param action - Operation to perform
   * @returns Handler result
   */
  private async processResource(
    resource: DiscoveredResource,
    action: LambdaAction
  ): Promise<HandlerResult> {
    try {
      const handler = getHandler(resource.resourceType, resource, this.config);

      if (!handler) {
        logger.warn(
          {
            resourceId: resource.resourceId,
            resourceType: resource.resourceType,
          },
          'No handler available for resource type'
        );

        return {
          success: false,
          action,
          resourceType: resource.resourceType,
          resourceId: resource.resourceId,
          message: `No handler available for resource type: ${resource.resourceType}`,
          error: 'HANDLER_NOT_FOUND',
        };
      }

      // Execute action via handler
      let result: HandlerResult;

      switch (action) {
        case 'start':
          result = await handler.start();
          break;
        case 'stop':
          result = await handler.stop();
          break;
        case 'status': {
          const status = await handler.getStatus();
          result = {
            success: true,
            action: 'status',
            resourceType: resource.resourceType,
            resourceId: resource.resourceId,
            message: 'Status retrieved successfully',
            previousState: status,
          };
          break;
        }
        default:
          // This should never happen due to type safety, but keep for defensive coding
          logger.error(
            {
              action,
              resourceId: resource.resourceId,
            },
            'Invalid action'
          );

          return {
            success: false,
            action,
            resourceType: resource.resourceType,
            resourceId: resource.resourceId,
            message: `Invalid action: ${action}`,
            error: 'INVALID_ACTION',
          };
      }

      return result;
    } catch (error) {
      logger.error(
        {
          resourceId: resource.resourceId,
          resourceType: resource.resourceType,
          error: String(error),
        },
        'Failed to process resource'
      );

      return {
        success: false,
        action,
        resourceType: resource.resourceType,
        resourceId: resource.resourceId,
        message: `Failed to process resource: ${String(error)}`,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Group resources by priority value.
   * Resources with the same priority are grouped together.
   *
   * @param resources - Resources to group (should already be sorted)
   * @returns Array of resource groups, ordered by priority
   */
  private groupByPriority(resources: DiscoveredResource[]): DiscoveredResource[][] {
    const groups: DiscoveredResource[][] = [];
    let currentGroup: DiscoveredResource[] = [];
    let currentPriority: number | null = null;

    for (const resource of resources) {
      if (currentPriority === null || resource.priority !== currentPriority) {
        // New priority group
        if (currentGroup.length > 0) {
          groups.push(currentGroup);
        }
        currentGroup = [resource];
        currentPriority = resource.priority;
      } else {
        // Same priority, add to current group
        currentGroup.push(resource);
      }
    }

    // Don't forget the last group
    if (currentGroup.length > 0) {
      groups.push(currentGroup);
    }

    return groups;
  }

  /**
   * Sort resources by priority based on the action type.
   *
   * Priority logic:
   * - START: Lower priority values execute first (ascending order)
   *   Example: [p10, p20, p50] ensures foundational services start before dependent ones
   * - STOP: Higher priority values execute first (descending order)
   *   Example: [p50, p20, p10] ensures dependent services stop before foundational ones
   * - STATUS/DISCOVER: No sorting (preserve discovery order)
   *
   * @param resources - Discovered resources
   * @param action - Operation to perform
   * @returns Sorted resources array
   */
  private sortResourcesByPriority(
    resources: DiscoveredResource[],
    action: LambdaAction
  ): DiscoveredResource[] {
    // Only sort for start/stop operations
    if (action !== 'start' && action !== 'stop') {
      return resources;
    }

    const sorted = [...resources].sort((a, b) => {
      if (action === 'start') {
        // Ascending: lower priority first
        return a.priority - b.priority;
      } else {
        // Descending: higher priority first (lower priority stops last)
        return b.priority - a.priority;
      }
    });

    logger.debug(
      {
        action,
        sortOrder: action === 'start' ? 'ascending' : 'descending',
        priorities: sorted.map((r) => ({ id: r.resourceId, priority: r.priority })),
      },
      'Resources sorted by priority'
    );

    return sorted;
  }
}

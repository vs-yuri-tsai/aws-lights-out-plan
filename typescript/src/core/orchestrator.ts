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
} from "@/types";
import { TagDiscovery } from "@discovery/tagDiscovery";
import { getHandler } from "@handlers/factory";
import { setupLogger } from "@utils/logger";

const logger = setupLogger("lights-out:orchestrator");

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
      logger.warn("No tag filters configured for discovery");
      return [];
    }

    if (resourceTypes.length === 0) {
      logger.warn("No resource types configured for discovery");
      return [];
    }

    logger.info({
      tagFilters,
      resourceTypes,
      regions: regions.length > 0 ? regions : ["default (Lambda region)"],
    }, "Starting tag-based resource discovery");

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
    logger.info({ action }, "Starting orchestration");

    const resources = await this.discoverResources();

    logger.info(`Processing ${resources.length} resources`);

    const results: HandlerResult[] = [];
    let succeeded = 0;
    let failed = 0;

    for (const resource of resources) {
      try {
        const handler = getHandler(
          resource.resourceType,
          resource,
          this.config
        );

        if (!handler) {
          logger.warn({
            resourceId: resource.resourceId,
            resourceType: resource.resourceType,
          }, "No handler available for resource type");
          failed++;

          results.push({
            success: false,
            action,
            resourceType: resource.resourceType,
            resourceId: resource.resourceId,
            message: `No handler available for resource type: ${resource.resourceType}`,
            error: "HANDLER_NOT_FOUND",
          });
          continue;
        }

        // Execute action via handler
        let result: HandlerResult;

        switch (action) {
          case "start":
            result = await handler.start();
            break;
          case "stop":
            result = await handler.stop();
            break;
          case "status": {
            const status = await handler.getStatus();
            result = {
              success: true,
              action: "status",
              resourceType: resource.resourceType,
              resourceId: resource.resourceId,
              message: "Status retrieved successfully",
              previousState: status,
            };
            break;
          }
          default:
            // This should never happen due to type safety, but keep for defensive coding
            logger.error({
              action,
              resourceId: resource.resourceId,
            }, "Invalid action");
            failed++;
            results.push({
              success: false,
              action,
              resourceType: resource.resourceType,
              resourceId: resource.resourceId,
              message: `Invalid action: ${action}`,
              error: "INVALID_ACTION",
            });
            continue;
        }

        results.push(result);

        if (result.success) {
          succeeded++;
        } else {
          failed++;
        }
      } catch (error) {
        logger.error({
          resourceId: resource.resourceId,
          resourceType: resource.resourceType,
          error: String(error),
        }, "Failed to process resource");
        failed++;

        results.push({
          success: false,
          action,
          resourceType: resource.resourceType,
          resourceId: resource.resourceId,
          message: `Failed to process resource: ${String(error)}`,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const summary: OrchestrationResult = {
      total: resources.length,
      succeeded,
      failed,
      results,
    };

    logger.info(summary, "Orchestration completed");

    return summary;
  }
}

#!/usr/bin/env node
/**
 * AWS Resource Discovery MCP Server
 *
 * Provides tools for discovering AWS resources (ECS, RDS) and
 * generating Lights Out configuration recommendations.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';

import { verifyCredentials } from './tools/verifyCredentials.js';
import { discoverEcsServices } from './tools/discoverEcs.js';
import { discoverRdsInstances } from './tools/discoverRds.js';
import { listAvailableRegions } from './tools/listRegions.js';
import { scanBackendProject } from './tools/scanBackendProject.js';
import { analyzeDependencies } from './tools/analyzeDependencies.js';
import { listDiscoveryReports } from './tools/listDiscoveryReports.js';
import { parseDiscoveryReport } from './tools/parseDiscoveryReport.js';
import { applyTagsViaApi } from './tools/applyTagsViaApi.js';
import { verifyTags } from './tools/verifyTags.js';
import {
  VerifyCredentialsInputSchema,
  DiscoverEcsInputSchema,
  DiscoverRdsInputSchema,
  ScanBackendProjectInputSchema,
  AnalyzeDependenciesInputSchema,
  ListDiscoveryReportsInputSchema,
  ParseDiscoveryReportInputSchema,
  ApplyTagsViaApiInputSchema,
  VerifyTagsInputSchema,
} from './types.js';

const server = new Server(
  {
    name: 'lights-out-discovery',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: { listChanged: false },
    },
  }
);

// Handle tool listing
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'list_available_regions',
        description:
          'List all available AWS regions grouped by geography. Use this first to show users the region options before discovery.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'verify_credentials',
        description: 'Verify AWS credentials and return account identity information',
        inputSchema: {
          type: 'object',
          properties: {
            profile: {
              type: 'string',
              description: 'AWS profile name (optional, uses default credentials if not specified)',
            },
          },
        },
      },
      {
        name: 'discover_ecs_services',
        description:
          'Discover all ECS services in specified AWS regions, including Auto Scaling configuration, launch type, Task Definition analysis, and container roles (scheduler, webhook, sidecar, etc.)',
        inputSchema: {
          type: 'object',
          properties: {
            regions: {
              type: 'array',
              items: { type: 'string' },
              description: 'AWS regions to scan (e.g., ["ap-southeast-1", "us-east-1"])',
            },
          },
          required: ['regions'],
        },
      },
      {
        name: 'discover_rds_instances',
        description:
          'Discover all RDS instances in specified AWS regions, including tags, configuration, Aurora cluster membership, read replica status, and Lights Out compatibility analysis',
        inputSchema: {
          type: 'object',
          properties: {
            regions: {
              type: 'array',
              items: { type: 'string' },
              description: 'AWS regions to scan (e.g., ["ap-southeast-1", "us-east-1"])',
            },
          },
          required: ['regions'],
        },
      },
      {
        name: 'scan_backend_project',
        description:
          'Scan a backend project directory for HTTP calls, environment variable usage, and infer service dependencies. Supports TypeScript/JavaScript, Python, and Go projects.',
        inputSchema: {
          type: 'object',
          properties: {
            directory: {
              type: 'string',
              description: 'Path to the backend project directory to scan',
            },
            serviceName: {
              type: 'string',
              description:
                'Name of the service this project represents (optional, inferred from directory name if not provided)',
            },
          },
          required: ['directory'],
        },
      },
      {
        name: 'analyze_dependencies',
        description:
          'Analyze service dependencies from multiple sources (ECS discovery, IaC scan, backend project analysis) and generate risk analysis, service groups, and recommended startup/shutdown order',
        inputSchema: {
          type: 'object',
          properties: {
            ecsServices: {
              type: 'array',
              description: 'ECS services from discover_ecs_services result',
            },
            backendAnalysis: {
              type: 'array',
              description: 'Results from scan_backend_project (can be multiple projects)',
            },
          },
        },
      },
      // Apply Tags tools
      {
        name: 'list_discovery_reports',
        description:
          'List available discovery reports from the reports directory, extracting account ID and date information',
        inputSchema: {
          type: 'object',
          properties: {
            accountId: {
              type: 'string',
              description: 'Filter by AWS account ID (optional)',
            },
            directory: {
              type: 'string',
              description: 'Custom reports directory (optional, defaults to ./reports)',
            },
          },
        },
      },
      {
        name: 'parse_discovery_report',
        description:
          'Parse a discovery report markdown file and extract resources, classifying them into autoApply (low risk), needConfirmation (high risk), and excluded (not supported) categories',
        inputSchema: {
          type: 'object',
          properties: {
            reportPath: {
              type: 'string',
              description: 'Path to the discovery report file',
            },
          },
          required: ['reportPath'],
        },
      },
      {
        name: 'apply_tags_via_api',
        description:
          'Apply Lights Out tags to AWS resources (ECS services, RDS instances) via AWS SDK APIs. Supports dry-run mode for preview.',
        inputSchema: {
          type: 'object',
          properties: {
            resources: {
              type: 'array',
              description: 'Resources to tag (ARN, type, tags)',
              items: {
                type: 'object',
                properties: {
                  arn: { type: 'string' },
                  type: { type: 'string', enum: ['ecs-service', 'rds-db'] },
                  tags: {
                    type: 'object',
                    properties: {
                      'lights-out:managed': { type: 'string' },
                      'lights-out:project': { type: 'string' },
                      'lights-out:priority': { type: 'string' },
                    },
                  },
                },
              },
            },
            dryRun: {
              type: 'boolean',
              description: 'Preview mode - no actual changes (default: false)',
            },
            profile: {
              type: 'string',
              description: 'AWS profile name (optional)',
            },
          },
          required: ['resources'],
        },
      },
      {
        name: 'verify_tags',
        description: 'Verify that Lights Out tags have been successfully applied to AWS resources',
        inputSchema: {
          type: 'object',
          properties: {
            resources: {
              type: 'array',
              description: 'Resources to verify (ARN, type, expectedTags)',
              items: {
                type: 'object',
                properties: {
                  arn: { type: 'string' },
                  type: { type: 'string', enum: ['ecs-service', 'rds-db'] },
                  expectedTags: {
                    type: 'object',
                    properties: {
                      'lights-out:managed': { type: 'string' },
                      'lights-out:project': { type: 'string' },
                      'lights-out:priority': { type: 'string' },
                    },
                  },
                },
              },
            },
            profile: {
              type: 'string',
              description: 'AWS profile name (optional)',
            },
          },
          required: ['resources'],
        },
      },
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'list_available_regions': {
        const result = listAvailableRegions();
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'verify_credentials': {
        const input = VerifyCredentialsInputSchema.parse(args);
        const result = await verifyCredentials(input);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'discover_ecs_services': {
        const input = DiscoverEcsInputSchema.parse(args);
        const result = await discoverEcsServices(input);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'discover_rds_instances': {
        const input = DiscoverRdsInputSchema.parse(args);
        const result = await discoverRdsInstances(input);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'scan_backend_project': {
        const input = ScanBackendProjectInputSchema.parse(args);
        const result = await scanBackendProject(input);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'analyze_dependencies': {
        const input = AnalyzeDependenciesInputSchema.parse(args);
        const result = await analyzeDependencies(input);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      // Apply Tags tools
      case 'list_discovery_reports': {
        const input = ListDiscoveryReportsInputSchema.parse(args);
        const result = await listDiscoveryReports(input);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'parse_discovery_report': {
        const input = ParseDiscoveryReportInputSchema.parse(args);
        const result = await parseDiscoveryReport(input);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'apply_tags_via_api': {
        const input = ApplyTagsViaApiInputSchema.parse(args);
        const result = await applyTagsViaApi(input);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'verify_tags': {
        const input = VerifyTagsInputSchema.parse(args);
        const result = await verifyTags(input);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      default:
        return {
          content: [
            {
              type: 'text',
              text: `Unknown tool: ${name}`,
            },
          ],
          isError: true,
        };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${errorMessage}`,
        },
      ],
      isError: true,
    };
  }
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Lights Out Discovery MCP Server started');
}

main().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});

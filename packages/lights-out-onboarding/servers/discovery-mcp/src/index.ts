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
import { scanIacDirectory } from './tools/scanIacDirectory.js';
import { scanBackendProject } from './tools/scanBackendProject.js';
import { analyzeDependencies } from './tools/analyzeDependencies.js';
import {
  VerifyCredentialsInputSchema,
  DiscoverEcsInputSchema,
  DiscoverRdsInputSchema,
  ScanIacDirectoryInputSchema,
  ScanBackendProjectInputSchema,
  AnalyzeDependenciesInputSchema,
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
        name: 'scan_iac_directory',
        description:
          'Scan a directory for Infrastructure as Code files (Terraform, CloudFormation, Terragrunt) and extract ECS/RDS resource definitions to provide context for analysis',
        inputSchema: {
          type: 'object',
          properties: {
            directory: {
              type: 'string',
              description: 'Path to the IaC project directory to scan',
            },
            includeSnippets: {
              type: 'boolean',
              description:
                'Whether to include code snippets around resource definitions (default: false)',
            },
          },
          required: ['directory'],
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
            iacScanResult: {
              type: 'object',
              description: 'Result from scan_iac_directory',
            },
            backendAnalysis: {
              type: 'array',
              description: 'Results from scan_backend_project (can be multiple projects)',
            },
          },
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

      case 'scan_iac_directory': {
        const input = ScanIacDirectoryInputSchema.parse(args);
        const result = await scanIacDirectory(input);
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

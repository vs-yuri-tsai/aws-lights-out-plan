/**
 * IaC Directory Scanner Tool
 *
 * Scans a directory for Infrastructure as Code files (Terraform, CloudFormation, Terragrunt)
 * and extracts resource definitions to provide context for Lights Out analysis.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { IacScanResult, IacResourceDefinition, IacFileInfo } from '../types.js';

// Supported IaC file patterns
const IAC_PATTERNS = {
  terraform: ['.tf', '.tf.json'],
  terragrunt: ['terragrunt.hcl'],
  cloudformation: ['.yaml', '.yml', '.json', '.template'],
};

// Resource type patterns to look for
const RESOURCE_PATTERNS = {
  ecs: [
    /resource\s+"aws_ecs_service"/g,
    /resource\s+"aws_ecs_cluster"/g,
    /resource\s+"aws_ecs_task_definition"/g,
    /AWS::ECS::Service/g,
    /AWS::ECS::Cluster/g,
    /AWS::ECS::TaskDefinition/g,
  ],
  rds: [
    /resource\s+"aws_db_instance"/g,
    /resource\s+"aws_rds_cluster"/g,
    /resource\s+"aws_rds_cluster_instance"/g,
    /AWS::RDS::DBInstance/g,
    /AWS::RDS::DBCluster/g,
  ],
  autoscaling: [
    /resource\s+"aws_appautoscaling_target"/g,
    /resource\s+"aws_appautoscaling_policy"/g,
    /AWS::ApplicationAutoScaling::ScalableTarget/g,
  ],
};

/**
 * Recursively find all IaC files in a directory
 */
function findIacFiles(dir: string, maxDepth: number = 5, currentDepth: number = 0): IacFileInfo[] {
  const files: IacFileInfo[] = [];

  if (currentDepth > maxDepth) {
    return files;
  }

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      // Skip common non-IaC directories
      if (entry.isDirectory()) {
        const skipDirs = ['node_modules', '.git', '.terraform', 'vendor', 'dist', 'build'];
        if (!skipDirs.includes(entry.name)) {
          files.push(...findIacFiles(fullPath, maxDepth, currentDepth + 1));
        }
        continue;
      }

      if (!entry.isFile()) continue;

      // Check if file matches IaC patterns
      const ext = path.extname(entry.name);
      const fileName = entry.name;

      let iacType: IacFileInfo['type'] | null = null;

      // Check Terragrunt first (more specific)
      if (IAC_PATTERNS.terragrunt.includes(fileName)) {
        iacType = 'terragrunt';
      }
      // Check Terraform
      else if (IAC_PATTERNS.terraform.some((p) => fileName.endsWith(p))) {
        iacType = 'terraform';
      }
      // Check CloudFormation (need to verify content)
      else if (IAC_PATTERNS.cloudformation.includes(ext)) {
        // Quick check for CloudFormation markers
        try {
          const content = fs.readFileSync(fullPath, 'utf-8').slice(0, 1000);
          if (
            content.includes('AWSTemplateFormatVersion') ||
            content.includes('Resources:') ||
            content.includes('"Resources"')
          ) {
            iacType = 'cloudformation';
          }
        } catch {
          // Skip files we can't read
        }
      }

      if (iacType) {
        files.push({
          path: fullPath,
          relativePath: path.relative(dir, fullPath),
          type: iacType,
          fileName: entry.name,
        });
      }
    }
  } catch (error) {
    // Directory not accessible, skip
  }

  return files;
}

/**
 * Extract resource definitions from file content
 */
function extractResources(content: string, filePath: string): IacResourceDefinition[] {
  const resources: IacResourceDefinition[] = [];

  // Check ECS resources
  for (const pattern of RESOURCE_PATTERNS.ecs) {
    const matches = content.matchAll(pattern);
    for (const match of matches) {
      resources.push({
        type: 'ecs',
        resourceType: match[0],
        file: filePath,
        lineNumber: getLineNumber(content, match.index || 0),
      });
    }
  }

  // Check RDS resources
  for (const pattern of RESOURCE_PATTERNS.rds) {
    const matches = content.matchAll(pattern);
    for (const match of matches) {
      resources.push({
        type: 'rds',
        resourceType: match[0],
        file: filePath,
        lineNumber: getLineNumber(content, match.index || 0),
      });
    }
  }

  // Check Auto Scaling resources
  for (const pattern of RESOURCE_PATTERNS.autoscaling) {
    const matches = content.matchAll(pattern);
    for (const match of matches) {
      resources.push({
        type: 'autoscaling',
        resourceType: match[0],
        file: filePath,
        lineNumber: getLineNumber(content, match.index || 0),
      });
    }
  }

  return resources;
}

/**
 * Get line number from character index
 */
function getLineNumber(content: string, index: number): number {
  return content.slice(0, index).split('\n').length;
}

/**
 * Extract a code snippet around a match
 */
function extractSnippet(content: string, lineNumber: number, contextLines: number = 5): string {
  const lines = content.split('\n');
  const start = Math.max(0, lineNumber - contextLines - 1);
  const end = Math.min(lines.length, lineNumber + contextLines);
  return lines.slice(start, end).join('\n');
}

/**
 * Scan a directory for IaC files and extract resource definitions
 */
export async function scanIacDirectory(input: {
  directory: string;
  includeSnippets?: boolean;
}): Promise<IacScanResult> {
  const { directory, includeSnippets = false } = input;

  // Validate directory exists
  if (!fs.existsSync(directory)) {
    return {
      success: false,
      error: `目錄不存在: ${directory}`,
      directory,
      files: [],
      resources: [],
      summary: {
        totalFiles: 0,
        terraform: 0,
        terragrunt: 0,
        cloudformation: 0,
        ecsResources: 0,
        rdsResources: 0,
        autoscalingResources: 0,
      },
    };
  }

  const stats = fs.statSync(directory);
  if (!stats.isDirectory()) {
    return {
      success: false,
      error: `路徑不是目錄: ${directory}`,
      directory,
      files: [],
      resources: [],
      summary: {
        totalFiles: 0,
        terraform: 0,
        terragrunt: 0,
        cloudformation: 0,
        ecsResources: 0,
        rdsResources: 0,
        autoscalingResources: 0,
      },
    };
  }

  // Find all IaC files
  const files = findIacFiles(directory);
  const resources: IacResourceDefinition[] = [];

  // Process each file
  for (const file of files) {
    try {
      const content = fs.readFileSync(file.path, 'utf-8');
      const fileResources = extractResources(content, file.relativePath);

      // Add snippets if requested
      if (includeSnippets) {
        for (const resource of fileResources) {
          resource.snippet = extractSnippet(content, resource.lineNumber);
        }
      }

      resources.push(...fileResources);
    } catch (error) {
      // Skip files we can't read
    }
  }

  // Build summary
  const summary = {
    totalFiles: files.length,
    terraform: files.filter((f) => f.type === 'terraform').length,
    terragrunt: files.filter((f) => f.type === 'terragrunt').length,
    cloudformation: files.filter((f) => f.type === 'cloudformation').length,
    ecsResources: resources.filter((r) => r.type === 'ecs').length,
    rdsResources: resources.filter((r) => r.type === 'rds').length,
    autoscalingResources: resources.filter((r) => r.type === 'autoscaling').length,
  };

  return {
    success: true,
    directory,
    files,
    resources,
    summary,
  };
}

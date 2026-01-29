/**
 * Parse Discovery Report Tool
 *
 * Parses a discovery report markdown file and extracts resource information,
 * classifying resources into autoApply, needConfirmation, and excluded categories.
 */

import * as fs from 'fs';
import * as path from 'path';
import type {
  ParseDiscoveryReportInput,
  ParseDiscoveryReportResult,
  ParsedEcsResource,
  ParsedRdsResource,
  LightsOutTags,
  RiskLevel,
  ResourceClassification,
} from '../types.js';

/**
 * Extract AWS account ID from report content or file path
 */
function extractAccountId(content: string, reportPath: string): string {
  // Try to extract from content
  const accountMatch = content.match(/\*\*AWS 帳號：\*\*\s*(\d{12})/);
  if (accountMatch) {
    return accountMatch[1];
  }

  // Fall back to directory name
  const dirName = path.basename(path.dirname(reportPath));
  if (/^\d{12}$/.test(dirName)) {
    return dirName;
  }

  return 'unknown';
}

/**
 * Extract regions from report content
 */
function extractRegions(content: string): string[] {
  const regionMatch = content.match(/\*\*探索區域：\*\*\s*(.+)/);
  if (regionMatch) {
    return regionMatch[1].split(',').map((r) => r.trim());
  }
  return [];
}

/**
 * Extract project name from cluster name
 * Example: 'vs-account-service-ecs-cluster-dev' => 'vs-account'
 *
 * Pattern: looks for common suffixes like '-ecs-cluster-{env}', '-service-{env}', etc.
 * and extracts the meaningful prefix before them.
 */
function extractProjectFromClusterName(clusterName: string): string | null {
  if (!clusterName) return null;

  // Common patterns to remove from cluster names
  const patternsToRemove = [
    /-ecs-cluster-\w+$/i, // vs-account-service-ecs-cluster-dev
    /-cluster-\w+$/i, // vs-account-cluster-dev
    /-ecs-\w+$/i, // vs-account-ecs-dev
    /-service-\w+$/i, // vs-account-service-dev (if no ecs-cluster)
  ];

  let project = clusterName;

  for (const pattern of patternsToRemove) {
    if (pattern.test(project)) {
      project = project.replace(pattern, '');
      break;
    }
  }

  // If we still have a meaningful prefix (at least 2 characters), return it
  if (project && project.length >= 2 && project !== clusterName) {
    return project;
  }

  return null;
}

/**
 * Extract project name, prioritizing cluster name over service names
 * Returns null if no meaningful project can be detected (user should be asked)
 */
function extractProjectName(clusterNames: string[], _serviceNames: string[]): string | null {
  // First, try to extract from cluster name
  if (clusterNames.length > 0) {
    // Use the most common cluster name
    const clusterCounts = new Map<string, number>();
    for (const cluster of clusterNames) {
      clusterCounts.set(cluster, (clusterCounts.get(cluster) || 0) + 1);
    }
    const mostCommonCluster = [...clusterCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

    if (mostCommonCluster) {
      const project = extractProjectFromClusterName(mostCommonCluster);
      if (project) {
        return project;
      }
    }
  }

  // If cluster name doesn't yield a result, return null to prompt user
  return null;
}

/**
 * Parse ECS services table from report
 */
function parseEcsTable(
  content: string,
  accountId: string,
  projectName: string | null
): ParsedEcsResource[] {
  const resources: ParsedEcsResource[] = [];

  // Find ECS Services section
  const ecsSection = content.match(
    /## ECS Services\n\n([\s\S]*?)(?=\n##|\n---|\n### 高風險服務說明|$)/
  );
  if (!ecsSection) return resources;

  // Parse table rows
  const tableContent = ecsSection[1];
  const rows = tableContent
    .split('\n')
    .filter((line) => line.startsWith('|') && !line.includes('---'));

  // Skip header row
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const cells = row
      .split('|')
      .map((c) => c.trim())
      .filter((c) => c);

    if (cells.length < 7) continue;

    const [region, cluster, serviceName, statusStr, autoScalingStr, riskLevelStr, supportStr] =
      cells;

    // Parse status (e.g., "1/1" -> { desired: 1, running: 1 })
    const statusMatch = statusStr.match(/(\d+)\/(\d+)/);
    const status = statusMatch ? `${statusMatch[1]}/${statusMatch[2]}` : statusStr;

    // Parse auto scaling
    const hasAutoScaling = autoScalingStr.includes('✅');
    const autoScalingRange = autoScalingStr.match(/\((\d+-\d+)\)/)?.[1];

    // Parse risk level
    const riskLevel: RiskLevel = riskLevelStr.includes('high')
      ? 'high'
      : riskLevelStr.includes('medium')
        ? 'medium'
        : 'low';

    // Parse lights out support
    const lightsOutSupport: 'supported' | 'caution' | 'not-supported' = supportStr.includes(
      'supported'
    )
      ? 'supported'
      : supportStr.includes('caution')
        ? 'caution'
        : 'not-supported';

    // Determine classification
    let classification: ResourceClassification;
    let classificationReason: string;

    // Parse status to check if service is stopped (0/0)
    const isServiceStopped = status === '0/0';

    if (lightsOutSupport === 'not-supported') {
      classification = 'excluded';
      classificationReason = 'Resource type not supported by Lights Out';
    } else if (isServiceStopped) {
      // Services with 0/0 status need confirmation - they may be intentionally stopped
      classification = 'needConfirmation';
      classificationReason = '服務目前已停止 (0/0)，請確認是否要納入 Lights Out 管理';
    } else if (riskLevel === 'high' || lightsOutSupport === 'caution') {
      classification = 'needConfirmation';
      classificationReason =
        riskLevel === 'high'
          ? 'High risk service (scheduler/webhook role) - requires confirmation'
          : 'Service requires caution - please review before applying';
    } else {
      classification = 'autoApply';
      classificationReason = 'Low risk service with full Lights Out support';
    }

    // Generate ARN
    const arn = `arn:aws:ecs:${region}:${accountId}:service/${cluster}/${serviceName}`;

    // Suggest tags based on risk level
    // Use empty string for project if not detected (skill will ask user)
    const suggestedTags: LightsOutTags = {
      'lights-out:managed': 'true',
      'lights-out:project': projectName || '',
      'lights-out:priority': riskLevel === 'high' ? '100' : '50',
    };

    resources.push({
      region,
      cluster,
      serviceName,
      arn,
      status,
      hasAutoScaling,
      autoScalingRange,
      riskLevel,
      lightsOutSupport,
      classification,
      classificationReason,
      suggestedTags,
    });
  }

  return resources;
}

/**
 * Parse RDS instances table from report
 */
function parseRdsTable(
  content: string,
  accountId: string,
  projectName: string | null
): ParsedRdsResource[] {
  const resources: ParsedRdsResource[] = [];

  // Find RDS Instances section
  const rdsSection = content.match(
    /## RDS Instances\n\n([\s\S]*?)(?=\n##|\n---|\n### 不支援的實例說明|$)/
  );
  if (!rdsSection) return resources;

  // Parse table rows
  const tableContent = rdsSection[1];
  const rows = tableContent
    .split('\n')
    .filter((line) => line.startsWith('|') && !line.includes('---'));

  // Skip header row
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const cells = row
      .split('|')
      .map((c) => c.trim())
      .filter((c) => c);

    if (cells.length < 6) continue;

    const [region, instanceId, engineStr, status, instanceType, supportStr] = cells;

    // Check if this is a Read Replica (by instance ID pattern or support string)
    const isReadReplica =
      instanceId.toLowerCase().includes('replica') ||
      instanceId.toLowerCase().includes('read-replica') ||
      supportStr.toLowerCase().includes('read-replica') ||
      supportStr.toLowerCase().includes('replica');

    // Parse lights out support
    let lightsOutSupport: 'supported' | 'cluster-managed' | 'not-supported';
    if (isReadReplica) {
      lightsOutSupport = 'not-supported';
    } else if (supportStr.includes('supported') && !supportStr.includes('not-supported')) {
      lightsOutSupport = 'supported';
    } else if (supportStr.includes('cluster-managed')) {
      lightsOutSupport = 'cluster-managed';
    } else {
      lightsOutSupport = 'not-supported';
    }

    // Determine classification
    let classification: ResourceClassification;
    let classificationReason: string;

    if (isReadReplica) {
      classification = 'excluded';
      classificationReason = 'Read Replica 不適合獨立啟停，應跟隨主資料庫';
    } else if (lightsOutSupport === 'supported') {
      classification = 'autoApply';
      classificationReason = 'Standard RDS instance with full Lights Out support';
    } else if (lightsOutSupport === 'cluster-managed') {
      classification = 'excluded';
      classificationReason =
        'Aurora cluster member - must be managed via cluster (not yet supported)';
    } else {
      classification = 'excluded';
      classificationReason = 'RDS type not supported';
    }

    // Generate ARN
    const arn = `arn:aws:rds:${region}:${accountId}:db:${instanceId}`;

    // Suggest tags only for supported instances
    // Use empty string for project if not detected (skill will ask user)
    let suggestedTags: LightsOutTags | undefined;
    if (lightsOutSupport === 'supported') {
      suggestedTags = {
        'lights-out:managed': 'true',
        'lights-out:project': projectName || '',
        'lights-out:priority': '100', // RDS should start first, stop last
      };
    }

    resources.push({
      region,
      instanceId,
      arn,
      engine: engineStr,
      status,
      instanceType,
      lightsOutSupport,
      classification,
      classificationReason,
      suggestedTags,
    });
  }

  return resources;
}

/**
 * Parses a discovery report markdown file.
 *
 * @param input - Input parameters
 * @returns Parsed resources with classification
 */
export async function parseDiscoveryReport(
  input: ParseDiscoveryReportInput
): Promise<ParseDiscoveryReportResult> {
  const { reportPath } = input;

  try {
    // Check if file exists
    if (!fs.existsSync(reportPath)) {
      return {
        success: false,
        error: `Report file not found: ${reportPath}`,
        reportPath,
        accountId: 'unknown',
        regions: [],
        detectedProject: null,
        ecsResources: [],
        rdsResources: [],
        summary: {
          totalEcs: 0,
          totalRds: 0,
          autoApply: 0,
          needConfirmation: 0,
          excluded: 0,
        },
        categorized: {
          autoApply: [],
          needConfirmation: [],
          excluded: [],
        },
      };
    }

    // Read report content
    const content = fs.readFileSync(reportPath, 'utf-8');

    // Extract metadata
    const accountId = extractAccountId(content, reportPath);
    const regions = extractRegions(content);

    // First pass: extract cluster names and service names to find project name
    const ecsSection = content.match(
      /## ECS Services\n\n([\s\S]*?)(?=\n##|\n---|\n### 高風險服務說明|$)/
    );
    const clusterNames: string[] = [];
    const serviceNames: string[] = [];
    if (ecsSection) {
      const tableContent = ecsSection[1];
      const rows = tableContent
        .split('\n')
        .filter((line) => line.startsWith('|') && !line.includes('---'));
      for (let i = 1; i < rows.length; i++) {
        const cells = rows[i]
          .split('|')
          .map((c) => c.trim())
          .filter((c) => c);
        if (cells.length >= 3) {
          clusterNames.push(cells[1]); // cluster is the 2nd column
          serviceNames.push(cells[2]); // serviceName is the 3rd column
        }
      }
    }

    // Extract project name from cluster name (priority) or service names
    const detectedProject = extractProjectName(clusterNames, serviceNames);

    // Parse resources with project name
    const ecsResources = parseEcsTable(content, accountId, detectedProject);
    const rdsResources = parseRdsTable(content, accountId, detectedProject);

    // Categorize resources
    const allResources = [...ecsResources, ...rdsResources];
    const categorized = {
      autoApply: allResources.filter((r) => r.classification === 'autoApply'),
      needConfirmation: allResources.filter((r) => r.classification === 'needConfirmation'),
      excluded: allResources.filter((r) => r.classification === 'excluded'),
    };

    return {
      success: true,
      reportPath,
      accountId,
      regions,
      detectedProject,
      ecsResources,
      rdsResources,
      summary: {
        totalEcs: ecsResources.length,
        totalRds: rdsResources.length,
        autoApply: categorized.autoApply.length,
        needConfirmation: categorized.needConfirmation.length,
        excluded: categorized.excluded.length,
      },
      categorized,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: `Failed to parse report: ${errorMessage}`,
      reportPath,
      accountId: 'unknown',
      regions: [],
      detectedProject: null,
      ecsResources: [],
      rdsResources: [],
      summary: {
        totalEcs: 0,
        totalRds: 0,
        autoApply: 0,
        needConfirmation: 0,
        excluded: 0,
      },
      categorized: {
        autoApply: [],
        needConfirmation: [],
        excluded: [],
      },
    };
  }
}

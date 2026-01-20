/**
 * Type definitions for AWS Resource Discovery MCP Server
 */

import { z } from 'zod';

// ============================================================================
// Credential Types
// ============================================================================

export interface CredentialVerificationResult {
  valid: boolean;
  identity?: {
    account: string;
    arn: string;
    userId: string;
  };
  error?: string;
}

// ============================================================================
// ECS Service Types
// ============================================================================

export interface AutoScalingConfig {
  minCapacity: number;
  maxCapacity: number;
  scalableTargetArn?: string;
}

// ============================================================================
// Container & Task Definition Types
// ============================================================================

/**
 * Container role classification for risk assessment
 */
export type ContainerRole =
  | 'scheduler' // Cron jobs, scheduled tasks
  | 'worker' // Background job processors
  | 'webhook' // Webhook handlers
  | 'api' // API servers
  | 'ui' // Frontend/UI servers
  | 'sidecar' // Sidecars (otel, envoy, etc.)
  | 'unknown';

/**
 * Risk level for lights-out operations
 */
export type RiskLevel = 'low' | 'medium' | 'high';

/**
 * Container information from Task Definition
 */
export interface ContainerInfo {
  name: string;
  image: string;
  essential: boolean;
  stopTimeout: number | null;
  memory: number;
  cpu: number;
  role: ContainerRole;
  riskLevel: RiskLevel;
  riskReasons: string[];
}

/**
 * Task Definition analysis result
 */
export interface TaskDefinitionAnalysis {
  taskDefinitionArn: string;
  family: string;
  revision: number;
  containers: ContainerInfo[];
  overallRiskLevel: RiskLevel;
  riskSummary: string[];
  recommendations: string[];
}

export interface EcsServiceInfo {
  region: string;
  clusterName: string;
  serviceName: string;
  arn: string;
  desiredCount: number;
  runningCount: number;
  status: string;
  launchType?: string;
  hasAutoScaling: boolean;
  autoScalingConfig?: AutoScalingConfig;
  tags: Record<string, string>;
  hasLightsOutTags: boolean;
  // New: Task Definition analysis
  taskDefinition?: TaskDefinitionAnalysis;
}

// ============================================================================
// RDS Instance Types
// ============================================================================

/**
 * Lights Out support level for RDS instances
 */
export type RdsLightsOutSupport =
  | 'supported' // Can be stopped/started directly
  | 'cluster-managed' // Aurora cluster member - must stop/start via cluster
  | 'not-supported' // Cannot be stopped (e.g., read replica, serverless v1)
  | 'unknown';

/**
 * RDS instance configuration analysis for Lights Out compatibility
 */
export interface RdsConfigAnalysis {
  /** Whether this instance supports Lights Out operations */
  supportLevel: RdsLightsOutSupport;
  /** Reasons explaining the support level */
  reasons: string[];
  /** Recommendations for this instance */
  recommendations: string[];
  /** Warning messages if any */
  warnings: string[];
}

export interface RdsInstanceInfo {
  region: string;
  instanceId: string;
  arn: string;
  engine: string;
  engineVersion: string;
  status: string;
  instanceClass: string;
  multiAZ: boolean;
  tags: Record<string, string>;
  hasLightsOutTags: boolean;
  // New fields for Lights Out compatibility analysis
  /** Whether this is an Aurora cluster member */
  isAuroraClusterMember: boolean;
  /** Aurora cluster identifier if applicable */
  clusterIdentifier?: string;
  /** Whether this is a read replica */
  isReadReplica: boolean;
  /** Source DB instance if this is a replica */
  sourceDBInstanceIdentifier?: string;
  /** Whether this is Aurora Serverless */
  isAuroraServerless: boolean;
  /** Storage type (for cost estimation) */
  storageType?: string;
  /** Allocated storage in GB */
  allocatedStorage?: number;
  /** Lights Out configuration analysis */
  configAnalysis: RdsConfigAnalysis;
}

// ============================================================================
// Analysis Types
// ============================================================================

export interface ResourceRecommendation {
  resourceId: string;
  resourceType: 'ecs-service' | 'rds-db';
  recommendation: 'recommended' | 'caution' | 'not-recommended';
  reason: string;
  suggestedConfig?: Record<string, unknown>;
}

export interface ResourceAnalysis {
  totalResources: number;
  alreadyTagged: number;
  recommendedForLightsOut: number;
  potentialMonthlySavings?: string;
  recommendations: ResourceRecommendation[];
}

// ============================================================================
// Input Schemas (Zod)
// ============================================================================

export const VerifyCredentialsInputSchema = z.object({
  profile: z.string().optional().describe('AWS profile name (optional)'),
});

export const DiscoverEcsInputSchema = z.object({
  regions: z.array(z.string()).min(1).describe('AWS regions to scan'),
});

export const DiscoverRdsInputSchema = z.object({
  regions: z.array(z.string()).min(1).describe('AWS regions to scan'),
});

// Container info schema for validation
const ContainerInfoSchema = z.object({
  name: z.string(),
  image: z.string(),
  essential: z.boolean(),
  stopTimeout: z.number().nullable(),
  memory: z.number(),
  cpu: z.number(),
  role: z.enum(['scheduler', 'worker', 'webhook', 'api', 'ui', 'sidecar', 'unknown']),
  riskLevel: z.enum(['low', 'medium', 'high']),
  riskReasons: z.array(z.string()),
});

const TaskDefinitionAnalysisSchema = z.object({
  taskDefinitionArn: z.string(),
  family: z.string(),
  revision: z.number(),
  containers: z.array(ContainerInfoSchema),
  overallRiskLevel: z.enum(['low', 'medium', 'high']),
  riskSummary: z.array(z.string()),
  recommendations: z.array(z.string()),
});

// RDS config analysis schema
const RdsConfigAnalysisSchema = z.object({
  supportLevel: z.enum(['supported', 'cluster-managed', 'not-supported', 'unknown']),
  reasons: z.array(z.string()),
  recommendations: z.array(z.string()),
  warnings: z.array(z.string()),
});

export type VerifyCredentialsInput = z.infer<typeof VerifyCredentialsInputSchema>;
export type DiscoverEcsInput = z.infer<typeof DiscoverEcsInputSchema>;
export type DiscoverRdsInput = z.infer<typeof DiscoverRdsInputSchema>;

// ============================================================================
// IaC Scanning Types
// ============================================================================

/**
 * IaC file type
 */
export type IacType = 'terraform' | 'terragrunt' | 'cloudformation';

/**
 * IaC resource category
 */
export type IacResourceCategory = 'ecs' | 'rds' | 'autoscaling';

/**
 * Information about a discovered IaC file
 */
export interface IacFileInfo {
  /** Absolute path to the file */
  path: string;
  /** Path relative to the scanned directory */
  relativePath: string;
  /** Type of IaC */
  type: IacType;
  /** File name */
  fileName: string;
}

/**
 * A resource definition found in IaC files
 */
export interface IacResourceDefinition {
  /** Resource category (ecs, rds, autoscaling) */
  type: IacResourceCategory;
  /** Full resource type string (e.g., "aws_ecs_service", "AWS::ECS::Service") */
  resourceType: string;
  /** File where the resource was found */
  file: string;
  /** Line number in the file */
  lineNumber: number;
  /** Code snippet around the resource definition */
  snippet?: string;
}

/**
 * Summary of IaC scan results
 */
export interface IacScanSummary {
  /** Total number of IaC files found */
  totalFiles: number;
  /** Number of Terraform files */
  terraform: number;
  /** Number of Terragrunt files */
  terragrunt: number;
  /** Number of CloudFormation files */
  cloudformation: number;
  /** Number of ECS resource definitions */
  ecsResources: number;
  /** Number of RDS resource definitions */
  rdsResources: number;
  /** Number of Auto Scaling resource definitions */
  autoscalingResources: number;
}

/**
 * Result of scanning an IaC directory
 */
export interface IacScanResult {
  /** Whether the scan was successful */
  success: boolean;
  /** Error message if scan failed */
  error?: string;
  /** Directory that was scanned */
  directory: string;
  /** List of IaC files found */
  files: IacFileInfo[];
  /** List of resource definitions found */
  resources: IacResourceDefinition[];
  /** Summary statistics */
  summary: IacScanSummary;
}

// Input schema for IaC scanning
export const ScanIacDirectoryInputSchema = z.object({
  directory: z.string().describe('IaC 專案的目錄路徑'),
  includeSnippets: z
    .boolean()
    .optional()
    .default(false)
    .describe('是否包含程式碼片段（預設 false）'),
});

export type ScanIacDirectoryInput = z.infer<typeof ScanIacDirectoryInputSchema>;

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
 * Environment variable from container definition
 */
export interface EnvironmentVariable {
  name: string;
  value?: string;
  /** Whether this is from secrets (SSM/Secrets Manager) */
  isSecret: boolean;
  /** Source ARN for secrets */
  secretArn?: string;
}

/**
 * Inferred service URL reference from environment variables
 */
export interface ServiceUrlReference {
  /** Environment variable name (e.g., "AUTH_SERVICE_URL") */
  envVarName: string;
  /** Value if available (e.g., "http://vs-auth-dev.internal") */
  value?: string;
  /** Inferred target service name */
  targetService?: string;
  /** Confidence level of the inference */
  confidence: 'high' | 'medium' | 'low';
}

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
  /** Environment variables (for dependency analysis) */
  environment?: EnvironmentVariable[];
  /** Inferred service URL references */
  serviceUrls?: ServiceUrlReference[];
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
export type IacResourceCategory =
  | 'ecs'
  | 'rds'
  | 'autoscaling'
  | 'security_group'
  | 'service_discovery'
  | 'load_balancer';

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
  /** Resource name (e.g., "main", "api") - Terraform resource name or CloudFormation logical ID */
  resourceName?: string;
  /** References to other resources (e.g., "aws_rds_cluster.db.endpoint") */
  references?: string[];
  /** Explicit depends_on declarations */
  dependsOn?: string[];
  /** Security group references */
  securityGroups?: string[];
}

/**
 * A dependency edge between two resources
 */
export interface DependencyEdge {
  /** Source resource identifier */
  from: string;
  /** Target resource identifier */
  to: string;
  /** Type of dependency */
  type: 'depends_on' | 'reference' | 'security_group' | 'env_var' | 'code_analysis';
  /** Confidence level */
  confidence: 'high' | 'medium' | 'low';
  /** Evidence for this dependency (file:line or description) */
  evidence?: string;
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
  /** Number of Security Group resource definitions */
  securityGroupResources: number;
  /** Number of Service Discovery resource definitions */
  serviceDiscoveryResources: number;
  /** Number of Load Balancer resource definitions */
  loadBalancerResources: number;
  /** Number of dependency edges discovered */
  dependencyEdges: number;
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
  /** Dependency graph edges discovered from IaC */
  dependencyGraph?: DependencyEdge[];
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

// ============================================================================
// Backend Project Analysis Types
// ============================================================================

/**
 * Detected programming language
 */
export type ProjectLanguage = 'typescript' | 'javascript' | 'python' | 'go' | 'unknown';

/**
 * HTTP call reference found in code
 */
export interface HttpCallReference {
  /** File where the call was found */
  file: string;
  /** Line number */
  lineNumber: number;
  /** HTTP method if detected */
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'unknown';
  /** URL or URL pattern */
  url: string;
  /** Whether URL contains environment variable */
  usesEnvVar: boolean;
  /** Environment variable name if used */
  envVarName?: string;
}

/**
 * Environment variable usage found in code
 */
export interface EnvVarUsage {
  /** Environment variable name */
  name: string;
  /** File where it's used */
  file: string;
  /** Line number */
  lineNumber: number;
  /** Whether this looks like a service URL */
  isServiceUrl: boolean;
}

/**
 * Inferred dependency from code analysis
 */
export interface InferredDependency {
  /** Source service/project name */
  source: string;
  /** Target service name */
  target: string;
  /** Confidence level */
  confidence: 'high' | 'medium' | 'low';
  /** Evidence for this dependency */
  evidence: string[];
}

/**
 * Result of scanning a backend project
 */
export interface BackendProjectAnalysis {
  /** Whether the scan was successful */
  success: boolean;
  /** Error message if scan failed */
  error?: string;
  /** Directory that was scanned */
  directory: string;
  /** Detected programming language */
  language: ProjectLanguage;
  /** HTTP call references found */
  httpCalls: HttpCallReference[];
  /** Environment variable usages found */
  envVarUsages: EnvVarUsage[];
  /** Inferred service dependencies */
  inferredDependencies: InferredDependency[];
  /** Summary statistics */
  summary: {
    totalFiles: number;
    filesWithHttpCalls: number;
    uniqueEnvVars: number;
    inferredDependencies: number;
  };
}

// Input schema for backend project scanning
export const ScanBackendProjectInputSchema = z.object({
  directory: z.string().describe('後端專案的目錄路徑'),
  serviceName: z.string().optional().describe('此專案對應的服務名稱（可選）'),
});

export type ScanBackendProjectInput = z.infer<typeof ScanBackendProjectInputSchema>;

// ============================================================================
// Dependency Analysis Types
// ============================================================================

/**
 * Service node in dependency graph
 */
export interface ServiceNode {
  /** Service name/identifier */
  name: string;
  /** Source of information */
  source: 'ecs' | 'iac' | 'code';
  /** Risk level if available */
  riskLevel?: RiskLevel;
  /** Whether it has Lights Out tags */
  hasLightsOutTags?: boolean;
}

/**
 * Risk analysis for dependencies
 */
export interface DependencyRiskItem {
  /** Service name */
  service: string;
  /** Service it depends on */
  dependsOn: string;
  /** Risk description */
  risk: string;
  /** Recommendation */
  recommendation: string;
}

/**
 * Group of services that should be managed together
 */
export interface ServiceGroup {
  /** Services in this group */
  services: string[];
  /** Reason for grouping */
  reason: string;
}

/**
 * Complete dependency risk analysis
 */
export interface DependencyRiskAnalysis {
  /** High risk dependencies */
  highRiskDependencies: DependencyRiskItem[];
  /** Service groups that should be managed together */
  serviceGroups: ServiceGroup[];
  /** Recommended shutdown order */
  shutdownOrder: string[];
  /** Recommended startup order */
  startupOrder: string[];
}

/**
 * Result of dependency analysis
 */
export interface DependencyAnalysisResult {
  /** Service nodes */
  services: ServiceNode[];
  /** Dependency edges */
  edges: DependencyEdge[];
  /** Risk analysis */
  riskAnalysis: DependencyRiskAnalysis;
}

// Input schema for dependency analysis
export const AnalyzeDependenciesInputSchema = z.object({
  ecsServices: z.array(z.any()).optional().describe('ECS services from discover_ecs_services'),
  iacScanResult: z.any().optional().describe('Result from scan_iac_directory'),
  backendAnalysis: z.array(z.any()).optional().describe('Results from scan_backend_project'),
});

export type AnalyzeDependenciesInput = z.infer<typeof AnalyzeDependenciesInputSchema>;

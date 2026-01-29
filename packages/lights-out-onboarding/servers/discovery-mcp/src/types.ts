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
// Dependency Edge Type (shared)
// ============================================================================

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
  backendAnalysis: z.array(z.any()).optional().describe('Results from scan_backend_project'),
});

export type AnalyzeDependenciesInput = z.infer<typeof AnalyzeDependenciesInputSchema>;

// ============================================================================
// Apply Tags Types
// ============================================================================

/**
 * Information about a discovery report file
 */
export interface DiscoveryReportInfo {
  /** Absolute path to the report file */
  path: string;
  /** AWS account ID extracted from directory name */
  accountId: string;
  /** Report date extracted from filename (YYYYMMDD) */
  date: string;
  /** File name */
  fileName: string;
  /** File size in bytes */
  size: number;
  /** Last modified time */
  modifiedAt: string;
}

/**
 * Result of listing discovery reports
 */
export interface ListDiscoveryReportsResult {
  success: boolean;
  error?: string;
  reports: DiscoveryReportInfo[];
  summary: {
    totalReports: number;
    accounts: string[];
  };
}

/**
 * Lights Out tags to apply
 */
export interface LightsOutTags {
  /** Whether the resource is managed by Lights Out */
  'lights-out:managed': 'true' | 'false';
  /** Project name (extracted from common service name prefix) */
  'lights-out:project': string;
  /** Priority for startup/shutdown order (lower = earlier) */
  'lights-out:priority': string;
}

/**
 * Resource classification for tag application
 */
export type ResourceClassification = 'autoApply' | 'needConfirmation' | 'excluded';

/**
 * ECS resource extracted from report
 */
export interface ParsedEcsResource {
  region: string;
  cluster: string;
  serviceName: string;
  arn: string;
  status: string;
  hasAutoScaling: boolean;
  autoScalingRange?: string;
  riskLevel: RiskLevel;
  lightsOutSupport: 'supported' | 'caution' | 'not-supported';
  classification: ResourceClassification;
  classificationReason: string;
  suggestedTags: LightsOutTags;
}

/**
 * RDS resource extracted from report
 */
export interface ParsedRdsResource {
  region: string;
  instanceId: string;
  arn: string;
  engine: string;
  status: string;
  instanceType: string;
  lightsOutSupport: 'supported' | 'cluster-managed' | 'not-supported';
  classification: ResourceClassification;
  classificationReason: string;
  suggestedTags?: LightsOutTags;
}

/**
 * Result of parsing a discovery report
 */
export interface ParseDiscoveryReportResult {
  success: boolean;
  error?: string;
  reportPath: string;
  accountId: string;
  regions: string[];
  /** Detected project name from cluster name, or null if not detected (user should be asked) */
  detectedProject: string | null;
  ecsResources: ParsedEcsResource[];
  rdsResources: ParsedRdsResource[];
  summary: {
    totalEcs: number;
    totalRds: number;
    autoApply: number;
    needConfirmation: number;
    excluded: number;
  };
  categorized: {
    autoApply: (ParsedEcsResource | ParsedRdsResource)[];
    needConfirmation: (ParsedEcsResource | ParsedRdsResource)[];
    excluded: (ParsedEcsResource | ParsedRdsResource)[];
  };
}

/**
 * Resource to apply tags to
 */
export interface ResourceToTag {
  /** Resource ARN */
  arn: string;
  /** Resource type */
  type: 'ecs-service' | 'rds-db';
  /** Tags to apply */
  tags: LightsOutTags;
}

/**
 * Result of applying tags to a single resource
 */
export interface TagApplicationResult {
  arn: string;
  type: 'ecs-service' | 'rds-db';
  status: 'success' | 'failed' | 'skipped';
  error?: string;
  appliedTags?: LightsOutTags;
}

/**
 * Result of applying tags via API
 */
export interface ApplyTagsResult {
  success: boolean;
  dryRun: boolean;
  results: TagApplicationResult[];
  summary: {
    total: number;
    succeeded: number;
    failed: number;
    skipped: number;
  };
}

/**
 * Result of verifying tags on a single resource
 */
export interface TagVerificationResult {
  arn: string;
  type: 'ecs-service' | 'rds-db';
  status: 'verified' | 'mismatch' | 'not-found' | 'error';
  expectedTags: LightsOutTags;
  actualTags?: Record<string, string>;
  mismatches?: string[];
  error?: string;
}

/**
 * Result of verifying tags
 */
export interface VerifyTagsResult {
  success: boolean;
  results: TagVerificationResult[];
  summary: {
    total: number;
    verified: number;
    mismatch: number;
    notFound: number;
    error: number;
  };
}

// Input schemas for Apply Tags tools

export const ListDiscoveryReportsInputSchema = z.object({
  accountId: z.string().optional().describe('Filter by AWS account ID (optional)'),
  directory: z
    .string()
    .optional()
    .describe('Custom reports directory (optional, defaults to ./reports)'),
});

export const ParseDiscoveryReportInputSchema = z.object({
  reportPath: z.string().describe('Path to the discovery report file'),
});

export const ApplyTagsViaApiInputSchema = z.object({
  resources: z
    .array(
      z.object({
        arn: z.string(),
        type: z.enum(['ecs-service', 'rds-db']),
        tags: z.object({
          'lights-out:managed': z.enum(['true', 'false']),
          'lights-out:project': z.string(),
          'lights-out:priority': z.string(),
        }),
      })
    )
    .min(1)
    .describe('Resources to tag'),
  dryRun: z.boolean().optional().default(false).describe('Preview mode (no actual changes)'),
  profile: z.string().optional().describe('AWS profile name (optional)'),
});

export const VerifyTagsInputSchema = z.object({
  resources: z
    .array(
      z.object({
        arn: z.string(),
        type: z.enum(['ecs-service', 'rds-db']),
        expectedTags: z.object({
          'lights-out:managed': z.enum(['true', 'false']),
          'lights-out:project': z.string(),
          'lights-out:priority': z.string(),
        }),
      })
    )
    .min(1)
    .describe('Resources to verify'),
  profile: z.string().optional().describe('AWS profile name (optional)'),
});

export type ListDiscoveryReportsInput = z.infer<typeof ListDiscoveryReportsInputSchema>;
export type ParseDiscoveryReportInput = z.infer<typeof ParseDiscoveryReportInputSchema>;
export type ApplyTagsViaApiInput = z.infer<typeof ApplyTagsViaApiInputSchema>;
export type VerifyTagsInput = z.infer<typeof VerifyTagsInputSchema>;

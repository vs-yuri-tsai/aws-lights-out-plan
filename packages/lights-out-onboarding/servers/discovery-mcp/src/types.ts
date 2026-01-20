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

export const AnalyzeResourcesInputSchema = z.object({
  resources: z.object({
    ecs: z.array(
      z.object({
        region: z.string(),
        clusterName: z.string(),
        serviceName: z.string(),
        arn: z.string(),
        desiredCount: z.number(),
        runningCount: z.number(),
        status: z.string(),
        launchType: z.string().optional(),
        hasAutoScaling: z.boolean(),
        autoScalingConfig: z
          .object({
            minCapacity: z.number(),
            maxCapacity: z.number(),
            scalableTargetArn: z.string().optional(),
          })
          .optional(),
        tags: z.record(z.string()),
        hasLightsOutTags: z.boolean(),
        taskDefinition: TaskDefinitionAnalysisSchema.optional(),
      })
    ),
    rds: z.array(
      z.object({
        region: z.string(),
        instanceId: z.string(),
        arn: z.string(),
        engine: z.string(),
        engineVersion: z.string(),
        status: z.string(),
        instanceClass: z.string(),
        multiAZ: z.boolean(),
        tags: z.record(z.string()),
        hasLightsOutTags: z.boolean(),
      })
    ),
  }),
});

export type VerifyCredentialsInput = z.infer<typeof VerifyCredentialsInputSchema>;
export type DiscoverEcsInput = z.infer<typeof DiscoverEcsInputSchema>;
export type DiscoverRdsInput = z.infer<typeof DiscoverRdsInputSchema>;
export type AnalyzeResourcesInput = z.infer<typeof AnalyzeResourcesInputSchema>;

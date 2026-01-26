/**
 * ECS Services Discovery Tool
 *
 * Discovers all ECS services across specified AWS regions,
 * including Auto Scaling configuration, tags, and Task Definition analysis.
 */

import {
  ECSClient,
  ListClustersCommand,
  ListServicesCommand,
  DescribeServicesCommand,
  DescribeTaskDefinitionCommand,
  ListTagsForResourceCommand,
} from '@aws-sdk/client-ecs';
import {
  ApplicationAutoScalingClient,
  DescribeScalableTargetsCommand,
  ServiceNamespace,
} from '@aws-sdk/client-application-auto-scaling';
import type {
  EcsServiceInfo,
  DiscoverEcsInput,
  AutoScalingConfig,
  ContainerInfo,
  ContainerRole,
  RiskLevel,
  TaskDefinitionAnalysis,
  EnvironmentVariable,
  ServiceUrlReference,
} from '../types.js';

const LIGHTS_OUT_TAG_KEY = 'lights-out:managed';

// Keywords for container role classification
const ROLE_KEYWORDS: Record<ContainerRole, string[]> = {
  scheduler: ['scheduler', 'cron', 'job', 'schedule', 'timer', 'periodic'],
  worker: ['worker', 'consumer', 'processor', 'handler', 'queue', 'background'],
  webhook: ['webhook', 'hook', 'callback', 'event-receiver'],
  api: ['api', 'server', 'service', 'gateway', 'backend', 'rest', 'graphql'],
  ui: ['ui', 'frontend', 'web', 'client', 'dashboard', 'portal', 'landing'],
  sidecar: [
    'otel',
    'collector',
    'envoy',
    'proxy',
    'sidecar',
    'agent',
    'datadog',
    'newrelic',
    'fluentd',
    'fluent-bit',
  ],
  unknown: [],
};

// Sidecar image patterns (these are typically low-risk)
const SIDECAR_IMAGE_PATTERNS = [
  'aws-otel-collector',
  'aws-xray-daemon',
  'envoyproxy',
  'datadog/agent',
  'newrelic',
  'fluent',
  'prometheus',
  'grafana',
];

// Patterns for service URL environment variables
const SERVICE_URL_PATTERNS = [
  /^(.+?)_SERVICE_URL$/i,
  /^(.+?)_SERVICE_HOST$/i,
  /^(.+?)_API_URL$/i,
  /^(.+?)_API_HOST$/i,
  /^(.+?)_HOST$/i,
  /^(.+?)_ENDPOINT$/i,
  /^(.+?)_BASE_URL$/i,
  /^(.+?)_URL$/i,
];

// Common infrastructure env vars to exclude from service URL detection
const INFRA_ENV_VAR_PREFIXES = [
  'AWS_',
  'DD_',
  'OTEL_',
  'NEW_RELIC_',
  'LOG_',
  'REDIS_',
  'DATABASE_',
  'DB_',
  'MONGO',
  'POSTGRES',
  'MYSQL',
  'ELASTIC',
  'KAFKA',
  'RABBITMQ',
  'SQS_',
  'SNS_',
  'S3_',
];

/**
 * Check if an environment variable name is likely infrastructure-related
 */
function isInfraEnvVar(name: string): boolean {
  const upperName = name.toUpperCase();
  return INFRA_ENV_VAR_PREFIXES.some((prefix) => upperName.startsWith(prefix));
}

/**
 * Extract service name from URL value
 */
function extractServiceNameFromUrl(url: string): string | undefined {
  try {
    // Try to parse as URL
    const parsed = new URL(url);
    const hostname = parsed.hostname;

    // Common patterns: vs-auth-dev.internal, auth-service.local, auth.svc.cluster.local
    const patterns = [
      /^([a-z0-9-]+)\.internal$/i,
      /^([a-z0-9-]+)\.local$/i,
      /^([a-z0-9-]+)\.svc\.cluster\.local$/i,
      /^([a-z0-9-]+)-service/i,
      /^vs-([a-z0-9-]+)/i,
    ];

    for (const pattern of patterns) {
      const match = hostname.match(pattern);
      if (match) {
        return match[1];
      }
    }

    // Fallback: use first part of hostname
    const parts = hostname.split('.');
    if (parts.length > 0) {
      return parts[0];
    }
  } catch {
    // Not a valid URL, try to extract from string
    const match = url.match(/([a-z0-9-]+)/i);
    if (match) {
      return match[1];
    }
  }
  return undefined;
}

/**
 * Infer service URL references from environment variables
 */
function inferServiceUrls(envVars: EnvironmentVariable[]): ServiceUrlReference[] {
  const serviceUrls: ServiceUrlReference[] = [];

  for (const envVar of envVars) {
    // Skip infrastructure env vars
    if (isInfraEnvVar(envVar.name)) continue;

    // Check if this looks like a service URL
    for (const pattern of SERVICE_URL_PATTERNS) {
      const match = envVar.name.match(pattern);
      if (match) {
        const servicePart = match[1];

        // Determine confidence level
        let confidence: 'high' | 'medium' | 'low' = 'low';
        let targetService: string | undefined;

        // High confidence: SERVICE_URL or API_URL patterns with a value
        if (
          envVar.name.endsWith('_SERVICE_URL') ||
          envVar.name.endsWith('_SERVICE_HOST') ||
          envVar.name.endsWith('_API_URL')
        ) {
          confidence = 'high';
        } else if (envVar.name.endsWith('_ENDPOINT') || envVar.name.endsWith('_HOST')) {
          confidence = 'medium';
        }

        // Try to extract service name from value if available
        if (envVar.value) {
          targetService = extractServiceNameFromUrl(envVar.value);
          if (targetService) {
            confidence = 'high';
          }
        }

        // If no service name from URL, use the env var prefix
        if (!targetService) {
          targetService = servicePart.toLowerCase().replace(/_/g, '-');
        }

        serviceUrls.push({
          envVarName: envVar.name,
          value: envVar.value,
          targetService,
          confidence,
        });

        break; // Only match first pattern
      }
    }
  }

  return serviceUrls;
}

/**
 * Classifies a container's role based on its name and image.
 */
function classifyContainerRole(name: string, image: string): ContainerRole {
  const lowerName = name.toLowerCase();
  const lowerImage = image.toLowerCase();

  // Check for sidecar patterns first (by image)
  for (const pattern of SIDECAR_IMAGE_PATTERNS) {
    if (lowerImage.includes(pattern)) {
      return 'sidecar';
    }
  }

  // Check role keywords by name
  for (const [role, keywords] of Object.entries(ROLE_KEYWORDS) as [ContainerRole, string[]][]) {
    if (role === 'unknown') continue;
    for (const keyword of keywords) {
      if (lowerName.includes(keyword)) {
        return role;
      }
    }
  }

  // Default classification based on common patterns
  if (lowerName.includes('main') || lowerName === lowerImage.split('/').pop()?.split(':')[0]) {
    return 'api'; // Main container is usually an API
  }

  return 'unknown';
}

/**
 * Assesses risk level for a container based on its role and configuration.
 */
function assessContainerRisk(container: {
  name: string;
  role: ContainerRole;
  stopTimeout: number | null;
  essential: boolean;
}): { riskLevel: RiskLevel; reasons: string[] } {
  const reasons: string[] = [];
  let riskLevel: RiskLevel = 'low';

  // High-risk roles
  if (container.role === 'scheduler') {
    riskLevel = 'high';
    reasons.push('Scheduler 可能有長時間執行的排程任務');
    reasons.push('停止時可能中斷正在執行的任務');
  } else if (container.role === 'worker') {
    riskLevel = 'high';
    reasons.push('Worker 可能正在處理 queue 中的任務');
    reasons.push('需要確保 graceful shutdown 機制');
  } else if (container.role === 'webhook') {
    riskLevel = 'medium';
    reasons.push('Webhook 停止時可能遺失外部系統的請求');
  }

  // Check stopTimeout
  if (container.stopTimeout === null || container.stopTimeout < 30) {
    if (container.role === 'scheduler' || container.role === 'worker') {
      reasons.push(
        `stopTimeout 未設定或過短 (${container.stopTimeout ?? 'null'})，建議設定 >= 60 秒`
      );
      if (riskLevel === 'low') riskLevel = 'medium';
    }
  }

  // Sidecar is always low risk
  if (container.role === 'sidecar') {
    return { riskLevel: 'low', reasons: ['Sidecar 容器，停止影響較小'] };
  }

  if (reasons.length === 0) {
    reasons.push('無特殊風險');
  }

  return { riskLevel, reasons };
}

/**
 * Analyzes a Task Definition and returns detailed container information.
 */
async function analyzeTaskDefinition(
  client: ECSClient,
  taskDefinitionArn: string
): Promise<TaskDefinitionAnalysis | undefined> {
  try {
    const response = await client.send(
      new DescribeTaskDefinitionCommand({ taskDefinition: taskDefinitionArn })
    );

    const taskDef = response.taskDefinition;
    if (!taskDef || !taskDef.containerDefinitions) {
      return undefined;
    }

    const containers: ContainerInfo[] = [];
    const riskSummary: string[] = [];
    const recommendations: string[] = [];
    let overallRiskLevel: RiskLevel = 'low';

    for (const containerDef of taskDef.containerDefinitions) {
      const name = containerDef.name || 'unknown';
      const image = containerDef.image || 'unknown';
      const role = classifyContainerRole(name, image);
      const { riskLevel, reasons } = assessContainerRisk({
        name,
        role,
        stopTimeout: containerDef.stopTimeout ?? null,
        essential: containerDef.essential ?? true,
      });

      // Extract environment variables
      const environment: EnvironmentVariable[] = [];

      // Regular environment variables
      if (containerDef.environment) {
        for (const env of containerDef.environment) {
          if (env.name) {
            environment.push({
              name: env.name,
              value: env.value || undefined,
              isSecret: false,
            });
          }
        }
      }

      // Secrets (from SSM/Secrets Manager)
      if (containerDef.secrets) {
        for (const secret of containerDef.secrets) {
          if (secret.name) {
            environment.push({
              name: secret.name,
              isSecret: true,
              secretArn: secret.valueFrom,
            });
          }
        }
      }

      // Infer service URLs from environment variables
      const serviceUrls = inferServiceUrls(environment);

      const containerInfo: ContainerInfo = {
        name,
        image,
        essential: containerDef.essential ?? true,
        stopTimeout: containerDef.stopTimeout ?? null,
        memory: containerDef.memory || 0,
        cpu: containerDef.cpu || 0,
        role,
        riskLevel,
        riskReasons: reasons,
      };

      // Only include environment and serviceUrls if they have content
      if (environment.length > 0) {
        containerInfo.environment = environment;
      }
      if (serviceUrls.length > 0) {
        containerInfo.serviceUrls = serviceUrls;
      }

      containers.push(containerInfo);

      // Update overall risk level
      if (riskLevel === 'high') {
        overallRiskLevel = 'high';
        riskSummary.push(`${name}: ${reasons[0]}`);
      } else if (riskLevel === 'medium' && overallRiskLevel !== 'high') {
        overallRiskLevel = 'medium';
        riskSummary.push(`${name}: ${reasons[0]}`);
      }
    }

    // Generate recommendations
    const highRiskContainers = containers.filter((c) => c.riskLevel === 'high');
    const noStopTimeoutContainers = containers.filter(
      (c) => c.stopTimeout === null && c.role !== 'sidecar'
    );

    if (highRiskContainers.length > 0) {
      recommendations.push(
        `建議為 ${highRiskContainers.map((c) => c.name).join(', ')} 實作 graceful shutdown`
      );
    }

    if (noStopTimeoutContainers.length > 0) {
      recommendations.push(
        `建議為 ${noStopTimeoutContainers.map((c) => c.name).join(', ')} 設定 stopTimeout (建議 60-120 秒)`
      );
    }

    if (overallRiskLevel === 'low') {
      riskSummary.push('所有容器風險等級均為低');
    }

    // Parse family and revision from ARN
    const arnParts = taskDefinitionArn.split(':');
    const familyRevision = arnParts[arnParts.length - 1];
    const [family, revisionStr] = familyRevision.split(':');

    return {
      taskDefinitionArn,
      family: family || taskDefinitionArn,
      revision: parseInt(revisionStr, 10) || 0,
      containers,
      overallRiskLevel,
      riskSummary,
      recommendations,
    };
  } catch (error) {
    // Log the error for debugging
    console.error(
      `[discoverEcs] Failed to analyze task definition: ${taskDefinitionArn}`,
      error instanceof Error ? error.message : error
    );
    return undefined;
  }
}

/**
 * Discovers ECS services in a single region.
 */
async function discoverInRegion(region: string): Promise<EcsServiceInfo[]> {
  const ecsClient = new ECSClient({ region });
  const autoScalingClient = new ApplicationAutoScalingClient({ region });
  const services: EcsServiceInfo[] = [];

  // List all clusters
  const clusters: string[] = [];
  let clusterNextToken: string | undefined;

  do {
    const listClustersResponse = await ecsClient.send(
      new ListClustersCommand({ nextToken: clusterNextToken })
    );
    if (listClustersResponse.clusterArns) {
      clusters.push(...listClustersResponse.clusterArns);
    }
    clusterNextToken = listClustersResponse.nextToken;
  } while (clusterNextToken);

  // For each cluster, list and describe services
  for (const clusterArn of clusters) {
    const clusterName = clusterArn.split('/').pop() || clusterArn;
    let serviceNextToken: string | undefined;

    do {
      const listServicesResponse = await ecsClient.send(
        new ListServicesCommand({
          cluster: clusterArn,
          nextToken: serviceNextToken,
        })
      );

      const serviceArns = listServicesResponse.serviceArns || [];

      if (serviceArns.length > 0) {
        // Describe services (max 10 at a time)
        for (let i = 0; i < serviceArns.length; i += 10) {
          const batch = serviceArns.slice(i, i + 10);
          const describeResponse = await ecsClient.send(
            new DescribeServicesCommand({
              cluster: clusterArn,
              services: batch,
            })
          );

          for (const service of describeResponse.services || []) {
            if (!service.serviceName || !service.serviceArn) continue;

            // Get tags
            const tags = await getServiceTags(ecsClient, service.serviceArn);

            // Check Auto Scaling
            const autoScalingConfig = await getAutoScalingConfig(
              autoScalingClient,
              clusterName,
              service.serviceName
            );

            // Analyze Task Definition
            let taskDefinition: TaskDefinitionAnalysis | undefined;
            if (service.taskDefinition) {
              // Add small delay to avoid API rate limiting
              await new Promise((resolve) => setTimeout(resolve, 100));
              taskDefinition = await analyzeTaskDefinition(ecsClient, service.taskDefinition);
              if (!taskDefinition) {
                console.warn(
                  `[discoverEcs] Task definition analysis returned undefined for ${service.serviceName}: ${service.taskDefinition}`
                );
              }
            } else {
              console.warn(
                `[discoverEcs] No task definition ARN found for service: ${service.serviceName}`
              );
            }

            const hasLightsOutTags = tags[LIGHTS_OUT_TAG_KEY] === 'true';

            services.push({
              region,
              clusterName,
              serviceName: service.serviceName,
              arn: service.serviceArn,
              desiredCount: service.desiredCount || 0,
              runningCount: service.runningCount || 0,
              status: service.status || 'UNKNOWN',
              launchType: service.launchType,
              hasAutoScaling: autoScalingConfig !== undefined,
              autoScalingConfig,
              tags,
              hasLightsOutTags,
              taskDefinition,
            });
          }
        }
      }

      serviceNextToken = listServicesResponse.nextToken;
    } while (serviceNextToken);
  }

  return services;
}

/**
 * Gets tags for an ECS service.
 */
async function getServiceTags(
  client: ECSClient,
  resourceArn: string
): Promise<Record<string, string>> {
  try {
    const response = await client.send(new ListTagsForResourceCommand({ resourceArn }));
    const tags: Record<string, string> = {};
    for (const tag of response.tags || []) {
      if (tag.key && tag.value !== undefined) {
        tags[tag.key] = tag.value;
      }
    }
    return tags;
  } catch (error) {
    // Log error and return empty tags
    console.warn(
      `[discoverEcs] Failed to fetch tags for: ${resourceArn}`,
      error instanceof Error ? error.message : error
    );
    return {};
  }
}

/**
 * Gets Auto Scaling configuration for an ECS service.
 */
async function getAutoScalingConfig(
  client: ApplicationAutoScalingClient,
  clusterName: string,
  serviceName: string
): Promise<AutoScalingConfig | undefined> {
  try {
    const resourceId = `service/${clusterName}/${serviceName}`;
    const response = await client.send(
      new DescribeScalableTargetsCommand({
        ServiceNamespace: ServiceNamespace.ECS,
        ResourceIds: [resourceId],
      })
    );

    const target = response.ScalableTargets?.[0];
    if (target) {
      return {
        minCapacity: target.MinCapacity || 0,
        maxCapacity: target.MaxCapacity || 0,
        scalableTargetArn: target.ScalableTargetARN,
      };
    }
    return undefined;
  } catch (error) {
    // No Auto Scaling configured is a normal case (not an error)
    // Only log unexpected errors
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (!errorMessage.includes('TargetNotFound') && !errorMessage.includes('ObjectNotFound')) {
      console.warn(
        `[discoverEcs] Failed to fetch Auto Scaling config for ${clusterName}/${serviceName}:`,
        errorMessage
      );
    }
    return undefined;
  }
}

/**
 * Discovers ECS services across multiple regions.
 *
 * @param input - Input parameters with regions to scan
 * @returns Object containing discovered services
 */
export async function discoverEcsServices(
  input: DiscoverEcsInput
): Promise<{ services: EcsServiceInfo[] }> {
  const { regions } = input;

  // Discover in all regions in parallel
  const regionPromises = regions.map((region) => discoverInRegion(region));
  const regionResults = await Promise.all(regionPromises);

  // Flatten results
  const services = regionResults.flat();

  return { services };
}

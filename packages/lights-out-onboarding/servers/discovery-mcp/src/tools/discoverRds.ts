/**
 * RDS Instances Discovery Tool
 *
 * Discovers all RDS instances across specified AWS regions,
 * including tags and configuration.
 */

import {
  RDSClient,
  DescribeDBInstancesCommand,
  ListTagsForResourceCommand,
} from '@aws-sdk/client-rds';
import type {
  RdsInstanceInfo,
  DiscoverRdsInput,
  RdsConfigAnalysis,
  RdsLightsOutSupport,
} from '../types.js';

const LIGHTS_OUT_TAG_KEY = 'lights-out:managed';

/**
 * Analyzes RDS instance configuration to determine Lights Out compatibility.
 */
function analyzeRdsConfig(instance: {
  engine: string;
  engineVersion: string;
  isAuroraClusterMember: boolean;
  isReadReplica: boolean;
  isAuroraServerless: boolean;
  multiAZ: boolean;
  instanceClass: string;
}): RdsConfigAnalysis {
  const reasons: string[] = [];
  const recommendations: string[] = [];
  const warnings: string[] = [];
  let supportLevel: RdsLightsOutSupport = 'supported';

  // Check Aurora Serverless v1 (not supported)
  if (instance.isAuroraServerless) {
    // Serverless v1 uses db.serverless instance class, v2 uses specific classes
    if (instance.instanceClass === 'db.serverless') {
      // This is likely Serverless v2 which supports start/stop
      reasons.push('Aurora Serverless v2 - 支援 cluster 級別啟停');
      supportLevel = 'cluster-managed';
    } else {
      supportLevel = 'not-supported';
      reasons.push('Aurora Serverless v1 不支援手動啟停');
      recommendations.push('考慮升級到 Aurora Serverless v2 以支援 Lights Out');
    }
  }

  // Check Read Replica (cannot be stopped independently)
  if (instance.isReadReplica) {
    supportLevel = 'not-supported';
    reasons.push('Read Replica 無法獨立停止');
    recommendations.push('需要先停止 source DB 或考慮刪除 replica');
    warnings.push('停止 source DB 會自動影響 replica');
  }

  // Check Aurora Cluster Member
  if (instance.isAuroraClusterMember && supportLevel !== 'not-supported') {
    supportLevel = 'cluster-managed';
    reasons.push('Aurora Cluster 成員 - 需透過 cluster 啟停');
    recommendations.push('使用 rds-cluster 類型而非 rds-db 來管理此資源');
    warnings.push(
      'Aurora Cluster 成員應透過 rds-cluster 類型統一管理，避免與 cluster 層級操作衝突'
    );
  }

  // Check Multi-AZ
  if (instance.multiAZ && supportLevel === 'supported') {
    reasons.push('Multi-AZ 配置 - 支援啟停但會影響高可用性');
    warnings.push('停止期間將失去 Multi-AZ 保護');
  }

  // Standard RDS instance
  if (supportLevel === 'supported') {
    reasons.push('標準 RDS instance - 完全支援 Lights Out 啟停');
    if (instance.engine.includes('aurora')) {
      recommendations.push('考慮此 instance 是否應該加入 Aurora Cluster 以獲得更好的可用性');
    }
  }

  return {
    supportLevel,
    reasons,
    recommendations,
    warnings,
  };
}

/**
 * Discovers RDS instances in a single region.
 */
async function discoverInRegion(region: string): Promise<RdsInstanceInfo[]> {
  const rdsClient = new RDSClient({ region });
  const instances: RdsInstanceInfo[] = [];

  let marker: string | undefined;

  do {
    const describeResponse = await rdsClient.send(
      new DescribeDBInstancesCommand({ Marker: marker })
    );

    for (const instance of describeResponse.DBInstances || []) {
      if (!instance.DBInstanceIdentifier || !instance.DBInstanceArn) continue;

      // Get tags
      const tags = await getInstanceTags(rdsClient, instance.DBInstanceArn);
      const hasLightsOutTags = tags[LIGHTS_OUT_TAG_KEY] === 'true';

      // Determine instance characteristics
      const engine = instance.Engine || 'unknown';
      const engineVersion = instance.EngineVersion || 'unknown';
      const instanceClass = instance.DBInstanceClass || 'unknown';
      const multiAZ = instance.MultiAZ || false;

      // Check if Aurora cluster member
      const isAuroraClusterMember = !!instance.DBClusterIdentifier;
      const clusterIdentifier = instance.DBClusterIdentifier;

      // Check if read replica
      const isReadReplica = !!instance.ReadReplicaSourceDBInstanceIdentifier;
      const sourceDBInstanceIdentifier = instance.ReadReplicaSourceDBInstanceIdentifier;

      // Check if Aurora Serverless
      // Aurora Serverless v1 has engine mode 'serverless'
      // Aurora Serverless v2 uses standard provisioned mode but with db.serverless class
      const isAuroraServerless =
        engine.includes('aurora') &&
        (instanceClass === 'db.serverless' || instance.DBInstanceStatus === 'serverless');

      // Analyze configuration for Lights Out compatibility
      const configAnalysis = analyzeRdsConfig({
        engine,
        engineVersion,
        isAuroraClusterMember,
        isReadReplica,
        isAuroraServerless,
        multiAZ,
        instanceClass,
      });

      instances.push({
        region,
        instanceId: instance.DBInstanceIdentifier,
        arn: instance.DBInstanceArn,
        engine,
        engineVersion,
        status: instance.DBInstanceStatus || 'unknown',
        instanceClass,
        multiAZ,
        tags,
        hasLightsOutTags,
        // New fields
        isAuroraClusterMember,
        clusterIdentifier,
        isReadReplica,
        sourceDBInstanceIdentifier,
        isAuroraServerless,
        storageType: instance.StorageType,
        allocatedStorage: instance.AllocatedStorage,
        configAnalysis,
      });
    }

    marker = describeResponse.Marker;
  } while (marker);

  return instances;
}

/**
 * Gets tags for an RDS instance.
 */
async function getInstanceTags(
  client: RDSClient,
  resourceArn: string
): Promise<Record<string, string>> {
  try {
    const response = await client.send(
      new ListTagsForResourceCommand({ ResourceName: resourceArn })
    );
    const tags: Record<string, string> = {};
    for (const tag of response.TagList || []) {
      if (tag.Key && tag.Value !== undefined) {
        tags[tag.Key] = tag.Value;
      }
    }
    return tags;
  } catch {
    // Return empty tags if unable to fetch
    return {};
  }
}

/**
 * Discovers RDS instances across multiple regions.
 *
 * @param input - Input parameters with regions to scan
 * @returns Object containing discovered instances
 */
export async function discoverRdsInstances(
  input: DiscoverRdsInput
): Promise<{ instances: RdsInstanceInfo[] }> {
  const { regions } = input;

  // Discover in all regions in parallel
  const regionPromises = regions.map((region) => discoverInRegion(region));
  const regionResults = await Promise.all(regionPromises);

  // Flatten results
  const instances = regionResults.flat();

  return { instances };
}

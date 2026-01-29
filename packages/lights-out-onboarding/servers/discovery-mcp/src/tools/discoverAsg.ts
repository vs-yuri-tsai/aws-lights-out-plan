/**
 * EC2 Auto Scaling Groups Discovery Tool
 *
 * Discovers all EC2 Auto Scaling Groups across specified AWS regions,
 * including capacity, scaling policies, and Lights Out compatibility analysis.
 */

import {
  AutoScalingClient,
  DescribeAutoScalingGroupsCommand,
  DescribePoliciesCommand,
  DescribeScheduledActionsCommand,
} from '@aws-sdk/client-auto-scaling';
import type {
  AsgGroupInfo,
  DiscoverAsgInput,
  AsgConfigAnalysis,
  AsgLightsOutSupport,
  RiskLevel,
} from '../types.js';

const LIGHTS_OUT_TAG_KEY = 'lights-out:managed';

/**
 * Production keywords for detecting production ASGs
 */
const PRODUCTION_KEYWORDS = ['prod', 'production', 'live', 'prd'];

/**
 * Analyzes ASG configuration to determine Lights Out compatibility.
 */
function analyzeAsgConfig(asg: {
  asgName: string;
  minSize: number;
  maxSize: number;
  desiredCapacity: number;
  suspendedProcesses: string[];
  hasScalingPolicies: boolean;
  hasScheduledActions: boolean;
}): AsgConfigAnalysis {
  const reasons: string[] = [];
  const recommendations: string[] = [];
  const warnings: string[] = [];
  let supportLevel: AsgLightsOutSupport = 'supported';
  let riskLevel: RiskLevel = 'low';

  const asgNameLower = asg.asgName.toLowerCase();

  // Check if production ASG
  const isProduction = PRODUCTION_KEYWORDS.some((keyword) => asgNameLower.includes(keyword));
  if (isProduction) {
    supportLevel = 'not-recommended';
    riskLevel = 'high';
    reasons.push('ASG 名稱包含生產環境關鍵字');
    recommendations.push('確認這是否為實際生產環境，如果是開發/測試環境請考慮重新命名');
    warnings.push('停止生產環境 ASG 可能導致服務中斷');
  }

  // Check if already stopped
  if (asg.minSize === 0 && asg.maxSize === 0 && asg.desiredCapacity === 0) {
    supportLevel = 'already-stopped';
    riskLevel = 'low';
    reasons.push('ASG 已處於停止狀態 (min=0, max=0, desired=0)');
    recommendations.push('此 ASG 已經停止，可能已被 Lights Out 或手動停止');
  }

  // Check for scheduled actions
  if (asg.hasScheduledActions) {
    if (supportLevel === 'supported') {
      riskLevel = 'medium';
    }
    reasons.push('ASG 已配置 Scheduled Actions');
    warnings.push('Lights Out 操作可能與現有 Scheduled Actions 衝突');
    recommendations.push('建議檢查現有 Scheduled Actions 是否與 Lights Out 排程重疊');
  }

  // Check for suspended processes
  if (asg.suspendedProcesses.length > 0) {
    if (supportLevel === 'supported') {
      riskLevel = 'medium';
    }
    reasons.push(
      `已暫停 ${asg.suspendedProcesses.length} 個 processes: ${asg.suspendedProcesses.join(', ')}`
    );
    warnings.push('部分 scaling processes 已被暫停，可能影響 Lights Out 操作');
  }

  // Check for scaling policies
  if (asg.hasScalingPolicies && supportLevel === 'supported') {
    reasons.push('ASG 配置了 Scaling Policies（Target Tracking 或 Step Scaling）');
    recommendations.push('Lights Out 會在停止時 suspend scaling processes，啟動時 resume');
  }

  // Standard ASG
  if (supportLevel === 'supported' && reasons.length === 0) {
    reasons.push('標準 ASG - 完全支援 Lights Out 啟停');
    recommendations.push('建議使用 suspendProcesses: true 以避免與 Scaling Policies 衝突');
  }

  return {
    supportLevel,
    riskLevel,
    reasons,
    recommendations,
    warnings,
  };
}

/**
 * Discovers ASGs in a single region.
 */
async function discoverInRegion(region: string): Promise<AsgGroupInfo[]> {
  const asgClient = new AutoScalingClient({ region });
  const groups: AsgGroupInfo[] = [];

  let nextToken: string | undefined;

  do {
    const describeResponse = await asgClient.send(
      new DescribeAutoScalingGroupsCommand({ NextToken: nextToken })
    );

    for (const asg of describeResponse.AutoScalingGroups || []) {
      if (!asg.AutoScalingGroupName || !asg.AutoScalingGroupARN) continue;

      // Get tags
      const tags: Record<string, string> = {};
      for (const tag of asg.Tags || []) {
        if (tag.Key && tag.Value !== undefined) {
          tags[tag.Key] = tag.Value;
        }
      }
      const hasLightsOutTags = tags[LIGHTS_OUT_TAG_KEY] === 'true';

      // Get suspended processes
      const suspendedProcesses = (asg.SuspendedProcesses || [])
        .map((p) => p.ProcessName)
        .filter((name): name is string => !!name);

      // Check for scaling policies
      const hasScalingPolicies = await checkScalingPolicies(asgClient, asg.AutoScalingGroupName);

      // Check for scheduled actions
      const hasScheduledActions = await checkScheduledActions(asgClient, asg.AutoScalingGroupName);

      // Get launch template/config info
      let launchTemplateId: string | undefined;
      let launchTemplateName: string | undefined;
      let launchConfigurationName: string | undefined;

      if (asg.LaunchTemplate) {
        launchTemplateId = asg.LaunchTemplate.LaunchTemplateId;
        launchTemplateName = asg.LaunchTemplate.LaunchTemplateName;
      } else if (asg.MixedInstancesPolicy?.LaunchTemplate?.LaunchTemplateSpecification) {
        const ltSpec = asg.MixedInstancesPolicy.LaunchTemplate.LaunchTemplateSpecification;
        launchTemplateId = ltSpec.LaunchTemplateId;
        launchTemplateName = ltSpec.LaunchTemplateName;
      } else if (asg.LaunchConfigurationName) {
        launchConfigurationName = asg.LaunchConfigurationName;
      }

      // Count instances
      const instances = asg.Instances?.length || 0;
      const inServiceInstances =
        asg.Instances?.filter((i) => i.LifecycleState === 'InService').length || 0;

      // Analyze configuration
      const configAnalysis = analyzeAsgConfig({
        asgName: asg.AutoScalingGroupName,
        minSize: asg.MinSize || 0,
        maxSize: asg.MaxSize || 0,
        desiredCapacity: asg.DesiredCapacity || 0,
        suspendedProcesses,
        hasScalingPolicies,
        hasScheduledActions,
      });

      groups.push({
        region,
        asgName: asg.AutoScalingGroupName,
        arn: asg.AutoScalingGroupARN,
        minSize: asg.MinSize || 0,
        maxSize: asg.MaxSize || 0,
        desiredCapacity: asg.DesiredCapacity || 0,
        instances,
        inServiceInstances,
        suspendedProcesses,
        tags,
        hasLightsOutTags,
        launchTemplateId,
        launchTemplateName,
        launchConfigurationName,
        hasScalingPolicies,
        hasScheduledActions,
        mixedInstancesPolicy: !!asg.MixedInstancesPolicy,
        configAnalysis,
      });
    }

    nextToken = describeResponse.NextToken;
  } while (nextToken);

  return groups;
}

/**
 * Check if ASG has scaling policies
 */
async function checkScalingPolicies(client: AutoScalingClient, asgName: string): Promise<boolean> {
  try {
    const response = await client.send(
      new DescribePoliciesCommand({
        AutoScalingGroupName: asgName,
        MaxRecords: 1,
      })
    );
    return (response.ScalingPolicies?.length || 0) > 0;
  } catch {
    return false;
  }
}

/**
 * Check if ASG has scheduled actions
 */
async function checkScheduledActions(client: AutoScalingClient, asgName: string): Promise<boolean> {
  try {
    const response = await client.send(
      new DescribeScheduledActionsCommand({
        AutoScalingGroupName: asgName,
        MaxRecords: 1,
      })
    );
    return (response.ScheduledUpdateGroupActions?.length || 0) > 0;
  } catch {
    return false;
  }
}

/**
 * Discovers EC2 Auto Scaling Groups across multiple regions.
 *
 * @param input - Input parameters with regions to scan
 * @returns Object containing discovered ASGs
 */
export async function discoverAsgGroups(
  input: DiscoverAsgInput
): Promise<{ groups: AsgGroupInfo[] }> {
  const { regions } = input;

  // Discover in all regions in parallel
  const regionPromises = regions.map((region) => discoverInRegion(region));
  const regionResults = await Promise.all(regionPromises);

  // Flatten results
  const groups = regionResults.flat();

  return { groups };
}

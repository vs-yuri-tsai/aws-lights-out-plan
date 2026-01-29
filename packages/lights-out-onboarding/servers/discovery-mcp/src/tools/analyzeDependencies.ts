/**
 * Dependency Analysis Tool
 *
 * Merges dependency information from multiple sources (ECS, IaC, code analysis)
 * and performs risk analysis for Lights Out operations.
 */

import type {
  DependencyAnalysisResult,
  DependencyEdge,
  ServiceNode,
  DependencyRiskAnalysis,
  DependencyRiskItem,
  ServiceGroup,
  EcsServiceInfo,
  BackendProjectAnalysis,
  RiskLevel,
} from '../types.js';

/**
 * Extract service nodes from ECS services
 */
function extractEcsServiceNodes(services: EcsServiceInfo[]): ServiceNode[] {
  return services.map((service) => ({
    name: service.serviceName,
    source: 'ecs' as const,
    riskLevel: service.taskDefinition?.overallRiskLevel,
    hasLightsOutTags: service.hasLightsOutTags,
  }));
}

/**
 * Extract dependency edges from ECS service environment variables
 */
function extractEcsDependencyEdges(services: EcsServiceInfo[]): DependencyEdge[] {
  const edges: DependencyEdge[] = [];
  const serviceNames = new Set(services.map((s) => s.serviceName.toLowerCase()));

  for (const service of services) {
    if (!service.taskDefinition?.containers) continue;

    for (const container of service.taskDefinition.containers) {
      if (!container.serviceUrls) continue;

      for (const serviceUrl of container.serviceUrls) {
        if (!serviceUrl.targetService) continue;

        // Check if target service exists in our service list
        const targetLower = serviceUrl.targetService.toLowerCase();
        const matchingService = services.find(
          (s) =>
            s.serviceName.toLowerCase() === targetLower ||
            s.serviceName.toLowerCase().includes(targetLower) ||
            targetLower.includes(s.serviceName.toLowerCase().replace(/-dev|-staging|-prod/g, ''))
        );

        if (matchingService) {
          edges.push({
            from: service.serviceName,
            to: matchingService.serviceName,
            type: 'env_var',
            confidence: serviceUrl.confidence,
            evidence: `環境變數: ${serviceUrl.envVarName}`,
          });
        }
      }
    }
  }

  return edges;
}

/**
 * Extract dependency edges from backend analysis
 */
function extractBackendDependencyEdges(
  analyses: BackendProjectAnalysis[],
  knownServices: Set<string>
): DependencyEdge[] {
  const edges: DependencyEdge[] = [];

  for (const analysis of analyses) {
    for (const dep of analysis.inferredDependencies) {
      // Check if target matches known services
      const targetLower = dep.target.toLowerCase();
      let matchedTarget: string | undefined;

      for (const service of knownServices) {
        const serviceLower = service.toLowerCase();
        if (
          serviceLower === targetLower ||
          serviceLower.includes(targetLower) ||
          targetLower.includes(serviceLower.replace(/-dev|-staging|-prod/g, ''))
        ) {
          matchedTarget = service;
          break;
        }
      }

      if (matchedTarget) {
        edges.push({
          from: dep.source,
          to: matchedTarget,
          type: 'code_analysis',
          confidence: dep.confidence,
          evidence: dep.evidence.join(', '),
        });
      }
    }
  }

  return edges;
}

/**
 * Deduplicate edges, keeping the highest confidence one
 */
function deduplicateEdges(edges: DependencyEdge[]): DependencyEdge[] {
  const edgeMap = new Map<string, DependencyEdge>();
  const confidenceOrder: Record<string, number> = { high: 3, medium: 2, low: 1 };

  for (const edge of edges) {
    const key = `${edge.from}->${edge.to}`;
    const existing = edgeMap.get(key);

    if (!existing || confidenceOrder[edge.confidence] > confidenceOrder[existing.confidence]) {
      edgeMap.set(key, edge);
    }
  }

  return Array.from(edgeMap.values());
}

/**
 * Analyze high-risk dependencies
 */
function analyzeHighRiskDependencies(
  services: ServiceNode[],
  edges: DependencyEdge[]
): DependencyRiskItem[] {
  const riskItems: DependencyRiskItem[] = [];
  const serviceRiskMap = new Map<string, RiskLevel>();

  for (const service of services) {
    if (service.riskLevel) {
      serviceRiskMap.set(service.name, service.riskLevel);
    }
  }

  for (const edge of edges) {
    const fromRisk = serviceRiskMap.get(edge.from);
    const toRisk = serviceRiskMap.get(edge.to);

    // High risk: high-risk service depends on low-risk service
    if (fromRisk === 'high' && toRisk === 'low') {
      riskItems.push({
        service: edge.from,
        dependsOn: edge.to,
        risk: `高風險服務 ${edge.from} 依賴低風險服務 ${edge.to}`,
        recommendation: `若 ${edge.to} 停止，${edge.from} 可能會失敗。建議一起納入或一起排除 Lights Out 管理。`,
      });
    }

    // Medium risk: webhook/scheduler depends on API service
    if (fromRisk === 'high' && (toRisk === 'medium' || !toRisk)) {
      riskItems.push({
        service: edge.from,
        dependsOn: edge.to,
        risk: `高風險服務 ${edge.from} 依賴服務 ${edge.to}`,
        recommendation: `需要確保 ${edge.to} 在 ${edge.from} 之前啟動，停止時則相反。`,
      });
    }
  }

  return riskItems;
}

/**
 * Group services that should be managed together
 */
function groupServices(services: ServiceNode[], edges: DependencyEdge[]): ServiceGroup[] {
  const groups: ServiceGroup[] = [];
  const visited = new Set<string>();

  // Build adjacency list (bidirectional for grouping)
  const adjacency = new Map<string, Set<string>>();
  for (const service of services) {
    adjacency.set(service.name, new Set());
  }

  for (const edge of edges) {
    adjacency.get(edge.from)?.add(edge.to);
    adjacency.get(edge.to)?.add(edge.from);
  }

  // Find connected components using BFS
  for (const service of services) {
    if (visited.has(service.name)) continue;

    const component: string[] = [];
    const queue = [service.name];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;

      visited.add(current);
      component.push(current);

      const neighbors = adjacency.get(current) || new Set();
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          queue.push(neighbor);
        }
      }
    }

    // Only add groups with more than one service
    if (component.length > 1) {
      groups.push({
        services: component.sort(),
        reason: `這些服務互相依賴，建議一起管理`,
      });
    }
  }

  return groups;
}

/**
 * Calculate shutdown and startup order using topological sort
 */
function calculateStartupShutdownOrder(
  services: ServiceNode[],
  edges: DependencyEdge[]
): { shutdownOrder: string[]; startupOrder: string[] } {
  const serviceNames = services.map((s) => s.name);
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  // Initialize
  for (const name of serviceNames) {
    inDegree.set(name, 0);
    adjacency.set(name, []);
  }

  // Build graph (A depends on B means B -> A)
  for (const edge of edges) {
    if (inDegree.has(edge.from) && inDegree.has(edge.to)) {
      adjacency.get(edge.to)!.push(edge.from);
      inDegree.set(edge.from, (inDegree.get(edge.from) || 0) + 1);
    }
  }

  // Kahn's algorithm for topological sort
  const startupOrder: string[] = [];
  const queue = serviceNames.filter((name) => inDegree.get(name) === 0);

  while (queue.length > 0) {
    const current = queue.shift()!;
    startupOrder.push(current);

    for (const neighbor of adjacency.get(current) || []) {
      const newDegree = (inDegree.get(neighbor) || 0) - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) {
        queue.push(neighbor);
      }
    }
  }

  // If there are remaining services (cycle), add them at the end
  for (const name of serviceNames) {
    if (!startupOrder.includes(name)) {
      startupOrder.push(name);
    }
  }

  // Shutdown is reverse of startup
  const shutdownOrder = [...startupOrder].reverse();

  return { startupOrder, shutdownOrder };
}

/**
 * Analyze dependencies from multiple sources
 */
export async function analyzeDependencies(input: {
  ecsServices?: EcsServiceInfo[];
  backendAnalysis?: BackendProjectAnalysis[];
}): Promise<DependencyAnalysisResult> {
  const { ecsServices = [], backendAnalysis = [] } = input;

  // Extract service nodes
  const services: ServiceNode[] = [];
  const allEdges: DependencyEdge[] = [];
  const knownServices = new Set<string>();

  // From ECS
  if (ecsServices.length > 0) {
    const ecsNodes = extractEcsServiceNodes(ecsServices);
    services.push(...ecsNodes);
    ecsNodes.forEach((n) => knownServices.add(n.name));

    const ecsEdges = extractEcsDependencyEdges(ecsServices);
    allEdges.push(...ecsEdges);
  }

  // From backend analysis
  if (backendAnalysis.length > 0) {
    // Add backend service names to known services if they match ECS services
    for (const analysis of backendAnalysis) {
      const serviceName = analysis.directory.split('/').pop() || analysis.directory;
      if (!knownServices.has(serviceName)) {
        // Check if it matches an ECS service
        const matchingEcs = ecsServices.find(
          (s) =>
            s.serviceName.toLowerCase().includes(serviceName.toLowerCase()) ||
            serviceName
              .toLowerCase()
              .includes(s.serviceName.toLowerCase().replace(/-dev|-staging|-prod/g, ''))
        );
        if (!matchingEcs) {
          services.push({
            name: serviceName,
            source: 'code',
          });
          knownServices.add(serviceName);
        }
      }
    }

    const backendEdges = extractBackendDependencyEdges(backendAnalysis, knownServices);
    allEdges.push(...backendEdges);
  }

  // Deduplicate edges
  const edges = deduplicateEdges(allEdges);

  // Perform risk analysis
  const highRiskDependencies = analyzeHighRiskDependencies(services, edges);
  const serviceGroups = groupServices(services, edges);
  const { startupOrder, shutdownOrder } = calculateStartupShutdownOrder(services, edges);

  const riskAnalysis: DependencyRiskAnalysis = {
    highRiskDependencies,
    serviceGroups,
    startupOrder,
    shutdownOrder,
  };

  return {
    services,
    edges,
    riskAnalysis,
  };
}

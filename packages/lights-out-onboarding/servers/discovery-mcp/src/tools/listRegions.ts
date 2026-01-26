/**
 * List Available AWS Regions Tool
 *
 * Provides a structured list of AWS regions grouped by geography,
 * enabling interactive region selection for resource discovery.
 */

export interface RegionInfo {
  code: string;
  name: string;
}

export interface RegionGroup {
  group: string;
  regions: RegionInfo[];
}

export interface ListRegionsResult {
  groups: RegionGroup[];
  allRegionCodes: string[];
}

/**
 * AWS regions grouped by geography.
 * Based on AWS Console region selector.
 */
const REGION_GROUPS: RegionGroup[] = [
  {
    group: 'United States',
    regions: [
      { code: 'us-east-1', name: 'N. Virginia' },
      { code: 'us-east-2', name: 'Ohio' },
      { code: 'us-west-1', name: 'N. California' },
      { code: 'us-west-2', name: 'Oregon' },
    ],
  },
  {
    group: 'Asia Pacific',
    regions: [
      { code: 'ap-south-1', name: 'Mumbai' },
      { code: 'ap-northeast-3', name: 'Osaka' },
      { code: 'ap-northeast-2', name: 'Seoul' },
      { code: 'ap-southeast-1', name: 'Singapore' },
      { code: 'ap-southeast-2', name: 'Sydney' },
      { code: 'ap-northeast-1', name: 'Tokyo' },
    ],
  },
  {
    group: 'Canada',
    regions: [{ code: 'ca-central-1', name: 'Central' }],
  },
  {
    group: 'Europe',
    regions: [
      { code: 'eu-central-1', name: 'Frankfurt' },
      { code: 'eu-west-1', name: 'Ireland' },
      { code: 'eu-west-2', name: 'London' },
      { code: 'eu-west-3', name: 'Paris' },
      { code: 'eu-north-1', name: 'Stockholm' },
    ],
  },
  {
    group: 'South America',
    regions: [{ code: 'sa-east-1', name: 'São Paulo' }],
  },
];

/**
 * Returns a structured list of AWS regions for interactive selection.
 *
 * @returns Object containing region groups and all region codes
 */
export function listAvailableRegions(): ListRegionsResult {
  const allRegionCodes = REGION_GROUPS.flatMap((group) => group.regions.map((r) => r.code));

  return {
    groups: REGION_GROUPS,
    allRegionCodes,
  };
}

import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import {
  loadConfigFromSsm,
  clearConfigCache,
  ConfigError,
  ParameterNotFoundError,
  ConfigValidationError,
} from '@functions/handler/core/config';

const ssmMock = mockClient(SSMClient);

describe('Config Loader', () => {
  beforeEach(() => {
    ssmMock.reset();
    clearConfigCache();
  });

  describe('loadConfigFromSsm', () => {
    it('should load and parse valid YAML configuration from SSM', async () => {
      const validConfig = `
version: "1.0"
environment: workshop
discovery:
  method: tag-based
  tags:
    lights-out:managed: "true"
`;

      ssmMock.on(GetParameterCommand).resolves({
        Parameter: {
          Value: validConfig,
        },
      });

      const config = await loadConfigFromSsm('/test/parameter');

      expect(config).toBeDefined();
      expect(config.version).toBe('1.0');
      expect(config.environment).toBe('workshop');
      expect(config.discovery).toEqual({
        method: 'tag-based', // Corrected from 'strategy' to 'method'
        tags: {
          'lights-out:managed': 'true',
        },
      });
    });

    it('should cache configuration to avoid duplicate SSM calls', async () => {
      const validConfig = `
version: "1.0"
environment: workshop
discovery:
  method: tag-based
`; // Corrected indentation and 'strategy' to 'method'

      ssmMock.on(GetParameterCommand).resolves({
        Parameter: {
          Value: validConfig,
        },
      });

      // First call - should hit SSM
      await loadConfigFromSsm('/test/parameter');

      // Second call - should use cache
      await loadConfigFromSsm('/test/parameter');

      // SSM should only be called once due to caching
      expect(ssmMock.calls()).toHaveLength(1);
    });

    it('should throw ParameterNotFoundError when SSM parameter does not exist', async () => {
      const notFoundError = new Error('ParameterNotFound');
      notFoundError.name = 'ParameterNotFound';

      ssmMock.on(GetParameterCommand).rejects(notFoundError);

      await expect(loadConfigFromSsm('/nonexistent/parameter')).rejects.toThrow(
        ParameterNotFoundError
      );

      await expect(loadConfigFromSsm('/nonexistent/parameter')).rejects.toThrow(
        'Could not find SSM parameter: /nonexistent/parameter'
      );
    });

    it('should throw ConfigError when SSM returns empty value', async () => {
      ssmMock.on(GetParameterCommand).resolves({
        Parameter: {
          Value: '',
        },
      });

      await expect(loadConfigFromSsm('/test/parameter')).rejects.toThrow(ConfigError);

      await expect(loadConfigFromSsm('/test/parameter')).rejects.toThrow('has no value');
    });

    it('should throw ConfigError when SSM call fails with generic error', async () => {
      ssmMock.on(GetParameterCommand).rejects(new Error('Network timeout'));

      await expect(loadConfigFromSsm('/test/parameter')).rejects.toThrow(ConfigError);

      await expect(loadConfigFromSsm('/test/parameter')).rejects.toThrow(
        'Failed to retrieve SSM parameter'
      );
    });

    it('should throw ConfigError when YAML is malformed', async () => {
      const malformedYaml = `
version: 1.0
environment: [unclosed
discovery: }invalid
`;

      ssmMock.on(GetParameterCommand).resolves({
        Parameter: {
          Value: malformedYaml,
        },
      });

      await expect(loadConfigFromSsm('/test/parameter')).rejects.toThrow(ConfigError);

      await expect(loadConfigFromSsm('/test/parameter')).rejects.toThrow(
        'Failed to parse YAML configuration'
      );
    });

    it("should accept config without 'version' field (version is optional)", async () => {
      const configWithoutVersion = `
environment: workshop
discovery:
  method: tag-based
`;

      ssmMock.on(GetParameterCommand).resolves({
        Parameter: {
          Value: configWithoutVersion,
        },
      });

      const config = await loadConfigFromSsm('/test/parameter');
      expect(config.environment).toBe('workshop');
      expect(config.version).toBeUndefined();
    });

    it("should throw ConfigValidationError when required field 'environment' is missing", async () => {
      const invalidConfig = `
version: "1.0"
discovery:
  method: tag-based
`; // Corrected indentation and 'strategy' to 'method'

      ssmMock.on(GetParameterCommand).resolves({
        Parameter: {
          Value: invalidConfig,
        },
      });

      await expect(loadConfigFromSsm('/test/parameter')).rejects.toThrow(ConfigValidationError);
    });

    it("should throw ConfigValidationError when required field 'discovery' is missing", async () => {
      const invalidConfig = `
version: "1.0"
environment: workshop
`;

      ssmMock.on(GetParameterCommand).resolves({
        Parameter: {
          Value: invalidConfig,
        },
      });

      await expect(loadConfigFromSsm('/test/parameter')).rejects.toThrow(ConfigValidationError);
    });

    it('should accept configuration with optional fields', async () => {
      const configWithOptionals = `
version: "1.0"
environment: workshop
discovery:
  method: tag-based
schedule:
  timezone: Asia/Taipei
  work_hours:
    start: "09:00"
    end: "18:00"
resources:
  - type: ecs-service
    arn: arn:aws:ecs:us-east-1:123456789012:service/my-service
handlers:
  ecs-service:
    stop_timeout: 30
`; // Corrected indentation and 'strategy' to 'method'

      ssmMock.on(GetParameterCommand).resolves({
        Parameter: {
          Value: configWithOptionals,
        },
      });

      const config = await loadConfigFromSsm('/test/parameter');

      expect(config).toBeDefined();
      expect(config.version).toBe('1.0');
      // The original schema does not include 'schedule', 'resources', 'handlers' in the ConfigSchema definition.
      // However, it uses .passthrough() which allows extra fields.
      // The test expects these fields to be defined on the resulting config.
      // This is okay as .passthrough() handles this.
      expect(config.schedule).toBeDefined();
      expect(config.resources).toBeDefined();
      expect(config.handlers).toBeDefined();
      // Ensure the discovery.method is correctly parsed
      expect(config.discovery).toEqual({
        method: 'tag-based',
      });
    });

    it('should handle different parameter names independently in cache', async () => {
      const config1 = `
version: "1.0"
environment: dev
discovery:
  method: tag-based
`; // Corrected indentation and 'strategy' to 'method'

      const config2 = `
version: "2.0"
environment: prod
discovery:
  method: arn-based
`; // Corrected indentation and 'strategy' to 'method'

      ssmMock
        .on(GetParameterCommand, { Name: '/dev/parameter' })
        .resolves({ Parameter: { Value: config1 } })
        .on(GetParameterCommand, { Name: '/prod/parameter' })
        .resolves({ Parameter: { Value: config2 } });

      const devConfig = await loadConfigFromSsm('/dev/parameter');
      const prodConfig = await loadConfigFromSsm('/prod/parameter');

      expect(devConfig.environment).toBe('dev');
      expect(prodConfig.environment).toBe('prod');
      expect(ssmMock.calls()).toHaveLength(2);
    });
  });

  describe('clearConfigCache', () => {
    it('should clear the cache and force reload from SSM', async () => {
      const config = `
version: "1.0"
environment: workshop
discovery:
  method: tag-based
`; // Corrected indentation and 'strategy' to 'method'

      ssmMock.on(GetParameterCommand).resolves({
        Parameter: {
          Value: config,
        },
      });

      // First load
      await loadConfigFromSsm('/test/parameter');
      expect(ssmMock.calls()).toHaveLength(1);

      // Second load (should use cache)
      await loadConfigFromSsm('/test/parameter');
      expect(ssmMock.calls()).toHaveLength(1);

      // Clear cache
      clearConfigCache();

      // Third load (should hit SSM again)
      await loadConfigFromSsm('/test/parameter');
      expect(ssmMock.calls()).toHaveLength(2);
    });
  });

  describe('Error Hierarchy', () => {
    it('should maintain proper error inheritance chain', () => {
      const configError = new ConfigError('test');
      const paramNotFound = new ParameterNotFoundError('test');
      const validationError = new ConfigValidationError('test');

      expect(configError).toBeInstanceOf(Error);
      expect(configError).toBeInstanceOf(ConfigError);
      expect(configError.name).toBe('ConfigError');

      expect(paramNotFound).toBeInstanceOf(Error);
      expect(paramNotFound).toBeInstanceOf(ConfigError);
      expect(paramNotFound).toBeInstanceOf(ParameterNotFoundError);
      expect(paramNotFound.name).toBe('ParameterNotFoundError');

      expect(validationError).toBeInstanceOf(Error);
      expect(validationError).toBeInstanceOf(ConfigError);
      expect(validationError).toBeInstanceOf(ConfigValidationError);
      expect(validationError.name).toBe('ConfigValidationError');
    });
  });

  describe('ECS Action Config Validation', () => {
    it('should accept valid Auto Scaling mode configuration', async () => {
      const configWithAutoScaling = `
version: "1.0"
environment: test
discovery:
  method: tag-based
resource_defaults:
  ecs-service:
    waitForStable: true
    stableTimeoutSeconds: 300
    start:
      minCapacity: 2
      maxCapacity: 10
      desiredCount: 5
    stop:
      desiredCount: 0
`;

      ssmMock.on(GetParameterCommand).resolves({
        Parameter: { Value: configWithAutoScaling },
      });

      const config = await loadConfigFromSsm('/test/parameter');

      expect(config.resource_defaults).toBeDefined();
      expect(config.resource_defaults?.['ecs-service'].start).toEqual({
        minCapacity: 2,
        maxCapacity: 10,
        desiredCount: 5,
      });
      // stop uses Direct mode (only desiredCount)
      expect(config.resource_defaults?.['ecs-service'].stop).toEqual({
        desiredCount: 0,
      });
    });

    it('should accept valid Direct mode configuration', async () => {
      const configWithDirectMode = `
version: "1.0"
environment: test
discovery:
  method: tag-based
resource_defaults:
  ecs-service:
    start:
      desiredCount: 2
    stop:
      desiredCount: 0
`;

      ssmMock.on(GetParameterCommand).resolves({
        Parameter: { Value: configWithDirectMode },
      });

      const config = await loadConfigFromSsm('/test/parameter');

      expect(config.resource_defaults?.['ecs-service'].start).toEqual({
        desiredCount: 2,
      });
      expect(config.resource_defaults?.['ecs-service'].stop).toEqual({
        desiredCount: 0,
      });
    });

    it('should fallback to Direct mode when Auto Scaling validation fails (minCapacity > maxCapacity)', async () => {
      const configWithInvalidAutoScaling = `
version: "1.0"
environment: test
discovery:
  method: tag-based
resource_defaults:
  ecs-service:
    start:
      minCapacity: 10
      maxCapacity: 5
      desiredCount: 7
`;

      ssmMock.on(GetParameterCommand).resolves({
        Parameter: { Value: configWithInvalidAutoScaling },
      });

      const config = await loadConfigFromSsm('/test/parameter');

      // Union schema falls back to Direct mode when Auto Scaling refine fails
      expect(config.resource_defaults?.['ecs-service'].start).toEqual({
        desiredCount: 7,
      });
    });

    it('should fallback to Direct mode when Auto Scaling validation fails (desiredCount < minCapacity)', async () => {
      const configWithInvalidAutoScaling = `
version: "1.0"
environment: test
discovery:
  method: tag-based
resource_defaults:
  ecs-service:
    start:
      minCapacity: 5
      maxCapacity: 10
      desiredCount: 3
`;

      ssmMock.on(GetParameterCommand).resolves({
        Parameter: { Value: configWithInvalidAutoScaling },
      });

      const config = await loadConfigFromSsm('/test/parameter');

      // Union schema falls back to Direct mode
      expect(config.resource_defaults?.['ecs-service'].start).toEqual({
        desiredCount: 3,
      });
    });

    it('should fallback to Direct mode when Auto Scaling validation fails (desiredCount > maxCapacity)', async () => {
      const configWithInvalidAutoScaling = `
version: "1.0"
environment: test
discovery:
  method: tag-based
resource_defaults:
  ecs-service:
    start:
      minCapacity: 2
      maxCapacity: 10
      desiredCount: 15
`;

      ssmMock.on(GetParameterCommand).resolves({
        Parameter: { Value: configWithInvalidAutoScaling },
      });

      const config = await loadConfigFromSsm('/test/parameter');

      // Union schema falls back to Direct mode
      expect(config.resource_defaults?.['ecs-service'].start).toEqual({
        desiredCount: 15,
      });
    });

    it('should reject negative desiredCount in Direct mode', async () => {
      const invalidConfig = `
version: "1.0"
environment: test
discovery:
  method: tag-based
resource_defaults:
  ecs-service:
    start:
      desiredCount: -1
`;

      ssmMock.on(GetParameterCommand).resolves({
        Parameter: { Value: invalidConfig },
      });

      await expect(loadConfigFromSsm('/test/parameter')).rejects.toThrow(ConfigValidationError);
    });
  });

  describe('Optional Fields Validation', () => {
    it('should accept configuration with regions field', async () => {
      const configWithRegions = `
version: "1.0"
environment: test
regions:
  - us-east-1
  - ap-southeast-1
discovery:
  method: tag-based
`;

      ssmMock.on(GetParameterCommand).resolves({
        Parameter: { Value: configWithRegions },
      });

      const config = await loadConfigFromSsm('/test/parameter');

      expect(config.regions).toEqual(['us-east-1', 'ap-southeast-1']);
    });

    it('should accept configuration with settings field', async () => {
      const configWithSettings = `
version: "1.0"
environment: test
discovery:
  method: tag-based
settings:
  schedule_tag: lights-out:schedule
`;

      ssmMock.on(GetParameterCommand).resolves({
        Parameter: { Value: configWithSettings },
      });

      const config = await loadConfigFromSsm('/test/parameter');

      expect(config.settings).toBeDefined();
      expect(config.settings?.schedule_tag).toBe('lights-out:schedule');
    });

    it('should accept configuration with resource_types in discovery', async () => {
      const configWithResourceTypes = `
version: "1.0"
environment: test
discovery:
  method: tag-based
  resource_types:
    - ecs:service
    - rds:db
`;

      ssmMock.on(GetParameterCommand).resolves({
        Parameter: { Value: configWithResourceTypes },
      });

      const config = await loadConfigFromSsm('/test/parameter');

      expect(config.discovery.resource_types).toEqual(['ecs:service', 'rds:db']);
    });

    it('should accept configuration with all ECS service optional fields', async () => {
      const configWithAllFields = `
version: "1.0"
environment: test
discovery:
  method: tag-based
resource_defaults:
  ecs-service:
    waitForStable: true
    stableTimeoutSeconds: 600
    start:
      desiredCount: 3
    stop:
      desiredCount: 0
  rds-db:
    waitForStable: false
    stableTimeoutSeconds: 300
`;

      ssmMock.on(GetParameterCommand).resolves({
        Parameter: { Value: configWithAllFields },
      });

      const config = await loadConfigFromSsm('/test/parameter');

      expect(config.resource_defaults?.['ecs-service'].waitForStable).toBe(true);
      expect(config.resource_defaults?.['ecs-service'].stableTimeoutSeconds).toBe(600);
      expect(config.resource_defaults?.['rds-db'].waitForStable).toBe(false);
      expect(config.resource_defaults?.['rds-db'].stableTimeoutSeconds).toBe(300);
    });
  });

  describe('Custom SSM Client', () => {
    it('should accept custom SSM client for testing', async () => {
      const customClient = new SSMClient({});
      const customMock = mockClient(customClient);

      const validConfig = `
version: "1.0"
environment: test
discovery:
  method: tag-based
`;

      customMock.on(GetParameterCommand).resolves({
        Parameter: { Value: validConfig },
      });

      const config = await loadConfigFromSsm('/test/parameter', customClient);

      expect(config).toBeDefined();
      expect(config.version).toBe('1.0');

      customMock.restore();
    });
  });

  describe('Schema Validation Error Handling', () => {
    it('should handle validation errors for invalid stableTimeoutSeconds', async () => {
      const config = `
version: "1.0"
environment: test
discovery:
  method: tag-based
resource_defaults:
  ecs-service:
    stableTimeoutSeconds: 0
`;

      ssmMock.on(GetParameterCommand).resolves({
        Parameter: { Value: config },
      });

      await expect(loadConfigFromSsm('/test/parameter')).rejects.toThrow(ConfigValidationError);
    });
  });

  describe('Regional Schedules Configuration', () => {
    describe('region_groups validation', () => {
      it('should accept valid region_groups configuration', async () => {
        const configWithRegionGroups = `
version: "1.0"
environment: test
discovery:
  method: tag-based
region_groups:
  asia:
    - ap-southeast-1
    - ap-northeast-1
  america:
    - us-east-1
`;

        ssmMock.on(GetParameterCommand).resolves({
          Parameter: { Value: configWithRegionGroups },
        });

        const config = await loadConfigFromSsm('/test/parameter');

        expect(config.region_groups).toBeDefined();
        expect(config.region_groups?.asia).toEqual(['ap-southeast-1', 'ap-northeast-1']);
        expect(config.region_groups?.america).toEqual(['us-east-1']);
      });

      it('should accept configuration without region_groups (backward compatible)', async () => {
        const configWithoutRegionGroups = `
version: "1.0"
environment: test
discovery:
  method: tag-based
regions:
  - us-east-1
  - ap-southeast-1
`;

        ssmMock.on(GetParameterCommand).resolves({
          Parameter: { Value: configWithoutRegionGroups },
        });

        const config = await loadConfigFromSsm('/test/parameter');

        expect(config.region_groups).toBeUndefined();
        expect(config.regions).toEqual(['us-east-1', 'ap-southeast-1']);
      });

      it('should accept empty region_groups', async () => {
        const configWithEmptyRegionGroups = `
version: "1.0"
environment: test
discovery:
  method: tag-based
region_groups: {}
`;

        ssmMock.on(GetParameterCommand).resolves({
          Parameter: { Value: configWithEmptyRegionGroups },
        });

        const config = await loadConfigFromSsm('/test/parameter');

        expect(config.region_groups).toEqual({});
      });
    });

    describe('group_schedules validation', () => {
      it('should accept valid group_schedules configuration', async () => {
        const configWithGroupSchedules = `
version: "1.0"
environment: test
discovery:
  method: tag-based
region_groups:
  asia:
    - ap-southeast-1
group_schedules:
  asia:
    timezone: Asia/Taipei
    start:
      expression: "0 0 ? * MON-FRI *"
      description: "Start Asia resources at 08:00 CST"
      enabled: true
    stop:
      expression: "0 14 ? * MON-FRI *"
      description: "Stop Asia resources at 22:00 CST"
      enabled: true
`;

        ssmMock.on(GetParameterCommand).resolves({
          Parameter: { Value: configWithGroupSchedules },
        });

        const config = await loadConfigFromSsm('/test/parameter');

        expect(config.group_schedules).toBeDefined();
        expect(config.group_schedules?.asia).toBeDefined();
        expect(config.group_schedules?.asia.timezone).toBe('Asia/Taipei');
        expect(config.group_schedules?.asia.start.expression).toBe('0 0 ? * MON-FRI *');
        expect(config.group_schedules?.asia.start.enabled).toBe(true);
        expect(config.group_schedules?.asia.stop.expression).toBe('0 14 ? * MON-FRI *');
        expect(config.group_schedules?.asia.stop.enabled).toBe(true);
      });

      it('should accept group_schedules without timezone (optional)', async () => {
        const configWithoutTimezone = `
version: "1.0"
environment: test
discovery:
  method: tag-based
group_schedules:
  asia:
    start:
      expression: "0 0 ? * MON-FRI *"
      enabled: true
    stop:
      expression: "0 14 ? * MON-FRI *"
      enabled: false
`;

        ssmMock.on(GetParameterCommand).resolves({
          Parameter: { Value: configWithoutTimezone },
        });

        const config = await loadConfigFromSsm('/test/parameter');

        expect(config.group_schedules?.asia.timezone).toBeUndefined();
        expect(config.group_schedules?.asia.start.enabled).toBe(true);
        expect(config.group_schedules?.asia.stop.enabled).toBe(false);
      });

      it('should accept group_schedules without description (optional)', async () => {
        const configWithoutDescription = `
version: "1.0"
environment: test
discovery:
  method: tag-based
group_schedules:
  america:
    start:
      expression: "0 13 ? * MON-FRI *"
      enabled: true
    stop:
      expression: "0 23 ? * MON-FRI *"
      enabled: true
`;

        ssmMock.on(GetParameterCommand).resolves({
          Parameter: { Value: configWithoutDescription },
        });

        const config = await loadConfigFromSsm('/test/parameter');

        expect(config.group_schedules?.america.start.description).toBeUndefined();
        expect(config.group_schedules?.america.stop.description).toBeUndefined();
      });

      // Note: group_schedules uses passthrough validation because Lambda does not use it at runtime.
      // The human-readable format is converted to group_schedules_cron by generate-cron.js at deploy time.
      // Therefore, these tests verify that any format is accepted.

      it('should accept group_schedules with any format (passthrough validation)', async () => {
        const configWithHumanReadableFormat = `
version: "1.0"
environment: test
discovery:
  method: tag-based
group_schedules:
  asia:
    timezone: Asia/Taipei
    startTime: "08:00"
    stopTime: "22:00"
    activeDays:
      - MON
      - TUE
      - WED
      - THU
      - FRI
    enabled: true
`;

        ssmMock.on(GetParameterCommand).resolves({
          Parameter: { Value: configWithHumanReadableFormat },
        });

        const config = await loadConfigFromSsm('/test/parameter');
        expect(config.group_schedules).toBeDefined();
        expect(config.group_schedules?.asia).toBeDefined();
      });

      it('should accept group_schedules with partial or missing fields (passthrough)', async () => {
        const configWithPartialFields = `
version: "1.0"
environment: test
discovery:
  method: tag-based
group_schedules:
  asia:
    timezone: Asia/Taipei
`;

        ssmMock.on(GetParameterCommand).resolves({
          Parameter: { Value: configWithPartialFields },
        });

        const config = await loadConfigFromSsm('/test/parameter');
        expect(config.group_schedules?.asia).toBeDefined();
      });

      it('should accept multiple groups in group_schedules', async () => {
        const configWithMultipleGroups = `
version: "1.0"
environment: test
discovery:
  method: tag-based
region_groups:
  asia:
    - ap-southeast-1
    - ap-northeast-1
  america:
    - us-east-1
group_schedules:
  asia:
    timezone: Asia/Taipei
    start:
      expression: "0 0 ? * MON-FRI *"
      enabled: true
    stop:
      expression: "0 14 ? * MON-FRI *"
      enabled: true
  america:
    timezone: America/New_York
    start:
      expression: "0 13 ? * MON-FRI *"
      enabled: true
    stop:
      expression: "0 23 ? * MON-FRI *"
      enabled: true
`;

        ssmMock.on(GetParameterCommand).resolves({
          Parameter: { Value: configWithMultipleGroups },
        });

        const config = await loadConfigFromSsm('/test/parameter');

        expect(Object.keys(config.group_schedules || {})).toHaveLength(2);
        expect(config.group_schedules?.asia).toBeDefined();
        expect(config.group_schedules?.america).toBeDefined();
      });
    });

    describe('combined region_groups and group_schedules', () => {
      it('should accept full regional schedules configuration', async () => {
        const fullConfig = `
version: "1.0"
environment: pg-stage-airsync-stage
discovery:
  method: tags
  tags:
    lights-out:managed: "true"
    lights-out:project: airsync-stage
  resource_types:
    - ecs:service
region_groups:
  asia:
    - ap-southeast-1
    - ap-northeast-1
  america:
    - us-east-1
group_schedules:
  asia:
    timezone: Asia/Taipei
    start:
      expression: "0 0 ? * MON-FRI *"
      description: "Start Asia resources at 08:00 CST"
      enabled: true
    stop:
      expression: "0 14 ? * MON-FRI *"
      description: "Stop Asia resources at 22:00 CST"
      enabled: true
  america:
    timezone: America/New_York
    start:
      expression: "0 13 ? * MON-FRI *"
      description: "Start America resources at 08:00 EST"
      enabled: true
    stop:
      expression: "0 23 ? * MON-FRI *"
      description: "Stop America resources at 18:00 EST"
      enabled: true
resource_defaults:
  ecs-service:
    waitForStable: true
    stableTimeoutSeconds: 300
    start:
      desiredCount: 2
    stop:
      desiredCount: 0
`;

        ssmMock.on(GetParameterCommand).resolves({
          Parameter: { Value: fullConfig },
        });

        const config = await loadConfigFromSsm('/test/parameter');

        expect(config.environment).toBe('pg-stage-airsync-stage');
        expect(config.region_groups?.asia).toEqual(['ap-southeast-1', 'ap-northeast-1']);
        expect(config.region_groups?.america).toEqual(['us-east-1']);
        expect(config.group_schedules?.asia.timezone).toBe('Asia/Taipei');
        expect(config.group_schedules?.america.timezone).toBe('America/New_York');
        expect(config.discovery.tags).toEqual({
          'lights-out:managed': 'true',
          'lights-out:project': 'airsync-stage',
        });
      });
    });
  });
});

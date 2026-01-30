/* eslint-disable no-undef */

/**
 * Generate EventBridge schedule events for Serverless Framework.
 *
 * This script dynamically generates EventBridge schedule events based on the config file.
 * It supports two modes:
 * 1. Regional schedules (group_schedules): Per-group start/stop rules with targetGroup
 * 2. Legacy schedules (schedules_cron): Single start/stop rules for all regions
 *
 * Usage in serverless.yml:
 *   functions:
 *     handler:
 *       events: ${file(./scripts/generate-schedules.js):events}
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

/**
 * Resolve config file path based on stage by scanning arguments directory.
 * This eliminates hardcoded mappings - the config path is read from arguments/{env}.json
 *
 * @param {string} stage - Serverless stage
 * @returns {string} Config file path relative to project root
 */
function resolveConfigPath(stage) {
  const argsDir = path.join(__dirname, 'arguments');

  // Check if arguments directory exists
  if (!fs.existsSync(argsDir)) {
    console.warn(`[generate-schedules] Arguments directory not found: ${argsDir}`);
    return `${stage}.yml`;
  }

  // Scan all JSON files in arguments directory
  const files = fs.readdirSync(argsDir).filter((file) => file.endsWith('.json'));

  for (const file of files) {
    try {
      const argPath = path.join(argsDir, file);
      const args = JSON.parse(fs.readFileSync(argPath, 'utf8'));

      // Match stage name
      if (args.stage === stage && args.config && args.config.path) {
        console.log(`[generate-schedules] Found config path from ${file}: ${args.config.path}`);
        return args.config.path;
      }
    } catch (error) {
      console.warn(`[generate-schedules] Failed to read ${file}: ${error.message}`);
    }
  }

  // Fallback: assume config/{stage}.yml
  console.warn(
    `[generate-schedules] No matching arguments file found for stage: ${stage}, using fallback: ${stage}.yml`
  );
  return `${stage}.yml`;
}

/**
 * Read and parse the config YAML file.
 *
 * @param {string} configPath - Absolute path to config file
 * @returns {object} Parsed config object
 */
function readConfig(configPath) {
  if (!fs.existsSync(configPath)) {
    throw new Error(`Config file not found: ${configPath}`);
  }

  const content = fs.readFileSync(configPath, 'utf8');
  return yaml.load(content);
}

/**
 * Generate a single EventBridge schedule event.
 *
 * @param {object} params - Event parameters
 * @param {string} params.name - Rule name
 * @param {string} params.description - Rule description
 * @param {string} params.expression - Cron expression
 * @param {string} params.action - Lambda action (start/stop)
 * @param {string|undefined} params.targetGroup - Target region group
 * @param {boolean} params.enabled - Whether the rule is enabled
 * @param {string} params.service - Service name
 * @param {string} params.stage - Serverless stage
 * @returns {object} Serverless schedule event
 */
function createScheduleEvent({
  name,
  description,
  expression,
  action,
  targetGroup,
  enabled,
  service,
  stage,
}) {
  const event = {
    schedule: {
      name,
      description,
      rate: `cron(${expression})`,
      input: {
        action,
        triggerSource: {
          type: 'eventbridge-scheduled',
          // Note: identity ARN will be resolved at deployment time by CloudFormation
          identity: `arn:aws:events:\${AWS::Region}:\${AWS::AccountId}:rule/${name}`,
          displayName: name,
          metadata: {
            eventDetailType: 'Scheduled Event',
          },
        },
      },
      enabled,
    },
  };

  // Add targetGroup if specified (for regional schedules)
  if (targetGroup) {
    event.schedule.input.targetGroup = targetGroup;
  }

  return event;
}

/**
 * Generate events for regional schedules (group_schedules_cron mode).
 *
 * @param {object} config - Parsed config object
 * @param {string} service - Service name
 * @param {string} stage - Serverless stage
 * @returns {object[]} Array of Serverless schedule events
 */
function generateRegionalScheduleEvents(config, service, stage) {
  const events = [];
  const groupSchedulesCron = config.group_schedules_cron;

  for (const [groupName, schedule] of Object.entries(groupSchedulesCron)) {
    // Start event
    if (schedule.start) {
      events.push(
        createScheduleEvent({
          name: `${service}-${stage}-${groupName}-start`,
          description: schedule.start.description || `Start ${groupName} resources`,
          expression: schedule.start.expression,
          action: 'start',
          targetGroup: groupName,
          enabled: schedule.start.enabled,
          service,
          stage,
        })
      );
    }

    // Stop event
    if (schedule.stop) {
      events.push(
        createScheduleEvent({
          name: `${service}-${stage}-${groupName}-stop`,
          description: schedule.stop.description || `Stop ${groupName} resources`,
          expression: schedule.stop.expression,
          action: 'stop',
          targetGroup: groupName,
          enabled: schedule.stop.enabled,
          service,
          stage,
        })
      );
    }
  }

  return events;
}

/**
 * Generate events for legacy schedules (schedules_cron mode).
 *
 * @param {object} config - Parsed config object
 * @param {string} service - Service name
 * @param {string} stage - Serverless stage
 * @returns {object[]} Array of Serverless schedule events
 */
function generateLegacyScheduleEvents(config, service, stage) {
  const events = [];
  const schedulesCron = config.schedules_cron;

  if (!schedulesCron) {
    console.warn(`[generate-schedules] No schedules_cron found in config for stage: ${stage}`);
    return events;
  }

  // Start event
  if (schedulesCron.start) {
    events.push(
      createScheduleEvent({
        name: `${service}-${stage}-start`,
        description: schedulesCron.start.description || 'Start resources',
        expression: schedulesCron.start.expression,
        action: 'start',
        targetGroup: undefined, // No targetGroup for legacy mode
        enabled: schedulesCron.start.enabled,
        service,
        stage,
      })
    );
  }

  // Stop event
  if (schedulesCron.stop) {
    events.push(
      createScheduleEvent({
        name: `${service}-${stage}-stop`,
        description: schedulesCron.stop.description || 'Stop resources',
        expression: schedulesCron.stop.expression,
        action: 'stop',
        targetGroup: undefined, // No targetGroup for legacy mode
        enabled: schedulesCron.stop.enabled,
        service,
        stage,
      })
    );
  }

  return events;
}

/**
 * Main function to generate EventBridge events.
 * Called by Serverless Framework via ${file(./scripts/generate-schedules.js):events}
 *
 * This function can be called in two ways:
 * 1. By Serverless Framework with (serverless) argument
 * 2. Directly without arguments (falls back to environment variables)
 *
 * @param {object} serverless - Serverless Framework instance (optional)
 * @returns {object[]|Promise<object[]>} Array of Serverless schedule events
 */
module.exports.events = (serverless) => {
  // Get stage from serverless context or environment variable
  let stage;
  let service = 'lights-out';

  console.log('[generate-schedules] 🚀 ~ serverless:', serverless);

  if (serverless && serverless.options) {
    // Called by Serverless Framework
    stage = serverless.options.stage;
  } else {
    // Called directly (e.g., for testing) - use environment variable
    stage = process.env.SLS_STAGE || 'dev';
  }

  // Resolve config path
  const configRelPath = resolveConfigPath(stage);
  const configPath = path.resolve(__dirname, '..', configRelPath);

  console.log(`[generate-schedules] Stage: ${stage}`);
  console.log(`[generate-schedules] Config: ${configPath}`);

  try {
    const config = readConfig(configPath);

    // Determine which mode to use
    if (config.group_schedules_cron && Object.keys(config.group_schedules_cron).length > 0) {
      console.log(`[generate-schedules] Using regional schedules (group_schedules_cron mode)`);
      console.log(
        `[generate-schedules] Groups: ${Object.keys(config.group_schedules_cron).join(', ')}`
      );
      return generateRegionalScheduleEvents(config, service, stage);
    } else {
      console.log(`[generate-schedules] Using legacy schedules (schedules_cron mode)`);
      return generateLegacyScheduleEvents(config, service, stage);
    }
  } catch (error) {
    console.error(`[generate-schedules] Error: ${error.message}`);
    // Return empty events on error to prevent deployment failure
    // The deployment will succeed but without scheduled events
    return [];
  }
};

// Export helper functions for testing
module.exports.resolveConfigPath = resolveConfigPath;
module.exports.readConfig = readConfig;
module.exports.generateRegionalScheduleEvents = generateRegionalScheduleEvents;
module.exports.generateLegacyScheduleEvents = generateLegacyScheduleEvents;

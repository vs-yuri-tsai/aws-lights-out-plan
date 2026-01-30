#!/usr/bin/env node
/* eslint-disable no-unused-vars */
/* eslint-disable no-undef */

/**
 * Generate AWS EventBridge cron expressions from human-readable schedule configurations
 *
 * Supports two configuration modes:
 * 1. Legacy mode (schedules.default) - Single schedule for all regions
 * 2. Regional mode (group_schedules) - Per-group schedules with different timezones
 *
 * Usage:
 *   node scripts/generate-cron.js --config config/sss-lab.yml
 *   node scripts/generate-cron.js --config config/pg-stage/airsync-stage.yml
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

// Mapping of day abbreviations to AWS EventBridge day-of-week format
const DAY_MAP = {
  MON: 'MON',
  TUE: 'TUE',
  WED: 'WED',
  THU: 'THU',
  FRI: 'FRI',
  SAT: 'SAT',
  SUN: 'SUN',
};

const DAY_ORDER = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

/**
 * Parse command line arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const params = {};

  for (let i = 0; i < args.length; i += 2) {
    const key = args[i].replace(/^--/, '');
    const value = args[i + 1];
    params[key] = value;
  }

  return params;
}

/**
 * Validate required parameters
 */
function validateParams(params) {
  if (!params.config) {
    console.error('❌ Missing required parameter: --config');
    console.error('\nUsage:');
    console.error('  node scripts/generate-cron.js --config config/sss-lab.yml');
    process.exit(1);
  }
}

/**
 * Validate a single schedule entry (shared by both modes)
 */
function validateScheduleEntry(schedule, context) {
  const { timezone, startTime, stopTime, activeDays } = schedule;

  if (!timezone) {
    throw new Error(`Missing ${context}.timezone`);
  }

  if (!startTime) {
    throw new Error(`Missing ${context}.startTime`);
  }

  if (!stopTime) {
    throw new Error(`Missing ${context}.stopTime`);
  }

  if (!activeDays || !Array.isArray(activeDays) || activeDays.length === 0) {
    throw new Error(`Missing or empty ${context}.activeDays array`);
  }

  // Validate time format (HH:mm)
  const timeRegex = /^([0-1][0-9]|2[0-3]):[0-5][0-9]$/;
  if (!timeRegex.test(startTime)) {
    throw new Error(
      `Invalid startTime format in ${context}: ${startTime}. Expected HH:mm (24-hour format)`
    );
  }

  if (!timeRegex.test(stopTime)) {
    throw new Error(
      `Invalid stopTime format in ${context}: ${stopTime}. Expected HH:mm (24-hour format)`
    );
  }

  // Validate activeDays
  for (const day of activeDays) {
    if (!DAY_MAP[day]) {
      throw new Error(
        `Invalid day in ${context}.activeDays: ${day}. Valid values: ${Object.keys(DAY_MAP).join(', ')}`
      );
    }
  }

  // Validate timezone (basic check - will fail at runtime if truly invalid)
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
  } catch (error) {
    throw new Error(
      `Invalid timezone in ${context}: ${timezone}. Must be a valid IANA timezone (e.g., Asia/Taipei)`
    );
  }
}

/**
 * Validate legacy schedule configuration (schedules.default)
 */
function validateLegacyScheduleConfig(schedules) {
  if (!schedules || !schedules.default) {
    throw new Error('Missing schedules.default section in config');
  }

  validateScheduleEntry(schedules.default, 'schedules.default');
}

/**
 * Validate regional schedule configuration (group_schedules)
 */
function validateGroupScheduleConfig(groupSchedules) {
  if (!groupSchedules || typeof groupSchedules !== 'object') {
    throw new Error('Missing or invalid group_schedules section in config');
  }

  const groups = Object.keys(groupSchedules);
  if (groups.length === 0) {
    throw new Error('group_schedules must contain at least one group');
  }

  for (const groupName of groups) {
    validateScheduleEntry(groupSchedules[groupName], `group_schedules.${groupName}`);
  }
}

/**
 * Convert local time to UTC using timezone offset
 *
 * @param {string} localTime - Time in HH:mm format (e.g., "09:00")
 * @param {string} timezone - IANA timezone (e.g., "Asia/Taipei")
 * @returns {{hour: number, minute: number}} UTC hour and minute
 */
function convertToUTC(localTime, timezone) {
  const [localHour, localMinute] = localTime.split(':').map(Number);

  // Get timezone offset in hours
  const getTimezoneOffsetHours = (tz) => {
    const date = new Date('2025-01-15T12:00:00Z');
    const utcDate = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' }));
    const tzDate = new Date(date.toLocaleString('en-US', { timeZone: tz }));
    return (tzDate - utcDate) / (1000 * 60 * 60);
  };

  const offsetHours = getTimezoneOffsetHours(timezone);

  // Convert local time to UTC
  let utcHour = localHour - offsetHours;
  let utcMinute = localMinute;

  // Handle day overflow/underflow
  if (utcHour < 0) {
    utcHour += 24;
  } else if (utcHour >= 24) {
    utcHour -= 24;
  }

  return {
    hour: Math.floor(utcHour),
    minute: utcMinute,
  };
}

/**
 * Normalize day range to AWS EventBridge format
 * Examples:
 *   [MON, TUE, WED, THU, FRI] → "MON-FRI"
 *   [MON, WED, FRI] → "MON,WED,FRI"
 *   [SAT, SUN] → "SAT-SUN"
 */
function normalizeDayRange(days) {
  if (days.length === 0) {
    throw new Error('activeDays cannot be empty');
  }

  if (days.length === 1) {
    return days[0];
  }

  // Sort days by their order in the week
  const sortedDays = [...days].sort((a, b) => {
    return DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b);
  });

  // Check if days are consecutive
  let isConsecutive = true;
  for (let i = 1; i < sortedDays.length; i++) {
    const prevIndex = DAY_ORDER.indexOf(sortedDays[i - 1]);
    const currIndex = DAY_ORDER.indexOf(sortedDays[i]);
    if (currIndex !== prevIndex + 1) {
      isConsecutive = false;
      break;
    }
  }

  if (isConsecutive) {
    // Return range format: MON-FRI
    return `${sortedDays[0]}-${sortedDays[sortedDays.length - 1]}`;
  } else {
    // Return comma-separated: MON,WED,FRI
    return sortedDays.join(',');
  }
}

/**
 * Generate AWS EventBridge cron expression
 *
 * Format: "MM HH ? * DOW *"
 * Example: "0 1 ? * MON-FRI *" = 01:00 UTC, Monday to Friday
 *
 * @param {number} utcHour - UTC hour (0-23)
 * @param {number} utcMinute - UTC minute (0-59)
 * @param {string[]} activeDays - Array of day abbreviations
 * @returns {string} AWS EventBridge cron expression
 */
function generateCronExpression(utcHour, utcMinute, activeDays) {
  const dayOfWeek = normalizeDayRange(activeDays);
  return `${utcMinute} ${utcHour} ? * ${dayOfWeek} *`;
}

/**
 * Generate cron configuration for a single schedule entry
 */
function generateCronForSchedule(schedule, groupName = null) {
  const { timezone, startTime, stopTime, activeDays, enabled } = schedule;

  // Convert times to UTC
  const startUTC = convertToUTC(startTime, timezone);
  const stopUTC = convertToUTC(stopTime, timezone);

  // Generate cron expressions
  const startCron = generateCronExpression(startUTC.hour, startUTC.minute, activeDays);
  const stopCron = generateCronExpression(stopUTC.hour, stopUTC.minute, activeDays);

  const groupLabel = groupName ? `${groupName} ` : '';

  return {
    start: {
      expression: startCron,
      description: `Start ${groupLabel}resources at ${startTime} ${timezone} (${String(startUTC.hour).padStart(2, '0')}:${String(startUTC.minute).padStart(2, '0')} UTC)`,
      enabled,
    },
    stop: {
      expression: stopCron,
      description: `Stop ${groupLabel}resources at ${stopTime} ${timezone} (${String(stopUTC.hour).padStart(2, '0')}:${String(stopUTC.minute).padStart(2, '0')} UTC)`,
      enabled,
    },
  };
}

/**
 * Generate cron configuration for legacy mode (schedules.default)
 */
function generateLegacyCronConfig(schedules) {
  return generateCronForSchedule(schedules.default);
}

/**
 * Generate cron configuration for regional mode (group_schedules)
 */
function generateGroupCronConfig(groupSchedules) {
  const result = {};

  for (const [groupName, schedule] of Object.entries(groupSchedules)) {
    result[groupName] = generateCronForSchedule(schedule, groupName);
  }

  return result;
}

/**
 * Read YAML configuration file
 */
function readConfigYAML(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return yaml.load(content);
  } catch (error) {
    throw new Error(`Failed to read config file ${filePath}: ${error.message}`);
  }
}

/**
 * Update YAML configuration file with generated cron config
 */
function updateConfigYAML(filePath, cronConfig, mode) {
  try {
    // Read existing YAML
    const content = fs.readFileSync(filePath, 'utf8');
    const config = yaml.load(content);

    // Update the appropriate cron section based on mode
    if (mode === 'regional') {
      config.group_schedules_cron = cronConfig;
    } else {
      config.schedules_cron = cronConfig;
    }

    // Convert back to YAML with proper formatting
    const updatedContent = yaml.dump(config, {
      indent: 2,
      lineWidth: 120,
      noRefs: true,
      sortKeys: false,
    });

    // Write back to file
    fs.writeFileSync(filePath, updatedContent, 'utf8');

    console.log(`✅ Updated ${filePath} with generated cron expressions`);
  } catch (error) {
    throw new Error(`Failed to update config file ${filePath}: ${error.message}`);
  }
}

/**
 * Detect configuration mode (legacy or regional)
 */
function detectConfigMode(config) {
  if (config.group_schedules && Object.keys(config.group_schedules).length > 0) {
    return 'regional';
  }
  if (config.schedules && config.schedules.default) {
    return 'legacy';
  }
  return null;
}

/**
 * Main entry point
 */
async function main() {
  try {
    // Parse and validate arguments
    const params = parseArgs();
    validateParams(params);

    const configPath = path.resolve(process.cwd(), params.config);

    // Check if file exists
    if (!fs.existsSync(configPath)) {
      throw new Error(`Config file not found: ${configPath}`);
    }

    console.log(`📄 Reading config from: ${configPath}`);

    // Read and parse YAML
    const config = readConfigYAML(configPath);

    // Detect configuration mode
    const mode = detectConfigMode(config);

    if (!mode) {
      throw new Error(
        'Config must contain either schedules.default (legacy) or group_schedules (regional)'
      );
    }

    console.log(
      `📋 Detected mode: ${mode === 'regional' ? 'Regional (group_schedules)' : 'Legacy (schedules.default)'}`
    );

    if (mode === 'regional') {
      // Regional mode: group_schedules
      validateGroupScheduleConfig(config.group_schedules);

      const groups = Object.keys(config.group_schedules);
      console.log(`\n📅 Group Schedules (${groups.length} groups):`);

      for (const groupName of groups) {
        const schedule = config.group_schedules[groupName];
        console.log(`\n   [${groupName}]`);
        console.log(`   Timezone: ${schedule.timezone}`);
        console.log(`   Start: ${schedule.startTime}`);
        console.log(`   Stop: ${schedule.stopTime}`);
        console.log(`   Days: ${schedule.activeDays.join(', ')}`);
        console.log(`   Enabled: ${schedule.enabled}`);
      }

      // Generate cron expressions for all groups
      const cronConfig = generateGroupCronConfig(config.group_schedules);

      console.log(`\n🔄 Generated Cron Expressions:`);
      for (const [groupName, cron] of Object.entries(cronConfig)) {
        console.log(`\n   [${groupName}]`);
        console.log(`   Start: ${cron.start.expression}`);
        console.log(`   └─ ${cron.start.description}`);
        console.log(`   Stop:  ${cron.stop.expression}`);
        console.log(`   └─ ${cron.stop.description}`);
      }

      // Update YAML file
      updateConfigYAML(configPath, cronConfig, 'regional');
    } else {
      // Legacy mode: schedules.default
      validateLegacyScheduleConfig(config.schedules);

      const { timezone, startTime, stopTime, activeDays } = config.schedules.default;

      console.log(`\n📅 Schedule Configuration:`);
      console.log(`   Timezone: ${timezone}`);
      console.log(`   Start: ${startTime}`);
      console.log(`   Stop: ${stopTime}`);
      console.log(`   Days: ${activeDays.join(', ')}`);

      // Generate cron expressions
      const cronConfig = generateLegacyCronConfig(config.schedules);

      console.log(`\n🔄 Generated Cron Expressions:`);
      console.log(`   Start: ${cronConfig.start.expression}`);
      console.log(`   └─ ${cronConfig.start.description}`);
      console.log(`   Stop:  ${cronConfig.stop.expression}`);
      console.log(`   └─ ${cronConfig.stop.description}`);

      // Update YAML file
      updateConfigYAML(configPath, cronConfig, 'legacy');
    }

    console.log(`\n✨ Done!`);
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
}

main();

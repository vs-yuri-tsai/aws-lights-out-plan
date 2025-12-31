#!/usr/bin/env node

/**
 * Generate AWS EventBridge cron expressions from human-readable schedule configurations
 *
 * Usage:
 *   node scripts/generate-cron.js --config config/sss-lab.yml
 *
 * This script reads the `schedules.default` section from a YAML config file,
 * converts timezone-aware times to UTC, generates AWS EventBridge cron expressions,
 * and updates the `schedules_cron` section in the same file.
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
 * Validate schedule configuration
 */
function validateScheduleConfig(schedules) {
  if (!schedules || !schedules.default) {
    throw new Error('Missing schedules.default section in config');
  }

  const { timezone, startTime, stopTime, activeDays } = schedules.default;

  if (!timezone) {
    throw new Error('Missing schedules.default.timezone');
  }

  if (!startTime) {
    throw new Error('Missing schedules.default.startTime');
  }

  if (!stopTime) {
    throw new Error('Missing schedules.default.stopTime');
  }

  if (!activeDays || !Array.isArray(activeDays) || activeDays.length === 0) {
    throw new Error('Missing or empty schedules.default.activeDays array');
  }

  // Validate time format (HH:mm)
  const timeRegex = /^([0-1][0-9]|2[0-3]):[0-5][0-9]$/;
  if (!timeRegex.test(startTime)) {
    throw new Error(`Invalid startTime format: ${startTime}. Expected HH:mm (24-hour format)`);
  }

  if (!timeRegex.test(stopTime)) {
    throw new Error(`Invalid stopTime format: ${stopTime}. Expected HH:mm (24-hour format)`);
  }

  // Validate activeDays
  for (const day of activeDays) {
    if (!DAY_MAP[day]) {
      throw new Error(`Invalid day in activeDays: ${day}. Valid values: ${Object.keys(DAY_MAP).join(', ')}`);
    }
  }

  // Validate timezone (basic check - will fail at runtime if truly invalid)
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
  } catch (error) {
    throw new Error(`Invalid timezone: ${timezone}. Must be a valid IANA timezone (e.g., Asia/Taipei)`);
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

  // Create a date object representing the local time in the target timezone
  // Use a fixed date (2025-01-15 - a Wednesday) to ensure consistent results
  const referenceDate = new Date('2025-01-15T00:00:00Z');
  const year = referenceDate.getUTCFullYear();
  const month = referenceDate.getUTCMonth();
  const day = referenceDate.getUTCDate();

  // Create date string in local timezone
  const localDateString = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(localHour).padStart(2, '0')}:${String(localMinute).padStart(2, '0')}:00`;

  // Get UTC offset for this timezone
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  // Parse the local time in the target timezone to get the equivalent UTC time
  // Strategy: Create a date at the local time, then extract UTC components
  const localDate = new Date(localDateString);

  // Get the offset in minutes
  const offsetMinutes = -localDate.getTimezoneOffset(); // Note: getTimezoneOffset returns offset in minutes, negative for UTC+

  // For a more robust approach, use a known reference
  // Create a date in UTC that represents the same local time
  const utcDate = new Date(Date.UTC(year, month, day, localHour, localMinute, 0));

  // Get the timezone offset using Intl
  const parts = formatter.formatToParts(utcDate);
  const tzHour = parseInt(parts.find(p => p.type === 'hour').value);
  const tzMinute = parseInt(parts.find(p => p.type === 'minute').value);

  // Calculate actual UTC time
  // If timezone is UTC+8 (like Asia/Taipei), local 09:00 = UTC 01:00
  // Strategy: Use a helper to get the offset

  // Better approach: Use a known UTC timestamp and format it in the target timezone
  const testDate = new Date('2025-01-15T00:00:00Z');
  const testFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  // Get offset by comparing UTC midnight with local time
  const utcMidnight = new Date(Date.UTC(2025, 0, 15, 0, 0, 0));
  const localMidnight = new Date(testFormatter.format(utcMidnight));

  // Simplified approach: Calculate offset manually
  // For Asia/Taipei (UTC+8): local 09:00 = 09:00 - 8:00 = 01:00 UTC
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
 * Generate cron configuration object
 */
function generateCronConfig(schedules) {
  const { timezone, startTime, stopTime, activeDays, enabled } = schedules.default;

  // Convert times to UTC
  const startUTC = convertToUTC(startTime, timezone);
  const stopUTC = convertToUTC(stopTime, timezone);

  // Generate cron expressions
  const startCron = generateCronExpression(startUTC.hour, startUTC.minute, activeDays);
  const stopCron = generateCronExpression(stopUTC.hour, stopUTC.minute, activeDays);

  return {
    start: {
      expression: startCron,
      description: `Start resources at ${startTime} ${timezone} (${String(startUTC.hour).padStart(2, '0')}:${String(startUTC.minute).padStart(2, '0')} UTC)`,
      enabled,
    },
    stop: {
      expression: stopCron,
      description: `Stop resources at ${stopTime} ${timezone} (${String(stopUTC.hour).padStart(2, '0')}:${String(stopUTC.minute).padStart(2, '0')} UTC)`,
      enabled,
    },
  };
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
function updateConfigYAML(filePath, cronConfig) {
  try {
    // Read existing YAML
    const content = fs.readFileSync(filePath, 'utf8');
    const config = yaml.load(content);

    // Update schedules_cron section
    config.schedules_cron = cronConfig;

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

    // Validate schedule configuration
    validateScheduleConfig(config.schedules);

    const { timezone, startTime, stopTime, activeDays } = config.schedules.default;

    console.log(`\n📅 Schedule Configuration:`);
    console.log(`   Timezone: ${timezone}`);
    console.log(`   Start: ${startTime}`);
    console.log(`   Stop: ${stopTime}`);
    console.log(`   Days: ${activeDays.join(', ')}`);

    // Generate cron expressions
    const cronConfig = generateCronConfig(config.schedules);

    console.log(`\n🔄 Generated Cron Expressions:`);
    console.log(`   Start: ${cronConfig.start.expression}`);
    console.log(`   └─ ${cronConfig.start.description}`);
    console.log(`   Stop:  ${cronConfig.stop.expression}`);
    console.log(`   └─ ${cronConfig.stop.description}`);

    // Update YAML file
    updateConfigYAML(configPath, cronConfig);

    console.log(`\n✨ Done!`);
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
}

main();

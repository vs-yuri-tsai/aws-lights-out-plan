#!/usr/bin/env node
/* eslint-disable no-undef */

/**
 * Interactive onboarding script for new projects
 *
 * This script guides users through setting up a new project configuration
 * for the lights-out system. It generates:
 * 1. scripts/arguments/{projectName}.json - Lambda invocation arguments
 * 2. config/{account}/{project}.yml - Project configuration
 *
 * Usage:
 *   node scripts/onboard-project.js
 */

const prompts = require('prompts');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const Handlebars = require('handlebars');

// ============================================================================
// Constants
// ============================================================================

const AWS_ACCOUNTS = [
  { title: 'pg-development', value: 'pg-development' },
  { title: 'pg-stage', value: 'pg-stage' },
  { title: '+ Create new...', value: '__new__' },
];

const AWS_REGIONS = [
  // United States
  { title: 'N. Virginia (us-east-1)', value: 'us-east-1' },
  { title: 'Ohio (us-east-2)', value: 'us-east-2' },
  { title: 'N. California (us-west-1)', value: 'us-west-1' },
  { title: 'Oregon (us-west-2)', value: 'us-west-2' },
  // Asia Pacific
  { title: 'Mumbai (ap-south-1)', value: 'ap-south-1' },
  { title: 'Osaka (ap-northeast-3)', value: 'ap-northeast-3' },
  { title: 'Seoul (ap-northeast-2)', value: 'ap-northeast-2' },
  { title: 'Singapore (ap-southeast-1)', value: 'ap-southeast-1' },
  { title: 'Sydney (ap-southeast-2)', value: 'ap-southeast-2' },
  { title: 'Tokyo (ap-northeast-1)', value: 'ap-northeast-1' },
  // Canada
  { title: 'Central (ca-central-1)', value: 'ca-central-1' },
  // Europe
  { title: 'Frankfurt (eu-central-1)', value: 'eu-central-1' },
  { title: 'Ireland (eu-west-1)', value: 'eu-west-1' },
  { title: 'London (eu-west-2)', value: 'eu-west-2' },
  { title: 'Paris (eu-west-3)', value: 'eu-west-3' },
  { title: 'Stockholm (eu-north-1)', value: 'eu-north-1' },
  // South America
  { title: 'São Paulo (sa-east-1)', value: 'sa-east-1' },
];

const TIMEZONES = [
  { title: 'Asia/Taipei (UTC+8)', value: 'Asia/Taipei' },
  { title: 'Asia/Tokyo (UTC+9)', value: 'Asia/Tokyo' },
  { title: 'Asia/Singapore (UTC+8)', value: 'Asia/Singapore' },
  { title: 'Asia/Shanghai (UTC+8)', value: 'Asia/Shanghai' },
  { title: 'America/New_York (UTC-5/-4)', value: 'America/New_York' },
  { title: 'America/Los_Angeles (UTC-8/-7)', value: 'America/Los_Angeles' },
  { title: 'America/Chicago (UTC-6/-5)', value: 'America/Chicago' },
  { title: 'Europe/London (UTC+0/+1)', value: 'Europe/London' },
  { title: 'Europe/Paris (UTC+1/+2)', value: 'Europe/Paris' },
  { title: 'UTC', value: 'UTC' },
];

const WEEKDAYS = [
  { title: 'Monday', value: 'MON' },
  { title: 'Tuesday', value: 'TUE' },
  { title: 'Wednesday', value: 'WED' },
  { title: 'Thursday', value: 'THU' },
  { title: 'Friday', value: 'FRI' },
  { title: 'Saturday', value: 'SAT' },
  { title: 'Sunday', value: 'SUN' },
];

const RESOURCE_TYPES = [
  { title: 'ECS Service', value: 'ecs:service', selected: true },
  { title: 'RDS Instance', value: 'rds:db' },
];

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Validate project name (lowercase + hyphens only)
 */
function validateProjectName(value) {
  if (!value || value.trim().length === 0) {
    return 'Project name is required';
  }
  if (!/^[a-z][a-z0-9-]*$/.test(value)) {
    return 'Project name must start with a letter and contain only lowercase letters, numbers, and hyphens';
  }
  if (value.length > 50) {
    return 'Project name must be 50 characters or less';
  }
  return true;
}

/**
 * Validate account alias (lowercase + hyphens only)
 */
function validateAccountAlias(value) {
  if (!value || value.trim().length === 0) {
    return 'Account alias is required';
  }
  if (!/^[a-z][a-z0-9-]*$/.test(value)) {
    return 'Account alias must start with a letter and contain only lowercase letters, numbers, and hyphens';
  }
  return true;
}

/**
 * Validate AWS profile name
 */
function validateProfile(value) {
  if (!value || value.trim().length === 0) {
    return 'AWS profile is required';
  }
  return true;
}

/**
 * Validate time format (HH:mm)
 */
function validateTime(value) {
  if (!value || value.trim().length === 0) {
    return 'Time is required';
  }
  if (!/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/.test(value)) {
    return 'Invalid time format. Use HH:mm (24-hour format, e.g., 09:00)';
  }
  return true;
}

/**
 * Validate positive integer
 */
function validatePositiveInt(value) {
  const num = parseInt(value, 10);
  if (isNaN(num) || num < 0) {
    return 'Must be a non-negative integer';
  }
  return true;
}

/**
 * Validate webhook URL
 */
function validateWebhookUrl(value) {
  if (!value || value.trim().length === 0) {
    return true; // Optional field
  }
  try {
    new URL(value);
    return true;
  } catch {
    return 'Invalid URL format';
  }
}

/**
 * Business logic validation: min <= desired <= max
 */
function validateCapacityRange(min, desired, max) {
  if (min > max) {
    return `minCapacity (${min}) cannot be greater than maxCapacity (${max})`;
  }
  if (desired < min) {
    return `desiredCount (${desired}) cannot be less than minCapacity (${min})`;
  }
  if (desired > max) {
    return `desiredCount (${desired}) cannot be greater than maxCapacity (${max})`;
  }
  return true;
}

// ============================================================================
// Cron Generation (from generate-cron.js)
// ============================================================================

const DAY_ORDER = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

/**
 * Convert local time to UTC using timezone offset
 */
function convertToUTC(localTime, timezone) {
  const [localHour, localMinute] = localTime.split(':').map(Number);

  const getTimezoneOffsetHours = (tz) => {
    const date = new Date('2025-01-15T12:00:00Z');
    const utcDate = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' }));
    const tzDate = new Date(date.toLocaleString('en-US', { timeZone: tz }));
    return (tzDate - utcDate) / (1000 * 60 * 60);
  };

  const offsetHours = getTimezoneOffsetHours(timezone);
  let utcHour = localHour - offsetHours;

  if (utcHour < 0) {
    utcHour += 24;
  } else if (utcHour >= 24) {
    utcHour -= 24;
  }

  return {
    hour: Math.floor(utcHour),
    minute: localMinute,
  };
}

/**
 * Normalize day range to AWS EventBridge format
 */
function normalizeDayRange(days) {
  if (days.length === 0) {
    throw new Error('activeDays cannot be empty');
  }

  if (days.length === 1) {
    return days[0];
  }

  const sortedDays = [...days].sort((a, b) => {
    return DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b);
  });

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
    return `${sortedDays[0]}-${sortedDays[sortedDays.length - 1]}`;
  } else {
    return sortedDays.join(',');
  }
}

/**
 * Generate cron expression and description
 */
function generateCronForSchedule(schedule, groupName = null) {
  const { timezone, startTime, stopTime, activeDays, enabled } = schedule;

  const startUTC = convertToUTC(startTime, timezone);
  const stopUTC = convertToUTC(stopTime, timezone);

  const dayOfWeek = normalizeDayRange(activeDays);
  const startCron = `${startUTC.minute} ${startUTC.hour} ? * ${dayOfWeek} *`;
  const stopCron = `${stopUTC.minute} ${stopUTC.hour} ? * ${dayOfWeek} *`;

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

// ============================================================================
// Interactive Steps
// ============================================================================

/**
 * Step 1: Scope Selection
 */
async function step1_scope() {
  console.log('\n🎯 Step 1: Scope Selection\n');

  const response = await prompts({
    type: 'select',
    name: 'scope',
    message: 'Select resource scope:',
    choices: [
      {
        title: 'project - Specific project resources only (Recommended)',
        value: 'project',
        description: 'Uses lights-out:project tag for discovery',
      },
      {
        title: 'aws-account - All tagged resources in the account',
        value: 'aws-account',
        description: 'Uses lights-out:group tag for discovery',
      },
    ],
    initial: 0,
  });

  if (!response.scope) {
    return null;
  }

  return response;
}

/**
 * Step 2: Project Basic Information
 * - If scope is 'project': asks for projectName, accountAlias, profile, primaryRegion
 * - If scope is 'aws-account': asks for accountAlias, profile, primaryRegion (uses accountAlias as config name)
 */
async function step2_projectInfo(scope) {
  console.log('\n📋 Step 2: Project Basic Information\n');

  // For project scope, ask for project name first
  let projectName = null;
  if (scope === 'project') {
    const projectResponse = await prompts({
      type: 'text',
      name: 'projectName',
      message: 'Project name (lowercase + hyphens, e.g. airsync-dev):',
      validate: validateProjectName,
    });

    if (!projectResponse.projectName) {
      return null;
    }
    projectName = projectResponse.projectName;
  }

  // Ask for account alias
  const accountResponse = await prompts({
    type: 'select',
    name: 'accountAlias',
    message: 'AWS account alias (to store config file in config/):',
    choices: AWS_ACCOUNTS,
    initial: 0,
  });

  if (accountResponse.accountAlias === undefined) {
    return null;
  }

  // Handle custom account alias
  let accountAlias = accountResponse.accountAlias;
  if (accountAlias === '__new__') {
    const customResponse = await prompts({
      type: 'text',
      name: 'customAccountAlias',
      message: 'Enter new account alias:',
      validate: validateAccountAlias,
    });

    if (!customResponse.customAccountAlias) {
      return null;
    }

    accountAlias = customResponse.customAccountAlias;
  }

  // For aws-account scope, use accountAlias as projectName (flat config like sss-lab.yml)
  if (scope === 'aws-account') {
    projectName = accountAlias;
    console.log(`\n📁 Config file: config/${accountAlias}.yml`);
  } else {
    console.log(`\n📁 Config file: config/${accountAlias}/${projectName}.yml`);
  }

  const remainingResponse = await prompts([
    {
      type: 'text',
      name: 'profile',
      message: 'AWS SSO profile name (see ~/.aws/config):',
      validate: validateProfile,
    },
    {
      type: 'select',
      name: 'primaryRegion',
      message: 'Primary AWS region:',
      choices: AWS_REGIONS,
      initial: AWS_REGIONS.findIndex(r => r.value === 'us-east-1'),
    },
  ]);

  if (!remainingResponse.profile) {
    return null;
  }

  return {
    projectName,
    accountAlias,
    profile: remainingResponse.profile,
    primaryRegion: remainingResponse.primaryRegion,
  };
}

/**
 * Step 3: Region Configuration Mode
 */
async function step3_regionMode() {
  console.log('\n🌍 Step 3: Region Configuration Mode\n');

  const response = await prompts({
    type: 'select',
    name: 'regionMode',
    message: 'Select region configuration mode:',
    choices: [
      {
        title: 'single - Single region',
        value: 'single',
        description: 'Resources in one region with one schedule',
      },
      {
        title: 'multiple - Multiple regions, shared schedule',
        value: 'multiple',
        description: 'Resources in multiple regions with same schedule',
      },
      {
        title: 'grouped - Region groups with different schedules',
        value: 'grouped',
        description: 'Different regions grouped by timezone/schedule',
      },
    ],
    initial: 0,
  });

  if (!response.regionMode) {
    return null;
  }

  return response;
}

/**
 * Step 3a: Configure regions based on mode
 */
async function step3a_configureRegions(regionMode, primaryRegion) {
  if (regionMode === 'single') {
    return { regions: [primaryRegion] };
  }

  if (regionMode === 'multiple') {
    console.log('\n🌍 Step 3a: Select Multiple Regions\n');
    const response = await prompts({
      type: 'multiselect',
      name: 'regions',
      message: 'Select regions (space to toggle, enter to confirm):',
      choices: AWS_REGIONS.map(r => ({
        ...r,
        selected: r.value === primaryRegion,
      })),
      min: 1,
    });

    if (!response.regions) {
      return null;
    }

    return { regions: response.regions };
  }

  // grouped mode
  console.log('\n🌍 Step 3a: Configure Region Groups\n');
  console.log('You will define region groups (e.g., "asia", "america").\n');

  const regionGroups = {};
  let addMore = true;

  while (addMore) {
    const groupResponse = await prompts([
      {
        type: 'text',
        name: 'groupName',
        message: 'Group name (e.g., asia, america):',
        validate: (v) => v && v.trim().length > 0 ? true : 'Group name is required',
      },
      {
        type: 'multiselect',
        name: 'regions',
        message: 'Select regions for this group:',
        choices: AWS_REGIONS,
        min: 1,
      },
    ]);

    if (!groupResponse.groupName || !groupResponse.regions) {
      return null;
    }

    regionGroups[groupResponse.groupName] = groupResponse.regions;

    const continueResponse = await prompts({
      type: 'confirm',
      name: 'addMore',
      message: 'Add another region group?',
      initial: false,
    });

    addMore = continueResponse.addMore;
  }

  return { regionGroups };
}

/**
 * Step 4: Resource Types
 */
async function step4_resourceTypes() {
  console.log('\n📦 Step 4: Resource Types\n');

  const response = await prompts({
    type: 'multiselect',
    name: 'resourceTypes',
    message: 'Select resource types to manage:',
    choices: RESOURCE_TYPES,
    min: 1,
  });

  if (!response.resourceTypes) {
    return null;
  }

  return response;
}

/**
 * Step 5: ECS Configuration
 */
async function step5_ecsConfig(hasEcs) {
  if (!hasEcs) {
    return { ecs: null };
  }

  console.log('\n🐳 Step 5: ECS Service Configuration\n');

  const modeResponse = await prompts({
    type: 'select',
    name: 'ecsMode',
    message: 'Select ECS scaling mode:',
    choices: [
      {
        title: 'direct - Set desiredCount directly',
        value: 'direct',
        description: 'For services without Application Auto Scaling',
      },
      {
        title: 'auto-scaling - Configure min/max/desired capacity',
        value: 'auto-scaling',
        description: 'For services with Application Auto Scaling',
      },
    ],
    initial: 0,
  });

  if (!modeResponse.ecsMode) {
    return null;
  }

  let ecsConfig;

  if (modeResponse.ecsMode === 'direct') {
    const configResponse = await prompts([
      {
        type: 'number',
        name: 'startDesired',
        message: 'START - Desired count:',
        initial: 1,
        validate: validatePositiveInt,
      },
      {
        type: 'number',
        name: 'stopDesired',
        message: 'STOP - Desired count:',
        initial: 0,
        validate: validatePositiveInt,
      },
    ]);

    if (configResponse.startDesired === undefined) {
      return null;
    }

    ecsConfig = {
      useAutoScaling: false,
      start: { desiredCount: configResponse.startDesired },
      stop: { desiredCount: configResponse.stopDesired },
    };
  } else {
    // auto-scaling mode
    const configResponse = await prompts([
      {
        type: 'number',
        name: 'startMin',
        message: 'START - Min capacity:',
        initial: 2,
        validate: validatePositiveInt,
      },
      {
        type: 'number',
        name: 'startMax',
        message: 'START - Max capacity:',
        initial: 6,
        validate: validatePositiveInt,
      },
      {
        type: 'number',
        name: 'startDesired',
        message: 'START - Desired count:',
        initial: 2,
        validate: validatePositiveInt,
      },
      {
        type: 'number',
        name: 'stopMin',
        message: 'STOP - Min capacity:',
        initial: 0,
        validate: validatePositiveInt,
      },
      {
        type: 'number',
        name: 'stopMax',
        message: 'STOP - Max capacity:',
        initial: 0,
        validate: validatePositiveInt,
      },
      {
        type: 'number',
        name: 'stopDesired',
        message: 'STOP - Desired count:',
        initial: 0,
        validate: validatePositiveInt,
      },
    ]);

    if (configResponse.startMin === undefined) {
      return null;
    }

    // Validate capacity ranges
    const startValidation = validateCapacityRange(
      configResponse.startMin,
      configResponse.startDesired,
      configResponse.startMax
    );
    if (startValidation !== true) {
      console.error(`\n❌ START configuration error: ${startValidation}`);
      return null;
    }

    const stopValidation = validateCapacityRange(
      configResponse.stopMin,
      configResponse.stopDesired,
      configResponse.stopMax
    );
    if (stopValidation !== true) {
      console.error(`\n❌ STOP configuration error: ${stopValidation}`);
      return null;
    }

    ecsConfig = {
      useAutoScaling: true,
      start: {
        minCapacity: configResponse.startMin,
        maxCapacity: configResponse.startMax,
        desiredCount: configResponse.startDesired,
      },
      stop: {
        minCapacity: configResponse.stopMin,
        maxCapacity: configResponse.stopMax,
        desiredCount: configResponse.stopDesired,
      },
    };
  }

  return { ecs: ecsConfig };
}

/**
 * Step 6: RDS Configuration
 */
async function step6_rdsConfig(hasRds) {
  if (!hasRds) {
    return { rds: null };
  }

  console.log('\n🗄️  Step 6: RDS Instance Configuration\n');

  const response = await prompts([
    {
      type: 'number',
      name: 'waitAfterCommand',
      message: 'Wait time after command (seconds):',
      initial: 60,
      validate: (v) => v >= 0 && v <= 300 ? true : 'Must be between 0 and 300 seconds',
    },
    {
      type: 'confirm',
      name: 'skipSnapshot',
      message: 'Skip snapshot on stop? (recommended for dev environments)',
      initial: true,
    },
  ]);

  if (response.waitAfterCommand === undefined) {
    return null;
  }

  return {
    rds: {
      waitAfterCommand: response.waitAfterCommand,
      skipSnapshot: response.skipSnapshot,
    },
  };
}

/**
 * Step 7: Schedule Configuration
 */
async function step7_schedule(regionMode, regionGroups) {
  console.log('\n⏰ Step 7: Schedule Configuration\n');

  if (regionMode === 'grouped') {
    // Configure schedule for each region group
    const groupSchedules = {};

    for (const groupName of Object.keys(regionGroups)) {
      console.log(`\n📅 Configure schedule for group: ${groupName}\n`);

      const scheduleResponse = await prompts([
        {
          type: 'select',
          name: 'timezone',
          message: `[${groupName}] Timezone:`,
          choices: TIMEZONES,
        },
        {
          type: 'text',
          name: 'startTime',
          message: `[${groupName}] Start time (HH:mm):`,
          initial: '08:00',
          validate: validateTime,
        },
        {
          type: 'text',
          name: 'stopTime',
          message: `[${groupName}] Stop time (HH:mm):`,
          initial: '18:00',
          validate: validateTime,
        },
        {
          type: 'multiselect',
          name: 'activeDays',
          message: `[${groupName}] Active days:`,
          choices: WEEKDAYS.map(d => ({
            ...d,
            selected: ['MON', 'TUE', 'WED', 'THU', 'FRI'].includes(d.value),
          })),
          min: 1,
        },
        {
          type: 'confirm',
          name: 'enabled',
          message: `[${groupName}] Enable schedule?`,
          initial: true,
        },
      ]);

      if (!scheduleResponse.timezone) {
        return null;
      }

      groupSchedules[groupName] = scheduleResponse;
    }

    return { groupSchedules };
  }

  // Single or multiple regions with shared schedule
  const scheduleResponse = await prompts([
    {
      type: 'select',
      name: 'timezone',
      message: 'Timezone:',
      choices: TIMEZONES,
    },
    {
      type: 'text',
      name: 'startTime',
      message: 'Start time (HH:mm):',
      initial: '08:00',
      validate: validateTime,
    },
    {
      type: 'text',
      name: 'stopTime',
      message: 'Stop time (HH:mm):',
      initial: '18:00',
      validate: validateTime,
    },
    {
      type: 'multiselect',
      name: 'activeDays',
      message: 'Active days:',
      choices: WEEKDAYS.map(d => ({
        ...d,
        selected: ['MON', 'TUE', 'WED', 'THU', 'FRI'].includes(d.value),
      })),
      min: 1,
    },
    {
      type: 'confirm',
      name: 'enabled',
      message: 'Enable schedule?',
      initial: true,
    },
  ]);

  if (!scheduleResponse.timezone) {
    return null;
  }

  return { schedule: scheduleResponse };
}

/**
 * Step 8: Teams Notification
 */
async function step8_teamsNotification() {
  console.log('\n📢 Step 8: Teams Notification (Optional)\n');

  const enableResponse = await prompts({
    type: 'confirm',
    name: 'enableTeams',
    message: 'Enable Microsoft Teams notifications?',
    initial: true,
  });

  if (!enableResponse.enableTeams) {
    return {
      teams: { enabled: false },
    };
  }

  const teamsResponse = await prompts([
    {
      type: 'text',
      name: 'webhookUrl',
      message: 'Teams webhook URL:',
      validate: validateWebhookUrl,
    },
    {
      type: 'text',
      name: 'description',
      message: 'Notification description:',
      initial: (prev, values, prompt) => `Lights Out notifications`,
    },
  ]);

  if (!teamsResponse.webhookUrl) {
    return null;
  }

  return {
    teams: {
      enabled: true,
      webhookUrl: teamsResponse.webhookUrl,
      description: teamsResponse.description,
    },
  };
}

/**
 * Step 9: Confirmation Summary
 */
async function step9_confirmSummary(config) {
  console.log('\n📋 Step 9: Configuration Summary\n');
  console.log('─'.repeat(60));

  const isAccountScope = config.scope === 'aws-account';

  if (isAccountScope) {
    console.log(`\n🔹 Account: ${config.accountAlias}`);
  } else {
    console.log(`\n🔹 Project: ${config.projectName}`);
    console.log(`   Account: ${config.accountAlias}`);
  }
  console.log(`   Profile: ${config.profile}`);
  console.log(`   Scope: ${config.scope}`);
  console.log(`   Region: ${config.primaryRegion}`);

  if (config.regions) {
    console.log(`   Regions: ${config.regions.join(', ')}`);
  }
  if (config.regionGroups) {
    console.log(`   Region Groups:`);
    for (const [name, regions] of Object.entries(config.regionGroups)) {
      console.log(`     - ${name}: ${regions.join(', ')}`);
    }
  }

  console.log(`\n🔹 Resource Types: ${config.resourceTypes.join(', ')}`);

  if (config.ecs) {
    console.log(`\n🔹 ECS Configuration:`);
    console.log(`   Mode: ${config.ecs.useAutoScaling ? 'Auto Scaling' : 'Direct'}`);
    if (config.ecs.useAutoScaling) {
      console.log(`   START: min=${config.ecs.start.minCapacity}, max=${config.ecs.start.maxCapacity}, desired=${config.ecs.start.desiredCount}`);
      console.log(`   STOP: min=${config.ecs.stop.minCapacity}, max=${config.ecs.stop.maxCapacity}, desired=${config.ecs.stop.desiredCount}`);
    } else {
      console.log(`   START: desiredCount=${config.ecs.start.desiredCount}`);
      console.log(`   STOP: desiredCount=${config.ecs.stop.desiredCount}`);
    }
  }

  if (config.rds) {
    console.log(`\n🔹 RDS Configuration:`);
    console.log(`   Wait after command: ${config.rds.waitAfterCommand}s`);
    console.log(`   Skip snapshot: ${config.rds.skipSnapshot}`);
  }

  if (config.schedule) {
    console.log(`\n🔹 Schedule:`);
    console.log(`   Timezone: ${config.schedule.timezone}`);
    console.log(`   Start: ${config.schedule.startTime}`);
    console.log(`   Stop: ${config.schedule.stopTime}`);
    console.log(`   Days: ${config.schedule.activeDays.join(', ')}`);
    console.log(`   Enabled: ${config.schedule.enabled}`);
  }

  if (config.groupSchedules) {
    console.log(`\n🔹 Group Schedules:`);
    for (const [name, sched] of Object.entries(config.groupSchedules)) {
      console.log(`   [${name}]`);
      console.log(`     Timezone: ${sched.timezone}`);
      console.log(`     Start: ${sched.startTime}, Stop: ${sched.stopTime}`);
      console.log(`     Days: ${sched.activeDays.join(', ')}`);
      console.log(`     Enabled: ${sched.enabled}`);
    }
  }

  if (config.teams.enabled) {
    console.log(`\n🔹 Teams Notification: Enabled`);
    console.log(`   Description: ${config.teams.description}`);
  } else {
    console.log(`\n🔹 Teams Notification: Disabled`);
  }

  // Show files to be created
  const argFileName = isAccountScope ? config.accountAlias : config.projectName;
  const argFile = `scripts/arguments/${argFileName}.json`;
  const configFile = isAccountScope
    ? `config/${config.accountAlias}.yml`
    : `config/${config.accountAlias}/${config.projectName}.yml`;

  console.log(`\n📁 Files to be created:`);
  console.log(`   1. ${argFile}`);
  console.log(`   2. ${configFile}`);

  console.log('\n' + '─'.repeat(60));

  const confirmResponse = await prompts({
    type: 'confirm',
    name: 'confirm',
    message: 'Proceed with file generation?',
    initial: true,
  });

  return confirmResponse.confirm;
}

/**
 * Step 10: Generate Files
 */
async function step10_generateFiles(config) {
  console.log('\n⚙️  Step 10: Generating Files\n');

  const scriptsDir = path.dirname(__filename);
  const rootDir = path.dirname(scriptsDir);

  // Determine paths based on scope
  const isAccountScope = config.scope === 'aws-account';
  const stage = isAccountScope
    ? config.accountAlias  // e.g., sss-lab
    : `${config.accountAlias}-${config.projectName}`;  // e.g., pg-development-airsync-dev

  const argFileName = isAccountScope ? config.accountAlias : config.projectName;
  const argFilePath = path.join(scriptsDir, 'arguments', `${argFileName}.json`);

  // Config file path: flat for aws-account, nested for project
  const configFilePath = isAccountScope
    ? path.join(rootDir, 'config', `${config.accountAlias}.yml`)  // config/sss-lab.yml
    : path.join(rootDir, 'config', config.accountAlias, `${config.projectName}.yml`);  // config/pg-development/airsync-dev.yml

  const configRelativePath = isAccountScope
    ? `config/${config.accountAlias}.yml`
    : `config/${config.accountAlias}/${config.projectName}.yml`;

  // 1. Generate argument JSON
  const argJson = {
    scope: config.scope,
    region: config.primaryRegion,
    stage: stage,
    profile: config.profile,
    'function-name': `lights-out-${stage}`,
    config: {
      name: `/lights-out/${stage}/config`,
      path: configRelativePath,
      description: `Lights Out configuration for ${config.projectName}${isAccountScope ? ' account' : ' project'}`,
    },
  };

  // Ensure arguments directory exists
  const argsDir = path.join(scriptsDir, 'arguments');
  if (!fs.existsSync(argsDir)) {
    fs.mkdirSync(argsDir, { recursive: true });
  }

  // Write argument JSON
  fs.writeFileSync(argFilePath, JSON.stringify(argJson, null, 2) + '\n', 'utf8');
  console.log(`✅ Created: ${path.relative(rootDir, argFilePath)}`);

  // 2. Generate YAML config using Handlebars template
  const templatePath = path.join(scriptsDir, 'templates', 'project.yml.hbs');
  const templateContent = fs.readFileSync(templatePath, 'utf8');
  const template = Handlebars.compile(templateContent);

  // Prepare template data
  const templateData = {
    environment: stage,
    useRegionGroups: !!config.regionGroups,
    regionGroups: config.regionGroups,
    regions: config.regions,
    projectTag: config.scope === 'project' ? config.projectName : null,
    groupTag: config.scope === 'aws-account' ? config.projectName : null,
    resourceTypes: config.resourceTypes,
    hasEcs: config.resourceTypes.includes('ecs:service'),
    hasRds: config.resourceTypes.includes('rds:db'),
    ecs: config.ecs,
    rds: config.rds,
    schedule: config.schedule,
    groupSchedules: config.groupSchedules,
    teams: config.teams,
  };

  const yamlContent = template(templateData);

  // Ensure config directory exists
  const configDir = path.dirname(configFilePath);
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  // Write YAML config
  fs.writeFileSync(configFilePath, yamlContent, 'utf8');
  console.log(`✅ Created: ${path.relative(rootDir, configFilePath)}`);

  // 3. Validate YAML syntax
  try {
    yaml.load(yamlContent);
    console.log(`✅ YAML syntax validation passed`);
  } catch (err) {
    console.error(`❌ YAML syntax error: ${err.message}`);
    return false;
  }

  // 4. Generate cron expressions
  console.log(`\n⏰ Generating cron expressions...`);

  try {
    const parsedConfig = yaml.load(yamlContent);
    let cronConfig;

    if (config.groupSchedules) {
      // Regional mode
      cronConfig = {};
      for (const [groupName, schedule] of Object.entries(config.groupSchedules)) {
        cronConfig[groupName] = generateCronForSchedule(schedule, groupName);
      }
      parsedConfig.group_schedules_cron = cronConfig;
    } else {
      // Legacy mode
      cronConfig = generateCronForSchedule(config.schedule);
      parsedConfig.schedules_cron = cronConfig;
    }

    // Write updated config with cron
    const updatedYaml = yaml.dump(parsedConfig, {
      indent: 2,
      lineWidth: 120,
      noRefs: true,
      sortKeys: false,
    });

    fs.writeFileSync(configFilePath, updatedYaml, 'utf8');
    console.log(`✅ Cron expressions generated`);
  } catch (err) {
    console.error(`❌ Cron generation error: ${err.message}`);
    return false;
  }

  // 5. Show next steps
  console.log('\n' + '═'.repeat(60));
  console.log('🎉 ONBOARDING COMPLETE!');
  console.log('═'.repeat(60));

  console.log('\n📝 NEXT STEPS:\n');

  // serverless.yml mapping path
  const serverlessConfigPath = isAccountScope
    ? `${config.accountAlias}.yml`
    : `${config.accountAlias}/${config.projectName}.yml`;

  console.log(`1. Update serverless.yml (add stage mapping):`);
  console.log(`   custom.resolveConfigPath:`);
  console.log(`     ${stage}: ${serverlessConfigPath}\n`);

  console.log(`2. Tag your AWS resources:`);
  console.log(`   lights-out:managed = true`);
  if (config.scope === 'project') {
    console.log(`   lights-out:project = ${config.projectName}`);
  } else {
    console.log(`   lights-out:group = ${config.projectName}`);
  }
  console.log('');

  console.log(`3. Deploy the Lambda function:`);
  console.log(`   pnpm deploy\n`);

  console.log(`4. Upload configuration to SSM:`);
  console.log(`   pnpm config\n`);

  console.log(`5. Verify resource discovery:`);
  console.log(`   pnpm action (select Discover)\n`);

  return true;
}

// ============================================================================
// Main Entry Point
// ============================================================================

async function main() {
  console.log('\n' + '═'.repeat(60));
  console.log('🚀 Lights Out - Project Onboarding Wizard');
  console.log('═'.repeat(60));
  console.log('\nThis wizard will help you configure a new project for');
  console.log('the lights-out automated resource management system.\n');

  const config = {};

  // Step 1: Scope selection
  const step1Result = await step1_scope();
  if (!step1Result) {
    console.log('\n👋 Onboarding cancelled.\n');
    process.exit(0);
  }
  Object.assign(config, step1Result);

  // Step 2: Project info (depends on scope)
  const step2Result = await step2_projectInfo(config.scope);
  if (!step2Result) {
    console.log('\n👋 Onboarding cancelled.\n');
    process.exit(0);
  }
  Object.assign(config, step2Result);

  // Step 3: Region mode
  const step3Result = await step3_regionMode();
  if (!step3Result) {
    console.log('\n👋 Onboarding cancelled.\n');
    process.exit(0);
  }
  Object.assign(config, step3Result);

  // Step 3a: Configure regions
  const step3aResult = await step3a_configureRegions(config.regionMode, config.primaryRegion);
  if (!step3aResult) {
    console.log('\n👋 Onboarding cancelled.\n');
    process.exit(0);
  }
  Object.assign(config, step3aResult);

  // Step 4: Resource types
  const step4Result = await step4_resourceTypes();
  if (!step4Result) {
    console.log('\n👋 Onboarding cancelled.\n');
    process.exit(0);
  }
  Object.assign(config, step4Result);

  // Step 5: ECS config
  const hasEcs = config.resourceTypes.includes('ecs:service');
  const step5Result = await step5_ecsConfig(hasEcs);
  if (!step5Result) {
    console.log('\n👋 Onboarding cancelled.\n');
    process.exit(0);
  }
  Object.assign(config, step5Result);

  // Step 6: RDS config
  const hasRds = config.resourceTypes.includes('rds:db');
  const step6Result = await step6_rdsConfig(hasRds);
  if (!step6Result) {
    console.log('\n👋 Onboarding cancelled.\n');
    process.exit(0);
  }
  Object.assign(config, step6Result);

  // Step 7: Schedule
  const step7Result = await step7_schedule(config.regionMode, config.regionGroups);
  if (!step7Result) {
    console.log('\n👋 Onboarding cancelled.\n');
    process.exit(0);
  }
  Object.assign(config, step7Result);

  // Step 8: Teams notification
  const step8Result = await step8_teamsNotification();
  if (!step8Result) {
    console.log('\n👋 Onboarding cancelled.\n');
    process.exit(0);
  }
  Object.assign(config, step8Result);

  // Step 9: Confirmation
  const confirmed = await step9_confirmSummary(config);
  if (!confirmed) {
    console.log('\n👋 Onboarding cancelled.\n');
    process.exit(0);
  }

  // Step 10: Generate files
  const success = await step10_generateFiles(config);
  if (!success) {
    console.log('\n❌ File generation failed.\n');
    process.exit(1);
  }

  console.log('');
}

// Run main function
main().catch((err) => {
  console.error('\n❌ Unexpected error:', err.message);
  process.exit(1);
});

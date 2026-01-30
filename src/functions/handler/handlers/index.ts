/**
 * Handlers module - exports all handler-related types and functions.
 */

// Export base types and utilities
export { getResourceDefaults } from './base';

// Export concrete handler implementations
export { ECSServiceHandler } from './ecsService';
export { RDSInstanceHandler } from './rdsInstance';
export { AuroraClusterHandler } from './auroraCluster';

// Export factory function
export { getHandler } from './factory';

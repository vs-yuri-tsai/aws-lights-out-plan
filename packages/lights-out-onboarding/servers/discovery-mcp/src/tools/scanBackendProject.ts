/**
 * Backend Project Scanner Tool
 *
 * Scans a backend project directory for HTTP calls, environment variable usage,
 * and infers service dependencies for Lights Out dependency analysis.
 */

import * as fs from 'fs';
import * as path from 'path';
import type {
  BackendProjectAnalysis,
  ProjectLanguage,
  HttpCallReference,
  EnvVarUsage,
  InferredDependency,
} from '../types.js';

// File patterns for different languages
const LANGUAGE_PATTERNS: Record<ProjectLanguage, string[]> = {
  typescript: ['.ts', '.tsx'],
  javascript: ['.js', '.jsx', '.mjs', '.cjs'],
  python: ['.py'],
  go: ['.go'],
  unknown: [],
};

// Directories to skip
const SKIP_DIRS = [
  'node_modules',
  '.git',
  'dist',
  'build',
  '__pycache__',
  '.venv',
  'venv',
  'vendor',
  '.next',
  'coverage',
  '.turbo',
];

// Patterns for HTTP calls (TypeScript/JavaScript)
const TS_HTTP_PATTERNS = [
  // fetch
  { pattern: /fetch\s*\(\s*[`'"](https?:\/\/[^`'"]+)[`'"]/g, method: 'unknown' as const },
  { pattern: /fetch\s*\(\s*`\$\{([^}]+)\}([^`]*)`/g, method: 'unknown' as const, hasEnvVar: true },
  {
    pattern: /fetch\s*\(\s*process\.env\.([A-Z_]+)/g,
    method: 'unknown' as const,
    isEnvVarOnly: true,
  },

  // axios
  {
    pattern: /axios\.(get|post|put|delete|patch)\s*\(\s*[`'"](https?:\/\/[^`'"]+)[`'"]/gi,
    extractMethod: true,
  },
  {
    pattern: /axios\.(get|post|put|delete|patch)\s*\(\s*`\$\{([^}]+)\}([^`]*)`/gi,
    extractMethod: true,
    hasEnvVar: true,
  },
  {
    pattern: /axios\s*\(\s*\{[^}]*url:\s*[`'"](https?:\/\/[^`'"]+)[`'"]/g,
    method: 'unknown' as const,
  },

  // got, ky, node-fetch similar patterns
  {
    pattern: /(?:got|ky|request)\s*\(\s*[`'"](https?:\/\/[^`'"]+)[`'"]/g,
    method: 'unknown' as const,
  },
];

// Patterns for environment variable usage (TypeScript/JavaScript)
const TS_ENV_PATTERNS = [
  /process\.env\.([A-Z][A-Z0-9_]*)/g,
  /process\.env\[['"]([A-Z][A-Z0-9_]*)['"]\]/g,
];

// Patterns for HTTP calls (Python)
const PY_HTTP_PATTERNS = [
  { pattern: /requests\.(get|post|put|delete|patch)\s*\(\s*['"](https?:\/\/[^'"]+)['"]/gi },
  { pattern: /httpx\.(get|post|put|delete|patch)\s*\(\s*['"](https?:\/\/[^'"]+)['"]/gi },
  { pattern: /aiohttp\.ClientSession\(\)\.(?:get|post|put|delete)\s*\(\s*['"](https?:\/\/[^'"]+)['"]/gi },
];

// Patterns for environment variable usage (Python)
const PY_ENV_PATTERNS = [
  /os\.environ\[['"]([A-Z][A-Z0-9_]*)['"]\]/g,
  /os\.environ\.get\s*\(\s*['"]([A-Z][A-Z0-9_]*)['"]/g,
  /os\.getenv\s*\(\s*['"]([A-Z][A-Z0-9_]*)['"]/g,
];

// Patterns for HTTP calls (Go)
const GO_HTTP_PATTERNS = [
  { pattern: /http\.(Get|Post|Put|Delete)\s*\(\s*["](https?:\/\/[^"]+)["]/gi },
  { pattern: /http\.NewRequest\s*\(\s*["](GET|POST|PUT|DELETE|PATCH)["].*["](https?:\/\/[^"]+)["]/gi },
];

// Patterns for environment variable usage (Go)
const GO_ENV_PATTERNS = [/os\.Getenv\s*\(\s*["']([A-Z][A-Z0-9_]*)["']\s*\)/g];

// Service URL environment variable patterns
const SERVICE_URL_ENV_PATTERNS = [
  /^(.+?)_SERVICE_URL$/i,
  /^(.+?)_SERVICE_HOST$/i,
  /^(.+?)_API_URL$/i,
  /^(.+?)_API_HOST$/i,
  /^(.+?)_BASE_URL$/i,
  /^(.+?)_ENDPOINT$/i,
];

// Infrastructure env vars to exclude
const INFRA_ENV_PREFIXES = [
  'AWS_',
  'DD_',
  'OTEL_',
  'NEW_RELIC_',
  'LOG_',
  'REDIS_',
  'DATABASE_',
  'DB_',
  'MONGO',
  'POSTGRES',
  'MYSQL',
  'NODE_',
  'NPM_',
  'PORT',
  'HOST',
];

/**
 * Detect the primary language of a project
 */
function detectLanguage(directory: string): ProjectLanguage {
  const files = fs.readdirSync(directory);

  // Check for language-specific markers
  if (files.includes('package.json')) {
    const pkgPath = path.join(directory, 'package.json');
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      if (pkg.devDependencies?.typescript || pkg.dependencies?.typescript) {
        return 'typescript';
      }
    } catch {
      // Ignore
    }
    return 'javascript';
  }

  if (files.includes('tsconfig.json')) {
    return 'typescript';
  }

  if (files.includes('requirements.txt') || files.includes('pyproject.toml') || files.includes('setup.py')) {
    return 'python';
  }

  if (files.includes('go.mod') || files.includes('go.sum')) {
    return 'go';
  }

  return 'unknown';
}

/**
 * Get line number from character index
 */
function getLineNumber(content: string, index: number): number {
  return content.slice(0, index).split('\n').length;
}

/**
 * Check if env var looks like a service URL
 */
function isServiceUrlEnvVar(name: string): boolean {
  // Exclude infrastructure vars
  if (INFRA_ENV_PREFIXES.some((prefix) => name.toUpperCase().startsWith(prefix))) {
    return false;
  }

  // Check if it matches service URL patterns
  return SERVICE_URL_ENV_PATTERNS.some((pattern) => pattern.test(name));
}

/**
 * Extract service name from env var name
 */
function extractServiceNameFromEnvVar(name: string): string | undefined {
  for (const pattern of SERVICE_URL_ENV_PATTERNS) {
    const match = name.match(pattern);
    if (match) {
      return match[1].toLowerCase().replace(/_/g, '-');
    }
  }
  return undefined;
}

/**
 * Recursively find source files
 */
function findSourceFiles(
  dir: string,
  extensions: string[],
  maxDepth: number = 10,
  currentDepth: number = 0
): string[] {
  const files: string[] = [];

  if (currentDepth > maxDepth) {
    return files;
  }

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (!SKIP_DIRS.includes(entry.name) && !entry.name.startsWith('.')) {
          files.push(...findSourceFiles(fullPath, extensions, maxDepth, currentDepth + 1));
        }
        continue;
      }

      if (!entry.isFile()) continue;

      const ext = path.extname(entry.name);
      if (extensions.includes(ext)) {
        files.push(fullPath);
      }
    }
  } catch {
    // Directory not accessible
  }

  return files;
}

/**
 * Scan TypeScript/JavaScript file
 */
function scanTsJsFile(
  filePath: string,
  relativePath: string,
  content: string
): { httpCalls: HttpCallReference[]; envVars: EnvVarUsage[] } {
  const httpCalls: HttpCallReference[] = [];
  const envVars: EnvVarUsage[] = [];

  // Scan for HTTP calls
  for (const patternDef of TS_HTTP_PATTERNS) {
    patternDef.pattern.lastIndex = 0;
    const matches = content.matchAll(patternDef.pattern);

    for (const match of matches) {
      let url = '';
      let method: HttpCallReference['method'] = 'unknown';
      let usesEnvVar = false;
      let envVarName: string | undefined;

      if ('extractMethod' in patternDef && patternDef.extractMethod) {
        method = (match[1]?.toUpperCase() as HttpCallReference['method']) || 'unknown';
        url = match[2] || '';
      } else if ('isEnvVarOnly' in patternDef && patternDef.isEnvVarOnly) {
        envVarName = match[1];
        url = `\${${envVarName}}`;
        usesEnvVar = true;
      } else if ('hasEnvVar' in patternDef && patternDef.hasEnvVar) {
        envVarName = match[1];
        url = `\${${envVarName}}${match[2] || ''}`;
        usesEnvVar = true;
      } else {
        url = match[1] || '';
        method = ('method' in patternDef ? patternDef.method : 'unknown') || 'unknown';
      }

      if (url) {
        httpCalls.push({
          file: relativePath,
          lineNumber: getLineNumber(content, match.index || 0),
          method,
          url,
          usesEnvVar,
          envVarName,
        });
      }
    }
  }

  // Scan for environment variables
  for (const pattern of TS_ENV_PATTERNS) {
    pattern.lastIndex = 0;
    const matches = content.matchAll(pattern);

    for (const match of matches) {
      const name = match[1];
      if (name) {
        envVars.push({
          name,
          file: relativePath,
          lineNumber: getLineNumber(content, match.index || 0),
          isServiceUrl: isServiceUrlEnvVar(name),
        });
      }
    }
  }

  return { httpCalls, envVars };
}

/**
 * Scan Python file
 */
function scanPythonFile(
  filePath: string,
  relativePath: string,
  content: string
): { httpCalls: HttpCallReference[]; envVars: EnvVarUsage[] } {
  const httpCalls: HttpCallReference[] = [];
  const envVars: EnvVarUsage[] = [];

  // Scan for HTTP calls
  for (const patternDef of PY_HTTP_PATTERNS) {
    patternDef.pattern.lastIndex = 0;
    const matches = content.matchAll(patternDef.pattern);

    for (const match of matches) {
      const method = (match[1]?.toUpperCase() as HttpCallReference['method']) || 'unknown';
      const url = match[2] || match[1] || '';

      if (url && url.startsWith('http')) {
        httpCalls.push({
          file: relativePath,
          lineNumber: getLineNumber(content, match.index || 0),
          method,
          url,
          usesEnvVar: false,
        });
      }
    }
  }

  // Scan for environment variables
  for (const pattern of PY_ENV_PATTERNS) {
    pattern.lastIndex = 0;
    const matches = content.matchAll(pattern);

    for (const match of matches) {
      const name = match[1];
      if (name) {
        envVars.push({
          name,
          file: relativePath,
          lineNumber: getLineNumber(content, match.index || 0),
          isServiceUrl: isServiceUrlEnvVar(name),
        });
      }
    }
  }

  return { httpCalls, envVars };
}

/**
 * Scan Go file
 */
function scanGoFile(
  filePath: string,
  relativePath: string,
  content: string
): { httpCalls: HttpCallReference[]; envVars: EnvVarUsage[] } {
  const httpCalls: HttpCallReference[] = [];
  const envVars: EnvVarUsage[] = [];

  // Scan for HTTP calls
  for (const patternDef of GO_HTTP_PATTERNS) {
    patternDef.pattern.lastIndex = 0;
    const matches = content.matchAll(patternDef.pattern);

    for (const match of matches) {
      const method = (match[1]?.toUpperCase() as HttpCallReference['method']) || 'unknown';
      const url = match[2] || match[1] || '';

      if (url && url.startsWith('http')) {
        httpCalls.push({
          file: relativePath,
          lineNumber: getLineNumber(content, match.index || 0),
          method,
          url,
          usesEnvVar: false,
        });
      }
    }
  }

  // Scan for environment variables
  for (const pattern of GO_ENV_PATTERNS) {
    pattern.lastIndex = 0;
    const matches = content.matchAll(pattern);

    for (const match of matches) {
      const name = match[1];
      if (name) {
        envVars.push({
          name,
          file: relativePath,
          lineNumber: getLineNumber(content, match.index || 0),
          isServiceUrl: isServiceUrlEnvVar(name),
        });
      }
    }
  }

  return { httpCalls, envVars };
}

/**
 * Infer dependencies from collected data
 */
function inferDependencies(
  serviceName: string,
  envVars: EnvVarUsage[],
  httpCalls: HttpCallReference[]
): InferredDependency[] {
  const dependencies = new Map<string, InferredDependency>();

  // Infer from service URL environment variables
  const serviceUrlEnvVars = envVars.filter((e) => e.isServiceUrl);
  for (const envVar of serviceUrlEnvVars) {
    const targetService = extractServiceNameFromEnvVar(envVar.name);
    if (targetService && targetService !== serviceName) {
      const key = `${serviceName}->${targetService}`;
      if (dependencies.has(key)) {
        dependencies.get(key)!.evidence.push(`${envVar.file}:${envVar.lineNumber}`);
      } else {
        dependencies.set(key, {
          source: serviceName,
          target: targetService,
          confidence: 'high',
          evidence: [`${envVar.file}:${envVar.lineNumber} (env: ${envVar.name})`],
        });
      }
    }
  }

  // Infer from HTTP calls using env vars
  const envVarHttpCalls = httpCalls.filter((c) => c.usesEnvVar && c.envVarName);
  for (const call of envVarHttpCalls) {
    const targetService = extractServiceNameFromEnvVar(call.envVarName!);
    if (targetService && targetService !== serviceName) {
      const key = `${serviceName}->${targetService}`;
      if (dependencies.has(key)) {
        dependencies.get(key)!.evidence.push(`${call.file}:${call.lineNumber}`);
      } else {
        dependencies.set(key, {
          source: serviceName,
          target: targetService,
          confidence: 'high',
          evidence: [`${call.file}:${call.lineNumber} (HTTP call using ${call.envVarName})`],
        });
      }
    }
  }

  // Infer from direct HTTP URLs (lower confidence)
  const directHttpCalls = httpCalls.filter((c) => !c.usesEnvVar && c.url.includes('://'));
  for (const call of directHttpCalls) {
    try {
      const url = new URL(call.url);
      const hostname = url.hostname;
      // Try to extract service name from hostname
      const match = hostname.match(/^([a-z0-9-]+)/i);
      if (match) {
        const targetService = match[1].toLowerCase();
        if (targetService !== serviceName && targetService !== 'localhost' && targetService !== '127') {
          const key = `${serviceName}->${targetService}`;
          if (!dependencies.has(key)) {
            dependencies.set(key, {
              source: serviceName,
              target: targetService,
              confidence: 'low',
              evidence: [`${call.file}:${call.lineNumber} (direct URL: ${call.url})`],
            });
          }
        }
      }
    } catch {
      // Invalid URL
    }
  }

  return Array.from(dependencies.values());
}

/**
 * Scan a backend project directory
 */
export async function scanBackendProject(input: {
  directory: string;
  serviceName?: string;
}): Promise<BackendProjectAnalysis> {
  const { directory, serviceName } = input;

  // Default empty result
  const emptyResult: BackendProjectAnalysis = {
    success: false,
    directory,
    language: 'unknown',
    httpCalls: [],
    envVarUsages: [],
    inferredDependencies: [],
    summary: {
      totalFiles: 0,
      filesWithHttpCalls: 0,
      uniqueEnvVars: 0,
      inferredDependencies: 0,
    },
  };

  // Validate directory exists
  if (!fs.existsSync(directory)) {
    return {
      ...emptyResult,
      error: `目錄不存在: ${directory}`,
    };
  }

  const stats = fs.statSync(directory);
  if (!stats.isDirectory()) {
    return {
      ...emptyResult,
      error: `路徑不是目錄: ${directory}`,
    };
  }

  // Detect language
  const language = detectLanguage(directory);
  const extensions = LANGUAGE_PATTERNS[language] || [];

  if (extensions.length === 0) {
    return {
      ...emptyResult,
      success: true,
      language,
      error: '無法偵測專案語言，請確認專案包含 package.json、tsconfig.json、requirements.txt 或 go.mod',
    };
  }

  // Find source files
  const sourceFiles = findSourceFiles(directory, extensions);
  const allHttpCalls: HttpCallReference[] = [];
  const allEnvVars: EnvVarUsage[] = [];
  const filesWithHttpCalls = new Set<string>();

  // Scan each file
  for (const filePath of sourceFiles) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const relativePath = path.relative(directory, filePath);

      let result: { httpCalls: HttpCallReference[]; envVars: EnvVarUsage[] };

      if (language === 'typescript' || language === 'javascript') {
        result = scanTsJsFile(filePath, relativePath, content);
      } else if (language === 'python') {
        result = scanPythonFile(filePath, relativePath, content);
      } else if (language === 'go') {
        result = scanGoFile(filePath, relativePath, content);
      } else {
        continue;
      }

      if (result.httpCalls.length > 0) {
        filesWithHttpCalls.add(relativePath);
        allHttpCalls.push(...result.httpCalls);
      }
      allEnvVars.push(...result.envVars);
    } catch {
      // Skip files we can't read
    }
  }

  // Deduplicate env vars
  const uniqueEnvVars = new Map<string, EnvVarUsage>();
  for (const envVar of allEnvVars) {
    if (!uniqueEnvVars.has(envVar.name)) {
      uniqueEnvVars.set(envVar.name, envVar);
    }
  }

  // Infer service name from directory if not provided
  const inferredServiceName = serviceName || path.basename(directory);

  // Infer dependencies
  const inferredDependencies = inferDependencies(
    inferredServiceName,
    Array.from(uniqueEnvVars.values()),
    allHttpCalls
  );

  return {
    success: true,
    directory,
    language,
    httpCalls: allHttpCalls,
    envVarUsages: Array.from(uniqueEnvVars.values()),
    inferredDependencies,
    summary: {
      totalFiles: sourceFiles.length,
      filesWithHttpCalls: filesWithHttpCalls.size,
      uniqueEnvVars: uniqueEnvVars.size,
      inferredDependencies: inferredDependencies.length,
    },
  };
}

/**
 * List Discovery Reports Tool
 *
 * Lists available discovery reports from the reports directory,
 * extracting account ID and date information from file paths.
 */

import * as fs from 'fs';
import * as path from 'path';
import type {
  ListDiscoveryReportsInput,
  ListDiscoveryReportsResult,
  DiscoveryReportInfo,
} from '../types.js';

// Default reports directory relative to project root
const DEFAULT_REPORTS_DIR = 'reports';

/**
 * Lists discovery reports from the specified directory.
 *
 * @param input - Input parameters
 * @returns List of discovery reports with metadata
 */
export async function listDiscoveryReports(
  input: ListDiscoveryReportsInput
): Promise<ListDiscoveryReportsResult> {
  const { accountId, directory } = input;

  // Determine the reports directory
  const reportsDir = directory || path.resolve(process.cwd(), DEFAULT_REPORTS_DIR);

  try {
    // Check if directory exists
    if (!fs.existsSync(reportsDir)) {
      return {
        success: false,
        error: `Reports directory not found: ${reportsDir}`,
        reports: [],
        summary: {
          totalReports: 0,
          accounts: [],
        },
      };
    }

    const reports: DiscoveryReportInfo[] = [];
    const accountsSet = new Set<string>();

    // List account directories
    const accountDirs = fs.readdirSync(reportsDir, { withFileTypes: true });

    for (const accountDir of accountDirs) {
      if (!accountDir.isDirectory()) continue;

      const accountIdFromDir = accountDir.name;

      // Skip if filtering by account and doesn't match
      if (accountId && accountIdFromDir !== accountId) continue;

      // Validate account ID format (12 digits)
      if (!/^\d{12}$/.test(accountIdFromDir)) continue;

      accountsSet.add(accountIdFromDir);

      const accountPath = path.join(reportsDir, accountIdFromDir);
      const files = fs.readdirSync(accountPath, { withFileTypes: true });

      for (const file of files) {
        if (!file.isFile()) continue;

        // Match discovery report files: discovery-report-YYYYMMDD.md
        const match = file.name.match(/^discovery-report-(\d{8})\.md$/);
        if (!match) continue;

        const reportDate = match[1];
        const filePath = path.join(accountPath, file.name);
        const stats = fs.statSync(filePath);

        reports.push({
          path: filePath,
          accountId: accountIdFromDir,
          date: reportDate,
          fileName: file.name,
          size: stats.size,
          modifiedAt: stats.mtime.toISOString(),
        });
      }
    }

    // Sort reports by date (newest first), then by account ID
    reports.sort((a, b) => {
      const dateCompare = b.date.localeCompare(a.date);
      if (dateCompare !== 0) return dateCompare;
      return a.accountId.localeCompare(b.accountId);
    });

    return {
      success: true,
      reports,
      summary: {
        totalReports: reports.length,
        accounts: Array.from(accountsSet).sort(),
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: `Failed to list reports: ${errorMessage}`,
      reports: [],
      summary: {
        totalReports: 0,
        accounts: [],
      },
    };
  }
}

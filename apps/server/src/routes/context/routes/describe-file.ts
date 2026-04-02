/**
 * POST /context/describe-file endpoint - Generate description for a text file
 *
 * Uses AI to analyze a text file and generate a concise description
 * suitable for context file metadata. Model is configurable via
 * phaseModels.fileDescriptionModel in settings (defaults to Haiku).
 *
 * SECURITY: This endpoint validates file paths against ALLOWED_ROOT_DIRECTORY
 * and reads file content directly (not via Claude's Read tool) to prevent
 * arbitrary file reads and prompt injection attacks.
 */

import type { Request, Response } from 'express';
import { createLogger } from '@automaker/utils';
import { PathNotAllowedError } from '@automaker/platform';
import { resolvePhaseModel } from '@automaker/model-resolver';
import { simpleQuery } from '../../../providers/simple-query-service.js';
import * as secureFs from '../../../lib/secure-fs.js';
import * as path from 'path';
import type { SettingsService } from '../../../services/settings-service.js';
import {
  getAutoLoadClaudeMdSetting,
  getPromptCustomization,
  getPhaseModelWithOverrides,
} from '../../../lib/settings-helpers.js';

const logger = createLogger('DescribeFile');

/**
 * Extract a structural summary from a JSON file.
 * For Postman collections, extracts collection name, folders, and request details.
 * For generic JSON, extracts top-level keys and structure overview.
 */
function extractJsonSummary(content: string, fileName: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null; // Not valid JSON, fall back to text truncation
  }

  if (!parsed || typeof parsed !== 'object') {
    return null;
  }

  const obj = parsed as Record<string, unknown>;

  // Detect Postman collection (v2.0 / v2.1)
  if (obj.info && typeof obj.info === 'object' && Array.isArray(obj.item)) {
    return extractPostmanSummary(obj);
  }

  // Detect OpenAPI / Swagger spec
  if (obj.openapi || obj.swagger) {
    return extractOpenApiSummary(obj);
  }

  // Generic JSON: summarize structure
  return extractGenericJsonSummary(obj, fileName);
}

/**
 * Extract summary from a Postman collection
 */
function extractPostmanSummary(collection: Record<string, unknown>): string {
  const info = collection.info as Record<string, unknown>;
  const items = collection.item as unknown[];

  const lines: string[] = [];
  lines.push(`Type: Postman Collection`);
  lines.push(`Name: ${info.name || 'Unnamed'}`);

  if (info.description) {
    const desc =
      typeof info.description === 'string'
        ? info.description
        : (info.description as Record<string, unknown>)?.content || '';
    if (desc) lines.push(`Description: ${String(desc).substring(0, 200)}`);
  }

  // Count requests and extract folder/request structure
  const requests: string[] = [];
  const folders: string[] = [];

  function walkItems(itemList: unknown[], prefix = ''): void {
    for (const entry of itemList) {
      if (!entry || typeof entry !== 'object') continue;
      const item = entry as Record<string, unknown>;
      const name = String(item.name || 'Unnamed');

      if (Array.isArray(item.item)) {
        // Folder
        folders.push(prefix + name);
        walkItems(item.item, prefix + '  ');
      } else if (item.request) {
        // Request
        const req = item.request as Record<string, unknown>;
        const method = typeof req.method === 'string' ? req.method : 'GET';
        let url = '';
        if (typeof req.url === 'string') {
          url = req.url;
        } else if (req.url && typeof req.url === 'object') {
          const urlObj = req.url as Record<string, unknown>;
          url = typeof urlObj.raw === 'string' ? urlObj.raw : '';
        }
        requests.push(`${prefix}${method} ${url || name}`);
      }
    }
  }

  walkItems(items);

  lines.push(`Total requests: ${requests.length}`);
  if (folders.length > 0) {
    lines.push(`Folders (${folders.length}): ${folders.join(', ')}`);
  }

  lines.push('');
  lines.push('Requests:');
  // Include all requests — this is the structural summary, much smaller than raw JSON
  for (const req of requests) {
    lines.push(`  ${req}`);
  }

  // Include variables if present
  if (Array.isArray(collection.variable) && collection.variable.length > 0) {
    lines.push('');
    lines.push('Collection variables:');
    for (const v of collection.variable as Record<string, unknown>[]) {
      lines.push(`  ${v.key}: ${v.value || '(empty)'}`);
    }
  }

  return lines.join('\n');
}

/**
 * Extract summary from an OpenAPI/Swagger spec
 */
function extractOpenApiSummary(spec: Record<string, unknown>): string {
  const lines: string[] = [];
  const version = spec.openapi || spec.swagger;
  lines.push(`Type: ${spec.openapi ? 'OpenAPI' : 'Swagger'} ${version}`);

  const info = spec.info as Record<string, unknown> | undefined;
  if (info) {
    if (info.title) lines.push(`Title: ${info.title}`);
    if (info.version) lines.push(`Version: ${info.version}`);
    if (info.description) lines.push(`Description: ${String(info.description).substring(0, 200)}`);
  }

  // Extract paths/endpoints
  const paths = spec.paths as Record<string, unknown> | undefined;
  if (paths) {
    const endpoints: string[] = [];
    for (const [pathStr, methods] of Object.entries(paths)) {
      if (!methods || typeof methods !== 'object') continue;
      for (const method of Object.keys(methods as Record<string, unknown>)) {
        if (['get', 'post', 'put', 'patch', 'delete', 'options', 'head'].includes(method)) {
          const operation = (methods as Record<string, unknown>)[method] as Record<string, unknown>;
          const summary = operation?.summary ? ` - ${operation.summary}` : '';
          endpoints.push(`  ${method.toUpperCase()} ${pathStr}${summary}`);
        }
      }
    }
    lines.push(`Total endpoints: ${endpoints.length}`);
    lines.push('');
    lines.push('Endpoints:');
    lines.push(...endpoints);
  }

  // Extract tags if present
  if (Array.isArray(spec.tags)) {
    const tagNames = (spec.tags as Record<string, unknown>[]).map((t) => t.name).filter(Boolean);
    if (tagNames.length > 0) {
      lines.push('');
      lines.push(`Tags: ${tagNames.join(', ')}`);
    }
  }

  return lines.join('\n');
}

/**
 * Extract summary from a generic JSON file
 */
function extractGenericJsonSummary(obj: Record<string, unknown>, fileName: string): string {
  const lines: string[] = [];
  lines.push(`Type: JSON file (${fileName})`);
  lines.push(`Top-level keys: ${Object.keys(obj).join(', ')}`);

  for (const [key, value] of Object.entries(obj)) {
    if (Array.isArray(value)) {
      lines.push(`  ${key}: array (${value.length} items)`);
    } else if (value && typeof value === 'object') {
      const nestedKeys = Object.keys(value as Record<string, unknown>);
      lines.push(
        `  ${key}: object {${nestedKeys.slice(0, 10).join(', ')}${nestedKeys.length > 10 ? ', ...' : ''}}`
      );
    } else {
      lines.push(`  ${key}: ${JSON.stringify(value)}`);
    }
  }

  return lines.join('\n');
}

/**
 * Request body for the describe-file endpoint
 */
interface DescribeFileRequestBody {
  /** Path to the file */
  filePath: string;
}

/**
 * Success response from the describe-file endpoint
 */
interface DescribeFileSuccessResponse {
  success: true;
  description: string;
}

/**
 * Error response from the describe-file endpoint
 */
interface DescribeFileErrorResponse {
  success: false;
  error: string;
}

/**
 * Create the describe-file request handler
 *
 * @param settingsService - Optional settings service for loading autoLoadClaudeMd setting
 * @returns Express request handler for file description
 */
export function createDescribeFileHandler(
  settingsService?: SettingsService
): (req: Request, res: Response) => Promise<void> {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const { filePath } = req.body as DescribeFileRequestBody;

      // Validate required fields
      if (!filePath || typeof filePath !== 'string') {
        const response: DescribeFileErrorResponse = {
          success: false,
          error: 'filePath is required and must be a string',
        };
        res.status(400).json(response);
        return;
      }

      logger.info(`Starting description generation for: ${filePath}`);

      // Resolve the path for logging and cwd derivation
      const resolvedPath = secureFs.resolvePath(filePath);

      // Read file content using secureFs (validates path against ALLOWED_ROOT_DIRECTORY)
      // This prevents arbitrary file reads (e.g., /etc/passwd, ~/.ssh/id_rsa)
      // and prompt injection attacks where malicious filePath values could inject instructions
      let fileContent: string;
      try {
        const content = await secureFs.readFile(resolvedPath, 'utf-8');
        fileContent = typeof content === 'string' ? content : content.toString('utf-8');
      } catch (readError) {
        // Path not allowed - return 403 Forbidden
        if (readError instanceof PathNotAllowedError) {
          logger.warn(`Path not allowed: ${filePath}`);
          const response: DescribeFileErrorResponse = {
            success: false,
            error: 'File path is not within the allowed directory',
          };
          res.status(403).json(response);
          return;
        }

        // File not found
        if (
          readError !== null &&
          typeof readError === 'object' &&
          'code' in readError &&
          readError.code === 'ENOENT'
        ) {
          logger.warn(`File not found: ${resolvedPath}`);
          const response: DescribeFileErrorResponse = {
            success: false,
            error: `File not found: ${filePath}`,
          };
          res.status(404).json(response);
          return;
        }

        const errorMessage = readError instanceof Error ? readError.message : 'Unknown error';
        logger.error(`Failed to read file: ${errorMessage}`);
        const response: DescribeFileErrorResponse = {
          success: false,
          error: `Failed to read file: ${errorMessage}`,
        };
        res.status(500).json(response);
        return;
      }

      // Get the filename for context
      const fileName = path.basename(resolvedPath);
      const isJsonFile = fileName.toLowerCase().endsWith('.json');

      // For JSON files, extract a structural summary instead of truncating.
      // This produces an accurate description regardless of file size because the
      // AI sees the full structure (endpoints, folders, keys) rather than an
      // arbitrary prefix of raw JSON.
      let contentToAnalyze: string;
      let contentLabel: string;

      if (isJsonFile) {
        const summary = extractJsonSummary(fileContent, fileName);
        if (summary) {
          contentToAnalyze = summary;
          contentLabel = `${fileName} (structural summary)`;
        } else {
          // Invalid JSON or couldn't parse — fall back to truncation
          const MAX_CONTENT_LENGTH = 50000;
          contentToAnalyze =
            fileContent.length > MAX_CONTENT_LENGTH
              ? fileContent.substring(0, MAX_CONTENT_LENGTH)
              : fileContent;
          contentLabel = `${fileName}${fileContent.length > MAX_CONTENT_LENGTH ? ' (truncated)' : ''}`;
        }
      } else {
        // Non-JSON: truncate very large files to avoid token limits
        const MAX_CONTENT_LENGTH = 50000;
        const truncated = fileContent.length > MAX_CONTENT_LENGTH;
        contentToAnalyze = truncated ? fileContent.substring(0, MAX_CONTENT_LENGTH) : fileContent;
        contentLabel = `${fileName}${truncated ? ' (truncated)' : ''}`;
      }

      // Get customized prompts from settings
      const prompts = await getPromptCustomization(settingsService, '[DescribeFile]');

      // Build prompt with file content passed as structured data
      // The file content is included directly, not via tool invocation
      const prompt = `${prompts.contextDescription.describeFilePrompt}

File: ${contentLabel}

--- FILE CONTENT ---
${contentToAnalyze}`;

      // Use the file's directory as the working directory
      const cwd = path.dirname(resolvedPath);

      // Load autoLoadClaudeMd setting
      const autoLoadClaudeMd = await getAutoLoadClaudeMdSetting(
        cwd,
        settingsService,
        '[DescribeFile]'
      );

      // Get model from phase settings with provider info
      const {
        phaseModel: phaseModelEntry,
        provider,
        credentials,
      } = await getPhaseModelWithOverrides(
        'fileDescriptionModel',
        settingsService,
        cwd,
        '[DescribeFile]'
      );
      const { model, thinkingLevel } = resolvePhaseModel(phaseModelEntry);

      logger.info(
        `Resolved model: ${model}, thinkingLevel: ${thinkingLevel}`,
        provider ? `via provider: ${provider.name}` : 'direct API'
      );

      // Use simpleQuery - provider abstraction handles routing to correct provider
      const result = await simpleQuery({
        prompt,
        model,
        cwd,
        maxTurns: 1,
        allowedTools: [],
        thinkingLevel,
        readOnly: true, // File description only reads, doesn't write
        settingSources: autoLoadClaudeMd ? ['user', 'project', 'local'] : undefined,
        claudeCompatibleProvider: provider, // Pass provider for alternative endpoint configuration
        credentials, // Pass credentials for resolving 'credentials' apiKeySource
      });

      const description = result.text;

      if (!description || description.trim().length === 0) {
        logger.warn('Received empty response from Claude');
        const response: DescribeFileErrorResponse = {
          success: false,
          error: 'Failed to generate description - empty response',
        };
        res.status(500).json(response);
        return;
      }

      logger.info(`Description generated, length: ${description.length} chars`);

      const response: DescribeFileSuccessResponse = {
        success: true,
        description: description.trim(),
      };
      res.json(response);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      logger.error('File description failed:', errorMessage);

      const response: DescribeFileErrorResponse = {
        success: false,
        error: errorMessage,
      };
      res.status(500).json(response);
    }
  };
}

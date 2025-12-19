/**
 * @automaker/utils
 * Shared utility functions for AutoMaker
 */

// Error handling
export {
  isAbortError,
  isCancellationError,
  isAuthenticationError,
  classifyError,
  getUserFriendlyErrorMessage,
} from './error-handler';

// Conversation utilities
export {
  extractTextFromContent,
  normalizeContentBlocks,
  formatHistoryAsText,
  convertHistoryToMessages,
} from './conversation-utils';

// Image handling
export {
  getMimeTypeForImage,
  readImageAsBase64,
  convertImagesToContentBlocks,
  formatImagePathsForPrompt,
} from './image-handler';

// Prompt building
export {
  buildPromptWithImages,
  type PromptContent,
  type PromptWithImages,
} from './prompt-builder';

// Logger
export {
  createLogger,
  getLogLevel,
  setLogLevel,
  LogLevel,
} from './logger';

// File system utilities
export {
  mkdirSafe,
  existsSafe,
} from './fs-utils';

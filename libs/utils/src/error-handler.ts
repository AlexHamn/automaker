/**
 * Error handling utilities for standardized error classification
 *
 * Provides utilities for:
 * - Detecting abort/cancellation errors
 * - Detecting authentication errors
 * - Classifying errors by type
 * - Generating user-friendly error messages
 */

import type { ErrorType, ErrorInfo } from '@automaker/types';

/**
 * Check if an error is an abort/cancellation error
 *
 * @param error - The error to check
 * @returns True if the error is an abort error
 */
export function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.message.includes("abort"))
  );
}

/**
 * Check if an error is a user-initiated cancellation
 *
 * @param errorMessage - The error message to check
 * @returns True if the error is a user-initiated cancellation
 */
export function isCancellationError(errorMessage: string): boolean {
  const lowerMessage = errorMessage.toLowerCase();
  return (
    lowerMessage.includes("cancelled") ||
    lowerMessage.includes("canceled") ||
    lowerMessage.includes("stopped") ||
    lowerMessage.includes("aborted")
  );
}

/**
 * Check if an error is an authentication/API key error
 *
 * @param errorMessage - The error message to check
 * @returns True if the error is authentication-related
 */
export function isAuthenticationError(errorMessage: string): boolean {
  return (
    errorMessage.includes("Authentication failed") ||
    errorMessage.includes("Invalid API key") ||
    errorMessage.includes("authentication_failed") ||
    errorMessage.includes("Fix external API key")
  );
}

/**
 * Classify an error into a specific type
 *
 * @param error - The error to classify
 * @returns Classified error information
 */
export function classifyError(error: unknown): ErrorInfo {
  const message = error instanceof Error ? error.message : String(error || "Unknown error");
  const isAbort = isAbortError(error);
  const isAuth = isAuthenticationError(message);
  const isCancellation = isCancellationError(message);

  let type: ErrorType;
  if (isAuth) {
    type = "authentication";
  } else if (isAbort) {
    type = "abort";
  } else if (isCancellation) {
    type = "cancellation";
  } else if (error instanceof Error) {
    type = "execution";
  } else {
    type = "unknown";
  }

  return {
    type,
    message,
    isAbort,
    isAuth,
    isCancellation,
    originalError: error,
  };
}

/**
 * Get a user-friendly error message
 *
 * @param error - The error to convert
 * @returns User-friendly error message
 */
export function getUserFriendlyErrorMessage(error: unknown): string {
  const info = classifyError(error);

  if (info.isAbort) {
    return "Operation was cancelled";
  }

  if (info.isAuth) {
    return "Authentication failed. Please check your API key.";
  }

  return info.message;
}

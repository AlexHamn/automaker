const featureLoader = require("./services/feature-loader");
const featureExecutor = require("./services/feature-executor");
const featureVerifier = require("./services/feature-verifier");
const contextManager = require("./services/context-manager");
const projectAnalyzer = require("./services/project-analyzer");

/**
 * Auto Mode Service - Autonomous feature implementation
 * Automatically picks and implements features from the kanban board
 *
 * This service acts as the main orchestrator, delegating work to specialized services:
 * - featureLoader: Loading and selecting features
 * - featureExecutor: Implementing features
 * - featureVerifier: Running tests and verification
 * - contextManager: Managing context files
 * - projectAnalyzer: Analyzing project structure
 */
class AutoModeService {
  constructor() {
    // Track multiple concurrent feature executions
    this.runningFeatures = new Map(); // featureId -> { abortController, query, projectPath, sendToRenderer }
    this.autoLoopRunning = false; // Separate flag for the auto loop
    this.autoLoopAbortController = null;
    this.autoLoopInterval = null; // Timer for periodic checking
    this.checkIntervalMs = 5000; // Check every 5 seconds
    this.maxConcurrency = 3; // Default max concurrency
  }

  /**
   * Helper to create execution context with isActive check
   */
  createExecutionContext(featureId) {
    const context = {
      abortController: null,
      query: null,
      projectPath: null,
      sendToRenderer: null,
      isActive: () => this.runningFeatures.has(featureId),
    };
    return context;
  }

  /**
   * Start auto mode - continuously implement features
   */
  async start({ projectPath, sendToRenderer, maxConcurrency }) {
    if (this.autoLoopRunning) {
      throw new Error("Auto mode loop is already running");
    }

    this.autoLoopRunning = true;
    this.maxConcurrency = maxConcurrency || 3;

    console.log(
      `[AutoMode] Starting auto mode for project: ${projectPath} with max concurrency: ${this.maxConcurrency}`
    );

    // Start the periodic checking loop
    this.runPeriodicLoop(projectPath, sendToRenderer);

    return { success: true };
  }

  /**
   * Stop auto mode - stops the auto loop and all running features
   */
  async stop() {
    console.log("[AutoMode] Stopping auto mode");

    this.autoLoopRunning = false;

    // Clear the interval timer
    if (this.autoLoopInterval) {
      clearInterval(this.autoLoopInterval);
      this.autoLoopInterval = null;
    }

    // Abort auto loop if running
    if (this.autoLoopAbortController) {
      this.autoLoopAbortController.abort();
      this.autoLoopAbortController = null;
    }

    // Abort all running features
    for (const [featureId, execution] of this.runningFeatures.entries()) {
      console.log(`[AutoMode] Aborting feature: ${featureId}`);
      if (execution.abortController) {
        execution.abortController.abort();
      }
    }

    // Clear all running features
    this.runningFeatures.clear();

    return { success: true };
  }

  /**
   * Get status of auto mode
   */
  getStatus() {
    return {
      autoLoopRunning: this.autoLoopRunning,
      runningFeatures: Array.from(this.runningFeatures.keys()),
      runningCount: this.runningFeatures.size,
    };
  }

  /**
   * Run a specific feature by ID
   */
  async runFeature({ projectPath, featureId, sendToRenderer }) {
    // Check if this specific feature is already running
    if (this.runningFeatures.has(featureId)) {
      throw new Error(`Feature ${featureId} is already running`);
    }

    console.log(`[AutoMode] Running specific feature: ${featureId}`);

    // Register this feature as running
    const execution = this.createExecutionContext(featureId);
    execution.projectPath = projectPath;
    execution.sendToRenderer = sendToRenderer;
    this.runningFeatures.set(featureId, execution);

    try {
      // Load features
      const features = await featureLoader.loadFeatures(projectPath);
      const feature = features.find((f) => f.id === featureId);

      if (!feature) {
        throw new Error(`Feature ${featureId} not found`);
      }

      console.log(`[AutoMode] Running feature: ${feature.description}`);

      // Update feature status to in_progress
      await featureLoader.updateFeatureStatus(
        featureId,
        "in_progress",
        projectPath
      );

      sendToRenderer({
        type: "auto_mode_feature_start",
        featureId: feature.id,
        feature: feature,
      });

      // Implement the feature
      const result = await featureExecutor.implementFeature(
        feature,
        projectPath,
        sendToRenderer,
        execution
      );

      // Update feature status based on result
      // For skipTests features, go to waiting_approval on success instead of verified
      let newStatus;
      if (result.passes) {
        newStatus = feature.skipTests ? "waiting_approval" : "verified";
      } else {
        newStatus = "backlog";
      }
      await featureLoader.updateFeatureStatus(
        feature.id,
        newStatus,
        projectPath
      );

      // Keep context file for viewing output later (deleted only when card is removed)

      sendToRenderer({
        type: "auto_mode_feature_complete",
        featureId: feature.id,
        passes: result.passes,
        message: result.message,
      });

      return { success: true, passes: result.passes };
    } catch (error) {
      console.error("[AutoMode] Error running feature:", error);

      // Write error to context file
      try {
        await contextManager.writeToContextFile(
          projectPath,
          featureId,
          `\n\n❌ ERROR: ${error.message}\n\n${error.stack || ''}\n`
        );
      } catch (contextError) {
        console.error("[AutoMode] Failed to write error to context:", contextError);
      }

      // Update feature status to waiting_approval so user can review the error
      try {
        await featureLoader.updateFeatureStatus(
          featureId,
          "waiting_approval",
          projectPath,
          null, // no summary
          error.message // pass error message
        );
      } catch (statusError) {
        console.error("[AutoMode] Failed to update feature status after error:", statusError);
      }

      sendToRenderer({
        type: "auto_mode_error",
        error: error.message,
        featureId: featureId,
      });
      throw error;
    } finally {
      // Clean up this feature's execution
      this.runningFeatures.delete(featureId);
    }
  }

  /**
   * Verify a specific feature by running its tests
   */
  async verifyFeature({ projectPath, featureId, sendToRenderer }) {
    console.log(`[AutoMode] verifyFeature called with:`, {
      projectPath,
      featureId,
    });

    // Check if this specific feature is already running
    if (this.runningFeatures.has(featureId)) {
      throw new Error(`Feature ${featureId} is already running`);
    }

    console.log(`[AutoMode] Verifying feature: ${featureId}`);

    // Register this feature as running
    const execution = this.createExecutionContext(featureId);
    execution.projectPath = projectPath;
    execution.sendToRenderer = sendToRenderer;
    this.runningFeatures.set(featureId, execution);

    try {
      // Load features
      const features = await featureLoader.loadFeatures(projectPath);
      const feature = features.find((f) => f.id === featureId);

      if (!feature) {
        throw new Error(`Feature ${featureId} not found`);
      }

      console.log(`[AutoMode] Verifying feature: ${feature.description}`);

      sendToRenderer({
        type: "auto_mode_feature_start",
        featureId: feature.id,
        feature: feature,
      });

      // Verify the feature by running tests
      const result = await featureVerifier.verifyFeatureTests(
        feature,
        projectPath,
        sendToRenderer,
        execution
      );

      // Update feature status based on result
      const newStatus = result.passes ? "verified" : "in_progress";
      await featureLoader.updateFeatureStatus(
        featureId,
        newStatus,
        projectPath
      );

      // Keep context file for viewing output later (deleted only when card is removed)

      sendToRenderer({
        type: "auto_mode_feature_complete",
        featureId: feature.id,
        passes: result.passes,
        message: result.message,
      });

      return { success: true, passes: result.passes };
    } catch (error) {
      console.error("[AutoMode] Error verifying feature:", error);

      // Write error to context file
      try {
        await contextManager.writeToContextFile(
          projectPath,
          featureId,
          `\n\n❌ ERROR: ${error.message}\n\n${error.stack || ''}\n`
        );
      } catch (contextError) {
        console.error("[AutoMode] Failed to write error to context:", contextError);
      }

      // Update feature status to waiting_approval so user can review the error
      try {
        await featureLoader.updateFeatureStatus(
          featureId,
          "waiting_approval",
          projectPath,
          null, // no summary
          error.message // pass error message
        );
      } catch (statusError) {
        console.error("[AutoMode] Failed to update feature status after error:", statusError);
      }

      sendToRenderer({
        type: "auto_mode_error",
        error: error.message,
        featureId: featureId,
      });
      throw error;
    } finally {
      // Clean up this feature's execution
      this.runningFeatures.delete(featureId);
    }
  }

  /**
   * Resume a feature that has previous context - loads existing context and continues implementation
   */
  async resumeFeature({ projectPath, featureId, sendToRenderer }) {
    console.log(`[AutoMode] resumeFeature called with:`, {
      projectPath,
      featureId,
    });

    // Check if this specific feature is already running
    if (this.runningFeatures.has(featureId)) {
      throw new Error(`Feature ${featureId} is already running`);
    }

    console.log(`[AutoMode] Resuming feature: ${featureId}`);

    // Register this feature as running
    const execution = this.createExecutionContext(featureId);
    execution.projectPath = projectPath;
    execution.sendToRenderer = sendToRenderer;
    this.runningFeatures.set(featureId, execution);

    try {
      // Load features
      const features = await featureLoader.loadFeatures(projectPath);
      const feature = features.find((f) => f.id === featureId);

      if (!feature) {
        throw new Error(`Feature ${featureId} not found`);
      }

      console.log(`[AutoMode] Resuming feature: ${feature.description}`);

      sendToRenderer({
        type: "auto_mode_feature_start",
        featureId: feature.id,
        feature: feature,
      });

      // Read existing context
      const previousContext = await contextManager.readContextFile(
        projectPath,
        featureId
      );

      // Resume implementation with context
      const result = await featureExecutor.resumeFeatureWithContext(
        feature,
        projectPath,
        sendToRenderer,
        previousContext,
        execution
      );

      // If the agent ends early without finishing, automatically re-run
      let attempts = 0;
      const maxAttempts = 3;
      let finalResult = result;

      while (!finalResult.passes && attempts < maxAttempts) {
        // Check if feature is still in progress (not verified)
        const updatedFeatures = await featureLoader.loadFeatures(projectPath);
        const updatedFeature = updatedFeatures.find((f) => f.id === featureId);

        if (updatedFeature && updatedFeature.status === "in_progress") {
          attempts++;
          console.log(
            `[AutoMode] Feature ended early, auto-retrying (attempt ${attempts}/${maxAttempts})...`
          );

          // Update context file with retry message
          await contextManager.writeToContextFile(
            projectPath,
            featureId,
            `\n\n🔄 Auto-retry #${attempts} - Continuing implementation...\n\n`
          );

          sendToRenderer({
            type: "auto_mode_progress",
            featureId: feature.id,
            content: `\n🔄 Auto-retry #${attempts} - Agent ended early, continuing...\n`,
          });

          // Read updated context
          const retryContext = await contextManager.readContextFile(
            projectPath,
            featureId
          );

          // Resume again with full context
          finalResult = await featureExecutor.resumeFeatureWithContext(
            feature,
            projectPath,
            sendToRenderer,
            retryContext,
            execution
          );
        } else {
          break;
        }
      }

      // Update feature status based on final result
      // For skipTests features, go to waiting_approval on success instead of verified
      let newStatus;
      if (finalResult.passes) {
        newStatus = feature.skipTests ? "waiting_approval" : "verified";
      } else {
        newStatus = "in_progress";
      }
      await featureLoader.updateFeatureStatus(
        featureId,
        newStatus,
        projectPath
      );

      // Keep context file for viewing output later (deleted only when card is removed)

      sendToRenderer({
        type: "auto_mode_feature_complete",
        featureId: feature.id,
        passes: finalResult.passes,
        message: finalResult.message,
      });

      return { success: true, passes: finalResult.passes };
    } catch (error) {
      console.error("[AutoMode] Error resuming feature:", error);

      // Write error to context file
      try {
        await contextManager.writeToContextFile(
          projectPath,
          featureId,
          `\n\n❌ ERROR: ${error.message}\n\n${error.stack || ''}\n`
        );
      } catch (contextError) {
        console.error("[AutoMode] Failed to write error to context:", contextError);
      }

      // Update feature status to waiting_approval so user can review the error
      try {
        await featureLoader.updateFeatureStatus(
          featureId,
          "waiting_approval",
          projectPath,
          null, // no summary
          error.message // pass error message
        );
      } catch (statusError) {
        console.error("[AutoMode] Failed to update feature status after error:", statusError);
      }

      sendToRenderer({
        type: "auto_mode_error",
        error: error.message,
        featureId: featureId,
      });
      throw error;
    } finally {
      // Clean up this feature's execution
      this.runningFeatures.delete(featureId);
    }
  }

  /**
   * New periodic loop - checks available slots and starts features up to max concurrency
   * This loop continues running even if there are no backlog items
   */
  runPeriodicLoop(projectPath, sendToRenderer) {
    console.log(
      `[AutoMode] Starting periodic loop with interval: ${this.checkIntervalMs}ms`
    );

    // Initial check immediately
    this.checkAndStartFeatures(projectPath, sendToRenderer);

    // Then check periodically
    this.autoLoopInterval = setInterval(() => {
      if (this.autoLoopRunning) {
        this.checkAndStartFeatures(projectPath, sendToRenderer);
      }
    }, this.checkIntervalMs);
  }

  /**
   * Check how many features are running and start new ones if under max concurrency
   */
  async checkAndStartFeatures(projectPath, sendToRenderer) {
    try {
      // Check how many are currently running
      const currentRunningCount = this.runningFeatures.size;

      console.log(
        `[AutoMode] Checking features - Running: ${currentRunningCount}/${this.maxConcurrency}`
      );

      // Calculate available slots
      const availableSlots = this.maxConcurrency - currentRunningCount;

      if (availableSlots <= 0) {
        console.log("[AutoMode] At max concurrency, waiting...");
        return;
      }

      // Load features from backlog
      const features = await featureLoader.loadFeatures(projectPath);
      const backlogFeatures = features.filter((f) => f.status === "backlog");

      if (backlogFeatures.length === 0) {
        console.log("[AutoMode] No backlog features available, waiting...");
        return;
      }

      // Grab up to availableSlots features from backlog
      const featuresToStart = backlogFeatures.slice(0, availableSlots);

      console.log(
        `[AutoMode] Starting ${featuresToStart.length} feature(s) from backlog`
      );

      // Start each feature (don't await - run in parallel like drag operations)
      for (const feature of featuresToStart) {
        this.startFeatureAsync(feature, projectPath, sendToRenderer);
      }
    } catch (error) {
      console.error("[AutoMode] Error checking/starting features:", error);
    }
  }

  /**
   * Start a feature asynchronously (similar to drag operation)
   */
  async startFeatureAsync(feature, projectPath, sendToRenderer) {
    const featureId = feature.id;

    // Skip if already running
    if (this.runningFeatures.has(featureId)) {
      console.log(`[AutoMode] Feature ${featureId} already running, skipping`);
      return;
    }

    try {
      console.log(
        `[AutoMode] Starting feature: ${feature.description.slice(0, 50)}...`
      );

      // Register this feature as running
      const execution = this.createExecutionContext(featureId);
      execution.projectPath = projectPath;
      execution.sendToRenderer = sendToRenderer;
      this.runningFeatures.set(featureId, execution);

      // Update status to in_progress with timestamp
      await featureLoader.updateFeatureStatus(
        featureId,
        "in_progress",
        projectPath
      );

      sendToRenderer({
        type: "auto_mode_feature_start",
        featureId: feature.id,
        feature: feature,
      });

      // Implement the feature (this runs async in background)
      const result = await featureExecutor.implementFeature(
        feature,
        projectPath,
        sendToRenderer,
        execution
      );

      // Update feature status based on result
      let newStatus;
      if (result.passes) {
        newStatus = feature.skipTests ? "waiting_approval" : "verified";
      } else {
        newStatus = "backlog";
      }
      await featureLoader.updateFeatureStatus(
        feature.id,
        newStatus,
        projectPath
      );

      // Keep context file for viewing output later (deleted only when card is removed)

      sendToRenderer({
        type: "auto_mode_feature_complete",
        featureId: feature.id,
        passes: result.passes,
        message: result.message,
      });
    } catch (error) {
      console.error(`[AutoMode] Error running feature ${featureId}:`, error);

      // Write error to context file
      try {
        await contextManager.writeToContextFile(
          projectPath,
          featureId,
          `\n\n❌ ERROR: ${error.message}\n\n${error.stack || ''}\n`
        );
      } catch (contextError) {
        console.error("[AutoMode] Failed to write error to context:", contextError);
      }

      // Update feature status to waiting_approval so user can review the error
      try {
        await featureLoader.updateFeatureStatus(
          featureId,
          "waiting_approval",
          projectPath,
          null, // no summary
          error.message // pass error message
        );
      } catch (statusError) {
        console.error("[AutoMode] Failed to update feature status after error:", statusError);
      }

      sendToRenderer({
        type: "auto_mode_error",
        error: error.message,
        featureId: featureId,
      });
    } finally {
      // Clean up this feature's execution
      this.runningFeatures.delete(featureId);
    }
  }

  /**
   * Analyze a new project - scans codebase and updates app_spec.txt
   * This is triggered when opening a project for the first time
   */
  async analyzeProject({ projectPath, sendToRenderer }) {
    console.log(`[AutoMode] Analyzing project at: ${projectPath}`);

    const analysisId = `project-analysis-${Date.now()}`;

    // Check if already analyzing this project
    if (this.runningFeatures.has(analysisId)) {
      throw new Error("Project analysis is already running");
    }

    // Register as running
    const execution = this.createExecutionContext(analysisId);
    execution.projectPath = projectPath;
    execution.sendToRenderer = sendToRenderer;
    this.runningFeatures.set(analysisId, execution);

    try {
      sendToRenderer({
        type: "auto_mode_feature_start",
        featureId: analysisId,
        feature: {
          id: analysisId,
          category: "Project Analysis",
          description: "Analyzing project structure and tech stack",
        },
      });

      // Perform the analysis
      const result = await projectAnalyzer.runProjectAnalysis(
        projectPath,
        analysisId,
        sendToRenderer,
        execution
      );

      sendToRenderer({
        type: "auto_mode_feature_complete",
        featureId: analysisId,
        passes: result.success,
        message: result.message,
      });

      return { success: true, message: result.message };
    } catch (error) {
      console.error("[AutoMode] Error analyzing project:", error);
      sendToRenderer({
        type: "auto_mode_error",
        error: error.message,
        featureId: analysisId,
      });
      throw error;
    } finally {
      this.runningFeatures.delete(analysisId);
    }
  }

  /**
   * Stop a specific feature by ID
   */
  async stopFeature({ featureId }) {
    if (!this.runningFeatures.has(featureId)) {
      return { success: false, error: `Feature ${featureId} is not running` };
    }

    console.log(`[AutoMode] Stopping feature: ${featureId}`);

    const execution = this.runningFeatures.get(featureId);
    if (execution && execution.abortController) {
      execution.abortController.abort();
    }

    // Clean up
    this.runningFeatures.delete(featureId);

    return { success: true };
  }

  /**
   * Follow-up on a feature with additional prompt
   * This continues work on a feature that's in waiting_approval status
   */
  async followUpFeature({
    projectPath,
    featureId,
    prompt,
    imagePaths,
    sendToRenderer,
  }) {
    // Check if this feature is already running
    if (this.runningFeatures.has(featureId)) {
      throw new Error(`Feature ${featureId} is already running`);
    }

    console.log(
      `[AutoMode] Follow-up on feature: ${featureId} with prompt: ${prompt}`
    );

    // Register this feature as running
    const execution = this.createExecutionContext(featureId);
    execution.projectPath = projectPath;
    execution.sendToRenderer = sendToRenderer;
    this.runningFeatures.set(featureId, execution);

    // Start the async work in the background (don't await)
    // This allows the API to return immediately so the modal can close
    this.runFollowUpWork({
      projectPath,
      featureId,
      prompt,
      imagePaths,
      sendToRenderer,
      execution,
    }).catch((error) => {
      console.error("[AutoMode] Follow-up work error:", error);
      this.runningFeatures.delete(featureId);
    });

    // Return immediately so the frontend can close the modal
    return { success: true };
  }

  /**
   * Internal method to run follow-up work asynchronously
   */
  async runFollowUpWork({
    projectPath,
    featureId,
    prompt,
    imagePaths,
    sendToRenderer,
    execution,
  }) {
    try {
      // Load features
      const features = await featureLoader.loadFeatures(projectPath);
      const feature = features.find((f) => f.id === featureId);

      if (!feature) {
        throw new Error(`Feature ${featureId} not found`);
      }

      console.log(`[AutoMode] Following up on feature: ${feature.description}`);

      // Update status to in_progress
      await featureLoader.updateFeatureStatus(
        featureId,
        "in_progress",
        projectPath
      );

      sendToRenderer({
        type: "auto_mode_feature_start",
        featureId: feature.id,
        feature: feature,
      });

      // Read existing context and append follow-up prompt
      const previousContext = await contextManager.readContextFile(
        projectPath,
        featureId
      );

      // Append follow-up prompt to context
      const followUpContext = `${previousContext}\n\n## Follow-up Instructions\n\n${prompt}`;
      await contextManager.writeToContextFile(
        projectPath,
        featureId,
        `\n\n## Follow-up Instructions\n\n${prompt}`
      );

      // Resume implementation with follow-up context and optional images
      const result = await featureExecutor.resumeFeatureWithContext(
        { ...feature, followUpPrompt: prompt, followUpImages: imagePaths },
        projectPath,
        sendToRenderer,
        followUpContext,
        execution
      );

      // For skipTests features, go to waiting_approval on success instead of verified
      const newStatus = result.passes
        ? feature.skipTests
          ? "waiting_approval"
          : "verified"
        : "in_progress";

      await featureLoader.updateFeatureStatus(
        feature.id,
        newStatus,
        projectPath
      );

      // Keep context file for viewing output later (deleted only when card is removed)

      sendToRenderer({
        type: "auto_mode_feature_complete",
        featureId: feature.id,
        passes: result.passes,
        message: result.message,
      });
    } catch (error) {
      console.error("[AutoMode] Error in follow-up:", error);

      // Write error to context file
      try {
        await contextManager.writeToContextFile(
          projectPath,
          featureId,
          `\n\n❌ ERROR: ${error.message}\n\n${error.stack || ''}\n`
        );
      } catch (contextError) {
        console.error("[AutoMode] Failed to write error to context:", contextError);
      }

      // Update feature status to waiting_approval so user can review the error
      try {
        await featureLoader.updateFeatureStatus(
          featureId,
          "waiting_approval",
          projectPath,
          null, // no summary
          error.message // pass error message
        );
      } catch (statusError) {
        console.error("[AutoMode] Failed to update feature status after error:", statusError);
      }

      sendToRenderer({
        type: "auto_mode_error",
        error: error.message,
        featureId: featureId,
      });
    } finally {
      this.runningFeatures.delete(featureId);
    }
  }

  /**
   * Commit changes for a feature without doing additional work
   * This marks the feature as verified and commits the changes
   */
  async commitFeature({ projectPath, featureId, sendToRenderer }) {
    console.log(`[AutoMode] Committing feature: ${featureId}`);

    // Register briefly as running for the commit operation
    const execution = this.createExecutionContext(featureId);
    execution.projectPath = projectPath;
    execution.sendToRenderer = sendToRenderer;
    this.runningFeatures.set(featureId, execution);

    try {
      // Load feature to get description for commit message
      const features = await featureLoader.loadFeatures(projectPath);
      const feature = features.find((f) => f.id === featureId);

      if (!feature) {
        throw new Error(`Feature ${featureId} not found`);
      }

      sendToRenderer({
        type: "auto_mode_feature_start",
        featureId: feature.id,
        feature: { ...feature, description: "Committing changes..." },
      });

      sendToRenderer({
        type: "auto_mode_phase",
        featureId,
        phase: "action",
        message: "Committing changes to git...",
      });

      // Run git commit via the agent
      await featureExecutor.commitChangesOnly(
        feature,
        projectPath,
        sendToRenderer,
        execution
      );

      // Update status to verified
      await featureLoader.updateFeatureStatus(
        featureId,
        "verified",
        projectPath
      );

      // Keep context file for viewing output later (deleted only when card is removed)

      sendToRenderer({
        type: "auto_mode_feature_complete",
        featureId: feature.id,
        passes: true,
        message: "Changes committed successfully",
      });

      return { success: true };
    } catch (error) {
      console.error("[AutoMode] Error committing feature:", error);
      sendToRenderer({
        type: "auto_mode_error",
        error: error.message,
        featureId: featureId,
      });
      throw error;
    } finally {
      this.runningFeatures.delete(featureId);
    }
  }

  /**
   * Sleep helper
   */
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// Export singleton instance
module.exports = new AutoModeService();

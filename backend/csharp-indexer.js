const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const config = require('./config');

class CSharpIndexerManager {
  constructor() {
    this.process = null;
    this.isRunning = false;
    this.restartCount = 0;
    this.startupPromise = null;
    this.isShuttingDown = false;
  }

  /**
   * Start the C# indexer process
   * @returns {Promise<boolean>} Promise that resolves to true if started successfully
   */
  async start() {
    if (this.isRunning || this.startupPromise) {
      console.log('C# indexer is already running or starting');
      return this.startupPromise || Promise.resolve(true);
    }

    this.startupPromise = this._startProcess();
    return this.startupPromise;
  }

  async _startProcess() {
    try {
      // Check if C# indexer executable exists
      if (!fs.existsSync(config.cSharpIndexerPath)) {
        console.error(`C# indexer executable not found at: ${config.cSharpIndexerPath}`);
        throw new Error('C# indexer executable not found');
      }

      // Convert base directory to absolute path
      const absoluteBasePath = path.resolve(config.baseDirectory);
      if (!fs.existsSync(absoluteBasePath)) {
        console.error(`Base directory does not exist: ${absoluteBasePath}`);
        throw new Error('Base directory does not exist');
      }

      console.log('Starting C# indexer...');
      console.log(`Executable: ${config.cSharpIndexerPath}`);
      console.log(`Base directory: ${absoluteBasePath}`);
      console.log(`Database path: ${config.fileIndexPath}`);

      // Prepare command arguments
      const args = ['full', absoluteBasePath];
      if (config.cSharpIndexerForceRebuild) {
        args.push('--force');
        console.log('Force rebuild enabled - will delete existing database and rebuild index');
      } else {
        console.log('Incremental mode - will reuse existing index if available');
      }

      // Set environment variables for the C# process
      const env = {
        ...process.env,
        INDEXER_DB_PATH: config.fileIndexPath,
        BASE_DIRECTORY: absoluteBasePath
      };

      // Spawn the C# indexer process
      this.process = spawn(config.cSharpIndexerPath, args, {
        env: env,
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: path.dirname(config.cSharpIndexerPath)
      });

      // Set up process event handlers
      this._setupProcessHandlers();

      // Wait for the process to be ready or timeout
      const startupSuccess = await this._waitForStartup();
      
      if (startupSuccess) {
        this.isRunning = true;
        this.restartCount = 0;
        console.log('C# indexer started successfully');
        return true;
      } else {
        throw new Error('C# indexer failed to start within timeout period');
      }

    } catch (error) {
      console.error('Failed to start C# indexer:', error.message);
      this.isRunning = false;
      this.process = null;
      this.startupPromise = null;
      throw error;
    }
  }

  _setupProcessHandlers() {
    if (!this.process) return;

    // Handle stdout
    this.process.stdout.on('data', (data) => {
      const output = data.toString().trim();
      if (output) {
        console.log(`[C# Indexer] ${output}`);
      }
    });

    // Handle stderr
    this.process.stderr.on('data', (data) => {
      const error = data.toString().trim();
      if (error) {
        console.error(`[C# Indexer Error] ${error}`);
      }
    });

    // Handle process exit
    this.process.on('close', (code, signal) => {
      console.log(`C# indexer process exited with code ${code}, signal: ${signal}`);
      this.isRunning = false;
      this.process = null;
      this.startupPromise = null;

      // Attempt restart if not shutting down and auto-restart is enabled
      if (!this.isShuttingDown && config.cSharpIndexerAutoRestart && this.restartCount < config.cSharpIndexerMaxRestarts) {
        this.restartCount++;
        console.log(`Attempting to restart C# indexer (attempt ${this.restartCount}/${config.cSharpIndexerMaxRestarts})`);
        
        setTimeout(() => {
          this.start().catch(error => {
            console.error('Failed to restart C# indexer:', error.message);
          });
        }, config.cSharpIndexerRestartDelay * 1000);
      } else if (this.restartCount >= config.cSharpIndexerMaxRestarts) {
        console.error('C# indexer exceeded maximum restart attempts, giving up');
      }
    });

    // Handle process error
    this.process.on('error', (error) => {
      console.error('C# indexer process error:', error.message);
      this.isRunning = false;
      this.process = null;
      this.startupPromise = null;
    });
  }

  async _waitForStartup() {
    if (!this.process) return false;

    return new Promise((resolve) => {
      let resolved = false;
      let startupTimer = null;

      const resolveOnce = (result) => {
        if (!resolved) {
          resolved = true;
          if (startupTimer) {
            clearTimeout(startupTimer);
          }
          resolve(result);
        }
      };

      // Set up timeout if configured
      if (config.cSharpIndexerStartupTimeout > 0) {
        startupTimer = setTimeout(() => {
          console.warn('C# indexer startup timeout reached');
          resolveOnce(false);
        }, config.cSharpIndexerStartupTimeout * 1000);
      }

      // Listen for startup indicators in stdout
      const onData = (data) => {
        const output = data.toString();
        
        // Look for indicators that the indexer is ready
        if (output.includes('Started monitoring directory:') || 
            output.includes('Index build completed successfully!') ||
            output.includes('File system monitoring started')) {
          resolveOnce(true);
        }
      };

      // Listen for process exit (failure)
      const onExit = () => {
        resolveOnce(false);
      };

      this.process.stdout.on('data', onData);
      this.process.on('close', onExit);

      // Clean up listeners when resolved
      const cleanup = () => {
        if (this.process) {
          this.process.stdout.removeListener('data', onData);
          this.process.removeListener('close', onExit);
        }
      };

      // Add cleanup to resolve function
      const originalResolve = resolve;
      resolve = (result) => {
        cleanup();
        originalResolve(result);
      };
    });
  }

  /**
   * Stop the C# indexer process
   * @returns {Promise<void>}
   */
  async stop() {
    if (!this.isRunning || !this.process) {
      console.log('C# indexer is not running');
      return;
    }

    this.isShuttingDown = true;
    
    console.log('Stopping C# indexer...');

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        console.warn('C# indexer did not stop gracefully, forcing termination');
        if (this.process) {
          this.process.kill('SIGKILL');
        }
        resolve();
      }, 10000); // 10 seconds timeout

      this.process.on('close', () => {
        clearTimeout(timeout);
        console.log('C# indexer stopped');
        this.isRunning = false;
        this.process = null;
        this.isShuttingDown = false;
        resolve();
      });

      // Try graceful shutdown first
      if (process.platform === 'win32') {
        this.process.kill('SIGTERM');
      } else {
        this.process.kill('SIGINT');
      }
    });
  }

  /**
   * Get the status of the C# indexer
   * @returns {Object} Status object
   */
  getStatus() {
    // Get database statistics if available
    try {
      if (!fs.existsSync(config.fileIndexPath)) {
        return {
          isRunning: this.isRunning,
          fileCount: 0,
          lastBuilt: null,
          isBuilding: false,
          progress: { total: 0, processed: 0, errors: 0 }
        };
      }

      const Database = require('better-sqlite3');
      let db = null;
      
      try {
        db = new Database(config.fileIndexPath, { readonly: true });
        
        // Get file count
        let fileCount = 0;
        try {
          const countResult = db.prepare('SELECT COUNT(*) as count FROM files').get();
          fileCount = countResult ? countResult.count : 0;
        } catch (error) {
          // Table might not exist yet
          fileCount = 0;
        }

        // Get last built timestamp
        let lastBuilt = null;
        let isBuilding = false;
        try {
          const lastBuiltResult = db.prepare(`SELECT value FROM metadata WHERE key = 'last_built'`).get();
          lastBuilt = lastBuiltResult ? lastBuiltResult.value : null;
          // If database exists but last_built is null, it means the indexer is building
          isBuilding = lastBuilt === null;
        } catch (error) {
          // Metadata table might not exist yet, which means indexer is building
          lastBuilt = null;
          isBuilding = true;
        }

        return {
          isRunning: this.isRunning,
          fileCount,
          lastBuilt,
          isBuilding,
          progress: { total: fileCount, processed: fileCount, errors: 0 }
        };
      } finally {
        if (db) {
          db.close();
        }
      }
    } catch (error) {
      console.error('Error getting C# indexer database stats:', error);
      return {
        isRunning: this.isRunning,
        fileCount: 0,
        lastBuilt: null,
        isBuilding: false,
        progress: { total: 0, processed: 0, errors: 0 }
      };
    }
  }

  /**
   * Check if C# indexer database is built and contains data
   * @returns {boolean}
   */
  isDatabaseBuilt() {
    try {
      // Check if database file exists
      if (!fs.existsSync(config.fileIndexPath)) {
        return false;
      }

      // Check if database file is not empty
      const stats = fs.statSync(config.fileIndexPath);
      if (stats.size === 0) {
        return false;
      }

      // Check if the index has been built by looking for 'last_built' metadata
      const Database = require('better-sqlite3');
      let db = null;
      
      try {
        db = new Database(config.fileIndexPath, { readonly: true });
        
        // Check if metadata table exists
        const tableExists = db.prepare(`
          SELECT name FROM sqlite_master 
          WHERE type='table' AND name='metadata'
        `).get();
        
        if (!tableExists) {
          return false;
        }
        
        // Check if 'last_built' metadata exists
        const lastBuilt = db.prepare(`
          SELECT value FROM metadata WHERE key = 'last_built'
        `).get();
        
        return lastBuilt && lastBuilt.value !== null;
      } finally {
        if (db) {
          db.close();
        }
      }
    } catch (error) {
      console.error('Error checking C# indexer database:', error);
      return false;
    }
  }

  /**
   * Check if C# indexer is available and configured
   * @returns {boolean}
   */
  isAvailable() {
    return config.useCSharpIndexer && fs.existsSync(config.cSharpIndexerPath);
  }

  /**
   * Send a signal to restart the indexer
   * @returns {Promise<boolean>}
   */
  async restart() {
    console.log('Restarting C# indexer...');
    await this.stop();
    return this.start();
  }
}

// Create and export singleton instance
const csharpIndexer = new CSharpIndexerManager();

module.exports = csharpIndexer; 
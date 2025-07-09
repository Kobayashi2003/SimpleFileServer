const config = require('./config');
const fs = require('fs');
const path = require('path');

/**
 * Initialize console output with timestamps if enabled
 */
function initializeConsoleTimestamps() {
  if (!config.enableConsoleTimestamps) return;

  const originalStdoutWrite = process.stdout.write;
  process.stdout.write = (chunk, encoding, callback) => {
    const date = new Date().toISOString();
    return originalStdoutWrite.call(process.stdout, `[${date}] ${chunk}`, encoding, callback);
  };

  const originalStderrWrite = process.stderr.write;
  process.stderr.write = (chunk, encoding, callback) => {
    const date = new Date().toISOString();
    return originalStderrWrite.call(process.stderr, `[${date}] ${chunk}`, encoding, callback);
  };
}

/**
 * Generic file logging utilities
 */
class FileLogger {
  constructor(logType = 'api') {
    this.logType = logType;
    this.currentLogFile = null;
    this.currentLogStream = null;
    this.initializeLogFile();
  }

  /**
   * Initialize log file based on rotation settings
   */
  initializeLogFile() {
    if (!config.enableFileLogging) return;

    const logDir = config.logsDirectory;
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    const timestamp = this.getLogFileTimestamp();
    this.currentLogFile = path.join(logDir, `${this.logType}-${timestamp}.log`);
    
    // Create write stream
    this.currentLogStream = fs.createWriteStream(this.currentLogFile, { 
      flags: 'a',
      encoding: 'utf8'
    });

    // Handle stream errors
    this.currentLogStream.on('error', (error) => {
      console.error(`Log file write error for ${this.logType}:`, error);
    });
  }

  /**
   * Get log file timestamp based on rotation setting
   */
  getLogFileTimestamp() {
    const now = new Date();
    
    switch (config.logFileRotation) {
      case 'daily':
        return now.toISOString().split('T')[0]; // YYYY-MM-DD
      case 'weekly':
        const weekStart = new Date(now.getTime() - (now.getDay() * 24 * 60 * 60 * 1000));
        return weekStart.toISOString().split('T')[0] + '-week';
      case 'monthly':
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`; // YYYY-MM
      case 'none':
        return this.logType;
      default:
        return now.toISOString().split('T')[0];
    }
  }

  /**
   * Check if we need to rotate log file
   */
  shouldRotateLogFile() {
    if (!this.currentLogFile || !fs.existsSync(this.currentLogFile)) {
      return true;
    }

    const stats = fs.statSync(this.currentLogFile);
    const fileSizeMB = stats.size / (1024 * 1024);
    
    return fileSizeMB >= config.maxLogFileSize;
  }

  /**
   * Write log message to file
   */
  writeToFile(message) {
    if (!config.enableFileLogging || !this.currentLogStream) return;

    // Check if we need to rotate
    if (this.shouldRotateLogFile()) {
      this.rotateLogFile();
    }

    // Write to file
    this.currentLogStream.write(message + '\n');
  }

  /**
   * Rotate log file
   */
  rotateLogFile() {
    if (this.currentLogStream) {
      this.currentLogStream.end();
    }

    this.initializeLogFile();
    this.cleanupOldLogs();
  }

  /**
   * Clean up old log files for this log type
   */
  cleanupOldLogs() {
    if (!config.enableFileLogging) return;

    try {
      const logDir = config.logsDirectory;
      const files = fs.readdirSync(logDir)
        .filter(file => file.startsWith(`${this.logType}-`) && file.endsWith('.log'))
        .map(file => ({
          name: file,
          path: path.join(logDir, file),
          mtime: fs.statSync(path.join(logDir, file)).mtime
        }))
        .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

      // Keep only the specified number of files
      if (files.length > config.logFilesToKeep) {
        const filesToDelete = files.slice(config.logFilesToKeep);
        filesToDelete.forEach(file => {
          try {
            fs.unlinkSync(file.path);
          } catch (error) {
            console.error(`Failed to delete old log file ${file.name}:`, error);
          }
        });
      }
    } catch (error) {
      console.error(`Error cleaning up old ${this.logType} log files:`, error);
    }
  }

  /**
   * Close log stream
   */
  close() {
    if (this.currentLogStream) {
      this.currentLogStream.end();
    }
  }
}

// Create global file logger instances
const apiLogger = new FileLogger('api');
const crashLogger = new FileLogger('crash');
const rejectionLogger = new FileLogger('rejection');

/**
 * Initialize error logging handlers
 */
function initializeErrorLogging() {
  if (!config.enableErrorLogging) return;

  process
    .on('uncaughtException', (error, origin) => {
      const errorTime = new Date().toISOString();
      const errorLog = `====== Uncaught Exception at ${errorTime} ======
Origin: ${origin}
Error: ${error}
Stack: ${error.stack}
================================================`;

      crashLogger.writeToFile(errorLog);
      console.error(`[${errorTime}] Uncaught Exception:`, error);
      
      // Exit if the error is not recoverable
      if (!isRecoverableError(error)) {
        process.exit(1);
      }
    })
    .on('unhandledRejection', (reason, promise) => {
      const errorTime = new Date().toISOString();
      const errorLog = `====== Unhandled Rejection at ${errorTime} ======
Promise: ${promise}
Reason: ${reason}
${reason.stack ? `Stack: ${reason.stack}` : ''}
================================================`;

      rejectionLogger.writeToFile(errorLog);
      console.error(`[${errorTime}] Unhandled Rejection:`, reason);
    });
}

/**
 * Check if error is recoverable
 */
function isRecoverableError(error) {
  // Add your error recovery logic here
  // For now, treat all errors as recoverable
  return true;
}

/**
 * API Access Logging Middleware
 */
function apiLoggingMiddleware(req, res, next) {
  // Skip logging if disabled in config
  if (!config.enableApiLogging) {
    return next();
  }

  const timestamp = new Date().toISOString();
  const method = req.method;
  const url = req.url;
  const userAgent = req.get('User-Agent') || 'Unknown';
  const ip = req.ip || req.connection.remoteAddress || 'Unknown';
  
  // Log based on configured level
  if (config.apiLogLevel === 'basic') {
    const message = `[${timestamp}] ${method} ${url} - IP: ${ip}`;
    console.log(message);
    apiLogger.writeToFile(message);
  } else if (config.apiLogLevel === 'detailed') {
    const queryParams = Object.keys(req.query).length > 0 ? `?${Object.keys(req.query).join(',')}` : '';
    const hasBody = req.body && Object.keys(req.body).length > 0 ? ' [with body]' : '';
    
    const message = `[${timestamp}] ${method} ${url}${queryParams}${hasBody} - IP: ${ip} - User-Agent: ${userAgent}`;
    console.log(message);
    apiLogger.writeToFile(message);
  } else if (config.apiLogLevel === 'verbose') {
    const queryParams = Object.keys(req.query).length > 0 ? `?${Object.keys(req.query).join(',')}` : '';
    const hasBody = req.body && Object.keys(req.body).length > 0 ? ' [with body]' : '';
    
    const message = `[${timestamp}] ${method} ${url}${queryParams}${hasBody} - IP: ${ip} - User-Agent: ${userAgent}`;
    console.log(message);
    apiLogger.writeToFile(message);
    
    // Log request body if enabled and exists
    if (config.logRequestBody && req.body && Object.keys(req.body).length > 0) {
      const bodyMessage = `[${timestamp}] Request Body: ${JSON.stringify(req.body, null, 2)}`;
      console.log(bodyMessage);
      apiLogger.writeToFile(bodyMessage);
    }
  }
  
  // Track request completion time
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    const statusCode = res.statusCode;
    
    if (config.apiLogLevel === 'basic') {
      const message = `[${timestamp}] ${method} ${url} - Status: ${statusCode} - Duration: ${duration}ms`;
      console.log(message);
      apiLogger.writeToFile(message);
    } else {
      const contentLength = res.get('Content-Length') || 'unknown';
      const statusText = statusCode >= 200 && statusCode < 300 ? 'OK' : 
                        statusCode >= 300 && statusCode < 400 ? 'REDIRECT' :
                        statusCode >= 400 && statusCode < 500 ? 'CLIENT_ERROR' : 'SERVER_ERROR';
      
      const message = `[${timestamp}] ${method} ${url} - Status: ${statusCode} (${statusText}) - Duration: ${duration}ms${contentLength > 0 ? ` - Size: ${contentLength}` : ''}`;
      console.log(message);
      apiLogger.writeToFile(message);
    }
  });
  
  next();
}

// Graceful shutdown handling
process.on('SIGINT', () => {
  console.log('\nReceived SIGINT. Shutting down gracefully...');
  apiLogger.close();
  crashLogger.close();
  rejectionLogger.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\nReceived SIGTERM. Shutting down gracefully...');
  apiLogger.close();
  crashLogger.close();
  rejectionLogger.close();
  process.exit(0);
});

// Initialize logging features
initializeConsoleTimestamps();
initializeErrorLogging();

module.exports = {
  apiLoggingMiddleware
}; 
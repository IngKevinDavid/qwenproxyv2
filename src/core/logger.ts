export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  timestamp: Date;
  level: LogLevel;
  message: string;
  context?: string;
  data?: Record<string, unknown>;
}

export class Logger {
  private minLevel: LogLevel;
  private context?: string;
  
  constructor(level: LogLevel = 'info', context?: string) {
    this.minLevel = level;
    this.context = context;
  }

  private shouldLog(level: LogLevel): boolean {
    const levels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
    return levels.indexOf(level) >= levels.indexOf(this.minLevel);
  }

  private formatEntry(entry: LogEntry): string {
    const timestamp = entry.timestamp.toISOString();
    const pad = (str: string): string => str.padStart(5, ' ');
    const colorCode = (
      entry.level === 'error' ? '\x1b[31m' :
      entry.level === 'warn' ? '\x1b[33m' :
      entry.level === 'debug' ? '\x1b[36m' : ''
    );
    const reset = '\x1b[0m';
    
    const coloredLevel = colorCode + pad(entry.level.toUpperCase()) + reset;
    const contextPart = entry.context ? ` [${entry.context}]` : '';
    
    let output = `${timestamp} ${coloredLevel}${contextPart} ${entry.message}`;
    
    if (entry.data) {
      output += '\n' + JSON.stringify(entry.data, null, 2);
    }
    
    return output;
  }

  debug(message: string, data?: Record<string, unknown>): void {
    if (this.shouldLog('debug')) {
      const entry = {
        timestamp: new Date(),
        level: 'debug' as LogLevel,
        message: this.context ? `[${this.context}] ${message}` : message,
        context: this.context,
        data,
      };
      const formatted = this.formatEntry(entry);
      originalLog(formatted);
      addToBuffer(entry, formatted);
    }
  }

  info(message: string, data?: Record<string, unknown>): void {
    if (this.shouldLog('info')) {
      const entry = {
        timestamp: new Date(),
        level: 'info' as LogLevel,
        message: this.context ? `[${this.context}] ${message}` : message,
        context: this.context,
        data,
      };
      const formatted = this.formatEntry(entry);
      originalLog(formatted);
      addToBuffer(entry, formatted);
    }
  }

  warn(message: string, data?: Record<string, unknown>): void {
    if (this.shouldLog('warn')) {
      const entry = {
        timestamp: new Date(),
        level: 'warn' as LogLevel,
        message: this.context ? `[${this.context}] ${message}` : message,
        context: this.context,
        data,
      };
      const formatted = this.formatEntry(entry);
      originalWarn(formatted);
      addToBuffer(entry, formatted);
    }
  }

  error(message: string, data?: Record<string, unknown>): void {
    if (this.shouldLog('error')) {
      const entry = {
        timestamp: new Date(),
        level: 'error' as LogLevel,
        message: this.context ? `[${this.context}] ${message}` : message,
        context: this.context,
        data,
      };
      const formatted = this.formatEntry(entry);
      originalError(formatted);
      addToBuffer(entry, formatted);
    }
  }

  child(context: string): Logger {
    return new Logger(this.minLevel, this.context ? `${this.context}.${context}` : context);
  }
}

export interface BufferedLog {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: string;
  raw: string;
}

export const logBuffer: BufferedLog[] = [];
const MAX_LOG_BUFFER_SIZE = 500;

function addToBuffer(entry: LogEntry, raw: string) {
  logBuffer.push({
    timestamp: entry.timestamp.toISOString(),
    level: entry.level,
    message: entry.message,
    context: entry.context,
    raw,
  });
  if (logBuffer.length > MAX_LOG_BUFFER_SIZE) {
    logBuffer.shift();
  }
}

export const logger = new Logger('info');

export function addDashboardLog(message: string, level: LogLevel = 'info', context = 'Cache'): void {
  const timestamp = new Date();
  const raw = `${timestamp.toISOString()} ${level.toUpperCase().padStart(5, ' ')} [${context}] ${message}`;
  
  logBuffer.push({
    timestamp: timestamp.toISOString(),
    level,
    message: context ? `[${context}] ${message}` : message,
    context,
    raw
  });
  
  if (logBuffer.length > MAX_LOG_BUFFER_SIZE) {
    logBuffer.shift();
  }
}

// Intercepción y redirección de funciones console.* globales
const originalLog = console.log;
const originalWarn = console.warn;
const originalError = console.error;

console.log = (...args: any[]) => {
  originalLog(...args);
  const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' ');
  addDashboardLog(message, 'info', 'Consola');
};

console.warn = (...args: any[]) => {
  originalWarn(...args);
  const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' ');
  addDashboardLog(message, 'warn', 'Consola');
};

console.error = (...args: any[]) => {
  originalError(...args);
  const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' ');
  addDashboardLog(message, 'error', 'Consola');
};

# @opengallery/logger

A shared logging package for the OpenGallery project using Pino.

## Features

- **Development Mode**: Pretty console output with colors and timestamps
- **Production Mode**: Structured JSON logging to files in `/app/logs/`
- Automatic redaction of sensitive fields
- Child loggers for context
- Environment-based configuration
- TypeScript support

## Installation

This package is automatically available to other packages in the monorepo.

## Usage

### Basic Usage

```typescript
import { logger, info, error, warn, debug } from "@opengallery/logger";

// Using the default logger instance
logger.info("Application started");
logger.error("Something went wrong", new Error("Database connection failed"));

// Using convenience functions
info("User logged in", { userId: "123", email: "user@example.com" });
error("API request failed", { statusCode: 500, endpoint: "/api/users" });
warn("Deprecated feature used", { feature: "old-api" });
debug("Processing request", { requestId: "abc-123" });
```

### Custom Logger Configuration

```typescript
import { Logger } from "@opengallery/logger";

const customLogger = new Logger({
  level: "debug",
  name: "worker-service",
  prettyPrint: true,
  redact: ["password", "token", "apiKey"],
  logFile: "/app/logs/custom.log", // Only used in production
});
```

### Child Loggers

```typescript
import { logger } from "@opengallery/logger";

// Create a child logger with additional context
const requestLogger = logger.child({
  requestId: "abc-123",
  userId: "user-456",
});

requestLogger.info("Processing request");
requestLogger.error("Request failed", new Error("Validation error"));
```

### Environment Variables

The logger can be configured using environment variables:

- `LOG_LEVEL`: Set the log level (default: 'info')
- `SERVICE_NAME`: Set the service name (default: 'opengallery')
- `NODE_ENV`: Controls logging behavior:
  - `development`: Pretty console output
  - `production`: JSON file logging

## Development vs Production

### Development Mode (`NODE_ENV=development`)

- Pretty console output with colors
- Human-readable timestamps
- No file logging

### Production Mode (`NODE_ENV=production`)

- Structured JSON logging to files
- Log directories created automatically if they don't exist
- Log files stored in `/app/logs/` directory:
  - API logs: `/app/logs/api.log`
  - Worker logs: `/app/logs/worker.log`
- Host volume mounts in Docker:
  - `./opengallery-logs/api:/app/logs` (API)
  - `./opengallery-logs/worker:/app/logs` (Worker)

## Log Levels

- `trace`: Most verbose logging
- `debug`: Debug information
- `info`: General information
- `warn`: Warning messages
- `error`: Error messages
- `fatal`: Fatal errors

## Redaction

By default, the following fields are automatically redacted:

- `password`
- `token`
- `secret`
- `key`

You can customize this list when creating a custom logger instance.

## Docker Integration

The logger is automatically configured in Docker containers:

1. **Development**: Console output with pretty formatting
2. **Production**: JSON logs written to mounted volumes
3. **Log Directory**: `/app/logs/` inside containers (created automatically)
4. **Host Mounts**: `./opengallery-logs/{service}/` on host

### Example Docker Compose Log Volumes

```yaml
services:
  api:
    volumes:
      - ./opengallery-logs/api:/app/logs
  worker:
    volumes:
      - ./opengallery-logs/worker:/app/logs
```

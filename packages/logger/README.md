# @opengallery/logger

Shared logging package using Pino.

## Usage

```typescript
import { logger, info, error, warn, debug } from "@opengallery/logger";

logger.info("Application started");
error("Request failed", { statusCode: 500 });
```

## Configuration

```typescript
import { Logger } from "@opengallery/logger";

const customLogger = new Logger({
  level: "debug",
  name: "my-service",
  prettyPrint: true,
});
```

## Environment Variables

- `LOG_LEVEL`: Log level (default: 'info')
- `SERVICE_NAME`: Service name (default: 'opengallery')
- `NODE_ENV`: 'development' (pretty output) or 'production' (JSON files)

## Log Levels

`trace` < `debug` < `info` < `warn` < `error` < `fatal`

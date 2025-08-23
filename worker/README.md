# 🔄 OpenGallery Worker

> **TLDR**: File system monitoring service that watches configured media directories and logs file system events in real-time for the OpenGallery system.

## 📋 Overview

The OpenGallery Worker is a dedicated service that monitors file system changes in configured media source paths. It provides real-time event logging for file additions, modifications, deletions, and directory changes, enabling the OpenGallery system to stay synchronized with your media library.

## 🛠 Technology Stack

- **Runtime**: Node.js with TypeScript
- **File Watching**: [Chokidar](https://github.com/paulmillr/chokidar) - Cross-platform file system monitoring
- **API Client**: [tRPC](https://trpc.io/) - Type-safe API communication
- **Validation**: [Zod](https://zod.dev/) - Schema validation
- **Logging**: Built-in console logging with emoji indicators

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- OpenGallery API running (see [API README](../api/README.md))
- Configured media source paths in the API

### Installation

```bash
# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your API configuration

# Start development server
npm run dev
```

## 📚 Available Scripts

| Command         | Description                              |
| --------------- | ---------------------------------------- |
| `npm run dev`   | Start development server with hot reload |
| `npm run build` | Build for production                     |
| `npm start`     | Start production server                  |

## 🔧 Configuration

### Environment Variables

Create a `.env` file with the following variables:

```env
# API Configuration
API_URL=http://localhost:3000
WORKER_TOKEN=your-worker-token

# Logging
LOG_LEVEL=info
```

## 🎯 Features

### File System Monitoring

- 📁 **File Added**: Detect new files in watched directories
- 📝 **File Changed**: Monitor file modifications
- 🗑️ **File Deleted**: Track file deletions
- 📂 **Directory Added**: Watch for new directories
- 🗂️ **Directory Deleted**: Monitor directory removals

### Smart Filtering

The worker automatically ignores:

- Hidden files (starting with `.`)
- System files (`.DS_Store`, `Thumbs.db`)
- Temporary files (`.tmp`)
- Log files (`.log`)

### Dynamic Path Management

- **Automatic Updates**: Fetches media source paths from API every 30 seconds
- **Dynamic Watchers**: Adds/removes watchers based on API configuration
- **Error Handling**: Graceful handling of missing or inaccessible paths

## 🔍 How It Works

### 1. Initialization

On startup, the worker:

- Connects to the OpenGallery API
- Fetches all configured media source paths
- Creates `chokidar` watchers for each path

### 2. Continuous Monitoring

During operation:

- Monitors file system events in real-time
- Logs events with descriptive emojis
- Updates watchers every 30 seconds based on API changes

### 3. Event Processing

For each file system event:

- Validates the event type
- Applies filtering rules
- Logs the event with context
- Handles errors gracefully

## 📊 Event Logging

The worker provides detailed logging with emoji indicators:

```
📁 File added: /photos/vacation/IMG_001.jpg
📝 File changed: /photos/vacation/IMG_002.jpg
🗑️ File deleted: /photos/old/IMG_003.jpg
📂 Directory added: /photos/vacation/2024
🗂️ Directory deleted: /photos/old
```

## 🛡️ Error Handling

The worker includes comprehensive error handling:

- **Watcher Errors**: Logged but don't stop the service
- **Missing Paths**: Handled gracefully with informative messages
- **Permission Errors**: Logged for debugging purposes
- **Network Issues**: Handled with retry logic
- **Graceful Shutdown**: Properly closes all watchers

## 🐳 Docker Deployment

```bash
# Build the image
docker build -t opengallery-worker .

# Run the container
docker run --env-file .env opengallery-worker
```

## 🔍 Development

### Local Development

```bash
# Start with hot reload
npm run dev

# Build for production
npm run build

# Start production build
npm start
```

### API Integration

The worker communicates with the OpenGallery API using tRPC:

```typescript
// Example: Fetching media sources
const mediaSources = await this.trpc.mediaSources.getAll.query();

// Example: Logging an event
console.log(`📁 File added: ${filePath}`);
```

## 📈 Performance

The worker is optimized for:

- **Low Resource Usage**: Efficient file watching with Chokidar
- **High Performance**: Minimal overhead on file system operations
- **Scalability**: Can handle multiple directories simultaneously
- **Reliability**: Robust error handling and recovery

## 🔧 Troubleshooting

### Common Issues

1. **Permission Denied**: Ensure the worker has read access to monitored directories
2. **API Connection**: Verify the API is running and accessible
3. **Token Issues**: Check that the worker token is valid
4. **Path Issues**: Ensure configured paths exist and are accessible

### Debug Mode

Enable debug logging by setting `LOG_LEVEL=debug` in your environment variables.

## 🤝 Contributing

1. Follow the project's coding standards
2. Add appropriate error handling
3. Update documentation for new features
4. Test with various file system scenarios
5. Use conventional commit messages

## 📄 License

This project is part of OpenGallery and follows the same license terms.

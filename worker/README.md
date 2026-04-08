# OpenGallery Worker

File system monitoring service that watches media directories.

## Quick Start

```bash
npm install
cp .env.sample .env
# Edit .env with your API_URL and INTERNAL_TOKEN
npm run dev
```

## Scripts

| Command         | Description            |
| --------------- | ---------------------- |
| `npm run dev`   | Start with hot reload  |
| `npm run build` | Build for production   |
| `npm start`     | Start production build |

## Environment Variables

```env
API_URL=http://localhost:3000
INTERNAL_TOKEN=worker-token
LOG_LEVEL=info
```

## Features

- Monitors file additions, modifications, and deletions
- Auto-fetches media paths from API every 30 seconds
- Ignores hidden files and system files

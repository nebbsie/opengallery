# OpenGallery Web

Angular frontend with Tailwind CSS and Spartan UI.

## Quick Start

```bash
npm install
npm start
```

Runs at http://localhost:4200

## Scripts

| Command              | Description              |
| -------------------- | ------------------------ |
| `npm start`          | Start development server |
| `npm run build`      | Build for development    |
| `npm run build:prod` | Build for production     |
| `npm test`           | Run unit tests           |
| `npm run lint`       | Run ESLint               |

## Configuration

Edit `src/environments/environment.ts`:

```typescript
export const environment = {
  production: false,
  apiUrl: 'http://localhost:3000',
};
```

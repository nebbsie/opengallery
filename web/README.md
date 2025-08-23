# 🌐 OpenGallery Web Application

> **TLDR**: Modern, responsive web application built with Angular 20, featuring a beautiful UI with Tailwind CSS and comprehensive photo management capabilities.

## 📋 Overview

The OpenGallery Web Application is a feature-rich, modern web interface for managing and viewing your photo collection. Built with Angular 20 and enhanced with cutting-edge UI components, it provides an intuitive and responsive experience for browsing, organizing, and enjoying your photos and videos.

## 🛠 Technology Stack

- **Framework**: [Angular 20](https://angular.io/) - Modern web framework
- **Styling**: [Tailwind CSS 4](https://tailwindcss.com/) - Utility-first CSS framework
- **UI Components**: [Spartan UI](https://spartan.ng/) - Beautiful Angular components
- **State Management**: [TanStack Query](https://tanstack.com/query) - Powerful data fetching
- **API Client**: [tRPC](https://trpc.io/) - End-to-end typesafe APIs
- **Authentication**: [Better Auth](https://better-auth.com/) - Modern auth solution
- **Icons**: [Lucide Icons](https://lucide.dev/) - Beautiful icon library
- **Build Tool**: [Angular CLI](https://angular.io/cli) - Official Angular build tool

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- Angular CLI (`npm install -g @angular/cli`)
- OpenGallery API running (see [API README](../api/README.md))

### Installation

```bash
# Install dependencies
npm install

# Start development server
npm start
```

The application will be available at `http://localhost:4200`

## 📚 Available Scripts

| Command              | Description                    |
| -------------------- | ------------------------------ |
| `npm start`          | Start development server       |
| `npm run start:prod` | Start production server        |
| `npm run build`      | Build for development          |
| `npm run build:prod` | Build for production           |
| `npm test`           | Run unit tests                 |
| `npm run lint`       | Run ESLint                     |
| `npm run serve:ssr`  | Serve server-side rendered app |

## 🏗 Project Structure

```
src/
├── @core/           # Core components and services
│   ├── components/  # Reusable UI components
│   ├── dialogs/     # Modal dialogs
│   ├── guards/      # Route guards
│   ├── services/    # Application services
│   └── ui/          # UI component library
├── app/             # Main application modules
│   ├── gallery/     # Photo gallery features
│   ├── login/       # Authentication
│   ├── register/    # User registration
│   └── settings/    # Application settings
├── environments/    # Environment configuration
└── main.ts         # Application entry point
```

## 🎨 UI Components

The application uses a comprehensive UI component library built with:

- **Spartan UI**: Modern, accessible Angular components
- **Tailwind CSS**: Utility-first styling
- **Custom Components**: Specialized components for photo management
- **Responsive Design**: Mobile-first approach

### Key Components

- **Gallery Views**: Grid and list layouts for photos/videos
- **Navigation**: Sidebar navigation with collapsible sections
- **Authentication**: Login and registration forms
- **Settings**: Media source configuration and preferences
- **Dialogs**: Confirmation dialogs and path selection

## 🔧 Configuration

### Environment Variables

Configure the application in `src/environments/environment.ts`:

```typescript
export const environment = {
  production: false,
  apiUrl: 'http://localhost:3000',
  // Add other configuration options
};
```

### API Integration

The application connects to the OpenGallery API using tRPC:

```typescript
// Example API call
const photos = await this.trpc.directory.getPhotos.query({
  path: '/photos',
  limit: 50,
});
```

## 🎯 Features

### Photo Management

- 📸 **Gallery View**: Browse photos in grid or list layout
- 🎥 **Video Support**: Play videos directly in the browser
- 📁 **Directory Navigation**: Navigate through folder structures
- 🔍 **Search & Filter**: Find photos quickly with search functionality

### User Experience

- 🎨 **Modern UI**: Beautiful, responsive interface
- ⚡ **Fast Loading**: Optimized for performance
- 📱 **Mobile Friendly**: Works great on all devices
- 🌙 **Theme Support**: Light and dark mode

### Authentication

- 🔐 **Secure Login**: Modern authentication flow
- 👤 **User Registration**: Easy account creation
- 🛡️ **Route Protection**: Guarded routes for authenticated users

## 🐳 Docker Deployment

```bash
# Build the image
docker build -t opengallery-web .

# Run the container
docker run -p 4200:4200 opengallery-web
```

## 🔍 Development

### Code Style

The project uses:

- **Prettier**: Code formatting
- **ESLint**: Code linting
- **TypeScript**: Type safety
- **Angular Style Guide**: Official Angular conventions

### Component Development

```bash
# Generate a new component
ng generate component @core/components/my-component

# Generate a new service
ng generate service @core/services/my-service
```

### Testing

```bash
# Run unit tests
npm test

# Run tests with coverage
npm run test:coverage
```

## 📱 Progressive Web App

The application is built as a Progressive Web App (PWA) with:

- Offline support
- App-like experience
- Fast loading times
- Responsive design

## 🤝 Contributing

1. Follow Angular style guide
2. Write unit tests for new features
3. Ensure responsive design works
4. Update documentation as needed
5. Use conventional commit messages

## 📄 License

This project is part of OpenGallery and follows the same license terms.

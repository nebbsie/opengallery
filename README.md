# 📸 OpenGallery

> **Fast, open-source, self-hosted alternative to Google Photos with modern architecture and beautiful UI.**

---

## 📦 Project Overview

OpenGallery is a **monorepo** containing a complete photo management system built with modern technologies. It provides a lightning-fast, private, and customizable alternative to cloud-based photo services, giving you full control over your photo collection.

### 🎯 Key Features

- 📸 **Photo & Video Management**: Browse, organize, and view your media collection
- 🔐 **Self-Hosted**: Complete privacy and control over your data
- ⚡ **Lightning Fast**: Optimized for performance with modern tech stack
- 🎨 **Beautiful UI**: Modern, responsive interface built with Angular and Tailwind CSS
- 🔄 **Real-time Sync**: Automatic file system monitoring and synchronization
- 📱 **Mobile Friendly**: Responsive design that works on all devices
- 🛡️ **Type Safe**: End-to-end TypeScript with tRPC for excellent developer experience

---

## 🏗 Architecture

OpenGallery follows a **microservices architecture** with three main components:

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   🌐 Web App    │    │   🚀 API        │    │   🔄 Worker     │
│   (Angular)     │◄──►│   (Fastify)     │◄──►│   (File Watch)  │
│   Port: 4200    │    │   Port: 3000    │    │   Background    │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                                │
                                ▼
                       ┌─────────────────┐
                       │   🗄️ Database   │
                       │   (PostgreSQL)  │
                       └─────────────────┘
```

### 📁 Repository Structure

```
opengallery/
├── 📁 api/          # Backend API server
├── 📁 web/          # Frontend web application
├── 📁 worker/       # File system monitoring service
├── 📁 packages/     # Shared packages and types
└── 📄 README.md     # This file
```

---

### 1. Start Dev Infrastructure

```bash
./dev
```

### 2. Individual Module Setup

Each module can be run independently for development:

#### 🌐 Web Application

```bash
cd web
npm install
npm start
# Available at http://localhost:4200
```

#### 🚀 API Server

```bash
cd api
npm install
npm run db:push
npm start
# Available at http://localhost:3000
```

#### 🔄 Worker Service

```bash
cd worker
npm install
npm run dev
# Runs in background monitoring file changes
```

### 3. Development Workflow

```bash
# Install dependencies for all modules
npm install

# Start all 3 services at the same time
npm start
```

---

## 📚 Module Documentation

Each module has its own comprehensive documentation:

- **[🌐 Web Application](web/README.md)** - Frontend Angular application with modern UI
- **[🚀 API Server](api/README.md)** - Backend Fastify server with tRPC and Drizzle ORM
- **[🔄 Worker Service](worker/README.md)** - File system monitoring and synchronization

---

## 🛠 Technology Stack

### Frontend (Web)

- **Framework**: Angular 20
- **Styling**: Tailwind CSS 4
- **UI Components**: Spartan UI
- **State Management**: TanStack Query
- **API Client**: tRPC

### Backend (API)

- **Runtime**: Node.js with TypeScript
- **Framework**: Fastify
- **API Layer**: tRPC
- **Database**: PostgreSQL with Drizzle ORM
- **Authentication**: Better Auth

### Infrastructure

- **File Watching**: Chokidar
- **Containerization**: Docker & Docker Compose
- **Package Management**: npm workspaces
- **Type Safety**: TypeScript throughout

---

## 📋 Development Guidelines

### Code Standards

- **TypeScript**: Use TypeScript for all new code
- **ESLint**: Follow the configured linting rules
- **Prettier**: Use consistent code formatting
- **Testing**: Write tests for new features
- **Documentation**: Update README files for significant changes

### Commit Messages

Use conventional commit format:

```
[<module>] <description>

Examples:
[web] Fix responsive layout on mobile devices
[api] Add user authentication endpoint
[worker] Improve file watching performance
```

### Pull Requests

Use descriptive branch names and PR titles:

```
Format: <module>/<short-description>

Examples:
web/fix-mobile-layout
api/add-auth-endpoint
worker/improve-performance
```

### Module-Specific Guidelines

#### Web Application

- Follow Angular style guide
- Use Angular CLI for component generation
- Ensure responsive design works on all devices
- Write unit tests for components and services

#### API Server

- Use tRPC for all API endpoints
- Follow RESTful principles for resource naming
- Write database migrations for schema changes
- Include proper error handling and validation

#### Worker Service

- Handle file system errors gracefully
- Log events with clear, descriptive messages
- Ensure proper cleanup on shutdown
- Test with various file system scenarios

---

## 🐳 Deployment

### Docker Compose (Recommended)

```bash
# Start all services
docker compose up -d

# View logs
docker compose logs -f

# Stop all services
docker compose down
```

### Individual Services

Each module includes its own Dockerfile for containerized deployment:

```bash
# Build and run individual services
cd api && docker build -t opengallery-api .
cd web && docker build -t opengallery-web .
cd worker && docker build -t opengallery-worker .
```

---

## 🔧 Configuration

### Environment Variables

Each module requires specific environment variables. See individual README files for details:

- **[API Configuration](api/README.md#configuration)**
- **[Web Configuration](web/README.md#configuration)**
- **[Worker Configuration](worker/README.md#configuration)**

### Database Setup

1. Create a PostgreSQL database
2. Update the `DATABASE_URL` in your API environment
3. Run database migrations: `npm run db:push` (in api directory)

---

## 🤝 Contributing

We welcome contributions! Please follow these steps:

1. **Fork** the repository
2. **Create** a feature branch: `git checkout -b feature/amazing-feature`
3. **Follow** the coding standards and commit message format
4. **Test** your changes thoroughly
5. **Submit** a pull request with a clear description

### Development Setup

```bash
# Clone the repository
git clone https://github.com/your-username/opengallery.git
cd opengallery

# Install dependencies
npm install

# Start development environment
docker compose up -d

# Make your changes and test
```

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

- Built with modern web technologies
- Inspired by the need for privacy-focused photo management
- Community-driven development

---

**Happy coding! 🚀**

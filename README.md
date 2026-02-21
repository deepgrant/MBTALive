# MBTA Tracker

A modern full-stack application for tracking MBTA commuter rail vehicles in real-time using Scala 3 backend and Angular frontend with interactive maps.

<img width="2709" height="1564" alt="Screenshot 2025-10-29 at 7 28 33 PM" src="https://github.com/user-attachments/assets/f5bf055a-b61f-4880-9773-19498e01d483" />

## Features

- **Real-time Vehicle Tracking**: Live updates of commuter rail vehicle positions
- **Interactive Map**: Leaflet-based map with custom vehicle markers showing direction and speed
- **Route Filtering**: Filter vehicles by specific routes
- **Modern UI**: Material Design with MBTA branding colors
- **RESTful API**: Scala 3 backend with Pekko HTTP

## Technology Stack

### Backend (Scala 3)
- **Gradle 9.3.1** - Build tool
- **Scala 3.3.7 LTS** - Language and stdlib
- **Apache Pekko 1.4.0** - Actor system and streams
- **Pekko HTTP 1.3.0** - HTTP server and client
- **Spray JSON 1.3.6** - JSON serialization
- **ScalaTest 3.2.19**, **scala-xml 2.4.0**, **scala-collection-compat 2.12.0**
- **Scalafix** - Linting (OrganizeImports, RemoveUnused, DisableSyntax, RedundantSyntax, etc.)

### Frontend (Angular)
- **Angular 19** - Framework and Angular Material
- **TypeScript 5.8** - Type-safe JavaScript
- **Leaflet 1.9** - Interactive maps
- **RxJS 7.8** - Reactive programming

## Getting Started

### Prerequisites

- **Java 21** for Scala backend (Gradle 9 requires JVM 17+)
- **Node.js 18+** and **npm** for Angular frontend
- **MBTA API Key** (optional, for higher rate limits)

### Backend Setup

1. **Set MBTA API Key** (optional):
   ```bash
   export MBTA_API_KEY="your_api_key_here"
   ```

2. **Run the Scala backend**:
   ```bash
   ./gradlew run
   ```
   The backend will start on `http://localhost:8080`

### Frontend Setup

1. **Install dependencies**:
   ```bash
   cd frontend
   npm install
   npm install -g @angular/cli@latest
   ```

2. **Start the Angular development server**:
   ```bash
   cd frontend
   ng serve --proxy-config proxy.conf.json
   ```
   The frontend will start on `http://localhost:4200`

### Access the Application

- **Frontend**: http://localhost:4200
- **Backend API**: http://localhost:8080/api

### Build and Lint

- **Backend**: `./gradlew build` (compile, test, check Scalafix)
- **Lint only**: `./gradlew checkScalafixMain` (fail if fixes needed) or `./gradlew applyScalafixMain` (apply fixes)

## API Endpoints

- `GET /api/routes` - Get all commuter rail routes
- `GET /api/vehicles` - Get all vehicles
- `GET /api/vehicles/{routeId}` - Get vehicles for specific route

## Features

### Real-time Updates
- Vehicle positions update every 5 seconds
- Route information refreshes every 30 seconds
- Automatic map bounds adjustment

### Interactive Map
- **Vehicle Markers**: Custom markers showing direction and speed
- **Route Filtering**: Click routes in sidebar to filter vehicles
- **Vehicle Details**: Click markers for detailed information
- **Responsive Design**: Works on desktop and mobile

### MBTA Branding
- **Colors**: Navy blue (#003DA5), Orange (#ED8B00), Purple (#80276C)
- **Material Design**: Modern, clean interface
- **Route Colors**: Authentic MBTA route color coding

## Development

### Backend Development
- **Gradle 9.3.1** for build management (`./gradlew build`, `./gradlew run`)
- **Scala 3.3.7 LTS**, **Pekko 1.4.0**, **Pekko HTTP 1.3.0**
- **Scalafix** for linting: `./gradlew checkScalafixMain` or `./gradlew applyScalafixMain`
- In-memory caching for performance

### Frontend Development
- **Angular 19**, **TypeScript 5.8**, **Leaflet 1.9**
- SCSS for styling with MBTA theme

## Architecture

```
┌─────────────────┐    HTTP/REST   ┌─────────────────┐
│   Angular UI    │◄──────────────►│    Scala API    │
│   (Port 4200)   │                │   (Port 8080)   │
└─────────────────┘                └─────────────────┘
         │                                  │
         │                                  │
         ▼                                  ▼
┌─────────────────┐                ┌─────────────────┐
│   Leaflet Map   │                │    MBTA API     │
│   (OpenStreet)  │                │   (External)    │
└─────────────────┘                └─────────────────┘
```

## Configuration

### Backend Configuration
- `source/resources/MBTA.conf` - MBTA API settings
- `source/resources/application.conf` - Pekko HTTP settings

### Frontend Configuration
- `frontend/proxy.conf.json` - API proxy settings
- `frontend/src/styles.scss` - MBTA theme colors

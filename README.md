# MBTA Tracker

A modern full-stack application for tracking MBTA commuter rail vehicles in real-time using Scala 3 backend and Angular frontend with interactive maps.

## Features

- **Real-time Vehicle Tracking**: Live updates of commuter rail vehicle positions
- **Interactive Map**: Leaflet-based map with custom vehicle markers showing direction and speed
- **Route Filtering**: Filter vehicles by specific routes
- **Modern UI**: Material Design with MBTA branding colors
- **RESTful API**: Scala 3 backend with Pekko HTTP

## Technology Stack

### Backend (Scala 3)
- **Scala 3.3.4** - Modern Scala with latest language features
- **Pekko HTTP** - HTTP server and client
- **Spray JSON** - JSON serialization
- **Apache Pekko** - Actor system and streams

### Frontend (Angular 18)
- **Angular 18** - Latest Angular framework
- **Angular Material** - UI components
- **Leaflet** - Interactive maps
- **RxJS** - Reactive programming
- **TypeScript** - Type-safe JavaScript

## Project Structure

```
mbta/
├── source/scala/mbta.scala          # Scala 3 backend with HTTP API
├── source/resources/                # Configuration files
├── frontend/                        # Angular application
│   ├── src/app/
│   │   ├── components/              # Angular components
│   │   │   ├── map/                # Map component (HTML, SCSS, TS)
│   │   │   ├── routes/             # Routes component (HTML, SCSS, TS)
│   │   │   └── vehicle-info/      # Vehicle info component (HTML, SCSS, TS)
│   │   ├── services/               # Angular services
│   │   │   ├── api.service.ts      # HTTP API client
│   │   │   ├── map.service.ts      # Leaflet map management
│   │   │   └── vehicle.service.ts  # Vehicle data management
│   │   └── models/                 # TypeScript models
│   │       ├── vehicle.model.ts    # Vehicle data structure
│   │       └── route.model.ts      # Route data structure
│   ├── package.json                # Angular dependencies
│   └── proxy.conf.json             # API proxy configuration
└── build.gradle                    # Gradle build configuration
```

## Getting Started

### Prerequisites

- **Java 11+** for Scala backend
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
   ng serve
   ```
   The frontend will start on `http://localhost:4200`

### Access the Application

- **Frontend**: http://localhost:4200
- **Backend API**: http://localhost:8080/api

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
- Uses Gradle for build management
- Scala 3 with modern syntax
- Pekko HTTP for REST API
- In-memory caching for performance

### Frontend Development
- Angular 18 with standalone components
- TypeScript for type safety
- SCSS for styling with MBTA theme
- Leaflet for interactive maps

## Architecture

```
┌─────────────────┐    HTTP/REST    ┌─────────────────┐
│   Angular UI    │◄──────────────►│   Scala API     │
│   (Port 4200)   │                 │   (Port 8080)   │
└─────────────────┘                 └─────────────────┘
         │                                    │
         │                                    │
         ▼                                    ▼
┌─────────────────┐                 ┌─────────────────┐
│   Leaflet Map   │                 │   MBTA API     │
│   (OpenStreet)  │                 │   (External)    │
└─────────────────┘                 └─────────────────┘
```

## Configuration

### Backend Configuration
- `source/resources/MBTA.conf` - MBTA API settings
- `source/resources/application.conf` - Pekko HTTP settings

### Frontend Configuration
- `frontend/proxy.conf.json` - API proxy settings
- `frontend/src/styles.scss` - MBTA theme colors

## Troubleshooting

### Common Issues

1. **Backend won't start**: Check Java version (11+ required)
2. **Frontend build fails**: Run `npm install` in frontend directory
3. **Map not loading**: Check browser console for Leaflet errors
4. **No vehicle data**: Verify MBTA API key is set correctly

### Development Tips

- Use browser dev tools to inspect API calls
- Check backend logs for MBTA API responses
- Leaflet map requires proper container sizing
- CORS is configured for localhost development

## License

This project is licensed under the MIT License - see the LICENSE file for details.
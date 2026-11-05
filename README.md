# Nismara Tracker Server

Dedicated backend server for the **NismaraTracker** in-game telemetry plugin (`NismaraTracker.dll`) and **Nismara Companion Desktop App** for Euro Truck Simulator 2 and American Truck Simulator.

## Architecture & Overview

To avoid high Vercel serverless invocation costs from continuous in-game telemetry polling and job submissions, `nismara-tracker-server` maintains a single persistent MongoDB connection pool to the official `nismara` database.

### Key Features
- **Driver Profile Synchronization**: Real-time driver profile, rank, wallet, fleet vehicles, and garage data via `/api/tracker/me`.
- **Job Lifecycle & Evaluation**: `/api/tracker/jobs/start`, `/api/tracker/jobs/complete`, `/api/tracker/jobs/cancel` with:
  - Anti-farming distance cap (`+25%` of planned distance).
  - Cumulative damage wear tracking across all truck components, trailer, and cargo.
  - Realistic financial payouts (NC), EXP calculation, tax, and fuel expense deduction.
  - Hardcore simulation validation (9-parameter profile check, manual parking, anti-warping, anti-repetitive route).
  - Hardcore Points (HP) formula and 5-Star Delivery Rating.
- **Speed Classification Enforcement**:
  - `Real Miles` ($\le 100$ km/h)
  - `Race Miles` ($100 - 180$ km/h, +2 penalty points)
  - `Invalid Stats` ($> 180$ km/h, +5 penalty points)
- **Penalty Management**: `/api/tracker/points/pay` (tebus via NC with cumulative booster & Nismara+ discounts) and `/api/tracker/points/use-ticket` (Safebox tickets).
- **Client Version Gatekeeper**: Validates `X-Tracker-Version` against `MIN_TRACKER_VERSION` with HTTP 426 upgrade requirements.

## Getting Started

### Prerequisites
- Node.js >= 18.0.0
- MongoDB connection string

### Installation
```bash
# Clone the repository
git clone https://github.com/mhazm/fortune-cookie-server.git
cd fortune-cookie-server

# Install dependencies
npm install

# Setup environment variables
cp .env.example .env
# Edit .env with your MongoDB credentials
```

### Running the Server
```bash
# Development (with auto-reload)
npm run dev

# Production
npm start
```
Default port: `3100` (`http://localhost:3100`).

## License
Private repository for Nismara Transport VTC.

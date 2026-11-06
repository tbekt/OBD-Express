# OBD Express

A real-time OBD-II vehicle dashboard built with **Node.js**, **TypeScript**, **Express**, and **WebSockets**. Connect a USB ELM327 adapter to your car and monitor live engine data directly in your browser.

![Dashboard](https://img.shields.io/badge/status-active-brightgreen)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)
![Node](https://img.shields.io/badge/Node.js-18+-green)

---

## Features

- **Live gauges** — Smooth animated RPM and speed gauges with redline zone
- **Live chart** — Rolling 90-second trace of RPM and speed with a real time axis
- **Metric cards** — Coolant, engine load, throttle, fuel level, intake air temp, mass air flow, timing advance, battery voltage
- **Fuel consumption** — Instantaneous L/100km and session average, derived from MAF
- **Trip odometer** — Session distance calculated by integrating speed readings
- **Session statistics** — Max RPM, max/average speed, drive time, idle time, litres used
- **CSV export** — Download the whole session log for analysis elsewhere
- **Fault codes (DTCs)** — Read and clear trouble codes, each resolved to a plain-language description, subsystem and severity
- **Readiness monitors** — See which emission monitors are incomplete after a code clear
- **True odometer** — Read the vehicle's actual mileage via OBD-II PID 0xA6 (2010+ vehicles)
- **Demo mode** — Explore the whole dashboard with a simulated vehicle, no adapter or car needed
- **Smooth animations** — Gauge needle lerp, metric count-up, odometer digit flip, staggered chip entrances

### Try it without a car

Start the server and click **Demo** in the header. A synthetic vehicle drives
itself — accelerating, cruising, braking and warming up — so every panel,
including fault codes and readiness monitors, can be explored offline.

---

## Requirements

- Node.js 18 or higher
- A USB ELM327 OBD-II adapter
- A vehicle with an OBD-II port (1996+ petrol, 2004+ diesel)

---

## Getting Started

### 1. Install dependencies

```bash
npm install
```

### 2. Start the development server

```bash
npm run dev
```

### 3. Open the dashboard

```
http://localhost:3000
```

### 4. Connect to your vehicle

1. Plug your ELM327 adapter into the OBD-II port (usually under the dashboard)
2. Click **Scan** to detect available serial ports
3. Select the correct port and baud rate (default: `38400`)
4. Click **Connect**

---

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start with hot-reload via nodemon + ts-node |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run the compiled build |

---

## Project Structure

```
OBD-Express/
├── src/
│   ├── index.ts            # Entry point
│   ├── app.ts              # Express app + WebSocket wiring
│   ├── obd/
│   │   ├── elm327.ts            # ELM327 serial driver, command queue, demo mode
│   │   ├── pids.ts              # OBD-II PID definitions, tiers and parsers
│   │   ├── dtc.ts               # Fault code (DTC) parser
│   │   ├── dtcDescriptions.ts   # DTC → description, severity, subsystem
│   │   ├── readiness.ts         # Readiness monitor + true odometer parsers
│   │   ├── history.ts           # Rolling sample buffer + CSV serialisation
│   │   ├── simulator.ts         # Synthetic vehicle model for demo mode
│   │   └── state.ts             # Shared OBD singleton + session state/stats
│   ├── routes/
│   │   ├── index.ts        # Route aggregator
│   │   ├── pages.ts        # GET / — serves the dashboard
│   │   ├── ports.ts        # GET /api/ports
│   │   ├── connection.ts   # POST /api/connect, /api/disconnect
│   │   ├── session.ts      # POST /api/session/reset, GET /api/status
│   │   ├── dtcs.ts         # GET /api/dtcs, POST /api/dtcs/clear
│   │   └── vehicle.ts      # GET /api/vehicle/monitors, /api/vehicle/odometer
│   └── ws/
│       └── index.ts        # WebSocket server + broadcast helper
├── views/
│   └── index.ejs           # Dashboard HTML template
├── public/
│   ├── css/style.css       # Dark dashboard theme + animations
│   ├── js/chart.js         # Rolling time-series chart (canvas)
│   └── js/dashboard.js     # Client-side gauge, animation, and WS logic
├── scripts/
│   ├── diagnose.ts         # Serial port + baud rate diagnostic
│   └── testconnect.ts      # End-to-end connection test, no browser needed
├── nodemon.json
├── tsconfig.json
└── package.json
```

---

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/ports` | List available serial ports |
| `POST` | `/api/connect` | Connect to OBD adapter `{ port, baudRate }` — `baudRate: "auto"` probes common rates |
| `POST` | `/api/simulate` | Start demo mode with a simulated vehicle |
| `POST` | `/api/disconnect` | Disconnect from adapter (or stop demo mode) |
| `GET` | `/api/dtcs` | Read fault codes, with descriptions and severity |
| `POST` | `/api/dtcs/clear` | Clear fault codes |
| `GET` | `/api/vehicle/monitors` | Read readiness monitor status |
| `GET` | `/api/vehicle/odometer` | Read true odometer (PID 0xA6) |
| `POST` | `/api/session/reset` | Reset trip odometer and statistics |
| `GET` | `/api/session/history` | Recent samples for charting (`?n=180`) |
| `GET` | `/api/session/export` | Download the session log as CSV |
| `GET` | `/api/status` | Connection status, current values and statistics |

Live data is pushed to the browser over **WebSocket** — no polling required.

---

## Supported PIDs

Polling is tiered: fast PIDs are read every round, slow ones every 4th, so
adding metrics does not make the gauges laggy. PIDs the vehicle does not
answer three times running are detected and skipped automatically.

| PID | Name | Unit | Tier |
|---|---|---|---|
| `010C` | Engine RPM | rpm | fast |
| `010D` | Vehicle speed | km/h | fast |
| `0111` | Throttle position | % | fast |
| `0104` | Engine load | % | fast |
| `0110` | Mass air flow | g/s | fast |
| `0105` | Coolant temperature | °C | slow |
| `012F` | Fuel level | % | slow |
| `010F` | Intake air temperature | °C | slow |
| `010E` | Timing advance | ° | slow |
| `ATRV` | Battery voltage (adapter command) | V | every 10th round |
| `0101` | Readiness monitors | — | on demand |
| `01A6` | True odometer | km | on demand |

---

## Notes

- **True odometer** requires OBD-II PID `0xA6`, which is typically only supported on 2010 and newer vehicles. Older vehicles will show "Not supported."
- **Trip distance** is calculated server-side by integrating speed readings using the trapezoidal rule. It resets on disconnect or when you click Reset.
- **Fuel consumption** is derived from mass air flow assuming petrol at a stoichiometric 14.7:1 ratio and 820 g/L density. It is an estimate, not a calibrated figure, and needs a vehicle that reports PID `0110`.
- **Clearing fault codes** requires two clicks as a safety measure — the button switches to a confirmation state for 4 seconds.
- **Bluetooth COM ports** are detected via their `pnpId` and labelled in the port list. They look identical to USB ports otherwise, and selecting one can never work.

## Troubleshooting

`scripts/diagnose.ts` inspects the serial layer without going through the web app:

```bash
npx ts-node scripts/diagnose.ts
```

It lists every serial port with its manufacturer, vendor/product ID and PnP ID,
so a USB adapter is easy to tell apart from a Bluetooth port. Pass a port to
probe it at every common baud rate and dump the raw bytes it returns:

```bash
npx ts-node scripts/diagnose.ts COM5
```

---

## License

MIT

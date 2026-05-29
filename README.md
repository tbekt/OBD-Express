# OBD Express

A real-time OBD-II vehicle dashboard built with **Node.js**, **TypeScript**, **Express**, and **WebSockets**. Connect a USB ELM327 adapter to your car and monitor live engine data directly in your browser.

![Dashboard](https://img.shields.io/badge/status-active-brightgreen)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)
![Node](https://img.shields.io/badge/Node.js-18+-green)

---

## Features

- **Live gauges** — Smooth animated RPM and speed gauges with redline zone
- **Metric cards** — Coolant temperature, engine load, throttle position, fuel level
- **Trip odometer** — Session distance calculated by integrating speed readings
- **Fault codes (DTCs)** — Read and clear OBD-II trouble codes with category colour coding (P/C/B/U)
- **Readiness monitors** — See which emission monitors are incomplete after a code clear
- **True odometer** — Read the vehicle's actual mileage via OBD-II PID 0xA6 (2010+ vehicles)
- **Smooth animations** — Gauge needle lerp, metric count-up, odometer digit flip, staggered chip entrances

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
│   │   ├── elm327.ts       # ELM327 serial driver + command queue
│   │   ├── pids.ts         # OBD-II PID definitions and parsers
│   │   ├── dtc.ts          # Fault code (DTC) parser
│   │   ├── readiness.ts    # Readiness monitor + true odometer parsers
│   │   └── state.ts        # Shared OBD singleton + session state
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
│   └── js/dashboard.js     # Client-side gauge, animation, and WS logic
├── nodemon.json
├── tsconfig.json
└── package.json
```

---

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/ports` | List available serial ports |
| `POST` | `/api/connect` | Connect to OBD adapter `{ port, baudRate }` |
| `POST` | `/api/disconnect` | Disconnect from adapter |
| `GET` | `/api/dtcs` | Read fault codes |
| `POST` | `/api/dtcs/clear` | Clear fault codes |
| `GET` | `/api/vehicle/monitors` | Read readiness monitor status |
| `GET` | `/api/vehicle/odometer` | Read true odometer (PID 0xA6) |
| `POST` | `/api/session/reset` | Reset trip odometer |
| `GET` | `/api/status` | Current connection status |

Live data is pushed to the browser over **WebSocket** — no polling required.

---

## Supported PIDs

| PID | Name | Unit |
|---|---|---|
| `010C` | Engine RPM | rpm |
| `010D` | Vehicle speed | km/h |
| `0105` | Coolant temperature | °C |
| `0104` | Engine load | % |
| `0111` | Throttle position | % |
| `012F` | Fuel level | % |
| `0101` | Readiness monitors | — |
| `01A6` | True odometer | km |

---

## Notes

- **True odometer** requires OBD-II PID `0xA6`, which is typically only supported on 2010 and newer vehicles. Older vehicles will show "Not supported."
- **Trip distance** is calculated server-side by integrating speed readings using the trapezoidal rule. It resets on disconnect or when you click Reset.
- **Clearing fault codes** requires two clicks as a safety measure — the button switches to a confirmation state for 4 seconds.

---

## License

MIT

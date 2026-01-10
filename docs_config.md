# eRoxii Vision Config App - Documentation

## Table of Contents
1. [Application Overview](#application-overview)
2. [Application Layout](#application-layout)
3. [Camera Configuration and Video Display](#camera-configuration-and-video-display)
4. [Gate Control System](#gate-control-system)
5. [Other Pages and Features](#other-pages-and-features)
6. [Configuration File Structure](#configuration-file-structure)

---

## Application Overview

The **eRoxii Vision Config App** is a PyQt6-based desktop application for managing and monitoring an automated parking system. It provides:
- Real-time RTSP video streaming from multiple cameras
- Gate control operations via HTTP API
- ALPR (Automatic License Plate Recognition) configuration
- Payment integration via Bakong
- System configuration management

**Technology Stack:**
- **Framework:** PyQt6
- **Video Processing:** OpenCV (cv2)
- **HTTP Client:** httpx (async)
- **Configuration:** YAML files
- **Threading:** Python threading + Qt signals/slots

---

## Application Layout

### Main Window Structure

```
┌─────────────────────────────────────────────────────────────┐
│  eRoxii Vision Config App                                   │
├──────────┬──────────────────────────────────────────────────┤
│          │                                                   │
│  [Logo]  │                                                   │
│          │                                                   │
│ ──────── │          Content Area (Active Page)              │
│ Video    │                                                   │
│ ALPR     │                                                   │
│ Gate     │                                                   │
│ Bakong   │                                                   │
│ Restart  │                                                   │
│ Config   │                                                   │
│ Settings │                                                   │
│ ──────── │                                                   │
│  [≡]     │                                                   │
└──────────┴──────────────────────────────────────────────────┘
```

### Sidebar Navigation
- **Width:** 250px (expanded), 60px (collapsed)
- **Animation:** 300ms smooth transition
- **Color Scheme:**
  - Background: #2c3e50 (dark blue-gray)
  - Buttons: #34495e (lighter gray)
  - Active: #3498db (bright blue)
  - Hover: #3d566e

### Navigation Pages (7 Total)

| Index | Page Name | Purpose |
|-------|-----------|---------|
| 0 | Video Streams | Display 4 RTSP camera feeds |
| 1 | ALPR Configuration | Configure ALPR system settings |
| 2 | Gate Control | Control physical gates (Barrel 1/2) |
| 3 | Bakong Account | Payment integration and QR codes |
| 4 | System Restart | Execute system restart scripts |
| 5 | Settings | Application settings (placeholder) |
| 6 | System Config | Direct YAML configuration editor |

---

## Camera Configuration and Video Display

### Camera Input Types

The system supports **4 RTSP camera streams**:

#### Camera Identifiers and URLs

| Camera Name | Config Key | Purpose | Example URL |
|-------------|------------|---------|-------------|
| Car Entry Camera | `CAMERA_CAR_ENTRY_URL` | Monitor car entry point | `rtsp://admin:admin@168@192.168.11.11:8000` |
| Car Exit Camera | `CAMERA_CAR_EXIT_URL` | Monitor car exit point | `rtsp://admin:admin@168@192.168.11.12:8000` |
| Motorcycle Entry | `CAMERA_MOTOR_ENTRY_URL` | Monitor motorcycle entry | `rtsp://admin:admin@168@192.168.11.13:8000` |
| Motorcycle Exit | `CAMERA_MOTOR_EXIT_URL` | Monitor motorcycle exit | `rtsp://admin:admin@168@192.168.11.14:8000` |

#### Camera Stream Parameters

Each camera stream supports the following configuration:

```yaml
camera:
  ENTRY:
    name: "entry_camera"
    rtsp_url: "rtsp://admin:password@192.168.1.100:554/stream"
    width: 1920        # Resolution width
    height: 1080       # Resolution height (1080p)
    frame_rate: 30     # Frames per second
    max_reconnect_attempts: 3
    reconnect_delay: 5  # Seconds between reconnect attempts
```

### Display Layouts

The Video Streams page provides **4 layout options**:

#### 1. 2x2 Grid Layout
```
┌──────────┬──────────┐
│ Camera 1 │ Camera 2 │
├──────────┼──────────┤
│ Camera 3 │ Camera 4 │
└──────────┴──────────┘
```
- Displays all 4 cameras simultaneously
- Equal space distribution
- Best for monitoring all entry/exit points

#### 2. 1x2 Grid Layout (Horizontal)
```
┌──────────────┬──────────────┐
│   Camera 1   │   Camera 2   │
└──────────────┴──────────────┘
```
- Two cameras side-by-side
- Larger individual display
- Good for comparing two specific cameras

#### 3. 2x1 Grid Layout (Vertical)
```
┌─────────────────────────────┐
│         Camera 1            │
├─────────────────────────────┤
│         Camera 2            │
└─────────────────────────────┘
```
- Two cameras stacked vertically
- Wider view per camera
- Suitable for portrait-oriented monitoring

#### 4. 1x1 Single View
```
┌─────────────────────────────┐
│                             │
│         Camera 1            │
│       (Full Screen)         │
│                             │
└─────────────────────────────┘
```
- Single camera maximized
- Full screen real estate
- Best for focused monitoring

### Video Streaming Architecture

#### How Video Streaming Works

**1. Stream Initialization**
```python
RTSPVideoWidget(rtsp_url, label_text)
  ↓
check_availability()  # Background thread
  ↓
_check_availability_thread()
  ↓
cv2.VideoCapture(rtsp_url)  # Test connection
  ↓
Signal: availability_checked → UI update
```

**2. Video Capture Process**
```
Background Thread:
  ├── cv2.VideoCapture(rtsp_url)
  ├── Continuous frame reading (while running)
  ├── Error handling with reconnection
  │   ├── Max 5 consecutive errors allowed
  │   ├── 0.5s delay for minor errors
  │   └── 2s delay after max errors
  ├── Thread-safe frame storage (Lock)
  └── Signal: status_update → UI

Main Thread (Timer: 30ms):
  ├── Read latest frame from lock
  ├── Convert BGR → RGB
  ├── Add camera label overlay
  ├── Scale to fit widget (maintain aspect ratio)
  └── Update QLabel with QPixmap
```

**3. Thread-Safe Communication**

Uses PyQt6 signals to communicate between threads:

| Signal | Parameters | Purpose |
|--------|------------|---------|
| `availability_checked` | `bool` | Stream available/unavailable |
| `status_update` | `str, str` | Status text and CSS color |
| `video_message` | `str` | Error/info message on video |

**4. Status Indicators**

Color-coded status labels:
- **Green:** Connected and streaming
- **Yellow:** Checking availability
- **Red:** Not available / Connection lost
- **Lime:** Stream available (ready to start)

### Control Panel Features

**Buttons:**
- **Start All** - Begin streaming all configured cameras
- **Stop All** - Stop all active streams
- **Reload Config** - Reload camera URLs from `system.yml`

**Layout Selector:**
- Dropdown to switch between 2x2, 1x2, 2x1, or 1x1 layouts
- Real-time layout change without stopping streams

### Video Frame Processing

**Specifications:**
- **Input Format:** RTSP stream via OpenCV
- **Resolution:** 1920x1080 (1080p)
- **Target FPS:** 30 frames per second
- **Display FPS:** ~33 FPS (30ms timer)
- **Color Conversion:** OpenCV BGR → PyQt6 RGB
- **Scaling:** Maintains aspect ratio with smooth transformation
- **Minimum Widget Size:** 320x240 pixels

**Frame Pipeline:**
```
RTSP Stream → OpenCV Capture → BGR Frame
  ↓
Thread-Safe Storage (Lock)
  ↓
Main Thread Timer (30ms)
  ↓
Frame Copy → BGR to RGB → Add Overlay Text
  ↓
QImage Creation → QPixmap
  ↓
Scale to Widget Size (keep aspect ratio)
  ↓
Display in QLabel
```

---

## Gate Control System

### Overview

The Gate Control page provides remote operation of physical barrier gates via HTTP API calls.

### Supported Gates

| Gate Name | Gate ID | Purpose |
|-----------|---------|---------|
| Barrel 1 | `barrel1` | First barrier gate |
| Barrel 2 | `barrel2` | Second barrier gate |

### Gate Control Operations

#### Available Operations

1. **Open Gate**
   - Opens the selected gate
   - Sends `control=open` parameter

2. **Close Gate**
   - Closes the selected gate
   - Sends `control=close` parameter

3. **Status Display**
   - Shows current gate state: OPEN / CLOSED
   - Displays timestamp of last update
   - Auto-updates after each operation

### Backend API Integration

#### API Endpoint Format

```
GET {LICENSE_PLATE_DETECTION_URL}/api/v1/gate/{gate_id}?control={operation}
```

**Components:**
- **Base URL:** Loaded from `system.yml` → `api.LICENSE_PLATE_DETECTION_URL`
- **Default:** `http://localhost:8005`
- **Path:** `/api/v1/gate/{gate_id}`
- **Parameters:** `?control={operation}`

#### Example API Calls

**Open Barrel 1:**
```http
GET http://localhost:8005/api/v1/gate/barrel1?control=open
```

**Close Barrel 2:**
```http
GET http://localhost:8005/api/v1/gate/barrel2?control=close
```

### Request Parameters

| Parameter | Type | Required | Values | Description |
|-----------|------|----------|--------|-------------|
| `gate_id` | Path | Yes | `barrel1`, `barrel2` | Gate identifier |
| `control` | Query | Yes | `open`, `close` | Operation to perform |

**No Authentication Required:** Direct HTTP GET requests without auth headers.

**Timeout:** 3.0 seconds (configurable)

### Response Format

#### Successful Response (HTTP 200)

**JSON Format:**
```json
{
  "success": true,
  "status": "success",
  "state": true,
  "gate_id": "barrel1",
  "action": "open"
}
```

**Response Fields:**
- `success` (bool): Operation success indicator
- `status` (string): "success" or error message
- `state` (bool): `true` = OPEN, `false` = CLOSED
- `gate_id` (string): Gate identifier
- `action` (string): Operation performed

**Alternative Success Indicators:**
- HTTP 200 status code
- `"success": true` field present
- `"status": "success"` field present

#### Error Response (Non-200 HTTP)

```json
{
  "success": false,
  "error": "HTTP 500: Internal Server Error",
  "gate_id": "barrel1"
}
```

#### Connection Error

```json
{
  "success": false,
  "error": "Connection timeout after 3.0 seconds",
  "gate_id": "barrel1",
  "action": "Check server connection and try again"
}
```

### Configuration

#### API Configuration (`system.yml`)

```yaml
api:
  LICENSE_PLATE_DETECTION_URL: http://localhost:8005
  TIMEOUT: 30.0          # General API timeout
  MAX_RETRIES: 1
  RETRY_DELAY: 1.0       # Seconds
```

#### Gate Configuration (`system.yml`)

```yaml
gates:
  ENTRY:
    gate_id: e23ea4ed-6662-4e25-90b3-42657bc70835
    gate_type: ENTRY
    name: Entry Gate
    control_pin: 1       # Hardware control pin
    sensor_pin: 2        # Sensor detection pin
    open_duration: 0.5   # Seconds gate stays open
    sensor_delay: 0.4    # Sensor activation delay

  EXIT:
    gate_id: f739d4cd-d4f7-488d-9cd9-53b792e4e661
    gate_type: EXIT
    name: Exit Gate
    control_pin: 2
    sensor_pin: 1
    open_duration: 0.5
    sensor_delay: 0.9
```

#### Serial Configuration (Hardware Control)

```yaml
serial:
  GATE_SENSORS:
    barrel:
      barrel_1:
        write_pin: 1     # Physical pin for Barrel 1
      barrel_2:
        write_pin: 2     # Physical pin for Barrel 2
  PORT: /dev/ttyUSB0     # Serial port
  BAUDRATE: 38400        # Communication speed
```

### UI Components

#### Gate Status Widget

Displays for each gate:
- **Gate Name:** "Barrel 1" or "Barrel 2"
- **Status Label:** "OPEN" or "CLOSED" with color coding
- **Timestamp:** "Last updated: YYYY-MM-DD HH:MM:SS"

#### Gate Control Panel

**Gate Selector:**
- Dropdown menu
- Options: "Barrel 1", "Barrel 2"

**Control Buttons:**
- **Open Gate** (Green button) → Sends `control=open`
- **Close Gate** (Red button) → Sends `control=close`

#### Console Output

- Read-only text area
- Timestamped operation logs
- Color-coded messages:
  - **Black:** Normal operations
  - **Red:** Errors
- Auto-scrolls to latest message

### Error Handling

**Handled Scenarios:**

1. **Connection Timeout** (3 seconds)
   - Error message: "Connection timeout after 3.0 seconds"
   - Suggestion: "Check server connection and try again"

2. **HTTP Errors** (Non-200 status)
   - Logs full HTTP status code and error
   - Example: "HTTP 500: Internal Server Error"

3. **JSON Parse Failures**
   - Falls back to assuming success for HTTP 200
   - Logs warning about non-JSON response

4. **404 Not Found**
   - Simulates successful operation (for demonstration)
   - Logs "Endpoint not found, simulating operation"

5. **Network Failures**
   - Returns detailed connection error
   - Logs to both UI console and application logs

### Threading Architecture

**AsyncWorker (QThread):**
```python
AsyncWorker(async_function, *args)
  ↓
Run async function in thread's event loop
  ↓
Emit signal: result_ready(result)
  ↓
Main thread receives result → Update UI
```

**Key Points:**
- Each gate operation runs in background thread
- UI remains responsive during HTTP calls
- Results communicated via Qt signals
- Worker references kept to prevent garbage collection

### File Locations

**Source Files:**
- **UI:** `/src/ui/pages/gate_control_page.py`
- **HTTP Client:** `/src/core/gate_http_client.py`
- **Config:** `/src/config/system.yml`

**Classes:**
- `GateControlPage` - Main UI container
- `GateStatusWidget` - Individual gate status display
- `GateHttpClient` - HTTP API communication
- `AsyncWorker` - Threading wrapper for async operations

---

## Other Pages and Features

### 1. ALPR Configuration Page

**Purpose:** Configure all ALPR system settings

**Configuration Sections:**
1. **Serial Settings** - Port, baudrate, timeout
2. **Camera URLs** - All 4 RTSP camera streams
3. **Backend/API Settings** - API endpoints, timeouts, retries
4. **Gate Settings** - Entry/exit gate IDs
5. **YOLO Model** - License plate detection model path
6. **Telegram** - Bot token and chat IDs for notifications
7. **Save Directory** - Storage path for captured images
8. **Printer Info** - Parking name, company details, contact
9. **Advanced** - Scanner duplicate timeout

**Features:**
- Scrollable form interface
- Load from file button
- Save configuration button
- Form validation
- Integration with ConfigAPI

### 2. Bakong Account Page

**Purpose:** Payment integration and QR code generation

**Features:**
1. **Create Bakong Account**
   - Merchant name, phone, email
   - Bakong ID configuration
   - Account creation via API

2. **Token Management**
   - Initialize tokens with account ID
   - Renew tokens when expired

3. **QR Code Payment**
   - Generate payment QR codes
   - Configure: amount, currency (KHR/USD), order ID
   - Display QR code in dialog

**API Endpoints:**
- `POST /api/v1/bakong-account/` - Create account
- `POST /api/v1/bakong-account/{id}/token/init` - Initialize token
- `POST /api/v1/bakong-account/{id}/token/renew` - Renew token
- `POST /api/v1/pay/initiate` - Create payment
- `GET /api/v1/khqr/{id}/image` - Retrieve QR code

### 3. System Restart Page

**Purpose:** Execute system restart scripts

**Features:**
- Script path selector with file browser
- Warning about interrupting operations
- Console output for script execution
- Real-time stdout/stderr streaming
- Return code reporting
- Background thread execution

**Default Script:** `~/startup_system.bat`

### 4. System Configuration Page

**Purpose:** Direct YAML configuration editing

**Features:**

**File Information Panel:**
- Configuration file path display (with copy button)
- Writable status indicator
- File existence check
- Parent directory info

**YAML Editor:**
- Direct text editing
- Monospace font for readability
- Load, Save, and Backup buttons
- YAML validation before save
- Syntax error reporting

**Quick Settings Panel:**
- API Endpoints (Payment, ALPR, License Plate Detection)
- Bakong Account ID
- Gate IDs (Car Entry/Exit, Motorcycle Entry/Exit)
- Apply Quick Settings button

**File Operations:**
- Load configuration from file
- Save changes to file
- Create timestamped backups

### 5. Settings Page

**Purpose:** Application-level settings

**Current Groups:**
1. General Settings (Language, Theme, Auto-update)
2. Network Settings (Server IP, Port, SSL)
3. Save Settings button

**Status:** Basic structure, placeholder for future expansion

---

## Configuration File Structure

### Main Configuration File: `system.yml`

**Location:**
- **Development:** `/src/config/system.yml`
- **Production:** `{executable_dir}/config/system.yml` or `~/.eroxii/system.yml`

### Configuration Sections

#### 1. API Configuration
```yaml
api:
  LICENSE_PLATE_DETECTION_URL: http://localhost:8005
  PAYMENT_API_URL: http://localhost:8000
  ALPR_API_URL: http://localhost:8001
  TIMEOUT: 30.0
  MAX_RETRIES: 1
  RETRY_DELAY: 1.0
```

#### 2. Camera Configuration
```yaml
camera:
  CAMERA_CAR_ENTRY_URL: rtsp://admin:password@192.168.11.11:8000
  CAMERA_CAR_EXIT_URL: rtsp://admin:password@192.168.11.12:8000
  CAMERA_MOTOR_ENTRY_URL: rtsp://admin:password@192.168.11.13:8000
  CAMERA_MOTOR_EXIT_URL: rtsp://admin:password@192.168.11.14:8000
  ENTRY:
    name: entry_camera
    rtsp_url: rtsp://admin:password@192.168.1.100:554
    width: 1920
    height: 1080
    frame_rate: 30
    max_reconnect_attempts: 3
    reconnect_delay: 5
  EXIT:
    name: exit_camera
    rtsp_url: rtsp://admin:password@192.168.1.101:554
    width: 1920
    height: 1080
    frame_rate: 30
    max_reconnect_attempts: 3
    reconnect_delay: 5
```

#### 3. Gate Configuration
```yaml
gates:
  ENTRY:
    gate_id: e23ea4ed-6662-4e25-90b3-42657bc70835
    gate_type: ENTRY
    name: Entry Gate
    control_pin: 1
    sensor_pin: 2
    open_duration: 0.5
    sensor_delay: 0.4
  EXIT:
    gate_id: f739d4cd-d4f7-488d-9cd9-53b792e4e661
    gate_type: EXIT
    name: Exit Gate
    control_pin: 2
    sensor_pin: 1
    open_duration: 0.5
    sensor_delay: 0.9
```

#### 4. Serial Configuration
```yaml
serial:
  PORT: /dev/ttyUSB0
  BAUDRATE: 38400
  TIMEOUT: 1.0
  GATE_SENSORS:
    barrel:
      barrel_1:
        write_pin: 1
      barrel_2:
        write_pin: 2
```

#### 5. Detection Configuration
```yaml
detection:
  YOLO_MODEL_PATH: /path/to/yolo/model.pt
  OCR_ENGINE: tesseract
  CONFIDENCE_THRESHOLD: 0.7
```

#### 6. Telegram Configuration
```yaml
telegram:
  BOT_TOKEN: your_telegram_bot_token
  CHAT_IDS:
    - 123456789
    - 987654321
```

#### 7. System Configuration
```yaml
system:
  SAVE_DIRECTORY: /path/to/save/images
  LOG_LEVEL: INFO
  BACKUP_ENABLED: true
```

#### 8. Printer Configuration
```yaml
printer:
  PARKING_NAME: eRoxii Parking
  COMPANY_NAME: eRoxii Co., Ltd.
  CONTACT_INFO: +855 12 345 678
  ADDRESS: Phnom Penh, Cambodia
```

### Configuration Management Classes

#### ConfigAPI (`src/core/config_api.py`)
**Methods:**
- `get_config(section)` - Retrieve configuration section
- `update_config(section, key, value)` - Update specific value
- `create_config(section, data)` - Create/overwrite section

#### ConfigFileManager (`src/core/config_file_manager.py`)
**Methods:**
- `get_config()` - Load YAML configuration
- `update_config()` - Save changes
- `create_config()` - Create new config
- `delete_config()` - Remove config section

**Supported Config Files:**
- `serial.yml`, `camera.yml`, `api.yml`, `gates.yml`
- `detection.yml`, `telegram.yml`, `system.yml`
- `printer.yml`, `grpc.yml`

---

## Technical Specifications

### Dependencies

**Core:**
- Python 3.8+
- PyQt6 6.6.1
- OpenCV (opencv-python) 4.11.0.86
- NumPy 1.26.4

**HTTP/Async:**
- httpx 0.28.0
- aiohttp 3.9.0

**Configuration:**
- PyYAML 6.0.1
- Loguru 0.7.2

**Utilities:**
- Pillow 10.0.0
- PyInstaller 6.3.0 (for building)

### Build Process

**Windows:**
```batch
build.bat
```

**Steps:**
1. Create/activate virtual environment
2. Install dependencies from requirements.txt
3. Convert PNG icon to ICO format
4. Clean old build files
5. Run PyInstaller with spec file

**Output:** `dist/eroxii-vision-streaming-app/eroxii-vision-streaming-app.exe`

### Logging

**Log Locations:**
- **Development:** `logs/app.log`
- **Production:** `{executable_dir}/logs/app.log`
- **Crash Logs:** `{executable_dir}/logs/crash.log`

**Log Levels:**
- DEBUG, INFO, WARNING, ERROR

**Log Rotation:**
- 10 MB per file
- 7 days retention
- Compression: zip

---

## Quick Reference

### Camera URLs Quick Config
```yaml
camera:
  CAMERA_CAR_ENTRY_URL: rtsp://user:pass@ip:port/path
  CAMERA_CAR_EXIT_URL: rtsp://user:pass@ip:port/path
  CAMERA_MOTOR_ENTRY_URL: rtsp://user:pass@ip:port/path
  CAMERA_MOTOR_EXIT_URL: rtsp://user:pass@ip:port/path
```

### Gate Control API Quick Reference
```http
# Open Barrel 1
GET http://localhost:8005/api/v1/gate/barrel1?control=open

# Close Barrel 2
GET http://localhost:8005/api/v1/gate/barrel2?control=close
```

### Key File Paths
- **Main Entry:** `src/main.py`
- **Config File:** `src/config/system.yml`
- **Build Script:** `build.bat`
- **Run Script:** `run_app.bat`
- **Spec File:** `eroxii_vision_app.spec`

---

**Document Version:** 1.0
**Last Updated:** 2026-01-10
**Author:** Generated from source code analysis

from fastapi import FastAPI, APIRouter, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.responses import JSONResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import asyncio
import json
import random
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional, Dict, Any
import uuid
from datetime import datetime, timezone, timedelta
from faker import Faker

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Create the main app
app = FastAPI()
api_router = APIRouter(prefix="/api")

# Initialize Faker
fake = Faker()

# WebSocket connection manager
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except:
                pass

manager = ConnectionManager()

# Models
class Device(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    type: str  # OLT, ODF, OTP, ODS, Tiang
    location: Dict[str, float]  # {lat, lng}
    status: str  # online, warning, offline
    port_capacity: Optional[int] = None
    ports_used: Optional[int] = None
    address: str

class Client(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    address: str
    location: Dict[str, float]
    ppoe: str
    billing_id: str
    modem_type: str
    optical_power: float  # Redaman dBm
    status: str  # online, los, gasep, offline, isoler
    activation_date: str
    download_speed: int  # Mbps
    upload_speed: int  # Mbps
    device_id: str  # Connected to which OTP/ODS
    connected_devices: int
    last_seen: str

class Alert(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    type: str  # los, port_down, high_redaman
    severity: str  # critical, warning, info
    message: str
    client_id: Optional[str] = None
    device_id: Optional[str] = None
    timestamp: str
    resolved: bool = False

class TrafficData(BaseModel):
    timestamp: str
    download: float  # Mbps
    upload: float  # Mbps

class WiFiConfig(BaseModel):
    ssid: str
    password: str

# Mock data generators
def generate_devices():
    """Generate mock network devices around Surabaya area"""
    devices = []
    device_types = [
        {"type": "OLT", "count": 3, "capacity": 128},
        {"type": "ODF", "count": 5, "capacity": 64},
        {"type": "OTP", "count": 15, "capacity": 16},
        {"type": "ODS", "count": 20, "capacity": 8},
        {"type": "Tiang", "count": 50, "capacity": None}
    ]
    
    # Base coordinates (Surabaya)
    base_lat, base_lng = -7.2575, 112.7521
    
    for device_type in device_types:
        for i in range(device_type["count"]):
            lat = base_lat + random.uniform(-0.05, 0.05)
            lng = base_lng + random.uniform(-0.05, 0.05)
            
            if device_type["capacity"]:
                ports_used = random.randint(0, device_type["capacity"])
                if ports_used / device_type["capacity"] > 0.8:
                    status = "warning"
                elif ports_used == device_type["capacity"]:
                    status = "offline"
                else:
                    status = "online"
            else:
                status = "online"
                ports_used = None
            
            devices.append({
                "id": str(uuid.uuid4()),
                "name": f"{device_type['type']}-{i+1:03d}",
                "type": device_type["type"],
                "location": {"lat": lat, "lng": lng},
                "status": status,
                "port_capacity": device_type["capacity"],
                "ports_used": ports_used,
                "address": fake.address().replace('\n', ', ')
            })
    
    return devices

def generate_clients(devices):
    """Generate mock clients connected to OTP/ODS devices"""
    clients = []
    otp_ods = [d for d in devices if d["type"] in ["OTP", "ODS"]]
    statuses = ["online", "los", "gasep", "offline", "isoler"]
    status_weights = [70, 10, 5, 10, 5]  # Probability weights
    
    for i in range(200):  # 200 mock clients
        device = random.choice(otp_ods)
        lat = device["location"]["lat"] + random.uniform(-0.002, 0.002)
        lng = device["location"]["lng"] + random.uniform(-0.002, 0.002)
        
        status = random.choices(statuses, weights=status_weights)[0]
        
        # Optical power varies by status
        if status == "los":
            optical_power = random.uniform(-35, -28)
        elif status == "gasep":
            optical_power = random.uniform(-26, -23)
        elif status == "offline":
            optical_power = -40
        else:
            optical_power = random.uniform(-23, -15)
        
        clients.append({
            "id": str(uuid.uuid4()),
            "name": fake.name(),
            "address": fake.address().replace('\n', ', '),
            "location": {"lat": lat, "lng": lng},
            "ppoe": f"user{i+1:04d}@ftth",
            "billing_id": f"BILL{i+1:06d}",
            "modem_type": random.choice(["Huawei HG8245H", "ZTE F660", "Fiberhome AN5506", "Nokia G-240W-C"]),
            "optical_power": round(optical_power, 2),
            "status": status,
            "activation_date": (datetime.now(timezone.utc) - timedelta(days=random.randint(30, 730))).isoformat(),
            "download_speed": random.choice([10, 20, 30, 50, 100]),
            "upload_speed": random.choice([5, 10, 15, 25, 50]),
            "device_id": device["id"],
            "connected_devices": random.randint(1, 8),
            "last_seen": (datetime.now(timezone.utc) - timedelta(minutes=random.randint(0, 60))).isoformat()
        })
    
    return clients

def generate_alerts(clients, devices):
    """Generate mock alerts"""
    alerts = []
    
    # LOS alerts
    los_clients = [c for c in clients if c["status"] == "los"]
    for client in los_clients[:5]:  # First 5 LOS clients
        alerts.append({
            "id": str(uuid.uuid4()),
            "type": "los",
            "severity": "critical",
            "message": f"Loss of Signal detected for client {client['name']}",
            "client_id": client["id"],
            "timestamp": (datetime.now(timezone.utc) - timedelta(minutes=random.randint(1, 60))).isoformat(),
            "resolved": False
        })
    
    # High redaman alerts
    high_redaman = [c for c in clients if c["optical_power"] < -25 and c["status"] != "los"]
    for client in high_redaman[:3]:
        alerts.append({
            "id": str(uuid.uuid4()),
            "type": "high_redaman",
            "severity": "warning",
            "message": f"High optical power loss ({client['optical_power']} dBm) for {client['name']}",
            "client_id": client["id"],
            "timestamp": (datetime.now(timezone.utc) - timedelta(minutes=random.randint(1, 120))).isoformat(),
            "resolved": False
        })
    
    # Port down alerts
    offline_devices = [d for d in devices if d["status"] == "offline" and d["type"] in ["OTP", "ODS"]]
    for device in offline_devices[:2]:
        alerts.append({
            "id": str(uuid.uuid4()),
            "type": "port_down",
            "severity": "critical",
            "message": f"Device {device['name']} is offline or all ports full",
            "device_id": device["id"],
            "timestamp": (datetime.now(timezone.utc) - timedelta(minutes=random.randint(1, 90))).isoformat(),
            "resolved": False
        })
    
    return alerts

# Initialize mock data
MOCK_DEVICES = []
MOCK_CLIENTS = []
MOCK_ALERTS = []

@app.on_event("startup")
async def startup_event():
    global MOCK_DEVICES, MOCK_CLIENTS, MOCK_ALERTS
    MOCK_DEVICES = generate_devices()
    MOCK_CLIENTS = generate_clients(MOCK_DEVICES)
    MOCK_ALERTS = generate_alerts(MOCK_CLIENTS, MOCK_DEVICES)
    
    # Start background task for real-time updates
    asyncio.create_task(send_realtime_updates())
    
    logger.info("Mock data initialized")
    logger.info(f"Devices: {len(MOCK_DEVICES)}, Clients: {len(MOCK_CLIENTS)}, Alerts: {len(MOCK_ALERTS)}")

async def send_realtime_updates():
    """Send periodic updates to connected clients"""
    while True:
        await asyncio.sleep(5)  # Update every 5 seconds
        
        if manager.active_connections:
            # Randomly update some client statuses
            if random.random() > 0.7:  # 30% chance
                client = random.choice(MOCK_CLIENTS)
                old_status = client["status"]
                
                # Simulate status changes
                if old_status == "online" and random.random() > 0.9:
                    client["status"] = random.choice(["los", "gasep"])
                elif old_status in ["los", "gasep"] and random.random() > 0.5:
                    client["status"] = "online"
                
                if client["status"] != old_status:
                    client["last_seen"] = datetime.now(timezone.utc).isoformat()
                    
                    # Create alert if status changed to problem
                    if client["status"] == "los":
                        alert = {
                            "id": str(uuid.uuid4()),
                            "type": "los",
                            "severity": "critical",
                            "message": f"Loss of Signal detected for client {client['name']}",
                            "client_id": client["id"],
                            "timestamp": datetime.now(timezone.utc).isoformat(),
                            "resolved": False
                        }
                        MOCK_ALERTS.append(alert)
                        await manager.broadcast({
                            "type": "alert",
                            "data": alert
                        })
                    
                    await manager.broadcast({
                        "type": "client_update",
                        "data": client
                    })

# API Routes
@api_router.get("/")
async def root():
    return {"message": "FTTH Network Management System API"}

@api_router.get("/devices")
async def get_devices(device_type: Optional[str] = None):
    """Get all network devices or filter by type"""
    if device_type:
        filtered = [d for d in MOCK_DEVICES if d["type"].lower() == device_type.lower()]
        return filtered
    return MOCK_DEVICES

@api_router.get("/devices/{device_id}")
async def get_device(device_id: str):
    """Get specific device details"""
    device = next((d for d in MOCK_DEVICES if d["id"] == device_id), None)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    return device

@api_router.get("/clients")
async def get_clients(search: Optional[str] = None, status: Optional[str] = None):
    """Get all clients with optional search and filter"""
    clients = MOCK_CLIENTS
    
    if search:
        search_lower = search.lower()
        clients = [
            c for c in clients
            if search_lower in c["name"].lower() or
               search_lower in c["address"].lower() or
               search_lower in c["ppoe"].lower() or
               search_lower in c["billing_id"].lower()
        ]
    
    if status:
        clients = [c for c in clients if c["status"] == status]
    
    return clients

@api_router.get("/clients/{client_id}")
async def get_client(client_id: str):
    """Get specific client details"""
    client = next((c for c in MOCK_CLIENTS if c["id"] == client_id), None)
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    return client

@api_router.post("/clients/{client_id}/restart")
async def restart_modem(client_id: str):
    """Mock ACS: Restart client modem"""
    client = next((c for c in MOCK_CLIENTS if c["id"] == client_id), None)
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    
    # Simulate restart delay
    await asyncio.sleep(1)
    
    return {
        "success": True,
        "message": f"Restart command sent to modem for {client['name']}",
        "timestamp": datetime.now(timezone.utc).isoformat()
    }

@api_router.post("/clients/{client_id}/wifi")
async def update_wifi(client_id: str, config: WiFiConfig):
    """Mock ACS: Update WiFi settings"""
    client = next((c for c in MOCK_CLIENTS if c["id"] == client_id), None)
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    
    return {
        "success": True,
        "message": f"WiFi settings updated for {client['name']}",
        "ssid": config.ssid,
        "timestamp": datetime.now(timezone.utc).isoformat()
    }

@api_router.get("/clients/{client_id}/devices")
async def get_connected_devices(client_id: str):
    """Mock ACS: Get connected devices"""
    client = next((c for c in MOCK_CLIENTS if c["id"] == client_id), None)
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    
    # Generate mock connected devices
    devices = []
    for i in range(client["connected_devices"]):
        devices.append({
            "id": str(uuid.uuid4()),
            "name": f"Device-{i+1}",
            "type": random.choice(["Smartphone", "Laptop", "Smart TV", "Tablet", "IoT Device"]),
            "connection": random.choice(["WiFi", "Ethernet"]),
            "mac": fake.mac_address(),
            "ip": fake.ipv4_private(),
            "connected_at": (datetime.now(timezone.utc) - timedelta(hours=random.randint(1, 48))).isoformat()
        })
    
    return devices

@api_router.get("/clients/{client_id}/traffic")
async def get_traffic_history(client_id: str, hours: int = 24):
    """Get client traffic history (mock MRTG data)"""
    client = next((c for c in MOCK_CLIENTS if c["id"] == client_id), None)
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    
    # Generate mock traffic data
    traffic = []
    now = datetime.now(timezone.utc)
    
    for i in range(hours * 4):  # 15-minute intervals
        timestamp = now - timedelta(minutes=15 * i)
        download = max(0, client["download_speed"] * random.uniform(0.3, 0.9))
        upload = max(0, client["upload_speed"] * random.uniform(0.2, 0.8))
        
        traffic.append({
            "timestamp": timestamp.isoformat(),
            "download": round(download, 2),
            "upload": round(upload, 2)
        })
    
    return list(reversed(traffic))

@api_router.get("/alerts")
async def get_alerts(resolved: Optional[bool] = None):
    """Get system alerts"""
    alerts = MOCK_ALERTS
    
    if resolved is not None:
        alerts = [a for a in alerts if a["resolved"] == resolved]
    
    return sorted(alerts, key=lambda x: x["timestamp"], reverse=True)

@api_router.post("/alerts/{alert_id}/resolve")
async def resolve_alert(alert_id: str):
    """Mark alert as resolved"""
    alert = next((a for a in MOCK_ALERTS if a["id"] == alert_id), None)
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    
    alert["resolved"] = True
    
    return {
        "success": True,
        "message": "Alert marked as resolved"
    }

@api_router.get("/stats")
async def get_stats():
    """Get network statistics"""
    total_clients = len(MOCK_CLIENTS)
    online_clients = len([c for c in MOCK_CLIENTS if c["status"] == "online"])
    los_clients = len([c for c in MOCK_CLIENTS if c["status"] == "los"])
    offline_clients = len([c for c in MOCK_CLIENTS if c["status"] in ["offline", "isoler"]])
    
    active_alerts = len([a for a in MOCK_ALERTS if not a["resolved"]])
    critical_alerts = len([a for a in MOCK_ALERTS if a["severity"] == "critical" and not a["resolved"]])
    
    total_devices = len(MOCK_DEVICES)
    online_devices = len([d for d in MOCK_DEVICES if d["status"] == "online"])
    
    return {
        "clients": {
            "total": total_clients,
            "online": online_clients,
            "los": los_clients,
            "offline": offline_clients,
            "online_percentage": round((online_clients / total_clients) * 100, 1)
        },
        "devices": {
            "total": total_devices,
            "online": online_devices,
            "offline": total_devices - online_devices
        },
        "alerts": {
            "active": active_alerts,
            "critical": critical_alerts
        }
    }

# WebSocket endpoint
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            # Keep connection alive
            data = await websocket.receive_text()
            # Echo back or handle client messages if needed
    except WebSocketDisconnect:
        manager.disconnect(websocket)

# Include the router in the main app
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
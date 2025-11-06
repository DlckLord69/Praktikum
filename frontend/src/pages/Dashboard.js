import { useState, useEffect, useRef } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import axios from "axios";
import io from "socket.io-client";
import { toast } from "sonner";
import {
  Activity,
  AlertTriangle,
  Wifi,
  WifiOff,
  Radio,
  Search,
  Filter,
  Moon,
  Sun,
  Navigation,
  MapPin,
  Phone,
  RotateCw,
  Users,
  TrendingUp,
  Server,
  Bell,
  X,
  MessageCircle,
  Eye,
  Settings
} from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { ScrollArea } from "../components/ui/scroll-area";
import { Switch } from "../components/ui/switch";
import { Label } from "../components/ui/label";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, Legend } from "recharts";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

// Custom map icons
const createIcon = (color, icon) => {
  return L.divIcon({
    className: 'custom-marker',
    html: `
      <div style="
        background: ${color};
        width: 32px;
        height: 32px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        border: 3px solid rgba(255,255,255,0.9);
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        font-size: 16px;
      ">${icon}</div>
    `,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  });
};

const deviceIcons = {
  OLT: createIcon('#10b981', '🔌'),
  ODF: createIcon('#3b82f6', '📡'),
  OTP: createIcon('#8b5cf6', '🔷'),
  ODS: createIcon('#f59e0b', '🔶'),
  Tiang: createIcon('#6b7280', '📍'),
};

const getClientIcon = (status) => {
  const colors = {
    online: '#10b981',
    los: '#ef4444',
    gasep: '#f59e0b',
    offline: '#6b7280',
    isoler: '#64748b',
  };
  return createIcon(colors[status] || '#6b7280', '👤');
};

function MapController({ center }) {
  const map = useMap();
  useEffect(() => {
    if (center) {
      map.setView([center.lat, center.lng], 15);
    }
  }, [center, map]);
  return null;
}

export default function Dashboard() {
  const [darkMode, setDarkMode] = useState(true);
  const [devices, setDevices] = useState([]);
  const [clients, setClients] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [stats, setStats] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedClient, setSelectedClient] = useState(null);
  const [selectedDevice, setSelectedDevice] = useState(null);
  const [trafficData, setTrafficData] = useState([]);
  const [connectedDevices, setConnectedDevices] = useState([]);
  const [filters, setFilters] = useState({
    OLT: true,
    ODF: true,
    OTP: true,
    ODS: true,
    Tiang: false,
    clients: true,
  });
  const [mapCenter, setMapCenter] = useState(null);
  const [showWiFiDialog, setShowWiFiDialog] = useState(false);
  const [wifiConfig, setWifiConfig] = useState({ ssid: "", password: "" });
  const wsRef = useRef(null);

  useEffect(() => {
    fetchInitialData();
    connectWebSocket();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  const connectWebSocket = () => {
    const ws = new WebSocket(`wss://ftth-command.preview.emergentagent.com/ws`);
    
    ws.onopen = () => {
      console.log('WebSocket connected');
    };

    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      
      if (message.type === 'client_update') {
        setClients(prev => 
          prev.map(c => c.id === message.data.id ? message.data : c)
        );
        toast.info(`Client ${message.data.name} status changed to ${message.data.status}`);
      } else if (message.type === 'alert') {
        setAlerts(prev => [message.data, ...prev]);
        toast.error(message.data.message);
        // Play alert sound
        new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBSuFze7hgh0GMXu+8sp4KwcphMXv3I8/CBeS5fjMdiEDHGam5uO2WRIHRqve7L5lGAU8lNbx1lMT').play();
      }
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    ws.onclose = () => {
      console.log('WebSocket disconnected');
      // Reconnect after 5 seconds
      setTimeout(connectWebSocket, 5000);
    };

    wsRef.current = ws;
  };

  const fetchInitialData = async () => {
    try {
      const [devicesRes, clientsRes, alertsRes, statsRes] = await Promise.all([
        axios.get(`${API}/devices`),
        axios.get(`${API}/clients`),
        axios.get(`${API}/alerts?resolved=false`),
        axios.get(`${API}/stats`),
      ]);

      setDevices(devicesRes.data);
      setClients(clientsRes.data);
      setAlerts(alertsRes.data);
      setStats(statsRes.data);
    } catch (error) {
      console.error('Error fetching data:', error);
      toast.error('Failed to load network data');
    }
  };

  const searchClients = async (query) => {
    setSearchQuery(query);
    if (query.length > 2) {
      try {
        const res = await axios.get(`${API}/clients?search=${query}`);
        setClients(res.data);
      } catch (error) {
        console.error('Search error:', error);
      }
    } else if (query.length === 0) {
      fetchInitialData();
    }
  };

  const viewClientDetails = async (client) => {
    setSelectedClient(client);
    setMapCenter({ lat: client.location.lat, lng: client.location.lng });

    try {
      const [trafficRes, devicesRes] = await Promise.all([
        axios.get(`${API}/clients/${client.id}/traffic?hours=24`),
        axios.get(`${API}/clients/${client.id}/devices`),
      ]);
      setTrafficData(trafficRes.data);
      setConnectedDevices(devicesRes.data);
    } catch (error) {
      console.error('Error fetching client details:', error);
    }
  };

  const restartModem = async (clientId) => {
    try {
      await axios.post(`${API}/clients/${clientId}/restart`);
      toast.success('Modem restart command sent successfully');
    } catch (error) {
      console.error('Restart error:', error);
      toast.error('Failed to restart modem');
    }
  };

  const updateWiFi = async () => {
    if (!selectedClient) return;

    try {
      await axios.post(`${API}/clients/${selectedClient.id}/wifi`, wifiConfig);
      toast.success('WiFi settings updated successfully');
      setShowWiFiDialog(false);
      setWifiConfig({ ssid: "", password: "" });
    } catch (error) {
      console.error('WiFi update error:', error);
      toast.error('Failed to update WiFi settings');
    }
  };

  const resolveAlert = async (alertId) => {
    try {
      await axios.post(`${API}/alerts/${alertId}/resolve`);
      setAlerts(prev => prev.filter(a => a.id !== alertId));
      toast.success('Alert resolved');
    } catch (error) {
      console.error('Error resolving alert:', error);
    }
  };

  const getStatusColor = (status) => {
    const colors = {
      online: 'bg-green-500',
      los: 'bg-red-500',
      gasep: 'bg-yellow-500',
      offline: 'bg-gray-500',
      isoler: 'bg-slate-500',
      warning: 'bg-orange-500',
    };
    return colors[status] || 'bg-gray-500';
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'online':
        return <Wifi className="w-4 h-4" />;
      case 'los':
        return <WifiOff className="w-4 h-4" />;
      case 'gasep':
        return <AlertTriangle className="w-4 h-4" />;
      default:
        return <Radio className="w-4 h-4" />;
    }
  };

  const filteredDevices = devices.filter(d => filters[d.type]);
  const filteredClients = filters.clients ? clients : [];

  return (
    <div className={`min-h-screen ${darkMode ? 'bg-slate-950 text-white' : 'bg-slate-50 text-slate-900'}`}>
      {/* Top Navigation */}
      <nav className="border-b border-slate-800 bg-slate-900/50 backdrop-blur-xl sticky top-0 z-50">
        <div className="px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
                  <Activity className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h1 className="text-xl font-bold" style={{ fontFamily: 'Space Grotesk, sans-serif' }} data-testid="dashboard-title">FTTH Network Management</h1>
                  <p className="text-xs text-slate-400">Real-Time Monitoring Dashboard</p>
                </div>
              </div>
            </div>

            <div className="flex items-center space-x-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-slate-400" />
                <Input
                  data-testid="search-input"
                  placeholder="Search clients (Name, Address, PPoE, Billing ID)..."
                  className="pl-10 w-96 bg-slate-800/50 border-slate-700 text-white"
                  value={searchQuery}
                  onChange={(e) => searchClients(e.target.value)}
                />
              </div>

              <div className="flex items-center space-x-2">
                <Sun className="w-4 h-4 text-slate-400" />
                <Switch
                  data-testid="dark-mode-toggle"
                  checked={darkMode}
                  onCheckedChange={setDarkMode}
                />
                <Moon className="w-4 h-4 text-slate-400" />
              </div>

              <Button variant="outline" size="icon" className="relative" data-testid="alerts-button">
                <Bell className="w-4 h-4" />
                {alerts.length > 0 && (
                  <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full text-xs flex items-center justify-center">
                    {alerts.length}
                  </span>
                )}
              </Button>
            </div>
          </div>
        </div>
      </nav>

      <div className="flex h-[calc(100vh-80px)]">
        {/* Left Sidebar - Stats & Filters */}
        <div className="w-80 border-r border-slate-800 bg-slate-900/30 p-4 overflow-y-auto">
          {/* Stats Cards */}
          {stats && (
            <div className="space-y-3 mb-6">
              <Card className="bg-gradient-to-br from-emerald-500/10 to-teal-500/10 border-emerald-500/20" data-testid="stats-clients-card">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-slate-400">Online Clients</p>
                      <p className="text-2xl font-bold">{stats.clients.online}/{stats.clients.total}</p>
                      <p className="text-xs text-emerald-400">{stats.clients.online_percentage}% uptime</p>
                    </div>
                    <Users className="w-10 h-10 text-emerald-400" />
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-gradient-to-br from-blue-500/10 to-cyan-500/10 border-blue-500/20" data-testid="stats-devices-card">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-slate-400">Network Devices</p>
                      <p className="text-2xl font-bold">{stats.devices.online}/{stats.devices.total}</p>
                    </div>
                    <Server className="w-10 h-10 text-blue-400" />
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-gradient-to-br from-red-500/10 to-orange-500/10 border-red-500/20" data-testid="stats-alerts-card">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-slate-400">Active Alerts</p>
                      <p className="text-2xl font-bold">{stats.alerts.active}</p>
                      <p className="text-xs text-red-400">{stats.alerts.critical} critical</p>
                    </div>
                    <AlertTriangle className="w-10 h-10 text-red-400" />
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Layer Filters */}
          <Card className="bg-slate-800/30 border-slate-700">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center space-x-2">
                <Filter className="w-4 h-4" />
                <span>Map Layers</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {Object.keys(filters).map((key) => (
                <div key={key} className="flex items-center justify-between">
                  <Label htmlFor={key} className="text-sm capitalize">{key}</Label>
                  <Switch
                    id={key}
                    checked={filters[key]}
                    onCheckedChange={(checked) => setFilters({ ...filters, [key]: checked })}
                  />
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Recent Alerts */}
          <Card className="mt-4 bg-slate-800/30 border-slate-700">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center space-x-2">
                <Bell className="w-4 h-4" />
                <span>Recent Alerts</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-64">
                <div className="space-y-2">
                  {alerts.slice(0, 10).map((alert) => (
                    <div key={alert.id} className="p-3 rounded-lg bg-slate-900/50 border border-slate-700" data-testid={`alert-${alert.type}`}>
                      <div className="flex items-start justify-between mb-1">
                        <Badge variant={alert.severity === 'critical' ? 'destructive' : 'warning'} className="text-xs">
                          {alert.severity}
                        </Badge>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-5 w-5"
                          onClick={() => resolveAlert(alert.id)}
                          data-testid={`resolve-alert-${alert.id}`}
                        >
                          <X className="w-3 h-3" />
                        </Button>
                      </div>
                      <p className="text-xs text-slate-300">{alert.message}</p>
                      <p className="text-xs text-slate-500 mt-1">
                        {new Date(alert.timestamp).toLocaleString()}
                      </p>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </div>

        {/* Main Map Area */}
        <div className="flex-1 relative">
          <MapContainer
            center={[-7.2575, 112.7521]}
            zoom={13}
            style={{ height: '100%', width: '100%' }}
            className="z-0"
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            {mapCenter && <MapController center={mapCenter} />}

            {/* Device Markers */}
            {filteredDevices.map((device) => (
              <Marker
                key={device.id}
                position={[device.location.lat, device.location.lng]}
                icon={deviceIcons[device.type]}
                eventHandlers={{
                  click: () => setSelectedDevice(device),
                }}
              >
                <Popup>
                  <div className="p-3" data-testid={`device-popup-${device.type}`}>
                    <h3 className="font-bold text-white mb-2">{device.name}</h3>
                    <div className="space-y-1 text-sm">
                      <p className="text-slate-300">Type: {device.type}</p>
                      <p className="text-slate-300">Status: 
                        <Badge className={`ml-2 ${getStatusColor(device.status)}`}>
                          {device.status}
                        </Badge>
                      </p>
                      {device.port_capacity && (
                        <p className="text-slate-300">
                          Ports: {device.ports_used}/{device.port_capacity}
                        </p>
                      )}
                      <div className="flex space-x-2 mt-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-xs"
                          onClick={() => window.open(`https://www.google.com/maps?q=${device.location.lat},${device.location.lng}`, '_blank')}
                          data-testid="navigate-device-button"
                        >
                          <Navigation className="w-3 h-3 mr-1" />
                          Navigate
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-xs"
                          onClick={() => window.open(`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${device.location.lat},${device.location.lng}`, '_blank')}
                          data-testid="street-view-device-button"
                        >
                          <Eye className="w-3 h-3 mr-1" />
                          Street View
                        </Button>
                      </div>
                    </div>
                  </div>
                </Popup>
              </Marker>
            ))}

            {/* Client Markers */}
            {filteredClients.map((client) => (
              <Marker
                key={client.id}
                position={[client.location.lat, client.location.lng]}
                icon={getClientIcon(client.status)}
                eventHandlers={{
                  click: () => viewClientDetails(client),
                }}
              >
                <Popup>
                  <div className="p-3" data-testid={`client-popup-${client.status}`}>
                    <h3 className="font-bold text-white mb-2">{client.name}</h3>
                    <div className="space-y-1 text-sm">
                      <div className="flex items-center space-x-2">
                        <span className="text-slate-300">Status:</span>
                        <Badge className={`${getStatusColor(client.status)} ${client.status === 'los' ? 'status-los' : ''}`}>
                          {getStatusIcon(client.status)}
                          <span className="ml-1">{client.status.toUpperCase()}</span>
                        </Badge>
                      </div>
                      <p className="text-slate-300">PPoE: {client.ppoe}</p>
                      <p className="text-slate-300">Power: {client.optical_power} dBm</p>
                      <p className="text-slate-300 text-xs">{client.address}</p>
                      <div className="flex space-x-2 mt-2">
                        <Button
                          size="sm"
                          className="text-xs bg-emerald-600 hover:bg-emerald-700"
                          onClick={() => viewClientDetails(client)}
                          data-testid="view-client-details-button"
                        >
                          View Details
                        </Button>
                      </div>
                    </div>
                  </div>
                </Popup>
              </Marker>
            ))}
          </MapContainer>
        </div>

        {/* Right Sidebar - Client Details */}
        {selectedClient && (
          <div className="w-96 border-l border-slate-800 bg-slate-900/30 overflow-y-auto">
            <div className="p-4">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h2 className="text-lg font-bold" data-testid="client-detail-name">{selectedClient.name}</h2>
                  <p className="text-xs text-slate-400">{selectedClient.billing_id}</p>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => setSelectedClient(null)}
                  data-testid="close-client-details-button"
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>

              <Tabs defaultValue="info" className="w-full">
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="info">Info</TabsTrigger>
                  <TabsTrigger value="traffic">Traffic</TabsTrigger>
                  <TabsTrigger value="devices">Devices</TabsTrigger>
                </TabsList>

                <TabsContent value="info" className="space-y-4">
                  <Card className="bg-slate-800/50 border-slate-700">
                    <CardContent className="p-4 space-y-3">
                      <div>
                        <p className="text-xs text-slate-400">Status</p>
                        <Badge className={`${getStatusColor(selectedClient.status)} mt-1`}>
                          {getStatusIcon(selectedClient.status)}
                          <span className="ml-1">{selectedClient.status.toUpperCase()}</span>
                        </Badge>
                      </div>
                      <div>
                        <p className="text-xs text-slate-400">Optical Power (Redaman)</p>
                        <p className="text-lg font-bold" data-testid="client-optical-power">{selectedClient.optical_power} dBm</p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-400">Modem Type</p>
                        <p className="text-sm">{selectedClient.modem_type}</p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-400">Service Profile</p>
                        <p className="text-sm">{selectedClient.download_speed} / {selectedClient.upload_speed} Mbps</p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-400">Activation Date</p>
                        <p className="text-sm">{new Date(selectedClient.activation_date).toLocaleDateString()}</p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-400">PPoE Username</p>
                        <p className="text-sm">{selectedClient.ppoe}</p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-400">Address</p>
                        <p className="text-sm">{selectedClient.address}</p>
                      </div>
                    </CardContent>
                  </Card>

                  <div className="space-y-2">
                    <Button
                      className="w-full bg-blue-600 hover:bg-blue-700"
                      onClick={() => restartModem(selectedClient.id)}
                      data-testid="restart-modem-button"
                    >
                      <RotateCw className="w-4 h-4 mr-2" />
                      Restart Modem
                    </Button>
                    <Button
                      className="w-full bg-purple-600 hover:bg-purple-700"
                      onClick={() => {
                        setWifiConfig({ ssid: "", password: "" });
                        setShowWiFiDialog(true);
                      }}
                      data-testid="change-wifi-button"
                    >
                      <Settings className="w-4 h-4 mr-2" />
                      Change WiFi Settings
                    </Button>
                    <Button
                      className="w-full bg-green-600 hover:bg-green-700"
                      onClick={() => window.open(`https://wa.me/?text=Hello ${selectedClient.name}`, '_blank')}
                      data-testid="whatsapp-button"
                    >
                      <MessageCircle className="w-4 h-4 mr-2" />
                      WhatsApp Client
                    </Button>
                    <Button
                      className="w-full bg-orange-600 hover:bg-orange-700"
                      onClick={() => window.open(`https://www.google.com/maps?q=${selectedClient.location.lat},${selectedClient.location.lng}`, '_blank')}
                      data-testid="navigate-client-button"
                    >
                      <Navigation className="w-4 h-4 mr-2" />
                      Navigate to Address
                    </Button>
                  </div>
                </TabsContent>

                <TabsContent value="traffic">
                  <Card className="bg-slate-800/50 border-slate-700">
                    <CardHeader>
                      <CardTitle className="text-sm">24-Hour Traffic History</CardTitle>
                    </CardHeader>
                    <CardContent>
                      {trafficData.length > 0 && (
                        <ResponsiveContainer width="100%" height={300}>
                          <LineChart data={trafficData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                            <XAxis
                              dataKey="timestamp"
                              stroke="#94a3b8"
                              tick={{ fontSize: 10 }}
                              tickFormatter={(value) => new Date(value).getHours() + ':00'}
                            />
                            <YAxis stroke="#94a3b8" tick={{ fontSize: 10 }} />
                            <RechartsTooltip
                              contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155' }}
                              labelFormatter={(value) => new Date(value).toLocaleString()}
                            />
                            <Legend />
                            <Line type="monotone" dataKey="download" stroke="#10b981" name="Download (Mbps)" />
                            <Line type="monotone" dataKey="upload" stroke="#3b82f6" name="Upload (Mbps)" />
                          </LineChart>
                        </ResponsiveContainer>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="devices">
                  <Card className="bg-slate-800/50 border-slate-700">
                    <CardHeader>
                      <CardTitle className="text-sm">Connected Devices ({connectedDevices.length})</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ScrollArea className="h-96">
                        <div className="space-y-2">
                          {connectedDevices.map((device) => (
                            <div key={device.id} className="p-3 rounded-lg bg-slate-900/50 border border-slate-700" data-testid="connected-device">
                              <div className="flex items-center justify-between mb-1">
                                <p className="text-sm font-medium">{device.name}</p>
                                <Badge variant="outline">{device.connection}</Badge>
                              </div>
                              <p className="text-xs text-slate-400">{device.type}</p>
                              <p className="text-xs text-slate-500">{device.ip}</p>
                              <p className="text-xs text-slate-500">MAC: {device.mac}</p>
                            </div>
                          ))}
                        </div>
                      </ScrollArea>
                    </CardContent>
                  </Card>
                </TabsContent>
              </Tabs>
            </div>
          </div>
        )}
      </div>

      {/* WiFi Config Dialog */}
      <Dialog open={showWiFiDialog} onOpenChange={setShowWiFiDialog}>
        <DialogContent className="bg-slate-900 border-slate-700">
          <DialogHeader>
            <DialogTitle>Change WiFi Settings</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="ssid">WiFi SSID</Label>
              <Input
                id="ssid"
                data-testid="wifi-ssid-input"
                placeholder="Enter new SSID"
                className="bg-slate-800 border-slate-700"
                value={wifiConfig.ssid}
                onChange={(e) => setWifiConfig({ ...wifiConfig, ssid: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="password">WiFi Password</Label>
              <Input
                id="password"
                type="password"
                data-testid="wifi-password-input"
                placeholder="Enter new password"
                className="bg-slate-800 border-slate-700"
                value={wifiConfig.password}
                onChange={(e) => setWifiConfig({ ...wifiConfig, password: e.target.value })}
              />
            </div>
            <Button
              className="w-full bg-purple-600 hover:bg-purple-700"
              onClick={updateWiFi}
              data-testid="save-wifi-button"
            >
              Save Settings
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
import { useState, useEffect } from 'react';
import { Save, RotateCcw, Server, Camera, Info, CheckCircle, Users, Plus, Trash2, Eye, EyeOff, Video } from 'lucide-react';
import { apiFetch } from '../utils/api';

// Load settings from localStorage
const loadSettings = () => {
  try {
    const saved = localStorage.getItem('app-settings');
    return saved ? JSON.parse(saved) : {
      gateControlApi: 'http://localhost:8005',
      cameraConfigs: [],
    };
  } catch {
    return {
      gateControlApi: 'http://localhost:8005',
      cameraConfigs: [],
    };
  }
};

// Save settings to localStorage
const saveSettings = (settings) => {
  localStorage.setItem('app-settings', JSON.stringify(settings));
};

function Settings({ isAdmin = false }) {
  const [settings, setSettings] = useState(loadSettings);
  const [status, setStatus] = useState('');

  // User management state
  const [users, setUsers] = useState([]);
  const [newPhone, setNewPhone] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [userError, setUserError] = useState('');
  const [userLoading, setUserLoading] = useState(false);

  useEffect(() => {
    if (isAdmin) fetchUsers();
  }, [isAdmin]);

  const fetchUsers = async () => {
    try {
      const res = await apiFetch('/api/users');
      const data = await res.json();
      setUsers(Array.isArray(data) ? data : []);
    } catch {}
  };

  const addUser = async (e) => {
    e.preventDefault();
    setUserError('');
    setUserLoading(true);
    try {
      const res = await apiFetch('/api/users', {
        method: 'POST',
        body: JSON.stringify({ phone: newPhone, password: newPassword }),
      });
      const data = await res.json();
      if (data.success) {
        setNewPhone('');
        setNewPassword('');
        fetchUsers();
      } else {
        setUserError(data.message || 'Failed to create user');
      }
    } catch {
      setUserError('Unable to connect to server');
    } finally {
      setUserLoading(false);
    }
  };

  const deleteUser = async (phone) => {
    try {
      await apiFetch(`/api/users/${encodeURIComponent(phone)}`, { method: 'DELETE' });
      fetchUsers();
    } catch {}
  };

  // Camera management state
  const [cameras, setCameras] = useState([]);
  const [newCamName, setNewCamName] = useState('');
  const [newCamUrl, setNewCamUrl] = useState('');
  const [camError, setCamError] = useState('');
  const [camLoading, setCamLoading] = useState(false);

  useEffect(() => {
    if (isAdmin) fetchCameras();
  }, [isAdmin]);

  const fetchCameras = async () => {
    try {
      const res = await apiFetch('/api/cameras');
      const data = await res.json();
      setCameras(Array.isArray(data) ? data : []);
    } catch {}
  };

  const addCamera = async (e) => {
    e.preventDefault();
    setCamError('');
    setCamLoading(true);
    try {
      const res = await apiFetch('/api/cameras', {
        method: 'POST',
        body: JSON.stringify({ name: newCamName, rtspUrl: newCamUrl }),
      });
      const data = await res.json();
      if (data.success) {
        setNewCamName('');
        setNewCamUrl('');
        fetchCameras();
      } else {
        setCamError(data.message || 'Failed to add camera');
      }
    } catch {
      setCamError('Unable to connect to server');
    } finally {
      setCamLoading(false);
    }
  };

  const deleteCamera = async (id) => {
    try {
      await apiFetch(`/api/cameras/${id}`, { method: 'DELETE' });
      fetchCameras();
    } catch {}
  };

  // Save settings whenever they change
  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  const handleApiUrlChange = (e) => {
    setSettings(prev => ({
      ...prev,
      gateControlApi: e.target.value,
    }));
  };

  const handleSave = () => {
    saveSettings(settings);
    setStatus('Settings saved successfully!');
    setTimeout(() => setStatus(''), 3000);
  };

  const handleReset = () => {
    const defaultSettings = {
      gateControlApi: 'http://localhost:8005',
      cameraConfigs: [],
    };
    setSettings(defaultSettings);
    saveSettings(defaultSettings);
    setStatus('Settings reset to defaults!');
    setTimeout(() => setStatus(''), 3000);
  };

  return (
    <div className="flex-1 flex flex-col bg-gray-50 min-h-screen">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-8 py-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
            <p className="text-sm text-gray-500 mt-1">Configure application settings and preferences</p>
          </div>
        </div>
      </div>

      {/* Content Area - Same as GateControl */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {/* Status Message */}
        {status && (
          <div className="flex items-center gap-3 px-4 py-3 bg-green-50 border border-green-200 text-green-800 rounded-lg">
            <CheckCircle className="w-5 h-5 flex-shrink-0" />
            <span className="text-sm font-medium">{status}</span>
          </div>
        )}

        {/* Gate Control API Settings */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
          <div className="px-5 py-3.5 border-b border-gray-200">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-50 rounded-lg">
                <Server className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-gray-900">Gate Control API</h2>
                <p className="text-sm text-gray-500">Configure API endpoint for gate operations</p>
              </div>
            </div>
          </div>

          <div className="p-5 space-y-3">
            <div>
              <label htmlFor="gateControlApi" className="block text-sm font-medium text-gray-700 mb-2">
                API Base URL
              </label>
              <input
                id="gateControlApi"
                type="text"
                value={settings.gateControlApi}
                onChange={handleApiUrlChange}
                placeholder="http://localhost:8005"
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <p className="mt-2 text-xs text-gray-500">
                Example: http://192.168.1.100:8005 or http://localhost:8005
              </p>
            </div>

            <div className="bg-blue-50 rounded-lg p-4 border border-blue-200">
              <div className="flex items-start gap-3">
                <Info className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <h4 className="text-sm font-semibold text-blue-900 mb-2">API Endpoints</h4>
                  <ul className="text-xs text-blue-800 space-y-1.5">
                    <li className="flex items-start gap-2">
                      <span className="font-medium min-w-[80px]">Open Gate:</span>
                      <span className="break-all">GET {settings.gateControlApi}/api/v1/gate/barrel1?control=open</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="font-medium min-w-[80px]">Close Gate:</span>
                      <span className="break-all">GET {settings.gateControlApi}/api/v1/gate/barrel2?control=close</span>
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Camera Configuration */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
          <div className="px-5 py-3.5 border-b border-gray-200">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-purple-50 rounded-lg">
                <Camera className="w-5 h-5 text-purple-600" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-gray-900">Camera Configuration</h2>
                <p className="text-sm text-gray-500">RTSP camera stream settings</p>
              </div>
            </div>
          </div>

          <div className="p-5">
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-700">Configured Cameras</span>
                  <span className="text-2xl font-bold text-blue-600">
                    {JSON.parse(localStorage.getItem('rtsp-cameras') || '[]').length}
                  </span>
                </div>
              </div>
              <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-700">WebSocket Port</span>
                  <span className="text-2xl font-bold text-blue-600">9900</span>
                </div>
              </div>
            </div>

            <div className="bg-yellow-50 rounded-lg p-4 border border-yellow-200">
              <h4 className="text-sm font-semibold text-yellow-900 mb-2">Common RTSP URL Formats</h4>
              <ul className="text-xs text-yellow-800 space-y-1.5">
                <li className="flex items-start gap-2">
                  <span className="font-medium min-w-[80px]">Hikvision:</span>
                  <span>rtsp://user:pass@ip:554/Streaming/Channels/101</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="font-medium min-w-[80px]">Dahua:</span>
                  <span>rtsp://user:pass@ip:554/cam/realmonitor?channel=1</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="font-medium min-w-[80px]">Generic:</span>
                  <span>rtsp://user:pass@ip:554/stream</span>
                </li>
              </ul>
            </div>
          </div>
        </div>

        {/* System Information */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
          <div className="px-5 py-3.5 border-b border-gray-200">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-50 rounded-lg">
                <Info className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-gray-900">System Information</h2>
                <p className="text-sm text-gray-500">Application details and version info</p>
              </div>
            </div>
          </div>

          <div className="p-5">
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                <div className="flex flex-col">
                  <span className="text-xs text-gray-500 mb-1">Application</span>
                  <span className="text-sm font-semibold text-gray-900">Eroxii RTSP Stream</span>
                </div>
              </div>
              <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                <div className="flex flex-col">
                  <span className="text-xs text-gray-500 mb-1">Version</span>
                  <span className="text-sm font-semibold text-gray-900">1.0.0</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Camera Management — admin only */}
        {isAdmin && (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
            <div className="px-5 py-3.5 border-b border-gray-200">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-50 rounded-lg">
                  <Video className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-gray-900">Camera Management</h2>
                  <p className="text-sm text-gray-500">Add or remove RTSP camera streams</p>
                </div>
              </div>
            </div>

            <div className="p-5 space-y-4">
              {cameras.length > 0 ? (
                <ul className="space-y-2">
                  {cameras.map(c => (
                    <li key={c.id} className="flex items-center justify-between gap-2 px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-lg">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-800 truncate">{c.name}</p>
                        <p className="text-xs text-gray-400 truncate">{c.rtspUrl}</p>
                      </div>
                      <button
                        onClick={() => deleteCamera(c.id)}
                        className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors flex-shrink-0"
                        title="Remove camera"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-gray-400 text-center py-2">No cameras added yet</p>
              )}

              <form onSubmit={addCamera} className="space-y-3 pt-2 border-t border-gray-100">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Add Camera</p>
                <input
                  type="text"
                  value={newCamName}
                  onChange={e => setNewCamName(e.target.value)}
                  placeholder="Camera name (e.g. Front Door)"
                  required
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <input
                  type="text"
                  value={newCamUrl}
                  onChange={e => setNewCamUrl(e.target.value)}
                  placeholder="rtsp://user:pass@192.168.1.x:554/stream"
                  required
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                {camError && <p className="text-sm text-red-600">{camError}</p>}
                <button
                  type="submit"
                  disabled={camLoading}
                  className="flex items-center gap-2 px-4 py-2.5 bg-blue-500 text-white text-sm font-medium rounded-lg hover:bg-blue-600 disabled:opacity-50 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  {camLoading ? 'Adding…' : 'Add Camera'}
                </button>
              </form>
            </div>
          </div>
        )}

        {/* User Management — admin only */}
        {isAdmin && (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
            <div className="px-5 py-3.5 border-b border-gray-200">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-indigo-50 rounded-lg">
                  <Users className="w-5 h-5 text-indigo-600" />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-gray-900">User Management</h2>
                  <p className="text-sm text-gray-500">Add or remove viewer accounts</p>
                </div>
              </div>
            </div>

            <div className="p-5 space-y-4">
              {/* Existing users */}
              {users.length > 0 ? (
                <ul className="space-y-2">
                  {users.map(u => (
                    <li key={u.phone} className="flex items-center justify-between px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-lg">
                      <span className="text-sm font-medium text-gray-800">{u.phone}</span>
                      <button
                        onClick={() => deleteUser(u.phone)}
                        className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                        title="Remove user"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-gray-400 text-center py-2">No additional users yet</p>
              )}

              {/* Add user form */}
              <form onSubmit={addUser} className="space-y-3 pt-2 border-t border-gray-100">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Add User</p>
                <div>
                  <input
                    type="tel"
                    value={newPhone}
                    onChange={e => setNewPhone(e.target.value)}
                    placeholder="Phone number"
                    required
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <div className="relative">
                  <input
                    type={showNewPassword ? 'text' : 'password'}
                    value={newPassword}
                    onChange={e => setNewPassword(e.target.value)}
                    placeholder="Password"
                    required
                    className="w-full px-4 py-2.5 pr-10 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => setShowNewPassword(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {userError && (
                  <p className="text-sm text-red-600">{userError}</p>
                )}
                <button
                  type="submit"
                  disabled={userLoading}
                  className="flex items-center gap-2 px-4 py-2.5 bg-indigo-500 text-white text-sm font-medium rounded-lg hover:bg-indigo-600 disabled:opacity-50 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  {userLoading ? 'Adding…' : 'Add User'}
                </button>
              </form>
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex gap-3 pb-2">
          <button
            onClick={handleSave}
            className="flex items-center justify-center gap-2 px-6 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors font-medium shadow-sm"
          >
            <Save className="w-5 h-5" />
            <span>Save Settings</span>
          </button>
          <button
            onClick={handleReset}
            className="flex items-center justify-center gap-2 px-6 py-3 bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition-colors font-medium shadow-sm"
          >
            <RotateCcw className="w-5 h-5" />
            <span>Reset to Defaults</span>
          </button>
        </div>
      </div>
    </div>
  );
}

export default Settings;

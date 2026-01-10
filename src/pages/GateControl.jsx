import { useState } from 'react';
import { Unlock, Lock, Terminal, Trash2, AlertCircle, CheckCircle2, Info } from 'lucide-react';

function GateControl() {
  const [selectedGate, setSelectedGate] = useState('barrel1');
  const [gateStatus, setGateStatus] = useState({
    barrel1: { state: 'UNKNOWN', lastUpdate: null },
    barrel2: { state: 'UNKNOWN', lastUpdate: null },
  });
  const [consoleOutput, setConsoleOutput] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [apiUrl, setApiUrl] = useState('http://localhost:8005');

  const gates = [
    { id: 'barrel1', name: 'Barrel 1' },
    { id: 'barrel2', name: 'Barrel 2' },
  ];

  const addConsoleMessage = (message, type = 'info') => {
    const timestamp = new Date().toLocaleString();
    setConsoleOutput(prev => [
      ...prev,
      { timestamp, message, type }
    ]);
  };

  const controlGate = async (operation) => {
    setIsLoading(true);
    const gateId = selectedGate;
    const url = `${apiUrl}/api/v1/gate/${gateId}?control=${operation}`;

    addConsoleMessage(`Sending ${operation} command to ${gateId}...`, 'info');

    try {
      const response = await fetch(url, {
        method: 'GET',
        signal: AbortSignal.timeout(3000),
      });

      if (response.ok) {
        const data = await response.json();

        // Update gate status
        const newState = data.state === true ? 'OPEN' : 'CLOSED';
        setGateStatus(prev => ({
          ...prev,
          [gateId]: {
            state: newState,
            lastUpdate: new Date().toLocaleString(),
          }
        }));

        addConsoleMessage(
          `${gateId} ${operation} command successful - State: ${newState}`,
          'success'
        );
      } else {
        addConsoleMessage(
          `HTTP ${response.status}: ${response.statusText}`,
          'error'
        );

        // Simulate operation for 404 (demonstration mode)
        if (response.status === 404) {
          const simulatedState = operation === 'open' ? 'OPEN' : 'CLOSED';
          setGateStatus(prev => ({
            ...prev,
            [gateId]: {
              state: simulatedState,
              lastUpdate: new Date().toLocaleString(),
            }
          }));
          addConsoleMessage(
            'Endpoint not found, simulating operation',
            'info'
          );
        }
      }
    } catch (error) {
      if (error.name === 'TimeoutError') {
        addConsoleMessage(
          'Connection timeout after 3.0 seconds. Check server connection and try again.',
          'error'
        );
      } else {
        addConsoleMessage(
          `Connection error: ${error.message}`,
          'error'
        );
      }
    } finally {
      setIsLoading(false);
    }
  };

  const clearConsole = () => {
    setConsoleOutput([]);
  };

  return (
    <div className="flex-1 flex flex-col bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-8 py-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Gate Control System</h1>
            <p className="text-sm text-gray-500 mt-1">Remote control for physical barrier gates</p>
          </div>
        </div>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden p-6">
        {/* Gate Status Cards */}
        <div className="grid grid-cols-2 gap-4 mb-4 flex-shrink-0">
          {gates.map((gate) => {
            const status = gateStatus[gate.id];
            const isOpen = status.state === 'OPEN';
            const isClosed = status.state === 'CLOSED';
            const isUnknown = status.state === 'UNKNOWN';

            return (
              <div key={gate.id} className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="text-base font-semibold text-gray-900">{gate.name}</h3>
                    {status.lastUpdate && (
                      <p className="text-xs text-gray-500 mt-1">
                        Updated {status.lastUpdate}
                      </p>
                    )}
                  </div>
                  <div className={`p-2.5 rounded-lg ${
                    isOpen ? 'bg-green-50' :
                    isClosed ? 'bg-red-50' :
                    'bg-gray-50'
                  }`}>
                    {isOpen ? (
                      <Unlock className="w-5 h-5 text-green-600" />
                    ) : isClosed ? (
                      <Lock className="w-5 h-5 text-red-600" />
                    ) : (
                      <AlertCircle className="w-5 h-5 text-gray-400" />
                    )}
                  </div>
                </div>
                <div className={`inline-flex items-center px-3 py-1.5 rounded-lg text-sm font-medium ${
                  isOpen ? 'bg-green-100 text-green-700' :
                  isClosed ? 'bg-red-100 text-red-700' :
                  'bg-gray-100 text-gray-700'
                }`}>
                  {status.state}
                </div>
              </div>
            );
          })}
        </div>

        {/* Control Panel */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm mb-4 flex-shrink-0">
          <h2 className="text-base font-semibold text-gray-900 mb-4">Control Panel</h2>

          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                API Base URL
              </label>
              <input
                type="text"
                value={apiUrl}
                onChange={(e) => setApiUrl(e.target.value)}
                placeholder="http://localhost:8005"
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Select Gate
              </label>
              <select
                value={selectedGate}
                onChange={(e) => setSelectedGate(e.target.value)}
                disabled={isLoading}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed bg-white"
              >
                {gates.map((gate) => (
                  <option key={gate.id} value={gate.id}>
                    {gate.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-1">
              <button
                onClick={() => controlGate('open')}
                disabled={isLoading}
                className="flex items-center justify-center gap-2 px-6 py-3 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium shadow-sm"
              >
                {isLoading ? (
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Unlock className="w-5 h-5" />
                )}
                <span>Open Gate</span>
              </button>
              <button
                onClick={() => controlGate('close')}
                disabled={isLoading}
                className="flex items-center justify-center gap-2 px-6 py-3 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium shadow-sm"
              >
                {isLoading ? (
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Lock className="w-5 h-5" />
                )}
                <span>Close Gate</span>
              </button>
            </div>
          </div>
        </div>

        {/* Console Output - Flex to fill remaining space */}
        <div className="flex-1 bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm flex flex-col min-h-0">
          <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 flex-shrink-0">
            <div className="flex items-center gap-2">
              <Terminal className="w-5 h-5 text-gray-600" />
              <h2 className="text-base font-semibold text-gray-900">Console Output</h2>
            </div>
            <button
              onClick={clearConsole}
              className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-50 rounded-lg transition-colors"
            >
              <Trash2 className="w-4 h-4" />
              <span>Clear</span>
            </button>
          </div>

          <div className="flex-1 bg-gray-900 p-5 font-mono text-sm overflow-y-auto min-h-0">
            {consoleOutput.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-gray-500">
                <Terminal className="w-12 h-12 mb-3 opacity-50" />
                <p className="text-sm">No operations yet. Select a gate and perform an action.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {consoleOutput.map((log, index) => (
                  <div key={index} className="flex gap-3">
                    <span className="text-gray-500 text-xs whitespace-nowrap flex-shrink-0">
                      [{log.timestamp}]
                    </span>
                    <div className="flex items-start gap-2 flex-1">
                      {log.type === 'success' && (
                        <CheckCircle2 className="w-4 h-4 text-green-400 flex-shrink-0 mt-0.5" />
                      )}
                      {log.type === 'error' && (
                        <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                      )}
                      {log.type === 'info' && (
                        <Info className="w-4 h-4 text-blue-400 flex-shrink-0 mt-0.5" />
                      )}
                      <span className={`${
                        log.type === 'success' ? 'text-green-400' :
                        log.type === 'error' ? 'text-red-400' :
                        'text-gray-300'
                      }`}>
                        {log.message}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default GateControl;

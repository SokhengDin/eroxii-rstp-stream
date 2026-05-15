import { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import CameraDisplay from './pages/CameraDisplay';
import GateControl from './pages/GateControl';
import Settings from './pages/Settings';
import LoginPage from './pages/LoginPage';

function App() {
  const [authed, setAuthed] = useState(() => !!localStorage.getItem('auth-token'));

  const [currentPage, setCurrentPage] = useState(() => {
    try {
      return localStorage.getItem('app-current-page') || 'cameras';
    } catch {
      return 'cameras';
    }
  });

  useEffect(() => {
    localStorage.setItem('app-current-page', currentPage);
  }, [currentPage]);

  const handleLogout = () => {
    localStorage.removeItem('auth-token');
    setAuthed(false);
  };

  if (!authed) {
    return <LoginPage onLoginSuccess={() => setAuthed(true)} />;
  }

  const renderPage = () => {
    switch (currentPage) {
      case 'cameras':
        return <CameraDisplay />;
      case 'gate':
        return <GateControl />;
      case 'settings':
        return <Settings />;
      default:
        return <CameraDisplay />;
    }
  };

  return (
    <div className="flex w-screen h-screen overflow-hidden">
      <Sidebar currentPage={currentPage} onPageChange={setCurrentPage} onLogout={handleLogout} />
      <main className="flex-1 flex flex-col overflow-hidden bg-gray-50">
        {renderPage()}
      </main>
    </div>
  );
}

export default App;

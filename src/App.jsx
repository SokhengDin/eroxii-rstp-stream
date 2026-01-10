import { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import CameraDisplay from './pages/CameraDisplay';
import GateControl from './pages/GateControl';
import Settings from './pages/Settings';

function App() {
  // Load current page from localStorage, default to 'cameras'
  const [currentPage, setCurrentPage] = useState(() => {
    try {
      return localStorage.getItem('app-current-page') || 'cameras';
    } catch {
      return 'cameras';
    }
  });

  // Save current page to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem('app-current-page', currentPage);
  }, [currentPage]);

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
      <Sidebar currentPage={currentPage} onPageChange={setCurrentPage} />
      <main className="flex-1 flex flex-col overflow-hidden bg-gray-50">
        {renderPage()}
      </main>
    </div>
  );
}

export default App;

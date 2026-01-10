import { useState, useEffect } from 'react';
import { Video, DoorOpen, Settings, ChevronLeft, ChevronRight } from 'lucide-react';

const Sidebar = ({ currentPage, onPageChange }) => {
  // Load sidebar state from localStorage, default to true (expanded)
  const [isExpanded, setIsExpanded] = useState(() => {
    try {
      const saved = localStorage.getItem('sidebar-expanded');
      return saved !== null ? JSON.parse(saved) : true;
    } catch {
      return true;
    }
  });

  // Save sidebar state to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem('sidebar-expanded', JSON.stringify(isExpanded));
  }, [isExpanded]);

  const menuItems = [
    { id: 'cameras', label: 'Camera Display', icon: Video },
    { id: 'gate', label: 'Gate Control', icon: DoorOpen },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  return (
    <div className={`bg-white border-r border-gray-200 h-screen flex flex-col transition-all duration-300 ${isExpanded ? 'w-64' : 'w-20'}`}>
      {/* Logo Section */}
      <div className="p-6 flex items-center gap-3 border-b border-gray-200">
        <div className="w-10 h-10 rounded-xl bg-blue-500 flex items-center justify-center flex-shrink-0 shadow-sm">
          <img src="/images/logo.png" alt="eRoxii" className="w-7 h-7 object-contain" />
        </div>
        {isExpanded && (
          <div className="flex flex-col">
            <span className="font-bold text-gray-900 text-base">eRoxii</span>
            <span className="text-xs text-gray-500">Camera System</span>
          </div>
        )}
      </div>

      {/* Navigation Items */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {menuItems.map((item) => {
          const Icon = item.icon;
          const isActive = currentPage === item.id;

          return (
            <button
              key={item.id}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 ${
                isActive
                  ? 'bg-blue-50 text-blue-600 shadow-sm'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              }`}
              onClick={() => onPageChange(item.id)}
              title={!isExpanded ? item.label : ''}
            >
              <Icon className={`w-5 h-5 flex-shrink-0 ${isActive ? 'text-blue-600' : ''}`} />
              {isExpanded && (
                <span className="font-medium text-sm">{item.label}</span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Toggle Button */}
      <div className="p-3 border-t border-gray-200">
        <button
          className="w-full flex items-center justify-center p-3 rounded-xl text-gray-600 hover:bg-gray-50 transition-all duration-200"
          onClick={() => setIsExpanded(!isExpanded)}
          title={isExpanded ? 'Collapse sidebar' : 'Expand sidebar'}
        >
          {isExpanded ? (
            <ChevronLeft className="w-5 h-5" />
          ) : (
            <ChevronRight className="w-5 h-5" />
          )}
        </button>
      </div>
    </div>
  );
};

export default Sidebar;

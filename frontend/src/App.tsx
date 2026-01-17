import { useState, useEffect } from 'react';
import { Routes, Route, NavLink } from 'react-router-dom';
import { FilePlus, FileText, Files, GitCompare, Home, Users } from 'lucide-react';
import Claims from './pages/Claims';
import DraftClaims from './pages/DraftClaims';
import Documents from './pages/Documents';
import Matches from './pages/Matches';
import Patients from './pages/Patients';
import { cn } from './lib/utils';
import { api, type Stats } from './lib/api';

function NavItem({ to, icon: Icon, children }: { to: string; icon: React.ElementType; children: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-3 px-4 py-3 font-medium transition-colors',
          'border-l-4',
          isActive
            ? 'bg-bauhaus-blue text-white border-bauhaus-yellow'
            : 'text-bauhaus-gray hover:bg-bauhaus-lightgray border-transparent'
        )
      }
    >
      <Icon size={20} />
      {children}
    </NavLink>
  );
}

export default function App() {
  return (
    <div className="min-h-screen flex">
      {/* Sidebar */}
      <aside className="w-64 bg-white border-r-2 border-bauhaus-black flex flex-col">
        {/* Logo */}
        <div className="p-6 border-b-2 border-bauhaus-black">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-bauhaus-red rounded-full" />
            <div>
              <h1 className="font-bold text-lg leading-tight">Cigna Envoy</h1>
              <p className="text-xs text-bauhaus-gray">Claims Tracker</p>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-4">
          <NavItem to="/" icon={Home}>Dashboard</NavItem>
          <NavItem to="/claims" icon={FileText}>Claims</NavItem>
          <NavItem to="/draft-claims" icon={FilePlus}>Draft Claims</NavItem>
          <NavItem to="/documents" icon={Files}>Documents</NavItem>
          <NavItem to="/patients" icon={Users}>Patients</NavItem>
          <NavItem to="/matches" icon={GitCompare}>Match Review</NavItem>
        </nav>

        {/* Footer */}
        <div className="p-4 border-t-2 border-bauhaus-black">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-bauhaus-yellow rounded-full" />
            <div className="w-3 h-3 bg-bauhaus-red rounded-full" />
            <div className="w-3 h-3 bg-bauhaus-blue rounded-full" />
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 bg-bauhaus-lightgray/30">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/claims" element={<Claims />} />
          <Route path="/draft-claims" element={<DraftClaims />} />
          <Route path="/documents" element={<Documents />} />
          <Route path="/patients" element={<Patients />} />
          <Route path="/matches" element={<Matches />} />
        </Routes>
      </main>
    </div>
  );
}

function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadStats();
  }, []);

  async function loadStats() {
    try {
      const data = await api.getStats();
      setStats(data);
      setError(null);
    } catch (err) {
      setError('Failed to connect to API server. Is it running on port 3001?');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function handleProcessDocuments() {
    setProcessing('documents');
    try {
      const result = await api.processDocuments();
      alert(`Processed ${result.processed} documents`);
      loadStats();
    } catch (err) {
      alert(`Error: ${err}`);
    } finally {
      setProcessing(null);
    }
  }

  async function handleRunMatching() {
    setProcessing('matching');
    try {
      const result = await api.runMatching();
      alert(`Created ${result.created} match candidates`);
      loadStats();
    } catch (err) {
      alert(`Error: ${err}`);
    } finally {
      setProcessing(null);
    }
  }

  async function handleProcessCalendar() {
    setProcessing('calendar');
    try {
      const result = await api.processCalendar();
      alert(`Found ${result.processed} calendar events with medical appointments`);
      loadStats();
    } catch (err) {
      alert(`Error: ${err}`);
    } finally {
      setProcessing(null);
    }
  }

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-8 bauhaus-accent">Dashboard</h1>

      {error && (
        <div className="mb-6 p-4 bg-bauhaus-red/10 border-2 border-bauhaus-red text-bauhaus-red">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <StatCard
          title="Claims"
          value={loading ? '...' : String(stats?.claims ?? 0)}
          subtitle="Imported from Cigna"
          color="blue"
        />
        <StatCard
          title="Documents"
          value={loading ? '...' : String(stats?.documents ?? 0)}
          subtitle="Medical documents"
          color="yellow"
        />
        <StatCard
          title="Pending Review"
          value={loading ? '...' : String(stats?.assignments.candidates ?? 0)}
          subtitle="Match candidates"
          color="red"
        />
      </div>

      <div className="bg-white border-2 border-bauhaus-black p-6">
        <h2 className="text-xl font-bold mb-4">Quick Actions</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <ActionButton
            onClick={handleProcessDocuments}
            disabled={processing !== null}
          >
            {processing === 'documents' ? 'Processing...' : 'Process Email Attachments'}
          </ActionButton>
          <ActionButton
            onClick={handleProcessCalendar}
            disabled={processing !== null}
          >
            {processing === 'calendar' ? 'Searching...' : 'Search Calendar Events'}
          </ActionButton>
          <ActionButton
            onClick={handleRunMatching}
            disabled={processing !== null}
          >
            {processing === 'matching' ? 'Matching...' : 'Run Auto-Matching'}
          </ActionButton>
        </div>
      </div>
    </div>
  );
}

function StatCard({ title, value, subtitle, color }: {
  title: string;
  value: string;
  subtitle: string;
  color: 'blue' | 'yellow' | 'red';
}) {
  const colors = {
    blue: 'bg-bauhaus-blue',
    yellow: 'bg-bauhaus-yellow',
    red: 'bg-bauhaus-red',
  };

  return (
    <div className="bauhaus-card">
      <div className={cn('w-4 h-4 rounded-full mb-4', colors[color])} />
      <p className="text-sm text-bauhaus-gray uppercase tracking-wide">{title}</p>
      <p className="text-4xl font-bold my-2">{value}</p>
      <p className="text-sm text-bauhaus-gray">{subtitle}</p>
    </div>
  );
}

function ActionButton({
  children,
  onClick,
  disabled
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "px-4 py-3 bg-bauhaus-black text-white font-medium transition-colors text-left",
        disabled ? "opacity-50 cursor-not-allowed" : "hover:bg-bauhaus-gray"
      )}
    >
      {children}
    </button>
  );
}

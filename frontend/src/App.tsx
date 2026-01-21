import { useState, useEffect } from 'react';
import { Routes, Route, NavLink, useLocation } from 'react-router-dom';
import { FilePlus, FileText, Files, GitCompare, Home, Users, Shield, Archive, ChevronDown, ChevronRight, Heart } from 'lucide-react';
import Claims from './pages/Claims';
import DraftClaims from './pages/DraftClaims';
import Documents from './pages/Documents';
import Matches from './pages/Matches';
import Patients from './pages/Patients';
import Admin from './pages/Admin';
import ArchivedDocuments from './pages/archive/Documents';
import ArchivedClaims from './pages/archive/Claims';
import ArchivedDraftClaims from './pages/archive/DraftClaims';
import ArchivedPatients from './pages/archive/Patients';
import ArchivedIllnesses from './pages/archive/Illnesses';
import { cn } from './lib/utils';
import { api, type Stats } from './lib/api';

function NavItem({ to, icon: Icon, children, indent = false }: { to: string; icon: React.ElementType; children: React.ReactNode; indent?: boolean }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-3 py-3 font-medium transition-colors',
          'border-l-4',
          indent ? 'px-8' : 'px-4',
          isActive
            ? 'bg-bauhaus-blue text-white border-bauhaus-yellow'
            : 'text-bauhaus-gray hover:bg-bauhaus-lightgray border-transparent'
        )
      }
    >
      <Icon size={indent ? 16 : 20} />
      {children}
    </NavLink>
  );
}

function NavSection({
  icon: Icon,
  label,
  children,
  basePath
}: {
  icon: React.ElementType;
  label: string;
  children: React.ReactNode;
  basePath: string;
}) {
  const location = useLocation();
  const isChildActive = location.pathname.startsWith(basePath);
  const [isOpen, setIsOpen] = useState(isChildActive);

  // Auto-expand when navigating to child route
  useEffect(() => {
    if (isChildActive && !isOpen) {
      setIsOpen(true);
    }
  }, [isChildActive, isOpen]);

  return (
    <div>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          'w-full flex items-center gap-3 px-4 py-3 font-medium transition-colors',
          'border-l-4',
          isChildActive
            ? 'bg-bauhaus-blue/20 text-bauhaus-black border-bauhaus-yellow'
            : 'text-bauhaus-gray hover:bg-bauhaus-lightgray border-transparent'
        )}
      >
        <Icon size={20} />
        <span className="flex-1 text-left">{label}</span>
        {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
      </button>
      {isOpen && (
        <div className="bg-bauhaus-lightgray/50">
          {children}
        </div>
      )}
    </div>
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
        <nav className="flex-1 py-4 overflow-y-auto">
          <NavItem to="/" icon={Home}>Dashboard</NavItem>
          <NavItem to="/claims" icon={FileText}>Claims</NavItem>
          <NavItem to="/draft-claims" icon={FilePlus}>Draft Claims</NavItem>
          <NavItem to="/documents" icon={Files}>Documents</NavItem>
          <NavItem to="/patients" icon={Users}>Patients</NavItem>
          <NavItem to="/matches" icon={GitCompare}>Match Review</NavItem>
          <NavItem to="/admin" icon={Shield}>Admin</NavItem>

          <NavSection icon={Archive} label="Archive" basePath="/archive">
            <NavItem to="/archive/documents" icon={Files} indent>Documents</NavItem>
            <NavItem to="/archive/claims" icon={FileText} indent>Claims</NavItem>
            <NavItem to="/archive/draft-claims" icon={FilePlus} indent>Draft Claims</NavItem>
            <NavItem to="/archive/patients" icon={Users} indent>Patients</NavItem>
            <NavItem to="/archive/illnesses" icon={Heart} indent>Illnesses</NavItem>
          </NavSection>
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
          <Route path="/admin" element={<Admin />} />
          {/* Archive routes */}
          <Route path="/archive/documents" element={<ArchivedDocuments />} />
          <Route path="/archive/claims" element={<ArchivedClaims />} />
          <Route path="/archive/draft-claims" element={<ArchivedDraftClaims />} />
          <Route path="/archive/patients" element={<ArchivedPatients />} />
          <Route path="/archive/illnesses" element={<ArchivedIllnesses />} />
        </Routes>
      </main>
    </div>
  );
}

function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
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


import { Outlet, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { NavLink } from '@/components/NavLink';
import { Shield, User, LogOut, ChevronDown, LayoutDashboard } from 'lucide-react';
import { VideoStreamOverlay } from '@/components/VideoStreamOverlay';
import { VideoStreamProvider } from '@/contexts/VideoStreamContext';
import DispatcherDashboard from './DispatcherDashboard';

export default function DispatcherLayout() {
  const { isAuthenticated, user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const isOverlayRoute = location.pathname.startsWith('/dispatcher/') && location.pathname !== '/dispatcher';

  if (!isAuthenticated) return <Navigate to="/login" replace />;

  return (
    <VideoStreamProvider>
      <div className="h-screen flex flex-col overflow-hidden bg-background">
        <VideoStreamOverlay />
        <header className="h-16 bg-primary text-primary-foreground flex items-center justify-between px-6 shadow-md shrink-0">
          <NavLink to="/dispatcher" end className="flex items-center gap-3 hover:opacity-90 transition-opacity">
            <Shield className="h-7 w-7" />
            <div className="flex flex-col leading-tight">
              <span className="font-semibold text-xs uppercase tracking-[0.2em] opacity-80">
                Dispatch Center
              </span>
              <span className="font-bold text-base tracking-wide">
                Incident Management
              </span>
            </div>
          </NavLink>

          <div className="flex items-center gap-3">
            <NavLink
              to="/dispatcher/overview"
              className="h-9 inline-flex items-center gap-2 rounded-full border border-white/20 px-3 text-xs font-semibold text-primary-foreground hover:bg-white/15 transition-colors"
              activeClassName="bg-white/20 border-white/30"
            >
              <LayoutDashboard className="h-3.5 w-3.5" />
              Overview
            </NavLink>
            <div className="flex items-center gap-3 text-[11px]">
              <div className="hidden sm:flex items-center gap-1 px-2 py-1 rounded-full bg-black/10 border border-white/10">
                <span className="h-2 w-2 rounded-full bg-emerald-400 mr-1" />
                <span className="font-medium uppercase tracking-wide">Available</span>
              </div>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-9 text-primary-foreground hover:bg-white/15 gap-2 text-xs rounded-full border border-white/10 px-3">
                  <User className="h-3.5 w-3.5" />
                  {user?.name}
                  <ChevronDown className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={logout} className="gap-2">
                  <LogOut className="h-3.5 w-3.5" /> Sign Out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <main className="flex-1 overflow-hidden relative">
          <DispatcherDashboard
            routePanel={
              isOverlayRoute
                ? {
                    title: location.pathname.replace('/dispatcher/', '').toUpperCase(),
                    onBack: () => navigate('/dispatcher'),
                    content: <Outlet />,
                  }
                : null
            }
          />
        </main>
      </div>
    </VideoStreamProvider>
  );
}

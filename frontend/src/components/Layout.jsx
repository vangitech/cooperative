import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { cn } from '@/lib/utils';
import { initials } from '@/lib/format';
import {
  LayoutDashboard, Wallet, PiggyBank, HandCoins, TrendingUp,
  User, LogOut, Users, ShieldCheck, Receipt
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import NotificationsBell from '@/components/NotificationsBell';

const memberNav = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/wallet', label: 'Wallet', icon: Wallet },
  { to: '/savings', label: 'Savings', icon: PiggyBank },
  { to: '/loans', label: 'Loans', icon: HandCoins },
  { to: '/dividends', label: 'Dividends', icon: TrendingUp },
  { to: '/profile', label: 'Profile', icon: User },
];

const adminNav = [
  { to: '/admin', label: 'Overview', icon: LayoutDashboard },
  { to: '/admin/members', label: 'Members', icon: Users },
  { to: '/admin/loans', label: 'Loans', icon: HandCoins },
  { to: '/admin/dividends', label: 'Dividends', icon: TrendingUp },
  { to: '/admin/transactions', label: 'Transactions', icon: Receipt },
  { to: '/dashboard', label: 'Member View', icon: ShieldCheck },
];

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const nav = user?.role === 'admin' ? adminNav : memberNav;

  const handleLogout = () => { logout(); navigate('/login'); };

  return (
    <div className="min-h-screen flex bg-muted/30">
      {/* Sidebar */}
      <aside className="hidden md:flex w-64 flex-col border-r bg-background">
        <div className="h-16 flex items-center gap-2 px-5 border-b">
          <div className="h-8 w-8 rounded-lg bg-primary text-primary-foreground grid place-items-center font-bold">
            M
          </div>
          <div>
            <p className="font-semibold leading-tight">MPCS</p>
            <p className="text-xs text-muted-foreground">Cooperative Society</p>
          </div>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {nav.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to} to={to} end
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors',
                  isActive ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                )
              }
            >
              <Icon className="h-4 w-4" />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="p-3 border-t">
          <div className="flex items-center gap-3 px-2 py-2">
            <div className="h-9 w-9 rounded-full bg-primary/10 text-primary grid place-items-center font-semibold text-sm">
              {initials(user?.first_name, user?.last_name)}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{user?.first_name} {user?.last_name}</p>
              <p className="text-xs text-muted-foreground truncate capitalize">{user?.role}</p>
            </div>
          </div>
          <Button variant="ghost" className="w-full justify-start mt-1" onClick={handleLogout}>
            <LogOut className="h-4 w-4" /> Log out
          </Button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 border-b bg-background flex items-center px-4 md:px-6 justify-between">
          <h1 className="font-semibold capitalize">
            {user?.role === 'admin' ? 'Admin Panel' : 'Member Portal'}
          </h1>
          <div className="flex items-center gap-1">
            <span className="text-sm text-muted-foreground hidden sm:block mr-2">
              Welcome back, {user?.first_name}
            </span>
            <NotificationsBell />
          </div>
        </header>

        <main className="flex-1 p-4 md:p-6 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
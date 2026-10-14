/* global __APP_COMMIT__ */
import { useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { cn } from '@/lib/utils';
import { initials } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import AdminActivityBell from '@/components/AdminActivityBell';
import ChatWidget from '@/components/ChatWidget';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { Breadcrumb } from '@/components/ui/breadcrumb';
import { TooltipProvider } from '@/components/ui/tooltip';
import ThemeToggle from '@/components/ThemeToggle';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  LayoutDashboard, Users, HandCoins, TrendingUp, Receipt,
  Menu, LogOut, User as UserIcon, Shield, Home, Search, ScrollText, Store, Megaphone,
  PanelLeftClose, PanelLeftOpen, FileText, Building2, Scale, ShieldCheck, Crown, IdCard,
} from 'lucide-react';

const ALL_STAFF = ['super_admin', 'admin', 'officer', 'accountant', 'grantor'];

// Build stamp, baked at build time (Vercel commit SHA or local git HEAD).
// Lets anyone confirm which deployed version they are looking at.
const BUILD = typeof __APP_COMMIT__ !== 'undefined' ? __APP_COMMIT__ : 'dev';

const adminNav = [
  { to: '/admin',             label: 'Overview',     icon: LayoutDashboard, exact: true, roles: [...ALL_STAFF] },
  { to: '/admin/members',     label: 'Members',      icon: Users, roles: ['super_admin', 'admin', 'officer', 'accountant'] },
  { to: '/admin/kyc',         label: 'KYC',          icon: IdCard, roles: ['super_admin', 'admin', 'officer'] },
  { to: '/admin/staff',       label: 'Staff',        icon: Crown, roles: ['super_admin'] },
  { to: '/admin/organisations', label: 'Organisations', icon: Building2, roles: ['super_admin', 'admin', 'officer', 'accountant'] },
  { to: '/admin/loans',       label: 'Loans',        icon: HandCoins, roles: [...ALL_STAFF] },
  { to: '/admin/store',       label: 'Store',        icon: Store, roles: ['super_admin', 'admin', 'officer'] },
  { to: '/admin/dividends',   label: 'Dividends',    icon: TrendingUp, roles: ['super_admin', 'admin', 'accountant'] },
  { to: '/admin/transactions', label: 'Transactions', icon: Receipt, roles: ['super_admin', 'admin', 'accountant'] },
  { to: '/admin/reports', label: 'Reports', icon: FileText, roles: ['super_admin', 'admin', 'officer', 'accountant'] },
  { to: '/admin/compliance', label: 'Compliance', icon: ShieldCheck, roles: ['super_admin', 'admin', 'officer', 'accountant'] },
  { to: '/admin/reconcile', label: 'Reconcile', icon: Scale, roles: ['super_admin', 'admin', 'accountant'] },
  { to: '/admin/activity',    label: 'Activity Log', icon: ScrollText, roles: [...ALL_STAFF] },
  { to: '/admin/notices',     label: 'Notices',      icon: Megaphone, roles: ['super_admin', 'admin', 'officer'] },
];

const routeTitles = {
  '/admin': 'Overview',
  '/admin/members': 'Members',
  '/admin/kyc': 'KYC',
  '/admin/staff': 'Staff',
  '/admin/organisations': 'Organisations',
  '/admin/loans': 'Loans',
  '/admin/store': 'Store',
  '/admin/dividends': 'Dividends',
  '/admin/transactions': 'Transactions',
  '/admin/reports': 'Reports',
  '/admin/compliance': 'Compliance',
  '/admin/reconcile': 'Reconcile',
  '/admin/activity': 'Activity Log',
  '/admin/notices': 'Notices',
};

function SidebarContent({ onNavigate, role, collapsed }) {
  const items = adminNav.filter((n) => !n.roles || n.roles.includes(role));
  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      {/* Brand */}
      <div className={cn(
        'h-16 flex items-center gap-2.5 border-b border-sidebar-border/60',
        collapsed ? 'justify-center px-2' : 'px-5',
      )}>
        <div className="h-8 w-8 shrink-0 rounded-lg bg-primary text-primary-foreground grid place-items-center font-bold">
          M
        </div>
        {!collapsed && (
          <div className="leading-tight">
            <p className="font-semibold text-sm">MPCS</p>
            <p className="text-[11px] text-muted-foreground">Admin Console</p>
          </div>
        )}
      </div>

      {/* Nav */}
      <ScrollArea className="flex-1">
        <nav className={cn('space-y-0.5', collapsed ? 'p-2' : 'p-3')}>
          {!collapsed && (
            <p className="px-3 py-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Management
            </p>
          )}
          {items.map(({ to, label, icon: Icon, exact }) => (
            <NavLink
              key={to} to={to} end={exact}
              onClick={onNavigate}
              title={collapsed ? label : undefined}
              className={({ isActive }) =>
                cn(
                  'group flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors',
                  collapsed && 'justify-center px-0',
                  isActive
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                )
              }
            >
              <Icon className="h-4 w-4 shrink-0" />
              {!collapsed && <span className="truncate">{label}</span>}
            </NavLink>
          ))}

          <div className="my-2 border-t border-sidebar-border/60" />
          <NavLink
            to="/dashboard"
            onClick={onNavigate}
            title="Preview member experience"
            className={cn(
              'group flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors text-muted-foreground hover:bg-accent hover:text-foreground',
              collapsed && 'justify-center px-0',
            )}
          >
            <Home className="h-4 w-4 shrink-0" />
            {!collapsed && <span className="truncate">View as Member</span>}
          </NavLink>
        </nav>
      </ScrollArea>
      {!collapsed && (
        <p className="px-5 py-2 font-mono text-[10px] text-muted-foreground/70" title="Deployed build — compare with the latest commit to confirm you're seeing the newest version">
          build {BUILD}
        </p>
      )}
    </div>
  );
}

export default function AdminLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem('mpcs:admin:collapsed') === '1',
  );

  const title = routeTitles[location.pathname] || 'Admin';

  const handleLogout = () => { logout(); navigate('/login'); };
  const toggleCollapsed = () => {
    setCollapsed((c) => {
      localStorage.setItem('mpcs:admin:collapsed', c ? '0' : '1');
      return !c;
    });
  };

  return (
    <TooltipProvider delayDuration={200}>
      <div className="min-h-screen flex bg-muted/40 dark:bg-background">
        {/* Desktop sidebar */}
        <aside className={cn(
          'hidden md:flex shrink-0 border-r bg-sidebar transition-all duration-200 ease-in-out',
          collapsed ? 'w-[76px]' : 'w-64',
        )}>
          <SidebarContent role={user?.role} collapsed={collapsed} />
        </aside>

        <div className="flex-1 flex flex-col min-w-0">
          {/* Topbar */}
          <header className="h-16 border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-30">
            <div className="flex h-full items-center gap-2 px-4 md:px-6">
              {/* Mobile menu */}
              <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
                <SheetTrigger asChild>
                  <Button variant="ghost" size="icon" className="md:hidden">
                    <Menu className="h-5 w-5" />
                  </Button>
                </SheetTrigger>
                <SheetContent side="left" className="p-0 w-72 bg-sidebar">
                  <SidebarContent role={user?.role} onNavigate={() => setMobileOpen(false)} />
                </SheetContent>
              </Sheet>

              {/* Desktop collapse toggle */}
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleCollapsed}
                title={collapsed ? 'Expand menu' : 'Collapse menu'}
                className="hidden md:inline-flex"
              >
                {collapsed ? <PanelLeftOpen className="h-5 w-5" /> : <PanelLeftClose className="h-5 w-5" />}
              </Button>

              <div className="min-w-0">
                <Breadcrumb
                  className="hidden sm:flex"
                  items={[
                    { label: 'Admin', to: '/admin' },
                    ...(location.pathname !== '/admin' ? [{ label: title }] : []),
                  ]}
                />
                <h1 className="font-semibold text-lg sm:hidden">{title}</h1>
              </div>

              <div className="ml-auto flex items-center gap-2">
                {/* Fake global search */}                <button
                  onClick={() => navigate('/admin/transactions')}
                  className="hidden lg:flex items-center gap-2 h-9 rounded-md border bg-muted/50 px-3 text-sm text-muted-foreground hover:bg-muted w-64"
                >
                  <Search className="h-3.5 w-3.5" />
                  <span>Search transactions…</span>
                  <kbd className="ml-auto rounded border bg-background px-1.5 text-[10px] font-mono">⌘K</kbd>
                </button>

                <AdminActivityBell />

                <ThemeToggle />

                <Separator orientation="vertical" className="h-8" />

                {/* User dropdown */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" className="h-9 px-2 gap-2">
                      <Avatar className="h-7 w-7">
                        <AvatarFallback className="bg-primary/10 text-primary text-xs">
                          {initials(user?.first_name, user?.last_name)}
                        </AvatarFallback>
                      </Avatar>
                      <span className="hidden sm:block text-sm font-medium">
                        {user?.first_name} {user?.last_name}
                      </span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuLabel>
                      <div className="flex flex-col">
                        <span>{user?.first_name} {user?.last_name}</span>
                        <span className="text-xs font-normal text-muted-foreground">{user?.email}</span>
                      </div>
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => navigate('/profile')}>
                      <UserIcon className="h-4 w-4" /> Profile
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => navigate('/dashboard')}>
                      <Shield className="h-4 w-4" /> View as Member
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={handleLogout} className="text-destructive focus:text-destructive">
                      <LogOut className="h-4 w-4" /> Log out
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </header>

          {/* Content — single consistent container for every admin page */}
          <main className="flex-1 overflow-auto">
            <div className="mx-auto w-full max-w-7xl space-y-6 p-4 md:p-6 lg:p-8">
              <Outlet />
            </div>
          </main>
        </div>
        <ChatWidget />
      </div>
    </TooltipProvider>
  );
}
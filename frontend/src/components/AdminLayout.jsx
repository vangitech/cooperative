import { useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { cn } from '@/lib/utils';
import { initials } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { Breadcrumb } from '@/components/ui/breadcrumb';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  LayoutDashboard, Users, HandCoins, TrendingUp, Receipt,
  Menu, Bell, LogOut, User as UserIcon, Shield, Home, Search, ScrollText, Store, Megaphone,
} from 'lucide-react';

const adminNav = [
  { to: '/admin',             label: 'Overview',     icon: LayoutDashboard, exact: true, roles: ['admin', 'officer', 'accountant'] },
  { to: '/admin/members',     label: 'Members',      icon: Users, roles: ['admin', 'officer', 'accountant'] },
  { to: '/admin/loans',       label: 'Loans',        icon: HandCoins, roles: ['admin', 'officer', 'accountant'] },
  { to: '/admin/store',       label: 'Store',        icon: Store, roles: ['admin', 'officer'] },
  { to: '/admin/dividends',   label: 'Dividends',    icon: TrendingUp, roles: ['admin', 'accountant'] },
  { to: '/admin/transactions', label: 'Transactions', icon: Receipt, roles: ['admin', 'accountant'] },
  { to: '/admin/activity',    label: 'Activity Log', icon: ScrollText, roles: ['admin', 'officer', 'accountant'] },
  { to: '/admin/notices',     label: 'Notices',      icon: Megaphone, roles: ['admin', 'officer'] },
];

const routeTitles = {
  '/admin': 'Overview',
  '/admin/members': 'Members',
  '/admin/loans': 'Loans',
  '/admin/store': 'Store',
  '/admin/dividends': 'Dividends',
  '/admin/transactions': 'Transactions',
  '/admin/activity': 'Activity Log',
  '/admin/notices': 'Notices',
};

function SidebarContent({ onNavigate, role }) {
  const items = adminNav.filter((n) => !n.roles || n.roles.includes(role));
  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      {/* Brand */}
      <div className="h-16 flex items-center gap-2.5 px-5 border-b border-sidebar-border/60">
        <div className="h-8 w-8 rounded-lg bg-primary text-primary-foreground grid place-items-center font-bold">
          M
        </div>
        <div className="leading-tight">
          <p className="font-semibold text-sm">MPCS</p>
          <p className="text-[11px] text-muted-foreground">Admin Console</p>
        </div>
      </div>

      {/* Nav */}
      <ScrollArea className="flex-1">
        <nav className="p-3 space-y-0.5">
          <p className="px-3 py-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Management
          </p>
          {items.map(({ to, label, icon: Icon, exact }) => (
            <NavLink
              key={to} to={to} end={exact}
              onClick={onNavigate}
              className={({ isActive }) =>
                cn(
                  'group flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                )
              }
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="truncate">{label}</span>
            </NavLink>
          ))}
        </nav>
      </ScrollArea>

      {/* Member view link */}
      <div className="p-3 border-t">
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button asChild variant="outline" className="w-full justify-start" onClick={onNavigate}>
                <NavLink to="/dashboard">
                  <Home className="h-4 w-4" /> Member Portal
                </NavLink>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">Switch to member view</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </div>
  );
}

export default function AdminLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  const title = routeTitles[location.pathname] || 'Admin';

  const handleLogout = () => { logout(); navigate('/login'); };

  return (
    <TooltipProvider delayDuration={200}>
      <div className="min-h-screen flex bg-muted/30">
        {/* Desktop sidebar */}
        <aside className="hidden md:flex w-64 shrink-0 border-r bg-sidebar">
          <SidebarContent role={user?.role} />
        </aside>

        <div className="flex-1 flex flex-col min-w-0">
          {/* Topbar */}
          <header className="h-16 border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-30">
            <div className="flex h-full items-center gap-3 px-4 md:px-6">
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
                {/* Fake global search */}
                <button
                  onClick={() => navigate('/admin/transactions')}
                  className="hidden lg:flex items-center gap-2 h-9 rounded-md border bg-muted/50 px-3 text-sm text-muted-foreground hover:bg-muted w-64"
                >
                  <Search className="h-3.5 w-3.5" />
                  <span>Search transactions…</span>
                  <kbd className="ml-auto rounded border bg-background px-1.5 text-[10px] font-mono">⌘K</kbd>
                </button>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" className="relative">
                      <Bell className="h-5 w-5" />
                      <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-primary" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Notifications</TooltipContent>
                </Tooltip>

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
                      <Shield className="h-4 w-4" /> Member View
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

          {/* Content */}
          <main className="flex-1 p-4 md:p-6 overflow-auto">
            <Outlet />
          </main>
        </div>
      </div>
    </TooltipProvider>
  );
}
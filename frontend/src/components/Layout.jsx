import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { initials } from '@/lib/format';
import {
  LayoutDashboard, Wallet, PiggyBank, HandCoins, TrendingUp,
  User, LogOut, ShieldCheck, ShoppingBag, FileText,
  Menu, PanelLeftClose, PanelLeftOpen, BadgeCheck,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import NotificationsBell from '@/components/NotificationsBell';
import ThemeToggle from '@/components/ThemeToggle';
import ChatWidget from '@/components/ChatWidget';

const memberNav = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/verification', label: 'Verification', icon: BadgeCheck },
  { to: '/wallet', label: 'Wallet', icon: Wallet },
  { to: '/savings', label: 'Savings', icon: PiggyBank },
  { to: '/loans', label: 'Loans', icon: HandCoins },
  { to: '/market', label: 'Market', icon: ShoppingBag },
  { to: '/dividends', label: 'Dividends', icon: TrendingUp },
  { to: '/statement', label: 'Report', icon: FileText },
  { to: '/profile', label: 'Profile', icon: User },
];

const adminBackNav = [
  { to: '/admin', label: 'Back to Admin Console', icon: ShieldCheck },
];

function SidebarContent({ nav, collapsed, onNavigate }) {
  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
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
            <p className="text-[11px] text-muted-foreground">Cooperative Society</p>
          </div>
        )}
      </div>
      <ScrollArea className="flex-1">
        <nav className={cn('space-y-0.5', collapsed ? 'p-2' : 'p-3')}>
          {nav.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to} to={to} end={to === '/dashboard'}
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
        </nav>
      </ScrollArea>
    </div>
  );
}

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem('mpcs:member:collapsed') === '1',
  );
  // Additional-verification summary for the avatar menu (both sectors):
  // NIN/BVN passed at signup + which loan documents are still missing.
  const [verify, setVerify] = useState(null);
  useEffect(() => {
    if (!user) return;
    api.get('/kyc/me')
      .then((d) => {
        let vr = d?.profile?.verification_result || null;
        if (typeof vr === 'string') {
          try { vr = JSON.parse(vr); } catch { vr = null; }
        }
        const ninPassed = Boolean(
          vr?.nin?.verified || (vr?.checks || []).some((c) => ['nin', 'reg_nin'].includes(c.key) && c.passed) || d?.profile?.id_number
        );
        const bvnPassed = Boolean(
          vr?.bvn?.verified || (vr?.checks || []).some((c) => ['bvn_match', 'reg_bvn_match'].includes(c.key) && c.passed) || d?.profile?.bvn_verified
        );
        const docs = d?.documents || [];
        const hasGovId = docs.some((x) => ['passport', 'drivers_license', 'voters_card', 'id_card'].includes(x.doc_type));
        const util = docs.filter((x) => ['utility_bill', 'proof_of_address'].includes(x.doc_type));
        setVerify({ ninPassed, bvnPassed, hasGovId, hasUtility: util.length > 0 });
      })
      .catch(() => setVerify(null));
  }, [user]);

  const isStaff = ['super_admin', 'admin', 'officer', 'accountant', 'grantor'].includes(user?.role);
  const nav = isStaff ? [...memberNav, ...adminBackNav] : memberNav;

  const handleLogout = () => { logout(); navigate('/login'); };
  const toggleCollapsed = () => {
    setCollapsed((c) => {
      localStorage.setItem('mpcs:member:collapsed', c ? '0' : '1');
      return !c;
    });
  };

  return (
    <div className="min-h-screen flex bg-muted/30">
      {/* Desktop sidebar — collapsible */}
      <aside className={cn(
        'hidden md:flex shrink-0 border-r bg-sidebar transition-all duration-200 ease-in-out',
        collapsed ? 'w-[76px]' : 'w-64',
      )}>
        <SidebarContent nav={nav} collapsed={collapsed} />
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
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
                <SidebarContent nav={nav} onNavigate={() => setMobileOpen(false)} />
              </SheetContent>
            </Sheet>

            {/* Collapse toggle — top left */}
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleCollapsed}
              title={collapsed ? 'Expand menu' : 'Collapse menu'}
              className="hidden md:inline-flex"
            >
              {collapsed ? <PanelLeftOpen className="h-5 w-5" /> : <PanelLeftClose className="h-5 w-5" />}
            </Button>

            <h1 className="font-semibold capitalize">
              {isStaff ? 'Member View' : 'Member Portal'}
            </h1>

            {/* Top-right: user name + avatar + logout */}
            <div className="ml-auto flex items-center gap-2">
              <span className="text-sm text-muted-foreground hidden lg:block mr-1">
                Welcome back, {user?.first_name}
              </span>
              <ThemeToggle />
              <NotificationsBell />
              <Separator orientation="vertical" className="h-8" />
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
                <DropdownMenuContent align="end" className="w-64">
                  <DropdownMenuLabel>
                    <div className="flex flex-col">
                      <span>{user?.first_name} {user?.last_name}</span>
                      <span className="text-xs font-normal text-muted-foreground">{user?.email}</span>
                      {verify && (
                        <span className="mt-1.5 flex flex-wrap gap-1">
                          {verify.ninPassed && (
                            <span className="rounded-full bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300 px-1.5 py-px text-[10px] font-semibold">NIN ✓</span>
                          )}
                          {verify.bvnPassed && (
                            <span className="rounded-full bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300 px-1.5 py-px text-[10px] font-semibold">BVN ✓</span>
                          )}
                          {(!verify.hasUtility || !verify.hasGovId) && (
                            <span className="rounded-full bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 px-1.5 py-px text-[10px] font-semibold">docs needed</span>
                          )}
                        </span>
                      )}
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => navigate('/profile')}>
                    <User className="h-4 w-4" /> Profile
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => navigate('/verification')}>
                    <BadgeCheck className="h-4 w-4" /> Verification
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => navigate('/statement')}>
                    <FileText className="h-4 w-4" /> Report / Statement
                  </DropdownMenuItem>
                  {isStaff && (
                    <DropdownMenuItem onClick={() => navigate('/admin')}>
                      <ShieldCheck className="h-4 w-4" /> Back to Admin Console
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleLogout} className="text-destructive focus:text-destructive">
                    <LogOut className="h-4 w-4" /> Log out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </header>

        <main className="flex-1 p-4 md:p-6 overflow-auto">
          <Outlet />
        </main>
      </div>
      <ChatWidget />
    </div>
  );
}

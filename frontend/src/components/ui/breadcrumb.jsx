import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Link } from 'react-router-dom';

export function Breadcrumb({ items = [], className }) {
  return (
    <nav className={cn('flex items-center text-sm text-muted-foreground', className)}>
      {items.map((item, i) => (
        <div key={i} className="flex items-center">
          {i > 0 && <ChevronRight className="h-3.5 w-3.5 mx-1.5 opacity-60" />}
          {item.to ? (
            <Link to={item.to} className="hover:text-foreground transition-colors">{item.label}</Link>
          ) : (
            <span className="font-medium text-foreground">{item.label}</span>
          )}
        </div>
      ))}
    </nav>
  );
}
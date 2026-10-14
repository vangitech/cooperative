import { useNavigate } from 'react-router-dom';
import { ShieldCheck, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader,
  DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';

// Small, well-spaced popup shown when a member attempts a gated action
// (loan application, withdrawal, transfer, bank payout) without completing
// verification. The primary button takes them to the Verification section.
export default function KycRequiredModal({ open, onClose, missing = [], title }) {
  const navigate = useNavigate();

  const go = () => {
    onClose?.();
    navigate('/verification');
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose?.(); }}>
      <DialogContent className="max-w-md p-0 overflow-hidden">
        <div className="px-6 pt-6 pb-5 text-center space-y-3">
          <div className="mx-auto h-12 w-12 rounded-full bg-primary/10 grid place-items-center">
            <ShieldCheck className="h-6 w-6 text-primary" />
          </div>
          <DialogHeader className="space-y-1.5">
            <DialogTitle className="text-lg text-center">
              {title || 'Verification required'}
            </DialogTitle>
            <DialogDescription className="text-center text-sm leading-relaxed">
              To keep every account safe, this action needs a completed
              verification. You're almost there — just the items below:
            </DialogDescription>
          </DialogHeader>
          {missing.length > 0 && (
            <ul className="text-left text-sm rounded-lg border bg-muted/50 px-4 py-3 space-y-1.5">
              {missing.map((m) => (
                <li key={m} className="flex items-start gap-2">
                  <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                  <span>{m}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <DialogFooter className="px-6 pb-6 pt-1 flex-col sm:flex-col gap-2">
          <Button className="w-full h-11 text-sm" onClick={go}>
            Click here to complete your KYC <ArrowRight className="h-4 w-4" />
          </Button>
          <Button variant="ghost" className="w-full" onClick={() => onClose?.()}>
            I&rsquo;ll do it later
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

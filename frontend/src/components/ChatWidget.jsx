import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { MessageCircle, X, Send, Users, User as UserIcon, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function ChatWidget() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('chats');
  const [contacts, setContacts] = useState({ staff: [], groupMembers: [], myGroups: [] });
  const [convs, setConvs] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef(null);

  const loadContacts = async () => {
    try {
      setContacts(await api.get('/chat/contacts'));
    } catch { /* offline */ }
  };

  const loadConvs = async () => {
    try {
      const list = await api.get('/chat/conversations');
      setConvs(Array.isArray(list) ? list : []);
    } catch { /* offline */ }
  };

  const loadMessages = async (id) => {
    if (!id) return;
    try {
      const m = await api.get(`/chat/conversations/${id}/messages`);
      setMessages(Array.isArray(m) ? m : []);
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    } catch { /* ignore */ }
  };

  useEffect(() => {
    if (!open) return;
    loadContacts();
    loadConvs();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => {
      loadConvs();
      if (activeId) loadMessages(activeId);
    }, 10000);
    return () => clearInterval(t);
  }, [open, activeId]);

  useEffect(() => {
    if (activeId) loadMessages(activeId);
    else setMessages([]);
  }, [activeId]);

  const startChat = async (peerId, peerName) => {
    try {
      const c = await api.post('/chat/conversations', { type: 'direct', participantIds: [peerId], title: peerName });
      await loadConvs();
      setActiveId(c.id);
      setTab('chats');
    } catch (e) {
      alert(e.message);
    }
  };

  const startGroup = async () => {
    const ids = contacts.groupMembers.map((m) => m.id);
    if (!ids.length) return alert('No group members found — join an organisation first.');
    try {
      const c = await api.post('/chat/conversations', {
        type: 'group',
        title: contacts.myGroups[0]?.name ? `${contacts.myGroups[0].name} group` : 'My group',
        participantIds: ids.slice(0, 20),
        orgId: contacts.myGroups[0]?.id,
      });
      await loadConvs();
      setActiveId(c.id);
      setTab('chats');
    } catch (e) {
      alert(e.message);
    }
  };

  const send = async (e) => {
    e.preventDefault();
    if (!draft.trim() || !activeId || sending) return;
    setSending(true);
    try {
      await api.post(`/chat/conversations/${activeId}/messages`, { body: draft.trim() });
      setDraft('');
      await loadMessages(activeId);
      await loadConvs();
    } catch (err) {
      alert(err.message);
    } finally {
      setSending(false);
    }
  };

  const active = convs.find((c) => c.id === activeId);

  return (
    <>
      <button
        onClick={() => setOpen((o) => !o)}
        title="Chat"
        className="fixed bottom-5 right-5 z-50 h-12 w-12 rounded-full bg-primary text-primary-foreground shadow-lg grid place-items-center hover:opacity-90"
      >
        {open ? <X className="h-5 w-5" /> : <MessageCircle className="h-5 w-5" />}
        {!open && convs.length > 0 && (
          <span className="absolute -top-1 -right-1 h-5 min-w-5 px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] grid place-items-center">
            {convs.length}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed bottom-20 right-5 z-50 w-[92vw] max-w-sm h-[480px] rounded-xl border bg-background shadow-2xl flex flex-col overflow-hidden">
          <div className="px-4 py-3 border-b flex items-center gap-2">
            <MessageCircle className="h-4 w-4 text-primary" />
            <p className="font-semibold text-sm flex-1">Chat</p>
            <Badge variant="outline" className="text-[10px] capitalize">{user?.role}</Badge>
          </div>

          <div className="px-3 pt-2 flex gap-1">
            {['chats', 'people', 'group'].map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={cn(
                  'px-3 py-1.5 rounded-md text-xs font-medium capitalize',
                  tab === t ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'
                )}
              >
                {t === 'people' ? 'Admin & Officer' : t}
              </button>
            ))}
          </div>

          {tab === 'chats' && (
            <div className="flex-1 flex flex-col min-h-0">
              {!activeId ? (
                <div className="flex-1 overflow-auto p-2 space-y-1">
                  {convs.length === 0 && (
                    <p className="text-xs text-muted-foreground text-center py-8">
                      No chats yet — open <b>Admin & Officer</b> or <b>Group</b> to start one.
                    </p>
                  )}
                  {convs.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => setActiveId(c.id)}
                      className="w-full text-left rounded-lg border px-3 py-2 hover:border-primary/50"
                    >
                      <p className="text-sm font-medium truncate">{c.title || c.peers || `Chat #${c.id}`}</p>
                      <p className="text-xs text-muted-foreground truncate">{c.last_body || 'No messages yet'}</p>
                    </button>
                  ))}
                </div>
              ) : (
                <>
                  <div className="px-3 py-2 border-b flex items-center gap-2">
                    <button onClick={() => setActiveId(null)} className="text-xs text-primary hover:underline">← Back</button>
                    <p className="text-sm font-medium truncate flex-1">{active?.title || active?.peers || `Chat #${activeId}`}</p>
                  </div>
                  <div className="flex-1 overflow-auto p-3 space-y-2">
                    {messages.map((m) => {
                      const mine = m.sender_id === user?.id;
                      return (
                        <div key={m.id} className={cn('flex', mine ? 'justify-end' : 'justify-start')}>
                          <div className={cn(
                            'max-w-[80%] rounded-lg px-3 py-1.5 text-sm',
                            mine ? 'bg-primary text-primary-foreground' : 'bg-muted'
                          )}>
                            {!mine && (
                              <p className="text-[11px] font-semibold opacity-70">{m.first_name} {m.last_name} · {m.role}</p>
                            )}
                            <p>{m.body}</p>
                          </div>
                        </div>
                      );
                    })}
                    <div ref={bottomRef} />
                  </div>
                  <form onSubmit={send} className="p-2 border-t flex gap-2">
                    <Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Type a message…" maxLength={2000} />
                    <Button type="submit" size="icon" disabled={sending}><Send className="h-4 w-4" /></Button>
                  </form>
                </>
              )}
            </div>
          )}

          {tab === 'people' && (
            <div className="flex-1 overflow-auto p-2 space-y-1">
              <p className="px-2 py-1 text-[11px] uppercase tracking-wider text-muted-foreground">Admin · Account officer · Grantor (staff)</p>
              {contacts.staff.map((s) => (
                <div key={s.id} className="flex items-center gap-2 rounded-lg border px-3 py-2">
                  <div className="h-8 w-8 rounded-full bg-primary/10 text-primary grid place-items-center text-xs font-bold">
                    {s.first_name?.[0]}{s.last_name?.[0]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{s.first_name} {s.last_name}</p>
                    <p className="text-xs text-muted-foreground capitalize">{s.kind} · {s.role}</p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => startChat(s.id, `${s.first_name} ${s.last_name}`)}>
                    <UserIcon className="h-3.5 w-3.5" /> Chat
                  </Button>
                </div>
              ))}
              {contacts.staff.length === 0 && <p className="text-xs text-muted-foreground text-center py-6">No staff found.</p>}
            </div>
          )}

          {tab === 'group' && (
            <div className="flex-1 overflow-auto p-2 space-y-1">
              <div className="flex items-center justify-between px-2 py-1">
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Members in my group</p>
                <Button size="sm" variant="outline" onClick={startGroup}><Users className="h-3.5 w-3.5" /> Group chat</Button>
              </div>
              {contacts.groupMembers.map((s) => (
                <div key={s.id} className="flex items-center gap-2 rounded-lg border px-3 py-2">
                  <div className="h-8 w-8 rounded-full bg-primary/10 text-primary grid place-items-center text-xs font-bold">
                    {s.first_name?.[0]}{s.last_name?.[0]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{s.first_name} {s.last_name}</p>
                    <p className="text-xs text-muted-foreground truncate">{s.org_name || 'Group member'}</p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => startChat(s.id, `${s.first_name} ${s.last_name}`)}>
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
              {contacts.groupMembers.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-6">No group members — you appear to be in General Members only.</p>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}

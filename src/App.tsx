import React, { useState, useRef, useEffect } from 'react';
import { Terminal as TerminalIcon, Send, Copy, Check, Power, AlertCircle, HelpCircle, Code, Cpu, ShieldCheck, Download, LogIn, User } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useTermux, Message, TerminalLine } from './hooks/useTermux';
import { getGeminiResponse } from './lib/gemini';

declare global {
  interface Window {
    google: any;
  }
}

export default function App() {
  const { roomId, isConnected, terminalHistory, sendCommand, writeRemoteFile, clearTerminal } = useTermux();
  const [messages, setMessages] = useState<Message[]>([
    { role: 'model', content: "Hello! I'm your Termux Code Genius. Once you connect your Termux terminal, I can help you code, manage files, and automate your mobile environment. How can I assist you today?" }
  ]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [activeTab, setActiveTab] = useState<'chat' | 'terminal'>('chat');
  const [copied, setCopied] = useState(false);
  const [customHost, setCustomHost] = useState('localhost:3000');
  const [user, setUser] = useState<{ name: string; email: string; picture: string } | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  // Load Google Identity Services
  useEffect(() => {
    const clientId = process.env.VITE_GOOGLE_CLIENT_ID;
    if (!clientId || clientId === "") {
        console.warn("GOOGLE_CLIENT_ID is missing from environment secrets.");
        return;
    }

    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = () => {
      try {
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: handleGoogleResponse,
          auto_select: false,
          cancel_on_tap_outside: true,
        });
        renderGoogleButton();
      } catch (err: any) {
        setAuthError(err.message);
      }
    };
    document.body.appendChild(script);
  }, []);

  const renderGoogleButton = () => {
    const btnContainer = document.getElementById('google-login-btn');
    if (btnContainer && !user) {
        window.google.accounts.id.renderButton(
          btnContainer,
          { theme: 'outline', size: 'large', shape: 'pill' }
        );
    }
  };

  useEffect(() => {
    if (!user) {
        // Re-render button if user logs out
        setTimeout(renderGoogleButton, 100);
    }
  }, [user]);

  const handleGoogleResponse = (response: any) => {
    try {
        const payload = JSON.parse(atob(response.credential.split('.')[1]));
        setUser({
          name: payload.name,
          email: payload.email,
          picture: payload.picture
        });
        setAuthError(null);
    } catch (err) {
        setAuthError("Failed to decode user information.");
    }
  };

  const handleLogout = () => {
    setUser(null);
  };

  const scrollRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [terminalHistory]);

  const handleSend = async () => {
    if (!input.trim() || isTyping) return;

    // Check if we need auth first
    if (process.env.VITE_GOOGLE_CLIENT_ID && !user) {
      setMessages(prev => [...prev, { role: 'model', content: "Please sign in with Google to use the code assistant." }]);
      return;
    }

    const userMessage: Message = { role: 'user', content: input };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsTyping(true);

    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

    const response = await getGeminiResponse([...messages, userMessage], async (name, args) => {
      if (name === 'execute_shell_command') {
        if (isLocal) {
          const res = await fetch('/api/execute', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ command: args.command })
          });
          return await res.json();
        }
        const result = await sendCommand(args.command);
        return result;
      } else if (name === 'write_file') {
        if (isLocal) {
          const res = await fetch('/api/write', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: args.path, content: args.content })
          });
          return await res.json();
        }
        const result = await writeRemoteFile(args.path, args.content);
        return result;
      }
      return { error: 'Unknown tool' };
    });

    setMessages(prev => [...prev, { role: 'model', content: response || "" }]);
    setIsTyping(false);
  };

  const protocol = customHost.includes('localhost') ? 'ws' : 'wss';
  
  const agentScript = `
const WebSocket = require('ws');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOM_ID = "${roomId}";
const RE_HOST = "${customHost}";
const WS_URL = "${protocol}://${customHost}/?room=${roomId}&role=agent";

console.log('Connecting to ' + WS_URL + '...');

const ws = new WebSocket(WS_URL);

ws.on('open', () => {
  console.log('Connected! Termux Code Genius is ready.');
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  if (msg.type === 'execute') {
    const { id, command } = msg.data;
    console.log('Executing: ' + command);
    exec(command, (err, stdout, stderr) => {
      ws.send(JSON.stringify({ 
        type: 'command_output', 
        data: { id, output: stdout, error: stderr || (err ? err.message : '') } 
      }));
    });
  } else if (msg.type === 'write_file') {
    const { id, path: filePath, content } = msg.data;
    console.log('Writing file: ' + filePath);
    try {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(filePath, content);
      ws.send(JSON.stringify({ type: 'file_result', data: { id, success: true } }));
    } catch (e) {
      ws.send(JSON.stringify({ type: 'file_result', data: { id, success: false, error: e.message } }));
    }
  }
});

ws.on('error', (err) => console.error('Connection error:', err.message));
ws.on('close', () => console.log('Disconnected.'));
`.trim();

  const copyScript = () => {
    navigator.clipboard.writeText(`pkg install nodejs -y && npm install ws\ncat > agent.js <<EOF\n${agentScript}\nEOF\nnode agent.js`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex h-screen bg-[#0F1115] text-[#E4E6EB] font-sans overflow-hidden flex-col md:flex-row">
      {/* Sidebar / Setup Instructions (Desktop Drawer or Mobile Overlay) */}
      <AnimatePresence>
        {showSetup && (
          <>
            {/* Backdrop for mobile */}
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowSetup(false)}
              className="fixed inset-0 bg-black/60 z-30 md:hidden"
            />
            <motion.div 
              initial={{ x: -400, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: -400, opacity: 0 }}
              className="fixed md:relative inset-y-0 left-0 w-full sm:w-96 border-r border-[#1C1F26] bg-[#0A0C10] p-6 flex flex-col overflow-y-auto z-40 shadow-2xl"
            >
              <div className="flex items-center justify-between mb-8">
                <h2 className="text-xl font-bold flex items-center gap-2">
                  <ShieldCheck className="w-6 h-6 text-emerald-400" />
                  Setup Guide
                </h2>
                <button onClick={() => setShowSetup(false)} className="text-gray-500 hover:text-white p-2">
                  <Power className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-6">
                <section>
                  <div className="flex items-center gap-2 mb-2 text-emerald-400 font-mono text-sm uppercase tracking-wider">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    Step 1: Install Requirements
                  </div>
                  <p className="text-gray-400 text-sm mb-3">Ensure you have Node.js and common tools installed in Termux.</p>
                  <div className="bg-[#151821] p-3 rounded font-mono text-xs text-blue-300 border border-[#1C1F26]">
                    pkg install nodejs -y && npm install ws
                  </div>
                </section>

                <section>
                  <div className="flex items-center gap-2 mb-2 text-emerald-400 font-mono text-sm uppercase tracking-wider">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    Step 2: Run Bridge Agent
                  </div>
                  <p className="text-gray-400 text-sm mb-3">Copy and paste this command into your Termux terminal to start the bridge.</p>
                  
                  <div className="mb-4">
                    <label className="text-[10px] text-gray-500 font-bold uppercase tracking-widest mb-1 block">Bridge Host URL</label>
                    <input 
                      type="text" 
                      value={customHost}
                      onChange={(e) => setCustomHost(e.target.value)}
                      className="w-full bg-[#151821] border border-[#1C1F26] rounded px-3 py-2 text-xs font-mono text-blue-300 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      placeholder="e.g. localhost:3000"
                    />
                    {customHost.includes('localhost') && (
                      <p className="mt-1 text-[10px] text-amber-500 flex items-center gap-1">
                        <AlertCircle className="w-3 h-3" />
                        Using localhost bridge.
                      </p>
                    )}
                  </div>

                  <div className="relative">
                    <div className="bg-[#151821] p-3 rounded font-mono text-xs text-gray-300 border border-[#1C1F26] h-32 overflow-y-auto break-all scrollbar-hide">
                      {`cat > agent.js <<EOF\n${agentScript}\nEOF\nnode agent.js`}
                    </div>
                    <button 
                      onClick={copyScript}
                      className="absolute bottom-2 right-2 p-2 bg-[#1C1F26] hover:bg-[#2A2E38] rounded-md transition-colors border border-[#30363D]"
                    >
                      {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>
                </section>

                <div className="mt-8 p-4 bg-blue-900/20 border border-blue-500/30 rounded-lg">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
                    <p className="text-xs text-blue-100 leading-relaxed">
                      If runnning in the cloud, change Host URL to your public app address.
                    </p>
                  </div>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col relative overflow-hidden h-full">
        {/* Top Header */}
        <header className="h-16 border-b border-[#1C1F26] flex items-center justify-between px-4 md:px-6 bg-[#0A0C10] z-10 shrink-0">
          <div className="flex items-center gap-2 md:gap-4">
            <button 
              onClick={() => setShowSetup(true)}
              className="p-2 hover:bg-[#1C1F26] rounded-md text-gray-400 transition-colors"
              title="Show Setup Guide"
            >
              <HelpCircle className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 md:gap-3">
              <div className="w-8 h-8 md:w-10 md:h-10 bg-blue-600 rounded-lg md:rounded-xl flex items-center justify-center shadow-lg shadow-blue-900/20">
                <Cpu className="text-white w-5 h-5 md:w-6 md:h-6" />
              </div>
              <div>
                <h1 className="font-bold text-sm md:text-lg tracking-tight truncate max-w-[120px] md:max-w-none">Termux Genius</h1>
                <div className="flex items-center gap-1 md:gap-2">
                  <div className={`w-1.5 h-1.5 md:w-2 md:h-2 rounded-full ${isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
                  <span className="text-[8px] md:text-[10px] uppercase font-bold tracking-widest text-gray-500">
                    {isConnected ? 'Active' : 'Offline'}
                  </span>
                </div>
              </div>
            </div>
          </div>
          
          <div className="flex items-center gap-2 md:gap-4">
             <div className="hidden sm:flex flex-col items-end">
                <span className="text-[8px] md:text-[10px] text-gray-500 uppercase font-bold">Session</span>
                <span className="text-[10px] md:text-xs font-mono text-gray-300">{roomId}</span>
             </div>
             <div className="h-6 md:h-8 w-[1px] bg-[#1C1F26]" />
             
             {user ? (
               <div className="flex items-center gap-2 md:gap-3">
                 <div className="hidden md:flex flex-col items-end">
                    <span className="text-[10px] text-white font-bold">{user.name}</span>
                    <button 
                        onClick={handleLogout}
                        className="text-[8px] text-red-500 hover:text-red-400 uppercase font-bold tracking-widest"
                    >
                        Sign Out
                    </button>
                 </div>
                 <img 
                   src={user.picture} 
                   alt={user.name} 
                   className="w-8 h-8 md:w-10 md:h-10 rounded-full border-2 border-blue-500 shadow-lg shrink-0" 
                   referrerPolicy="no-referrer"
                 />
               </div>
             ) : (
               <div className="flex flex-col items-center">
                 {!process.env.VITE_GOOGLE_CLIENT_ID && (
                   <span className="text-[8px] text-amber-500 font-bold mb-1 uppercase">Client ID missing</span>
                 )}
                 <div id="google-login-btn" className="shrink-0 scale-75 md:scale-100" />
               </div>
             )}
          </div>
        </header>

        {/* Local Mode Banner */}
        {window.location.hostname === 'localhost' && (
          <div className="bg-emerald-900/30 border-b border-emerald-500/30 px-4 py-2 flex items-center justify-between text-[10px] md:text-sm">
            <span className="flex items-center gap-2 text-emerald-400">
              <ShieldCheck className="w-4 h-4" />
              Running in Local Mode (Termux)
            </span>
            <span className="text-emerald-500 font-mono">Commands execute directly on this device</span>
          </div>
        )}

        {/* Layout: Messages & Terminal */}
        <main className="flex-1 flex overflow-hidden relative">
          {/* Tabs for mobile */}
          <div className="md:hidden absolute top-0 inset-x-0 h-10 border-b border-[#1C1F26] bg-[#0A0C10] flex z-10">
            <button 
              onClick={() => setActiveTab('chat')}
              className={`flex-1 flex items-center justify-center gap-2 text-[10px] font-bold uppercase tracking-wider transition-colors ${activeTab === 'chat' ? 'text-blue-400 bg-[#151821]' : 'text-gray-500'}`}
            >
              <Send className="w-3 h-3" />
              Chat
            </button>
            <button 
              onClick={() => setActiveTab('terminal')}
              className={`flex-1 flex items-center justify-center gap-2 text-[10px] font-bold uppercase tracking-wider transition-colors ${activeTab === 'terminal' ? 'text-emerald-400 bg-[#151821]' : 'text-gray-500'}`}
            >
              <TerminalIcon className="w-3 h-3" />
              Terminal
            </button>
          </div>

          <div className={`flex-1 flex flex-col min-w-0 border-r border-[#1C1F26] ${activeTab !== 'chat' ? 'hidden md:flex' : 'flex'} mt-10 md:mt-0`}>
            <div 
              ref={scrollRef}
              className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4 md:space-y-6 scroll-smooth scrollbar-thin scrollbar-track-transparent scrollbar-thumb-gray-800"
            >
              <AnimatePresence initial={false}>
                {messages.map((message, i) => (
                  <motion.div
                    key={i}
                    initial={{ y: 10, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div className={`max-w-[90%] md:max-w-[85%] rounded-2xl px-3 md:px-4 py-2 md:py-3 shadow-sm ${
                      message.role === 'user' 
                        ? 'bg-blue-600 text-white rounded-tr-none' 
                        : 'bg-[#1C1F26] text-gray-200 border border-[#2A2E38] rounded-tl-none'
                    }`}>
                      <p className="text-sm leading-relaxed whitespace-pre-wrap">{message.content}</p>
                    </div>
                  </motion.div>
                ))}
                {isTyping && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="flex justify-start"
                  >
                    <div className="bg-[#1C1F26] rounded-2xl rounded-tl-none px-3 py-2 flex gap-1 items-center border border-[#2A2E38]">
                      <span className="w-1 h-1 bg-gray-500 rounded-full animate-bounce [animation-delay:-0.3s]" />
                      <span className="w-1 h-1 bg-gray-500 rounded-full animate-bounce [animation-delay:-0.15s]" />
                      <span className="w-1 h-1 bg-gray-500 rounded-full animate-bounce" />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Input Bar */}
            <div className="p-4 md:p-6 pt-0 bg-[#0F1115]/80 backdrop-blur-md">
              <div className="relative group">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleSend())}
                  placeholder="Ask Gemini to code..."
                  className="w-full bg-[#1C1F26] border border-[#2A2E38] rounded-2xl py-3 md:py-4 pl-4 md:pl-5 pr-12 md:pr-14 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all resize-none h-12 md:h-14 scrollbar-hide"
                />
                <button
                  onClick={handleSend}
                  disabled={!input.trim() || isTyping}
                  className="absolute right-2 md:right-3 top-2 md:top-3 p-1.5 md:p-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 text-white rounded-xl shadow-lg"
                >
                  <Send className="w-4 h-4 md:w-5 md:h-5" />
                </button>
              </div>
            </div>
          </div>

          {/* Terminal Pane */}
          <div className={`w-full md:w-[400px] lg:w-[450px] flex flex-col bg-black overflow-hidden select-none ${activeTab !== 'terminal' ? 'hidden md:flex' : 'flex'} mt-10 md:mt-0`}>
            <div className="flex items-center justify-between px-4 py-2 border-b border-[#1C1F26] bg-[#0A0C10]">
              <div className="flex items-center gap-2">
                <div className="flex gap-1">
                  <div className="w-2 h-2 rounded-full bg-red-500/50" />
                  <div className="w-2 h-2 rounded-full bg-yellow-500/50" />
                  <div className="w-2 h-2 rounded-full bg-green-500/50" />
                </div>
                <span className="text-[9px] font-mono text-gray-500 uppercase tracking-widest font-bold ml-2">Console</span>
              </div>
              <button 
                onClick={clearTerminal}
                className="text-[9px] text-gray-600 hover:text-gray-400 uppercase font-bold transition-colors"
              >
                Clear
              </button>
            </div>
            
            <div 
              ref={terminalRef}
              className="flex-1 overflow-y-auto p-4 font-mono text-[10px] md:text-xs leading-relaxed space-y-1.5 scrollbar-thin scrollbar-thumb-gray-800"
            >
              {terminalHistory.map((line, i) => (
                <div key={i} className={`break-words ${
                  line.type === 'command' ? 'text-emerald-400 font-bold' : 
                  line.type === 'error' ? 'text-red-400 bg-red-950/20 px-1 rounded' : 
                  'text-gray-300'
                }`}>
                  {line.text}
                </div>
              ))}
            </div>

            <div className="p-3 border-t border-[#1C1F26] bg-[#0A0C10]">
              <div className="flex items-center justify-between text-[8px] md:text-[10px] text-gray-500 font-mono">
                <div className="flex items-center gap-1">
                  <span className={`w-1 h-1 rounded-full ${isConnected ? 'bg-emerald-500' : 'bg-red-500'}`} />
                  {isConnected ? 'READY' : 'OFFLINE'}
                </div>
                <span>ROOM: {roomId}</span>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

import React, { useState, useRef, useEffect } from 'react';
import { Terminal as TerminalIcon, Send, Copy, Check, Power, AlertCircle, HelpCircle, Code, Cpu, ShieldCheck, Download } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useTermux, Message, TerminalLine } from './hooks/useTermux';
import { getGeminiResponse } from './lib/gemini';

export default function App() {
  const { roomId, isConnected, terminalHistory, sendCommand, writeRemoteFile, clearTerminal } = useTermux();
  const [messages, setMessages] = useState<Message[]>([
    { role: 'model', content: "Hello! I'm your Termux Code Genius. Once you connect your Termux terminal, I can help you code, manage files, and automate your mobile environment. How can I assist you today?" }
  ]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [showSetup, setShowSetup] = useState(!isConnected);
  const [copied, setCopied] = useState(false);
  
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

    const userMessage: Message = { role: 'user', content: input };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsTyping(true);

    const response = await getGeminiResponse([...messages, userMessage], async (name, args) => {
      if (name === 'execute_shell_command') {
        const result = await sendCommand(args.command);
        return result;
      } else if (name === 'write_file') {
        const result = await writeRemoteFile(args.path, args.content);
        return result;
      }
      return { error: 'Unknown tool' };
    });

    setMessages(prev => [...prev, { role: 'model', content: response || "" }]);
    setIsTyping(false);
  };

  const agentScript = `
import asyncio
import websockets
import json
import subprocess
import os

ROOM_ID = "${roomId}"
RE_URL = "${window.location.host}"
WS_URL = f"ws://{RE_URL}/?room={ROOM_ID}&role=agent"

async def run_agent():
    print(f"Connecting to {WS_URL}...")
    async with websockets.connect(WS_URL) as websocket:
        print("Connected! Termux Code Genius is ready.")
        async for message in websocket:
            data = json.loads(message)
            if data['type'] == 'execute':
                cmd_id = data['data']['id']
                command = data['data']['command']
                print(f"Executing: {command}")
                try:
                    process = await asyncio.create_subprocess_shell(
                        command,
                        stdout=asyncio.subprocess.PIPE,
                        stderr=asyncio.subprocess.PIPE
                    )
                    stdout, stderr = await process.communicate()
                    
                    response = {
                        "type": "command_output",
                        "data": {
                            "id": cmd_id,
                            "output": stdout.decode(),
                            "error": stderr.decode()
                        }
                    }
                    await websocket.send(json.json(response))
                except Exception as e:
                    await websocket.send(json.json({
                        "type": "command_output",
                        "data": { "id": cmd_id, "error": str(e) }
                    }))
            elif data['type'] == 'write_file':
                file_id = data['data']['id']
                file_path = data['data']['path']
                content = data['data']['content']
                print(f"Writing file: {file_path}")
                try:
                    os.makedirs(os.path.dirname(file_path), exist_ok=True)
                    with open(file_path, "w") as f:
                        f.write(content)
                    await websocket.send(json.json({
                        "type": "file_result",
                        "data": { "id": file_id, "success": True }
                    }))
                except Exception as e:
                    await websocket.send(json.json({
                        "type": "file_result",
                        "data": { "id": file_id, "success": False, "error": str(e) }
                    }))

if __name__ == "__main__":
    asyncio.run(run_agent())
`.trim();

  // Python JSON serialization fix for the template string
  const finalAgentScript = agentScript.replace(/json\.json/g, 'json.dumps');

  const copyScript = () => {
    navigator.clipboard.writeText(`pkg install python -y && pip install websockets\ncat > agent.py <<EOF\n${finalAgentScript}\nEOF\npython agent.py`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex h-screen bg-[#0F1115] text-[#E4E6EB] font-sans overflow-hidden">
      {/* Sidebar / Setup Instructions */}
      <AnimatePresence>
        {showSetup && (
          <motion.div 
            initial={{ x: -400, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -400, opacity: 0 }}
            className="w-96 border-r border-[#1C1F26] bg-[#0A0C10] p-6 flex flex-col overflow-y-auto z-20 shadow-2xl"
          >
            <div className="flex items-center justify-between mb-8">
              <h2 className="text-xl font-bold flex items-center gap-2">
                <ShieldCheck className="w-6 h-6 text-emerald-400" />
                Setup Guide
              </h2>
              <button onClick={() => setShowSetup(false)} className="text-gray-500 hover:text-white">
                <Power className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-6">
              <section>
                <div className="flex items-center gap-2 mb-2 text-emerald-400 font-mono text-sm uppercase tracking-wider">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  Step 1: Install Requirements
                </div>
                <p className="text-gray-400 text-sm mb-3">Ensure you have Python and common tools installed in Termux.</p>
                <div className="bg-[#151821] p-3 rounded font-mono text-xs text-blue-300 border border-[#1C1F26]">
                  pkg install python -y && pip install websockets
                </div>
              </section>

              <section>
                <div className="flex items-center gap-2 mb-2 text-emerald-400 font-mono text-sm uppercase tracking-wider">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  Step 2: Run Bridge Agent
                </div>
                <p className="text-gray-400 text-sm mb-3">Copy and paste this command into your Termux terminal to start the bridge.</p>
                <div className="relative">
                  <div className="bg-[#151821] p-3 rounded font-mono text-xs text-gray-300 border border-[#1C1F26] h-32 overflow-y-auto break-all scrollbar-hide">
                    {`cat > agent.py <<EOF\n${finalAgentScript}\nEOF\npython agent.py`}
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
                    This bridge uses a temporary Room ID (<span className="text-emerald-400 font-mono">{roomId}</span>). 
                    Your terminal remains secure as it only executes commands generated by this AI session.
                  </p>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col relative overflow-hidden">
        {/* Top Header */}
        <header className="h-16 border-b border-[#1C1F26] flex items-center justify-between px-6 bg-[#0A0C10] z-10">
          <div className="flex items-center gap-4">
            {!showSetup && (
              <button 
                onClick={() => setShowSetup(true)}
                className="p-2 hover:bg-[#1C1F26] rounded-md text-gray-400 transition-colors"
                title="Show Setup Guide"
              >
                <HelpCircle className="w-5 h-5" />
              </button>
            )}
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-900/20">
                <Cpu className="text-white w-6 h-6" />
              </div>
              <div>
                <h1 className="font-bold text-lg tracking-tight">Termux Code Genius</h1>
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
                  <span className="text-[10px] uppercase font-bold tracking-widest text-gray-500">
                    {isConnected ? 'Bridge Active' : 'Waiting for Termux Connection...'}
                  </span>
                </div>
              </div>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
             <div className="hidden md:flex flex-col items-end">
                <span className="text-[10px] text-gray-500 uppercase font-bold">Room Session</span>
                <span className="text-xs font-mono text-gray-300">{roomId}</span>
             </div>
             <div className="h-8 w-[1px] bg-[#1C1F26]" />
             <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg">
                <span className="font-bold text-xs">U</span>
             </div>
          </div>
        </header>

        {/* Layout: Messages & Terminal */}
        <main className="flex-1 flex overflow-hidden">
          {/* Chat Pane */}
          <div className="flex-1 flex flex-col min-w-0 border-r border-[#1C1F26]">
            <div 
              ref={scrollRef}
              className="flex-1 overflow-y-auto p-6 space-y-6 scroll-smooth scrollbar-thin scrollbar-track-transparent scrollbar-thumb-gray-800"
            >
              <AnimatePresence initial={false}>
                {messages.map((message, i) => (
                  <motion.div
                    key={i}
                    initial={{ y: 10, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div className={`max-w-[85%] rounded-2xl px-4 py-3 shadow-sm ${
                      message.role === 'user' 
                        ? 'bg-blue-600 text-white rounded-tr-none' 
                        : 'bg-[#1C1F26] text-gray-200 border border-[#2A2E38] rounded-tl-none'
                    }`}>
                      <p className="text-sm leading-relaxed whitespace-pre-wrap">{message.content}</p>
                      {message.role === 'model' && message.content.includes("```") && (
                         <div className="mt-3 flex items-center gap-2 text-[10px] text-gray-500 font-bold uppercase tracking-wider">
                           <Code className="w-3 h-3" />
                           Source Reference Included
                         </div>
                      )}
                    </div>
                  </motion.div>
                ))}
                {isTyping && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="flex justify-start"
                  >
                    <div className="bg-[#1C1F26] rounded-2xl rounded-tl-none px-4 py-3 flex gap-1 items-center border border-[#2A2E38]">
                      <span className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce [animation-delay:-0.3s]" />
                      <span className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce [animation-delay:-0.15s]" />
                      <span className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce" />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Input Bar */}
            <div className="p-6 pt-0 bg-[#0F1115]/80 backdrop-blur-md">
              <div className="relative group">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleSend())}
                  placeholder="Ask Gemini to code something in your Termux terminal..."
                  className="w-full bg-[#1C1F26] border border-[#2A2E38] rounded-2xl py-4 pl-5 pr-14 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all resize-none h-14 scrollbar-hide"
                />
                <button
                  onClick={handleSend}
                  disabled={!input.trim() || isTyping}
                  className="absolute right-3 top-3 p-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 text-white rounded-xl transition-all shadow-lg active:scale-95"
                >
                  <Send className="w-5 h-5" />
                </button>
              </div>
              <p className="mt-2 text-center text-[10px] text-gray-500 flex items-center justify-center gap-1">
                <AlertCircle className="w-3 h-3" />
                Always review generated shell commands before execution.
              </p>
            </div>
          </div>

          {/* Terminal Pane */}
          <div className="w-[450px] flex flex-col bg-black overflow-hidden select-none">
            <div className="flex items-center justify-between px-4 py-2 border-b border-[#1C1F26] bg-[#0A0C10]">
              <div className="flex items-center gap-2">
                <div className="flex gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full bg-red-500/50" />
                  <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/50" />
                  <div className="w-2.5 h-2.5 rounded-full bg-green-500/50" />
                </div>
                <div className="h-4 w-[1px] bg-[#1C1F26] mx-2" />
                <span className="text-[10px] font-mono text-gray-500 uppercase tracking-widest font-bold">Termux Bridge Console</span>
              </div>
              <button 
                onClick={clearTerminal}
                className="text-[10px] text-gray-600 hover:text-gray-400 uppercase font-bold transition-colors"
              >
                Clear
              </button>
            </div>
            
            <div 
              ref={terminalRef}
              className="flex-1 overflow-y-auto p-4 font-mono text-xs leading-relaxed space-y-1.5 scrollbar-thin scrollbar-thumb-gray-800"
            >
              {terminalHistory.length === 0 && (
                <div className="text-gray-700 italic py-2">No session data. Connect your agent to begin...</div>
              )}
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

            <div className="p-4 border-t border-[#1C1F26] bg-[#0A0C10]">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-[10px] text-gray-500 font-mono">
                  <span className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-emerald-500' : 'bg-red-500'}`} />
                  {isConnected ? 'NODE SESSION: ACTIVE' : 'NODE SESSION: DISCONNECTED'}
                </div>
                <div className="text-[10px] text-gray-500 font-mono">
                  ROOM: {roomId}
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

import { useState, useEffect, useRef, useCallback } from 'react';

export type Message = {
  role: 'user' | 'model' | 'system';
  content: string;
};

export type TerminalLine = {
  type: 'command' | 'output' | 'error';
  text: string;
  timestamp: number;
};

export function useTermux() {
  const [roomId] = useState(() => Math.random().toString(36).substring(2, 10));
  const [isConnected, setIsConnected] = useState(false);
  const [terminalHistory, setTerminalHistory] = useState<TerminalLine[]>([]);
  const socketRef = useRef<WebSocket | null>(null);
  const pendingRequests = useRef<Map<string, (res: any) => void>>(new Map());

  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/?room=${roomId}&role=ui`;
    
    const socket = new WebSocket(wsUrl);
    socketRef.current = socket;

    socket.onopen = () => {
      console.log('Connected to WebSocket relay');
    };

    socket.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'status') {
        if (msg.data === 'agent_connected') setIsConnected(true);
        if (msg.data === 'agent_disconnected') setIsConnected(false);
      } else if (msg.type === 'command_output') {
        const { id, output, error } = msg.data;
        const resolver = pendingRequests.current.get(id);
        if (resolver) {
          resolver({ output, error });
          pendingRequests.current.delete(id);
        }
        
        if (output) addTerminalLine('output', output);
        if (error) addTerminalLine('error', error);
      } else if (msg.type === 'file_result') {
        const { id, success, error } = msg.data;
        const resolver = pendingRequests.current.get(id);
        if (resolver) {
          resolver({ success, error });
          pendingRequests.current.delete(id);
        }
      }
    };

    socket.onclose = () => {
      setIsConnected(false);
    };

    return () => {
      socket.close();
    };
  }, [roomId]);

  const addTerminalLine = useCallback((type: TerminalLine['type'], text: string) => {
    setTerminalHistory(prev => [...prev, { type, text, timestamp: Date.now() }].slice(-100));
  }, []);

  const sendCommand = useCallback((command: string): Promise<any> => {
    return new Promise((resolve) => {
      if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
        resolve({ error: "Termux Agent is not connected" });
        return;
      }

      const id = Math.random().toString(36).substring(7);
      pendingRequests.current.set(id, resolve);
      
      addTerminalLine('command', `$ ${command}`);
      
      socketRef.current.send(JSON.stringify({
        type: 'execute',
        data: { id, command }
      }));
    });
  }, [addTerminalLine]);

  const writeRemoteFile = useCallback((path: string, content: string): Promise<any> => {
    return new Promise((resolve) => {
      if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
        resolve({ error: "Termux Agent is not connected" });
        return;
      }

      const id = Math.random().toString(36).substring(7);
      pendingRequests.current.set(id, resolve);
      
      addTerminalLine('output', `Writing file: ${path}...`);
      
      socketRef.current.send(JSON.stringify({
        type: 'write_file',
        data: { id, path, content }
      }));
    });
  }, [addTerminalLine]);

  return {
    roomId,
    isConnected,
    terminalHistory,
    sendCommand,
    writeRemoteFile,
    clearTerminal: () => setTerminalHistory([])
  };
}

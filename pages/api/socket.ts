import { NextApiRequest, NextApiResponse } from 'next';
import { Server as ServerIO } from 'socket.io';
import { initializeWebSocketServer } from '@/lib/websocket';

export default function SocketHandler(req: NextApiRequest, res: NextApiResponse) {
  // Only allow GET requests
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    res.status(405).end(`Method ${req.method} Not Allowed`);
    return;
  }

  // Check if WebSocket server is already initialized
  if ((res.socket as any).server.io) {
    console.log('Socket is already running');
    res.status(200).json({ message: 'Socket server already running' });
    return;
  }

  console.log('Socket is initializing');
  const httpServer = (res.socket as any).server;

  const io = new ServerIO(httpServer, {
    path: '/api/socket',
    cors: {
      origin: process.env.NODE_ENV === 'production' ? false : true,
      methods: ['GET', 'POST']
    },
    transports: ['websocket', 'polling']
  });

  // Attach io to server
  (res.socket as any).server.io = io;

  // Initialize our custom WebSocket handlers
  initializeWebSocketServer(httpServer);

  res.status(200).json({ message: 'Socket server initialized' });
}
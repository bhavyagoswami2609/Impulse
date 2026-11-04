import peerPkg from 'peerjs';
const Peer = peerPkg?.Peer || peerPkg?.default?.Peer || peerPkg;

/**
 * Binary Packet Tags for low-latency Float32Array telemetry over WebRTC DataChannel
 */
export const PACKET_TAGS = {
  TT_SYNC: 1.0,
  TT_CLIENT_INPUT: 2.0,
  HOCKEY_SYNC: 3.0,
  HOCKEY_CLIENT_INPUT: 4.0,
};

/**
 * MultiplayerManager coordinates serverless WebRTC peer-to-peer connections using PeerJS
 */
export class MultiplayerManager {
  constructor(callbacks = {}) {
    this.callbacks = Object.assign(
      {
        onConnected: (role, peerId) => {},
        onDisconnected: () => {},
        onDataReceived: (packet) => {},
        onStatusChange: (status, message) => {},
      },
      callbacks
    );

    this.peer = null;
    this.connection = null;
    this.role = null; // 'host' or 'client'
    this.roomId = null;
    this.isConnected = false;
  }

  /**
   * Helper to generate a clean 6-character room code (e.g. "SMASH-742")
   */
  static generateRoomId() {
    const num = Math.floor(100 + Math.random() * 900);
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const letter1 = chars[Math.floor(Math.random() * chars.length)];
    const letter2 = chars[Math.floor(Math.random() * chars.length)];
    return `TT-${letter1}${letter2}${num}`;
  }

  /**
   * Initialize Host Peer
   */
  createRoom(roomId) {
    this.roomId = roomId || MultiplayerManager.generateRoomId();
    this.role = 'host';
    const peerId = `tt-${this.roomId.toLowerCase()}-host`;

    this.callbacks.onStatusChange('connecting', `Creating Room ${this.roomId}...`);

    if (this.peer) {
      this.peer.destroy();
    }

    try {
      this.peer = new Peer(peerId, {
        debug: 1,
      });

      this.peer.on('open', (id) => {
        this.callbacks.onStatusChange('waiting', `Room ${this.roomId} ready! Waiting for Player 2...`);
      });

      this.peer.on('connection', (conn) => {
        this.connection = conn;
        this.setupConnectionHandlers();
      });

      this.peer.on('error', (err) => {
        console.warn('Peer error (host):', err);
        if (err.type === 'unavailable-id') {
          // Room ID already in use, regenerate
          this.createRoom(MultiplayerManager.generateRoomId());
        } else {
          this.callbacks.onStatusChange('error', `Connection error: ${err.type}`);
        }
      });
    } catch (e) {
      this.callbacks.onStatusChange('error', `Failed to initialize PeerJS: ${e.message}`);
    }

    return this.roomId;
  }

  /**
   * Initialize Client Peer and connect to Host
   */
  joinRoom(roomId) {
    this.roomId = roomId.trim().toUpperCase();
    this.role = 'client';
    const randomSuffix = Math.random().toString(36).substring(2, 6);
    const clientId = `tt-${this.roomId.toLowerCase()}-client-${randomSuffix}`;
    const hostPeerId = `tt-${this.roomId.toLowerCase()}-host`;

    this.callbacks.onStatusChange('connecting', `Connecting to Room ${this.roomId}...`);

    if (this.peer) {
      this.peer.destroy();
    }

    try {
      this.peer = new Peer(clientId, {
        debug: 1,
      });

      this.peer.on('open', () => {
        // Connect to host
        this.connection = this.peer.connect(hostPeerId, {
          reliable: false, // Low-latency UDP data channel for real-time sports telemetry
        });
        this.setupConnectionHandlers();
      });

      this.peer.on('error', (err) => {
        console.warn('Peer error (client):', err);
        this.callbacks.onStatusChange('error', `Failed to reach Room ${this.roomId}: ${err.type}`);
      });
    } catch (e) {
      this.callbacks.onStatusChange('error', `Client error: ${e.message}`);
    }

    return this.roomId;
  }

  setupConnectionHandlers() {
    if (!this.connection) return;

    this.connection.on('open', () => {
      this.isConnected = true;
      this.callbacks.onStatusChange('connected', `Connected to peer in Room ${this.roomId}!`);
      this.callbacks.onConnected(this.role, this.connection.peer);

      // Send initial handshake
      this.send({
        type: 'handshake',
        role: this.role,
        timestamp: Date.now(),
      });
    });

    this.connection.on('data', (data) => {
      if (data instanceof ArrayBuffer) {
        this.callbacks.onDataReceived(new Float32Array(data));
      } else if (ArrayBuffer.isView(data) && !(data instanceof Float32Array)) {
        this.callbacks.onDataReceived(new Float32Array(data.buffer, data.byteOffset, data.byteLength / 4));
      } else {
        this.callbacks.onDataReceived(data);
      }
    });

    this.connection.on('close', () => {
      this.isConnected = false;
      this.callbacks.onStatusChange('disconnected', 'Peer disconnected.');
      this.callbacks.onDisconnected();
    });

    this.connection.on('error', (err) => {
      console.warn('DataChannel error:', err);
      this.callbacks.onStatusChange('error', `DataChannel error: ${err}`);
    });
  }

  /**
   * Broadcast real-time packet to the peer
   */
  send(payload) {
    if (this.connection && this.connection.open) {
      this.connection.send(payload);
    }
  }

  disconnect() {
    this.isConnected = false;
    if (this.connection) {
      try {
        this.connection.close();
      } catch (e) {}
    }
    if (this.peer) {
      try {
        this.peer.destroy();
      } catch (e) {}
    }
    this.role = null;
    this.roomId = null;
  }
}

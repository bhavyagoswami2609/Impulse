import peerPkg from 'peerjs';
const Peer = peerPkg?.Peer || peerPkg?.default?.Peer || peerPkg;

/**
 * Standard 32-byte Binary Packet Types (Float32Array with 8 floats)
 * [0]: Packet type
 *   1.0 = Position State
 *   2.0 = Score Update
 *   3.0 = Collision Event
 */
export const PACKET_TYPES = {
  POSITION_STATE: 1.0,
  SCORE_UPDATE: 2.0,
  COLLISION_EVENT: 3.0,
};

/**
 * Backwards-compatible aliases for unit tests
 */
export const PACKET_TAGS = {
  POSITION_STATE: 1.0,
  SCORE_UPDATE: 2.0,
  COLLISION_EVENT: 3.0,
  TT_SYNC: 1.0,
  TT_CLIENT_INPUT: 2.0,
  HOCKEY_SYNC: 3.0,
  HOCKEY_CLIENT_INPUT: 4.0,
};

/**
 * MultiplayerManager coordinates serverless WebRTC peer-to-peer connections using PeerJS
 * with unordered, unreliable DataChannels and zero-lag 32-byte binary packet serialization.
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

    // Pre-allocated 32-byte (8-float) reusable buffers to prevent GC pauses
    this.posPacket = new Float32Array(8);
    this.scorePacket = new Float32Array(8);
    this.collisionPacket = new Float32Array(8);
  }

  /**
   * Generates a clean 5-letter uppercase room code (e.g. "KPNRX")
   */
  static generateRoomId() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    let code = '';
    for (let i = 0; i < 5; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  /**
   * Creates a compact 32-byte (8 float) Position State Packet
   * [0]: 1.0 (POSITION_STATE)
   * [1..3]: Paddle / Striker X, Y, Z
   * [4..6]: Ball / Puck X, Y, Z
   * [7]: Flags / Velocity / Hand State
   */
  encodePositionState(paddleX, paddleY, paddleZ, objX, objY, objZ, flags = 0.0) {
    this.posPacket[0] = PACKET_TYPES.POSITION_STATE;
    this.posPacket[1] = paddleX;
    this.posPacket[2] = paddleY;
    this.posPacket[3] = paddleZ;
    this.posPacket[4] = objX;
    this.posPacket[5] = objY;
    this.posPacket[6] = objZ;
    this.posPacket[7] = flags;
    return this.posPacket;
  }

  /**
   * Creates a compact 32-byte (8 float) Score Update Packet
   * [0]: 2.0 (SCORE_UPDATE)
   * [1]: P1 Score
   * [2]: P2 Score
   * [3]: Serving player (1.0 or 2.0)
   * [4]: Match state code
   * [5]: P1 Energy / Power
   * [6]: P2 Energy / Power
   * [7]: Timestamp (seconds)
   */
  encodeScoreUpdate(p1Score, p2Score, server = 1.0, state = 1.0, p1Power = 0.0, p2Power = 0.0) {
    this.scorePacket[0] = PACKET_TYPES.SCORE_UPDATE;
    this.scorePacket[1] = p1Score;
    this.scorePacket[2] = p2Score;
    this.scorePacket[3] = server;
    this.scorePacket[4] = state;
    this.scorePacket[5] = p1Power;
    this.scorePacket[6] = p2Power;
    this.scorePacket[7] = (Date.now() % 1000000) / 1000.0;
    return this.scorePacket;
  }

  /**
   * Creates a compact 32-byte (8 float) Collision Event Packet
   * [0]: 3.0 (COLLISION_EVENT)
   * [1]: Collision Subtype (1=Paddle Hit, 2=Table Bounce, 3=Wall Hit, 4=Goal)
   * [2..4]: Collision Contact Position X, Y, Z
   * [5..7]: Impact Velocity Vector X, Y, Z
   */
  encodeCollisionEvent(collisionType, posX, posY, posZ, velX, velY, velZ) {
    this.collisionPacket[0] = PACKET_TYPES.COLLISION_EVENT;
    this.collisionPacket[1] = collisionType;
    this.collisionPacket[2] = posX;
    this.collisionPacket[3] = posY;
    this.collisionPacket[4] = posZ;
    this.collisionPacket[5] = velX;
    this.collisionPacket[6] = velY;
    this.collisionPacket[7] = velZ;
    return this.collisionPacket;
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

      this.peer.on('open', () => {
        this.callbacks.onStatusChange('waiting', `Room ${this.roomId} ready! Waiting for Player 2...`);
      });

      this.peer.on('connection', (conn) => {
        this.connection = conn;
        this.setupConnectionHandlers();
      });

      this.peer.on('error', (err) => {
        console.warn('Peer error (host):', err);
        if (err.type === 'unavailable-id') {
          // Room ID already in use, regenerate clean 5-letter code
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
   * Initialize Client Peer and connect to Host with unordered unreliable DataChannel
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
        // Connect to host with unordered, unreliable DataChannel and raw binary serialization
        this.connection = this.peer.connect(hostPeerId, {
          reliable: false,
          serialization: 'none',
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

      // Initial binary handshake packet using compact Float32Array (no JSON)
      const handshake = new Float32Array(8);
      handshake[0] = 1.0; // Position state / handshake
      handshake[1] = this.role === 'host' ? 1.0 : 2.0;
      this.send(handshake);
    });

    this.connection.on('data', (data) => {
      if (data instanceof ArrayBuffer) {
        this.callbacks.onDataReceived(new Float32Array(data));
      } else if (ArrayBuffer.isView(data)) {
        if (data instanceof Float32Array) {
          this.callbacks.onDataReceived(data);
        } else {
          this.callbacks.onDataReceived(new Float32Array(data.buffer, data.byteOffset, data.byteLength / 4));
        }
      } else if (data instanceof Blob) {
        data.arrayBuffer().then((buf) => {
          this.callbacks.onDataReceived(new Float32Array(buf));
        }).catch((err) => console.warn('Blob unpack error:', err));
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
   * Broadcast real-time binary packet to the peer
   * Transmits raw ArrayBuffer / Float32Array directly (zero JSON.stringify overhead)
   */
  send(payload) {
    if (!this.connection || !this.connection.open) return;

    if (payload instanceof Float32Array) {
      this.connection.send(payload.buffer);
    } else if (payload instanceof ArrayBuffer) {
      this.connection.send(payload);
    } else if (ArrayBuffer.isView(payload)) {
      this.connection.send(payload.buffer);
    } else if (typeof payload === 'object') {
      // Replaced JSON.stringify with compact Float32Array binary packet
      const packet = new Float32Array(8);
      packet[0] = PACKET_TYPES.POSITION_STATE;
      if (payload.scores) {
        packet[0] = PACKET_TYPES.SCORE_UPDATE;
        packet[1] = payload.scores[0] || 0;
        packet[2] = payload.scores[1] || 0;
        packet[3] = payload.server || 1;
      }
      this.connection.send(packet.buffer);
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

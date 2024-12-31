import { ChatMessage, MessageHandlerDependencies, AnswerContent, IceCandidateContent, OfferContent, PeerConnection, PeerConnectionState, createPeerConnection } from '../types/chat';
import { useMediaStore } from '../store/mediaStore';

// Add to the WebSocketMessage type union
interface WebSocketMessage {
  type: 'startMeeting' | 'createOffer' | 'offer' | 'answer' | 'iceCandidate' | 
        'userID' | 'initiatorStatus' | 'chatMessage' | 'userList' | 'incoming_call';
  content: any;
  room_id?: string;
}

interface IceCandidateQueue {
  candidates: RTCIceCandidateInit[];
  hasRemoteDescription: boolean;
  createdAt: number;              // Timestamp when queue was created
  lastUpdated: number;            // Timestamp of last candidate added
  processedCount: number;         // Number of candidates successfully processed
  connectionState?: RTCIceConnectionState;  // Current ICE connection state
  gatheringState?: RTCIceGatheringState;   // Current ICE gathering state
}

const iceCandidateQueues = new Map<string, IceCandidateQueue>();
const offerQueue: Map<string, RTCSessionDescription> = new Map();
const recoveryAttempted = new Map<string, boolean>();

// Add a flag to track if we've received our initiator status
let hasReceivedInitiatorStatus = false;
let pendingUserId: string | null = null;

let internalState = {
    userId: null as string | null
};

// Add debouncing/cooldown for ICE restarts
let lastIceRestart = 0;
const ICE_RESTART_COOLDOWN = 1000; // 1 second

// Add at the top with other constants
const ICE_RETRY_MAX = 3;
const ICE_RETRY_DELAY = 2000; // 2 seconds

// Add at the top with other utility functions
const safeSetStorage = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value);
  } catch (error) {
    console.warn('localStorage write failed:', error);
  }
};

// Utility to shorten UUIDs/IDs
const short = (id: string) => id.slice(0, 4);

// Simplified logging utility
const logMsg = (type: string, msg: string, data?: any) => {
    const shortData = data ? JSON.stringify(data).slice(0, 50) : '';
    console.log(`[${type}] ${msg} ${shortData}`);
};

const ensureLocalMedia = async (deps: MessageHandlerDependencies) => {
    const mediaStore = useMediaStore.getState();
    if (!mediaStore.localStream) {
        logMsg('MEDIA', 'Requesting local media access');
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ 
                video: true, 
                audio: true 
            });
            mediaStore.setLocalStream(stream);
            mediaStore.setMediaReady(true);
            logMsg('MEDIA', `Got local stream with ${stream.getTracks().length} tracks`);
            return stream;
        } catch (error) {
            logMsg('ERROR', `Failed to get local media: ${error}`);
            throw error;
        }
    }
    return mediaStore.localStream;
};

const setupPeerConnection = async (peerId: string, deps: MessageHandlerDependencies): Promise<RTCPeerConnection> => {
    const pc = new RTCPeerConnection({
        iceServers: await getIceServers(),
        iceTransportPolicy: 'all',
        bundlePolicy: 'balanced',
        iceCandidatePoolSize: 1
    });
    
    const peerConn = createPeerConnection(peerId, pc);
    deps.peerConnections.set(peerId, peerConn);

    // Add local tracks immediately
    const mediaStore = useMediaStore.getState();
    const localStream = mediaStore.localStream;
    if (localStream) {
        localStream.getTracks().forEach(track => {
            pc.addTrack(track, localStream);
            logMsg('TRACK', `Added ${track.kind} track to peer connection ${peerId}`);
        });
    }

    // Handle ICE candidates
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            deps.sendMessage('iceCandidate', {
                candidate: event.candidate,
                fromPeerId: deps.getState().userId,
                targetPeerId: peerId
            });
            logMsg('ICE', `Sent candidate to ${peerId}`);
        }
    };

    pc.oniceconnectionstatechange = () => {
        logMsg('ICE', `Connection state for ${peerId}: ${pc.iceConnectionState}`);
        const conn = deps.peerConnections.get(peerId);
        if (!conn) return;

        const mediaStore = useMediaStore.getState();

        switch (pc.iceConnectionState) {
            case 'checking':
                conn.connectionState = PeerConnectionState.CONNECTING;
                mediaStore.updatePeerState(peerId, PeerConnectionState.CONNECTING);
                break;
            case 'connected':
            case 'completed':
                conn.connectionState = PeerConnectionState.CONNECTED;
                mediaStore.updatePeerState(peerId, PeerConnectionState.CONNECTED);
                deps.activePeers.add(peerId);
                break;
            case 'failed':
                conn.connectionState = PeerConnectionState.FAILED;
                conn.iceRetryCount++;
                if (conn.iceRetryCount < ICE_RETRY_MAX) {
                    retryIceConnection(pc, peerId, deps);
                }
                deps.activePeers.delete(peerId);
                break;
            case 'closed':
                conn.connectionState = PeerConnectionState.CLOSED;
                deps.activePeers.delete(peerId);
                break;
        }
        deps.peerConnections.set(peerId, conn);
    };

    // Add connection state change handler
    pc.onconnectionstatechange = () => {
        logMsg('CONN', `Connection state for ${peerId}: ${pc.connectionState}`);
    };

    // Add signaling state change handler
    pc.onsignalingstatechange = () => {
        logMsg('SIGNAL', `Signaling state for ${peerId}: ${pc.signalingState}`);
    };

    pc.ontrack = (event) => {
        const conn = deps.peerConnections.get(peerId);
        if (!conn) return;

        const kind = event.track.kind as 'audio' | 'video';
        conn.trackReadyState[kind] = {
            track: event.track,
            ready: true,
            timestamp: Date.now()
        };
        conn.trackStatus[kind] = true;
        conn.lastTrackUpdate = Date.now();
        
        // Add to MediaStore immediately when track arrives
        const mediaStore = useMediaStore.getState();
        mediaStore.addPeerTrack(peerId, event.track, event.streams[0]);
        mediaStore.updateTrackStatus(peerId, kind, true);
        
        // Update connection state
        if (conn.trackStatus.audio && conn.trackStatus.video) {
            conn.connectionState = PeerConnectionState.READY;
        }
        
        // Update MediaStore connection state
        mediaStore.updatePeerState(peerId, conn.connectionState);
        
        // Ensure peer is marked as active
        deps.activePeers.add(peerId);
        
        deps.peerConnections.set(peerId, conn);
        
        // Log track addition
        console.log(`[TRACK] Added ${kind} track to MediaStore for peer ${peerId}`, {
            trackId: event.track.id,
            readyState: event.track.readyState,
            enabled: event.track.enabled
        });
    };

    // Add any pending candidates
    const pending = iceCandidateQueues.get(peerId)?.candidates || [];
    for (const candidate of pending) {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
    }
    iceCandidateQueues.delete(peerId);

    return pc;
};

const handleOffer = async (content: OfferContent, deps: MessageHandlerDependencies) => {
    const { sdp, fromPeerId: peerId } = content;
    
    if (!peerId) {
        logMsg('ERROR', 'No peer ID in offer');
        return;
    }

    logMsg('OFFER', `Handling offer from ${peerId}`);
    let peerConn = deps.peerConnections.get(peerId);

    try {
        // Create or get peer connection
        if (!peerConn) {
            logMsg('ICE', `Setting up new peer connection for ${peerId}`);
            const newPc = await setupPeerConnection(peerId, deps);
            peerConn = createPeerConnection(peerId, newPc);
            deps.peerConnections.set(peerId, peerConn);
        }

        const pc = peerConn.connection;

        // Set remote description
        logMsg('SDP', `Setting remote description for ${peerId}`);
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
        logMsg('SIGNAL', `Signaling state for ${peerId}: ${pc.signalingState}`);

        // Create and set local description (answer)
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        
        // Process any queued candidates now that we have both descriptions
        await processQueuedCandidates(pc, peerId);

        // Send answer
        deps.sendMessage('answer', {
            sdp: answer,
            fromPeerID: deps.getState().userId,
            targetPeerID: peerId
        });
        logMsg('ANSWER', `Sent answer to ${peerId}`);
        
        // Update connection state
        peerConn.connectionState = pc.connectionState as PeerConnectionState;
        deps.peerConnections.set(peerId, peerConn);
        logMsg('STATE', `Peer ${peerId} connection state: ${pc.connectionState}`);

    } catch (err) {
        logMsg('ERROR', `Failed to handle offer from ${peerId}: ${err}`);
        if (peerConn) {
            peerConn.connectionState = PeerConnectionState.FAILED;
            deps.peerConnections.set(peerId, peerConn);
        }
    }
};

const handleAnswer = async (content: AnswerContent, deps: MessageHandlerDependencies) => {
    if (!content.fromPeerId) {
        logMsg('ERROR', 'Missing from peer ID');
        return;
    }

    const peerId = content.fromPeerId;
    const pc = deps.peerConnections.get(peerId);
    
    if (!pc) {
        logMsg('ERROR', `No connection found for peer ${peerId}`);
        return;
    }
    
    try {
        // 1. Validate signaling state
        if (pc.connection.signalingState === 'stable') {
            logMsg('ANSWER', `Connection already stable for ${peerId}, ignoring answer`);
            return;
        }

        if (pc.connection.signalingState !== 'have-local-offer') {
            logMsg('ERROR', `Wrong signaling state for ${peerId}: ${pc.connection.signalingState}`);
            return;
        }

        // 2. Set remote description (answer)
        logMsg('SDP', `Setting remote description (answer) for ${peerId}`);
        await pc.connection.setRemoteDescription(new RTCSessionDescription({
            type: 'answer',
            sdp: typeof content.sdp === 'string' ? content.sdp : content.sdp.sdp
        }));
        logMsg('ANSWER', `Set remote description for ${peerId}`);

        // 3. Process any queued ICE candidates now that we have remote description
        logMsg('ICE', `Processing queued candidates for ${peerId}`);
        await processQueuedCandidates(pc.connection, peerId);
        
        // 4. Verify local tracks (shouldn't need to add, but verify)
        const mediaStore = useMediaStore.getState();
        const localStream = mediaStore.localStream;
        if (localStream) {
            const senders = pc.connection.getSenders();
            localStream.getTracks().forEach(track => {
                if (!senders.find(s => s.track?.id === track.id)) {
                    logMsg('TRACK', `Adding missing ${track.kind} track for ${peerId}`);
                    pc.connection.addTrack(track, localStream);
                }
            });
        }

        logMsg('CONN', `Answer processing complete for ${peerId}`);
        
    } catch (err) {
        logMsg('ERROR', `Failed to handle answer from ${peerId}: ${err}`);
        pc.connectionState = PeerConnectionState.FAILED;
        deps.peerConnections.set(peerId, pc);
    }
};

// Add at the top with other utility functions
const getIceServers = async () => {
    try {
        const url = 'https://nochat.io/api/ice-servers';
        logMsg('[ICE]', `Fetching from URL: ${url}`);
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        logMsg('[ICE]', 'Parsed response:', data);
        return data.iceServers;
    } catch (error) {
        console.error('[ICE] Failed to fetch servers:', error);
        // Fallback to public STUN server
        return [{ urls: 'stun:stun.l.google.com:19302' }];
    }
};

const processQueuedCandidates = async (pc: RTCPeerConnection, peerId: string) => {
    const queue = iceCandidateQueues.get(peerId);
    if (!queue || queue.candidates.length === 0) {
        logMsg('ICE', `No queued candidates for ${peerId}`);
        return;
    }

    logMsg('ICE', `Processing ${queue.candidates.length} queued candidates for ${peerId}`);
    
    // Ensure we have both local and remote descriptions
    if (pc.remoteDescription === null || pc.localDescription === null) {
        logMsg('ICE', `Waiting for descriptions before processing candidates for ${peerId}`);
        queue.hasRemoteDescription = false;
        return;
    }

    queue.hasRemoteDescription = true;
    let successCount = 0;

    for (const candidate of queue.candidates) {
        try {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
            successCount++;
            queue.processedCount++;
            logMsg('ICE', `Successfully added candidate ${queue.processedCount} for ${peerId}`);
        } catch (error) {
            logMsg('ERROR', `Failed to add ICE candidate for ${peerId}: ${error}`);
        }
    }

    // Update queue state
    queue.candidates = [];
    queue.lastUpdated = Date.now();
    queue.connectionState = pc.iceConnectionState;
    queue.gatheringState = pc.iceGatheringState;
    iceCandidateQueues.set(peerId, queue);

    logMsg('ICE', `Processed ${successCount}/${queue.processedCount} candidates for ${peerId}`);
};

const retryIceConnection = async (pc: RTCPeerConnection, peerId: string, deps: MessageHandlerDependencies, attempt = 0) => {
    if (attempt >= ICE_RETRY_MAX) {
        logMsg('ICE', `Failed to establish connection with ${peerId} after ${ICE_RETRY_MAX} attempts`);
        return;
    }

    if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') {
        logMsg('ICE', `Retrying ICE connection for ${peerId}, attempt ${attempt + 1}`);
        try {
            await pc.restartIce();
            // Create new offer if we're the initiator
            if (deps.getState().isInitiator) {
                const offer = await pc.createOffer({ iceRestart: true });
                await pc.setLocalDescription(offer);
                deps.sendMessage('offer', {
                    sdp: offer,
                    fromPeerID: deps.getState().userId,
                    targetPeerID: peerId
                });
            }
            
            // Set a timeout for the next retry
            setTimeout(() => {
                if (pc.iceConnectionState !== 'connected' && pc.iceConnectionState !== 'completed') {
                    retryIceConnection(pc, peerId, deps, attempt + 1);
                }
            }, ICE_RETRY_DELAY);
        } catch (error) {
            logMsg('ERROR', `ICE retry failed for ${peerId}: ${error}`);
        }
    }
};

const handleIceCandidate = async (content: IceCandidateContent, deps: MessageHandlerDependencies) => {
    const { candidate, fromPeerId } = content;
    
    if (!fromPeerId) {
        logMsg('ERROR', 'No peer ID in ICE candidate');
        return;
    }

    const peerConn = deps.peerConnections.get(fromPeerId);
    
    if (!peerConn) {
        // Queue the candidate if we don't have a connection yet
        if (!iceCandidateQueues.has(fromPeerId)) {
            iceCandidateQueues.set(fromPeerId, {
                candidates: [],
                lastUpdated: Date.now(),
                createdAt: Date.now(),
                processedCount: 0,
                hasRemoteDescription: false,
                connectionState: undefined,
                gatheringState: undefined
            });
        }
        const queue = iceCandidateQueues.get(fromPeerId)!;
        queue.candidates.push(candidate);
        logMsg('ICE', `Queued candidate for ${fromPeerId} - waiting for peer connection`);
        return;
    }

    // If we have a connection but no remote description, queue the candidate
    if (!peerConn.connection.remoteDescription || !peerConn.connection.localDescription) {
        if (!iceCandidateQueues.has(fromPeerId)) {
            iceCandidateQueues.set(fromPeerId, {
                candidates: [],
                lastUpdated: Date.now(),
                createdAt: Date.now(),
                processedCount: 0,
                hasRemoteDescription: false,
                connectionState: peerConn.connection.iceConnectionState,
                gatheringState: peerConn.connection.iceGatheringState
            });
        }
        const queue = iceCandidateQueues.get(fromPeerId)!;
        queue.candidates.push(candidate);
        logMsg('ICE', `Queued candidate for ${fromPeerId} - waiting for descriptions`);
        return;
    }

    // If we have everything we need, add the candidate immediately
    try {
        await peerConn.connection.addIceCandidate(new RTCIceCandidate(candidate));
        logMsg('ICE', `Added candidate for ${fromPeerId}`);
    } catch (error) {
        logMsg('ERROR', `Failed to add ICE candidate for ${fromPeerId}: ${error}`);
    }
};

const updateConnectionState = (peerId: string, state: PeerConnectionState, deps: MessageHandlerDependencies) => {
    const peerConn = deps.peerConnections.get(peerId);
    if (peerConn) {
        peerConn.connectionState = state;
        deps.peerConnections.set(peerId, peerConn);
        logMsg('STATE', `Peer ${peerId} connection state: ${state}`);
    }
};

export const createMessageHandler = (deps: MessageHandlerDependencies) => {
    return async (message: WebSocketMessage) => {
        const currentState = deps.getState();
        const mediaStore = useMediaStore.getState();
        logMsg('MSG', `${message.type} media:${mediaStore.mediaReady}`);
        
        switch (message.type) {
            case 'startMeeting':
                logMsg('MEET', 'Started');
                deps.setState.setMeetingStarted(true);
                deps.log('Meeting started - transitioning from lobby');
                
                // Check local media state
                const localStream = mediaStore.localStream;
                if (localStream) {
                    const videoTracks = localStream.getVideoTracks();
                    const audioTracks = localStream.getAudioTracks();
                    logMsg('MEDIA', `Local tracks available - Video: ${videoTracks.length}, Audio: ${audioTracks.length}`);
                    videoTracks.forEach(track => logMsg('TRACK', `Local video track: ${track.enabled ? 'enabled' : 'disabled'}, ${track.readyState}`));
                    audioTracks.forEach(track => logMsg('TRACK', `Local audio track: ${track.enabled ? 'enabled' : 'disabled'}, ${track.readyState}`));
                } else {
                    logMsg('MEDIA', 'No local stream available at meeting start');
                }
                
                // Get current state to ensure we have latest userId
                const currentUserId = deps.getState().userId;
                console.log('[MESSAGE HANDLER] THIS PEERS ID IS:', currentUserId);
                break;

            case 'createOffer': {
                const peers = Array.isArray(message.content.peers) ? message.content.peers : [];
                logMsg('OFFER', `Creating for ${peers.length} peers: ${peers.map(short).join(', ')}`);
                
                if (mediaStore.mediaReady) {
                    for (const peerId of peers) {
                        if (!deps.peerConnections.has(peerId)) {
                            try {
                                // 1. Setup peer connection (tracks are added during setup)
                                const pc = await setupPeerConnection(peerId, deps);
                                
                                // 2. Verify tracks were added
                                const senders = pc.getSenders();
                                logMsg('TRACK', `Verifying tracks for ${peerId}: ${senders.length} senders`);
                                
                                if (senders.length === 0) {
                                    throw new Error('No tracks added to peer connection');
                                }

                                // 3. Create and set local description
                                const offer = await pc.createOffer({
                                    offerToReceiveAudio: true,
                                    offerToReceiveVideo: true
                                });
                                
                                logMsg('SDP', `Created offer for ${peerId}`);
                                await pc.setLocalDescription(offer);
                                logMsg('SDP', `Set local description for ${peerId}`);
                                
                                // 4. Send offer
                                deps.sendMessage('offer', {
                                    sdp: offer,
                                    fromPeerId: deps.getState().userId,
                                    targetPeerId: peerId
                                });
                                
                                logMsg('OFFER', `Created and sent offer for peer ${peerId}`);
                                
                            } catch (error) {
                                logMsg('ERROR', `Failed to create offer for ${peerId}: ${error}`);
                                // Clean up failed connection
                                const failedConn = deps.peerConnections.get(peerId);
                                if (failedConn) {
                                    failedConn.connection.close();
                                    deps.peerConnections.delete(peerId);
                                }
                            }
                        } else {
                            logMsg('SKIP', `Already have connection to peer ${peerId}`);
                        }
                    }
                } else {
                    logMsg('WAIT', `Media not ready, queueing ${peers.length} peers`);
                    deps.setState.setPendingPeers(peers);
                }
                break;
            }

            case 'offer':
                await handleOffer(message.content, deps);
                break;

            case 'answer':
                if (message.content) {
                    await handleAnswer(message.content, deps);
                }
                break;

            case 'iceCandidate': {
                const { candidate, fromPeerId, fromPeerID } = message.content;
                const peerId = fromPeerId || fromPeerID;
                
                if (!peerId) {
                    logMsg('ERROR', 'Missing from peer ID');
                    return;
                }

                const pc = deps.peerConnections.get(peerId)?.connection;
                if (!pc) {
                    logMsg('ERROR', `No connection found for peer ${peerId}`);
                    return;
                }

                try {
                    if (pc.remoteDescription && pc.currentRemoteDescription) {
                        await pc.addIceCandidate(new RTCIceCandidate(candidate));
                        logMsg('ICE', `Added candidate from ${peerId}`);
                    } else {
                        // Queue the candidate
                        if (!iceCandidateQueues.has(peerId)) {
                            iceCandidateQueues.set(peerId, {
                                candidates: [],
                                hasRemoteDescription: false,
                                createdAt: Date.now(),
                                lastUpdated: Date.now(),
                                processedCount: 0,
                                connectionState: undefined,
                                gatheringState: undefined
                            });
                        }
                        const queue = iceCandidateQueues.get(peerId)!;
                        queue.candidates.push(candidate);
                        queue.lastUpdated = Date.now();
                        iceCandidateQueues.set(peerId, queue);
                        logMsg('ICE', `Queued candidate for ${peerId} - waiting for remote description`);
                    }
                } catch (error) {
                    logMsg('ERROR', `Failed to handle ICE candidate: ${error}`);
                }
                break;
            }

            case 'userID':
                internalState.userId = message.content;
                deps.setState.setUserId(message.content);
                deps.setWindowState(message.content);
                if (hasReceivedInitiatorStatus) {
                    deps.sendMessage('ready', { userId: message.content, initiator: currentState.isInitiator });
                } else {
                    pendingUserId = message.content;
                }
                break;

            case 'initiatorStatus':
                const isInitiatorValue = message.content === 'true' || message.content === true;
                deps.setState.setIsInitiator(isInitiatorValue);
                hasReceivedInitiatorStatus = true;
                
                if (pendingUserId) {
                    deps.sendMessage('ready', { userId: pendingUserId, initiator: isInitiatorValue });
                    pendingUserId = null;
                }
                break;

            case 'chatMessage':
                try {
                    const chatMessage = typeof message.content === 'string'
                        ? JSON.parse(message.content)
                        : message.content;

                    deps.setState.setMessages([...deps.getState().messages, chatMessage]);
                } catch (error) {
                    console.log(`Error parsing chat message: ${error}`);
                }
                break;

            case 'userList':
                if (message.content && typeof message.content === 'object') {
                    const users = Object.keys(message.content);
                    console.log('Updated user list:', users);
                }
                break;

            case 'incoming_call':
                const { from, fromName, roomId } = message.content;
                logMsg('CALL', `Incoming call from ${fromName || from} for room ${roomId}`);
                
                try {
                    if (Notification.permission === 'default') {
                        await Notification.requestPermission();
                    }

                    if (Notification.permission === 'granted') {
                        const notification = new Notification('Incoming Call', {
                            body: `${fromName || from} is calling you`,
                            icon: '/favicon.ico',
                            requireInteraction: true,
                        });

                        notification.onclick = () => {
                            window.focus();
                            safeSetStorage('isInitiator', 'false');
                            window.location.href = `/call/${roomId}`;
                        };
                    }
                } catch (err) {
                    logMsg('ERROR', `Error showing notification: ${err}`);
                }
                break;

            default:
                logMsg('MSG', `Unhandled message type: ${message.type}`);
        }
    };
}; 
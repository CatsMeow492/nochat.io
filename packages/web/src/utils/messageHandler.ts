import { ChatMessage, MessageHandlerDependencies, WebSocketMessage, AnswerContent, IceCandidateContent, OfferContent, PeerConnection } from '../types/chat';

const iceCandidateQueue: Map<string, RTCIceCandidate[]> = new Map();
const offerQueue: Map<string, RTCSessionDescription> = new Map();
const recoveryAttempted = new Map<string, boolean>();
const pendingTracks: Map<string, Set<MediaStreamTrack>> = new Map();

// Add a flag to track if we've received our initiator status
let hasReceivedInitiatorStatus = false;
let pendingUserId: string | null = null;

let internalState = {
    userId: null as string | null
};

// Add debouncing/cooldown for ICE restarts
let lastIceRestart = 0;
const ICE_RESTART_COOLDOWN = 1000; // 1 second

function triggerIceRestart() {
  const now = Date.now();
  if (now - lastIceRestart < ICE_RESTART_COOLDOWN) {
    console.log("[ICE] Skipping restart - too soon");
    return;
  }
  
  lastIceRestart = now;
  console.log("[ICE] Triggering ICE restart");
  // ... existing restart code ...
}

const processQueuedAnswer = async (pc: PeerConnection, peerId: string, deps: MessageHandlerDependencies) => {
  const queuedAnswer = deps.getState().offerQueue.get(peerId);
  if (queuedAnswer && pc.connection.signalingState === 'have-local-offer') {
    try {
      await pc.connection.setRemoteDescription(new RTCSessionDescription(queuedAnswer));
      const newQueue = new Map(deps.getState().offerQueue);
      newQueue.delete(peerId);
      deps.setState.setOfferQueue(newQueue);
      console.log('Successfully processed queued answer for peer:', peerId);
    } catch (error) {
      console.error('Error processing queued answer:', error);
    }
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
    if (!deps.getState().localStream) {
        logMsg('MEDIA', 'Requesting local media access');
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ 
                video: true, 
                audio: true 
            });
            deps.setState.setLocalStream(stream);
            logMsg('MEDIA', `Got local stream with ${stream.getTracks().length} tracks`);
            return stream;
        } catch (error) {
            logMsg('ERROR', `Failed to get local media: ${error}`);
            throw error;
        }
    }
    return deps.getState().localStream;
};

const handleAnswer = async (content: AnswerContent, deps: MessageHandlerDependencies) => {
    console.log('Answer message content:', content);
    console.log(`[ANSWER] Received from ${content.fromPeerId}`);
    
    if (!content.fromPeerId) {
        console.log("[ANSWER] Missing from peer ID");
        return;
    }

    const peerId = content.fromPeerId;
    const pc = deps.getState().peerConnections.get(peerId);
    
    if (!pc) {
        console.error(`[ANSWER] No connection found for peer ${peerId}`);
        return;
    }
    
    try {
        if (pc.connection.signalingState === 'stable') {
            console.log('[ANSWER] Connection already stable, ignoring answer');
            return;
        }

        if (pc.connection.signalingState !== 'have-local-offer') {
            console.log(`[ANSWER] Wrong signaling state for answer: ${pc.connection.signalingState}`);
            return;
        }

        if (!content.targetPeerId && !content.targetPeerID) {
            console.log("[ANSWER] Missing target peer ID");
            return;
        }

        if (!content.sdp || (!content.sdp.sdp && !content.sdp.type)) {
            console.log("[ANSWER] Invalid answer message structure");
            return;
        }

        await pc.connection.setRemoteDescription(new RTCSessionDescription({
            type: 'answer',
            sdp: typeof content.sdp === 'string' ? content.sdp : content.sdp.sdp
        }));
        logMsg('ANSWER', `Set remote description for ${peerId}`);

        // Add local tracks if needed
        const localStream = deps.getState().localStream;
        if (localStream) {
            localStream.getTracks().forEach(track => {
                if (!pc.connection.getSenders().find(s => s.track?.id === track.id)) {
                    pc.connection.addTrack(track, localStream);
                    logMsg('TRACK', `Added ${track.kind} track after answer for ${peerId}`);
                }
            });
        }

        // Process queued candidates in one place
        await processQueuedCandidates(pc.connection, peerId);
        
    } catch (err) {
        console.error(`[ANSWER] Failed to handle answer from ${peerId}:`, err);
    }
};

// At the top with other state management
const trackStatusMap = new Map<string, { audio: boolean, video: boolean }>();

// Update the createPeerConnection function to initialize track status
const createPeerConnection = (peerId: string, deps: MessageHandlerDependencies): PeerConnection => {
    const connection = new RTCPeerConnection(deps.getState().rtcConfig);
    
    // Set up ontrack handler
    connection.ontrack = (event) => {
        const trackType = event.track.kind as 'audio' | 'video';
        
        // Update stream management
        const currentStreams = new Map(deps.getState().remoteStreams);
        const streamManager = createPeerStreamManager(
            currentStreams.get(peerId) || new MediaStream()
        );
        
        // Log before state
        const beforeAudio = streamManager.hasTrackType('audio');
        const beforeVideo = streamManager.hasTrackType('video');
        logMsg('TRACK', `Before adding ${trackType} track - Audio: ${beforeAudio}, Video: ${beforeVideo}`);

        // Update the track
        streamManager.updateTrack(event.track);
        
        // Update the streams map
        currentStreams.set(peerId, streamManager.stream);
        
        // Log after state
        const hasAudio = streamManager.hasTrackType('audio');
        const hasVideo = streamManager.hasTrackType('video');
        
        logMsg('TRACK', `After adding ${trackType} track - Audio: ${hasAudio}, Video: ${hasVideo}`);
        
        // Only activate peer when both tracks are present
        if (hasAudio && hasVideo) {
            const currentPeers = new Set(deps.getState().activePeers);
            if (!currentPeers.has(peerId)) {
                currentPeers.add(peerId);
                deps.setState.setActivePeers(currentPeers);
                logMsg('PEERS', `Added ${peerId} to active peers - has both tracks`);
            }
        }
        
        deps.setState.setRemoteStreams(currentStreams);
    };

    // Handle track ended events
    connection.onconnectionstatechange = () => {
        if (connection.connectionState === 'disconnected' || connection.connectionState === 'failed') {
            const currentStatus = trackStatusMap.get(peerId);
            if (currentStatus) {
                trackStatusMap.set(peerId, { audio: false, video: false });
                const currentPeers = new Set(deps.getState().activePeers);
                currentPeers.delete(peerId);
                deps.setState.setActivePeers(currentPeers);
                logMsg('PEERS', `Deactivated peer ${peerId} - connection ${connection.connectionState}`);
            }
        }
    };

    return {
        id: peerId,
        connection,
        trackStatus: { audio: false, video: false },
        connected: false,
        negotiationNeeded: false
    };
};

// Clean up function to remove peer
const removePeer = (peerId: string, deps: MessageHandlerDependencies) => {
    trackStatusMap.delete(peerId);
    const currentPeers = new Set(deps.getState().activePeers);
    currentPeers.delete(peerId);
    deps.setState.setActivePeers(currentPeers);
    
    const streams = new Map(deps.getState().remoteStreams);
    streams.delete(peerId);
    deps.setState.setRemoteStreams(streams);
    
    deps.peerConnections.delete(peerId);
};

const handleOffer = async (content: OfferContent, deps: MessageHandlerDependencies) => {
    const { fromPeerId, sdp } = content;
    if (!fromPeerId || !sdp) return;

    let pc = deps.peerConnections.get(fromPeerId);
    if (!pc) {
        pc = createPeerConnection(fromPeerId, deps);
        deps.peerConnections.set(fromPeerId, pc);
    }

    try {
        await pc.connection.setRemoteDescription(new RTCSessionDescription(sdp));
        await processQueuedCandidates(pc.connection, fromPeerId);
        
        // Add local tracks BEFORE creating answer
        const localStream = deps.getState().localStream;
        if (localStream) {
            const senders = pc.connection.getSenders();
            localStream.getTracks().forEach(track => {
                // Only add if not already present
                if (!senders.find(sender => sender.track?.id === track.id)) {
                    pc!.connection.addTrack(track, localStream);
                    logMsg('TRACK', `Added ${track.kind} track to answer for ${fromPeerId}`);
                }
            });
        }

        const answer = await pc.connection.createAnswer();
        await pc.connection.setLocalDescription(answer);

        // Structure the answer message
        const answerMessage = {
            targetPeerID: fromPeerId,
            fromPeerID: deps.getState().userId,
            fromPeerId: deps.getState().userId, // Add both variants for compatibility
            sdp: answer
        };

        logMsg('ANSWER', `Sending answer to peer: ${fromPeerId}`);
        deps.sendMessage('answer', answerMessage);

        // Check tracks after setting local description
        const peerStream = deps.getState().remoteStreams.get(fromPeerId);
        if (peerStream) {
            const hasAudio = peerStream.getAudioTracks().length > 0;
            const hasVideo = peerStream.getVideoTracks().length > 0;
            logMsg('TRACK', `Peer ${fromPeerId} tracks - Audio: ${hasAudio}, Video: ${hasVideo}`);
            
            // Update peer connection status
            const peerConnection = deps.peerConnections.get(fromPeerId);
            if (peerConnection) {
                deps.peerConnections.set(fromPeerId, {
                    ...peerConnection,
                    trackStatus: { audio: hasAudio, video: hasVideo },
                    stream: peerStream,
                    connected: true
                });
                logMsg('PEERS', `Updated ${fromPeerId} track status - Audio: ${hasAudio}, Video: ${hasVideo}`);
            }
        }
    } catch (error) {
        console.error('Error handling offer:', error);
    }
};

const handleIceCandidate = async (content: IceCandidateContent, deps: MessageHandlerDependencies) => {
    console.log('ICE candidate content:', content);
    
    const { candidate } = content;
    const fromId = content.fromPeerId || content.fromPeerID || content.from;
    
    if (!fromId) {
        logMsg('ERROR', 'Missing from peer ID');
        return;
    }

    // Get the peer connection using fromId instead of targetId
    const pc = deps.peerConnections.get(fromId);
    if (!pc) {
        logMsg('ERROR', `No connection found for peer ${fromId}`);
        return;
    }

    try {
        await pc.connection.addIceCandidate(candidate);
        logMsg('ICE', `Added candidate from ${fromId}`);
    } catch (err) {
        logMsg('ERROR', `Failed to add ICE candidate: ${err}`);
    }
};

const attachPeerConnectionHandlers = (pc: RTCPeerConnection, peerId: string, deps: MessageHandlerDependencies) => {
    pc.ontrack = (event) => {
        logMsg('TRACK', `Received ${event.track.kind} track from ${peerId}`);
        
        // Get or create stream for this peer
        const currentStreams = new Map(deps.getState().remoteStreams);
        let peerStream = currentStreams.get(peerId);
        
        if (!peerStream) {
            peerStream = new MediaStream();
            currentStreams.set(peerId, peerStream);
        }
        
        // Add track if not already present
        if (!peerStream.getTracks().find(t => t.id === event.track.id)) {
            peerStream.addTrack(event.track);
            deps.setState.setRemoteStreams(currentStreams);
            logMsg('TRACK', `Added ${event.track.kind} track to stream for ${peerId}`);
            
            // Check track status after adding
            const hasAudio = peerStream.getAudioTracks().length > 0;
            const hasVideo = peerStream.getVideoTracks().length > 0;
            logMsg('TRACK', `Peer ${peerId} tracks - Audio: ${hasAudio}, Video: ${hasVideo}`);
            
            if (hasAudio && hasVideo) {
                const currentPeers = new Set(deps.getState().activePeers);
                if (!currentPeers.has(peerId)) {
                    currentPeers.add(peerId);
                    deps.setState.setActivePeers(currentPeers);
                    logMsg('PEERS', `Added ${peerId} to active peers - has both tracks`);
                }
            }
        }
    };

    pc.onconnectionstatechange = () => {
        logMsg('CONNECTION', `State for ${peerId}: ${pc.connectionState}`);
        if (pc.connectionState === 'connected') {
            logMsg('CONNECTION', `Peer ${peerId} fully connected`);
            // Ensure peer is in active peers list when connected
            const currentPeers = new Set(deps.getState().activePeers);
            if (!currentPeers.has(peerId)) {
                currentPeers.add(peerId);
                deps.setState.setActivePeers(currentPeers);
            }
        } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
            const currentPeers = new Set(deps.getState().activePeers);
            currentPeers.delete(peerId);
            deps.setState.setActivePeers(currentPeers);
        }
    };
};

// Add the server test function at the top with other utility functions
const testIceServer = async (server: RTCIceServer): Promise<boolean> => {
    const pc = new RTCPeerConnection({
        iceServers: [server],
        iceTransportPolicy: server.urls.toString().startsWith('turn:') ? 'relay' : 'all'
    });
    
    try {
        return new Promise<boolean>((resolve) => {
            const timeout = setTimeout(() => {
                pc.close();
                resolve(false);
            }, 5000);

            pc.onicecandidate = (e) => {
                if (e.candidate) {
                    // For TURN servers, we specifically look for relay candidates
                    if (server.urls.toString().startsWith('turn:')) {
                        if (e.candidate.type === 'relay') {
                            clearTimeout(timeout);
                            pc.close();
                            resolve(true);
                        }
                    } else {
                        // For STUN servers, any valid candidate is good
                        clearTimeout(timeout);
                        pc.close();
                        resolve(true);
                    }
                }
            };

            const dc = pc.createDataChannel('test');
            pc.createOffer()
                .then(offer => pc.setLocalDescription(offer))
                .catch(() => {
                    clearTimeout(timeout);
                    pc.close();
                    resolve(false);
                });
        });
    } catch (err) {
        logMsg('ERROR', `Server test failed: ${err}`);
        return false;
    }
};

// Add this function near the top with other utility functions
const getIceServers = async () => {
    try {
        const response = await fetch('/api/ice-servers');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        console.log('[ICE] Fetched servers:', data.iceServers);
        return data.iceServers;
    } catch (error) {
        console.error('[ICE] Failed to fetch servers:', error);
        // Fallback to public STUN server
        return [{ urls: 'stun:stun.l.google.com:19302' }];
    }
};

// Update the setupPeerConnection function
const setupPeerConnection = async (peerId: string, deps: MessageHandlerDependencies): Promise<RTCPeerConnection> => {
    const iceServers = await getIceServers();
    
    const pc = new RTCPeerConnection({
        iceServers,
        iceTransportPolicy: 'all',
        bundlePolicy: 'max-bundle',
        iceCandidatePoolSize: 10,
        rtcpMuxPolicy: 'require'
    });
    
    deps.peerConnections.set(peerId, {
        id: peerId,
        connection: pc,
        trackStatus: { audio: false, video: false },
        connected: false,
        negotiationNeeded: false
    });

    // Add local tracks immediately if available
    const localStream = deps.getState().localStream;
    if (localStream) {
        try {
            const senders = pc.getSenders();
            localStream.getTracks().forEach(track => {
                // Only add track if it's not already added
                if (!senders.find(sender => sender.track?.id === track.id)) {
                    pc.addTrack(track, localStream);
                    // Update local track status
                    const peerConn = deps.peerConnections.get(peerId);
                    if (peerConn) {
                        peerConn.trackStatus = {
                            ...peerConn.trackStatus,
                            [track.kind]: true
                        };
                    }
                    logMsg('TRACK', `Added ${track.kind} track to connection for ${peerId}`);
                }
            });
        } catch (err) {
            logMsg('ERROR', `Failed to add tracks: ${err}`);
        }
    }

    // Add track handling
    pc.ontrack = (event) => {
        logMsg('TRACK', `Added ${event.track.kind} track from ${peerId}`);
        
        const currentStreams = new Map(deps.getState().remoteStreams);
        let peerStream = currentStreams.get(peerId);
        
        if (!peerStream) {
            peerStream = new MediaStream();
            currentStreams.set(peerId, peerStream);
        }
        
        // Add track and update peer connection status
        if (!peerStream.getTracks().find(t => t.id === event.track.id)) {
            peerStream.addTrack(event.track);
            deps.setState.setRemoteStreams(currentStreams);
            
            // Update peer connection track status
            const peerConnection = deps.peerConnections.get(peerId);
            if (peerConnection) {
                const updatedTrackStatus = {
                    ...peerConnection.trackStatus,
                    [event.track.kind]: true  // Accumulate track status
                };
                
                deps.peerConnections.set(peerId, {
                    ...peerConnection,
                    trackStatus: updatedTrackStatus,
                    stream: peerStream
                });
                
                // Only activate if both tracks are present
                if (updatedTrackStatus.audio && updatedTrackStatus.video) {
                    const currentPeers = new Set(deps.getState().activePeers);
                    currentPeers.add(peerId);
                    deps.setState.setActivePeers(currentPeers);
                    logMsg('PEERS', `Added ${peerId} to active peers - has both tracks`);
                }
            }
        }
    };

    pc.oniceconnectionstatechange = () => {
        const state = pc.iceConnectionState;
        logMsg('ICE', `Connection state for ${peerId}: ${state}`);
        
        if (state === 'disconnected' || state === 'failed') {
            logMsg('ICE', `Connection issues with ${peerId}, attempting recovery`);
            pc.restartIce();
        }
    };

    pc.onicegatheringstatechange = () => {
        logMsg('ICE', `Gathering state for ${peerId}: ${pc.iceGatheringState}`);
    };

    pc.onicecandidate = (event) => {
        if (event.candidate) {
            // Log the candidate
            console.log('[ICE] THE CANDIDATE BEING SENT IS:', event.candidate);
            deps.sendMessage('iceCandidate', {
                candidate: event.candidate,
                fromPeerID: deps.getState().userId,
                targetPeerID: peerId
            });
        }
    };

    // Add connection state monitoring
    pc.oniceconnectionstatechange = () => {
        logMsg('ICE', `Connection state for ${peerId}: ${pc.iceConnectionState}`);
        if (pc.iceConnectionState === 'connected') {
            // Double check our peer is activated once connected
            const currentStreams = deps.getState().remoteStreams;
            const peerStream = currentStreams.get(peerId);
            if (peerStream) {
                const hasAudio = peerStream.getAudioTracks().length > 0;
                const hasVideo = peerStream.getVideoTracks().length > 0;
                if (hasAudio && hasVideo) {
                    const currentPeers = new Set(deps.getState().activePeers);
                    if (!currentPeers.has(peerId)) {
                        currentPeers.add(peerId);
                        deps.setState.setActivePeers(currentPeers);
                        logMsg('PEERS', `Added ${peerId} to active peers after ICE connection`);
                    }
                }
            }
        }
    };

    // Add connection state change monitoring
    pc.onconnectionstatechange = () => {
        logMsg('CONNECTION', `State for ${peerId}: ${pc.connectionState}`);
        if (pc.connectionState === 'connected') {
            logMsg('CONNECTION', `Peer ${peerId} fully connected`);
        }
    };

    // Monitor signaling state
    pc.onsignalingstatechange = () => {
        logMsg('SIGNALING', `State for ${peerId}: ${pc.signalingState}`);
    };

    // Add negotiation needed handler
    pc.onnegotiationneeded = () => {
        logMsg('NEGOTIATION', `Needed for peer ${peerId}`);
    };

    return pc;
};

const createAndSendOffer = async (peerId: string, deps: MessageHandlerDependencies) => {
    logMsg('OFFER', `Creating for peer: ${peerId}`);
    
    try {
        // Create new connection (tracks are added during setup)
        const pc = await setupPeerConnection(peerId, deps);
        
        // Add to peerConnections map BEFORE creating offer
        deps.peerConnections.set(peerId, {
            id: peerId,
            connection: pc,
            trackStatus: { audio: false, video: false },
            connected: false,
            negotiationNeeded: false
        });
        
        attachPeerConnectionHandlers(pc, peerId, deps);

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        
        deps.sendMessage('offer', {
            sdp: {
                type: 'offer',
                sdp: offer.sdp
            },
            fromPeerId: deps.getState().userId,
            targetPeerId: peerId
        });
        
        logMsg('OFFER', `Created new offer for peer ${peerId}`);
    } catch (error) {
        logMsg('ERROR', `Offer creation failed for ${peerId}: ${error}`);
        throw error;
    }
};

interface PeerStreamManager {
    stream: MediaStream;
    getAudioTracks: () => MediaStreamTrack[];
    getVideoTracks: () => MediaStreamTrack[];
    hasTrackType: (type: 'audio' | 'video') => boolean;
    addTrack: (track: MediaStreamTrack) => void;
    updateTrack: (track: MediaStreamTrack) => void;
}

function createPeerStreamManager(stream: MediaStream): PeerStreamManager {
    // Create a new stream if one isn't provided
    const mediaStream = stream || new MediaStream();
    
    return {
        stream: mediaStream,
        getAudioTracks: () => mediaStream.getAudioTracks(),
        getVideoTracks: () => mediaStream.getVideoTracks(),
        hasTrackType: (type: 'audio' | 'video') => 
            type === 'audio' ? 
                mediaStream.getAudioTracks().length > 0 : 
                mediaStream.getVideoTracks().length > 0,
        addTrack: (track: MediaStreamTrack) => {
            // Only add if track of same ID doesn't exist
            const existingTracks = mediaStream.getTracks();
            if (!existingTracks.find(t => t.id === track.id)) {
                mediaStream.addTrack(track);
            }
        },
        updateTrack: (track: MediaStreamTrack) => {
            const trackType = track.kind;
            const existingTracks = trackType === 'audio' ? 
                mediaStream.getAudioTracks() : 
                mediaStream.getVideoTracks();
            
            // Only remove track of same type if it's different from new track
            existingTracks.forEach(existing => {
                if (existing.id !== track.id) {
                    mediaStream.removeTrack(existing);
                }
            });
            
            // Add new track if it's not already present
            if (!mediaStream.getTracks().find(t => t.id === track.id)) {
                mediaStream.addTrack(track);
            }
        }
    };
}

const processQueuedCandidates = async (pc: RTCPeerConnection, peerId: string) => {
    if (!pc.remoteDescription || !pc.currentRemoteDescription) {
        logMsg('ICE', `Skipping candidate processing - no remote description yet for ${peerId}`);
        return;
    }

    const candidates = iceCandidateQueue.get(peerId) || [];
    logMsg('ICE', `Processing ${candidates.length} queued candidates for ${peerId}`);
    logMsg('ICE', `Connection state: ${pc.connectionState}, ICE state: ${pc.iceConnectionState}`);
    
    if (candidates.length > 0) {
        for (const candidate of candidates) {
            try {
                await pc.addIceCandidate(candidate);
                logMsg('ICE', `Successfully added queued candidate: ${candidate.candidate}`);
            } catch (error) {
                logMsg('ERROR', `Failed to add ICE candidate: ${error}`);
            }
        }
        iceCandidateQueue.delete(peerId);
    }
};

export const createMessageHandler = (deps: MessageHandlerDependencies) => {
    return async (message: WebSocketMessage) => {
        const currentState = deps.getState();
        logMsg('MSG', `${message.type} media:${currentState.mediaReady}`);
        
        switch (message.type) {
            case 'startMeeting':
                logMsg('MEET', 'Started');
                deps.setState.setMeetingStarted(true);
                deps.log('Meeting started - transitioning from lobby');
                
                // Test STUN/TURN servers
                const twilioIceServers = [
                    {
                        urls: 'stun:global.stun.twilio.com:3478'
                    },
                    {
                        urls: 'turn:global.turn.twilio.com:3478?transport=udp',
                        username: '94316fe60bfab4243fd0b49dd93e8311a9ada880c39782d2237864fd54d95d86',
                        credential: '2vaj9tQQU1F385vsKvblIF0enj4dIwlWsczo9zk6x5s='
                    },
                    {
                        urls: 'turn:global.turn.twilio.com:3478?transport=tcp',
                        username: '94316fe60bfab4243fd0b49dd93e8311a9ada880c39782d2237864fd54d95d86',
                        credential: '2vaj9tQQU1F385vsKvblIF0enj4dIwlWsczo9zk6x5s='
                    },
                    {
                        urls: 'turn:global.turn.twilio.com:443?transport=tcp',
                        username: '94316fe60bfab4243fd0b49dd93e8311a9ada880c39782d2237864fd54d95d86',
                        credential: '2vaj9tQQU1F385vsKvblIF0enj4dIwlWsczo9zk6x5s='
                    }
                ];

                logMsg('[ICE]', 'Testing STUN/TURN servers...');
                for (const server of twilioIceServers) {
                    const isWorking = await testIceServer(server);
                    logMsg('ICE', `Server ${server.urls} ${isWorking ? 'is working' : 'failed'}`);
                }
                
                // Check local media state
                const localStream = deps.getState().localStream;
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
                // Log the users
                console.log('[MESSAGE HANDLER] THE USERS ARE:', deps.getState().pendingPeers);
                break;

            case 'createOffer': {
                const peers = Array.isArray(message.content.peers) ? message.content.peers : [];
                logMsg('OFFER', `Creating for ${peers.length} peers: ${peers.map(short).join(', ')}`);
                
                if (currentState.mediaReady) {
                    // Create offers for all peers we don't have connections with yet
                    for (const peerId of peers) {
                        if (!deps.peerConnections.has(peerId)) {
                            try {
                                await createAndSendOffer(peerId, deps);
                                logMsg('[OFFER]', `Created new offer for peer ${peerId}`);
                            } catch (error) {
                                logMsg('ERROR', `Failed to create offer for ${peerId}: ${error}`);
                            }
                        } else {
                            logMsg('SKIP', `Already connected to peer ${peerId}`);
                        }
                    }
                } else {
                    logMsg('WAIT', `Media not ready, queueing ${peers.length} peers`);
                    deps.setState.setPendingPeers(peers);
                }
                break;
            }

            case 'offer': {
                const { sdp, fromPeerId, fromPeerID } = message.content;
                const peerId = fromPeerId || fromPeerID;
                
                if (!peerId) {
                    logMsg('ERROR', 'No peer ID in offer');
                    return;
                }

                // Create or get peer connection
                let pc = deps.peerConnections.get(peerId);
                if (!pc) {
                    const newPc = await setupPeerConnection(peerId, deps);
                    pc = {
                        id: peerId,
                        connection: newPc,
                        trackStatus: { audio: false, video: false },
                        connected: false,
                        negotiationNeeded: false
                    };
                    deps.peerConnections.set(peerId, pc);
                }

                // Process the offer first
                await pc.connection.setRemoteDescription(new RTCSessionDescription(sdp));
                await processQueuedCandidates(pc.connection, peerId);

                // Add local tracks before creating answer
                const localStream = deps.getState().localStream;
                if (localStream) {
                    localStream.getTracks().forEach(track => {
                        if (!pc!.connection.getSenders().find(s => s.track?.id === track.id)) {
                            pc!.connection.addTrack(track, localStream);
                            logMsg('TRACK', `Added ${track.kind} track to answer for ${peerId}`);
                        }
                    });
                }

                // Create and send answer
                const answer = await pc.connection.createAnswer();
                await pc.connection.setLocalDescription(answer);

                deps.sendMessage('answer', {
                    targetPeerID: peerId,
                    fromPeerID: currentState.userId,
                    sdp: {
                        type: answer.type,
                        sdp: answer.sdp
                    }
                });

                break;
            }

            case 'iceCandidate': {
                const { candidate, fromPeerId, fromPeerID } = message.content;
                const peerId = fromPeerId || fromPeerID;
                
                if (!peerId) {
                    logMsg('ERROR', 'No peer ID in ICE candidate');
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
                        if (!iceCandidateQueue.has(peerId)) {
                            iceCandidateQueue.set(peerId, []);
                        }
                        iceCandidateQueue.get(peerId)!.push(new RTCIceCandidate(candidate));
                        logMsg('ICE', `Queued candidate for ${peerId} - waiting for remote description`);
                    }
                } catch (error) {
                    logMsg('ERROR', `Failed to handle ICE candidate: ${error}`);
                }
                break;
            }

            case 'answer':
                if (message.content) {
                    await handleAnswer(message.content, deps);
                }
                break;

            case 'userID':
                console.log('Handling userID message:', {
                    content: message.content,
                    currentUserId: deps.getState().userId
                });
                internalState.userId = message.content;
                deps.setState.setUserId(message.content);
                console.log('Internal state userId:', internalState.userId);
                deps.setWindowState(message.content);
                console.log(`User ID set to: ${message.content}`);
                if (hasReceivedInitiatorStatus) {
                    deps.sendMessage('ready', { userId: message.content, initiator: currentState.isInitiator });
                } else {
                    pendingUserId = message.content;
                    console.log('Waiting for initiator status before sending ready');
                }
                break;

            case 'initiatorStatus':
                const isInitiatorValue = message.content === 'true' || message.content === true;
                console.log(`Setting initiator status to: ${isInitiatorValue}`);
                deps.setState.setIsInitiator(isInitiatorValue);
                hasReceivedInitiatorStatus = true;
                
                // If we were waiting to send ready, do it now
                if (pendingUserId) {
                    console.log('Sending delayed ready message');
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
                    console.log(`Chat message received from ${chatMessage.senderName}`);
                } catch (error) {
                    console.log(`Error parsing chat message: ${error}`);
                }
                break;

            case 'userList':
                console.log('Received user list:', message.content);
                // Make sure we're properly handling the user list
                if (message.content && typeof message.content === 'object') {
                    const users = Object.keys(message.content);
                    console.log('Updated user list:', users);
                }
                break;

            default:
                console.log(`Unhandled message type: ${message.type}`);
        }
    };
}; 
import React, { useState, useEffect, useRef } from 'react';
import { Mic, MicOff, PhoneOff, Radio, SignalHigh, Trash2 } from 'lucide-react';
import { db } from '../lib/firebase';
import { ref, set, push, onValue, onChildAdded, remove, onDisconnect, get } from 'firebase/database';

export default function VoiceCall({ user, roomId, sessionId: propSessionId, autoJoin = false, onEnd }) {
    const [sessionId] = useState(propSessionId || Math.random().toString(36).substring(7));
    const isMutedRef = useRef(false);
    const isCallingRef = useRef(false); // Track calling state for callbacks
    const [isMuted, setIsMuted] = useState(false);
    const [isCalling, setIsCalling] = useState(false);
    const [callError, setCallError] = useState(null); // Error message state
    const [activeCallers, setActiveCallers] = useState([]); // Array of session data
    const [localStream, setLocalStream] = useState(null);
    const [pcStates, setPcStates] = useState({}); // { sessionKey: state }
    const [isLoopback, setIsLoopback] = useState(false);
    const [remoteStreams, setRemoteStreams] = useState({}); // { sessionKey: stream }
    const peerConnections = useRef({});
    const hadRemotePeer = useRef(false); // Track if we ever had a connected peer
    const mySessionKey = `${user.id}_${sessionId}`;
    const callStartTimeRef = useRef(null);
    const [callDuration, setCallDuration] = useState(0);

    const iceServers = {
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    };

    const candidateQueue = useRef({});

    const [micLevel, setMicLevel] = useState(0);
    const audioContext = useRef(null);
    const analyser = useRef(null);

    const toggleMute = () => {
        const newState = !isMuted;
        setIsMuted(newState);
        isMutedRef.current = newState;

        if (localStream) {
            localStream.getAudioTracks().forEach(track => {
                track.enabled = !newState;
            });
        }
    };

    useEffect(() => {
        if (!roomId || !sessionId) return;
        const mySignalsRef = ref(db, `signals/${roomId}/${mySessionKey}`);

        let sdkLoaded = false;
        const processedSignals = new Set();

        console.log(`[Voice] Subscribing to signals: ${mySessionKey}`);

        const handleSignal = async (data, signalId) => {
            if (processedSignals.has(signalId)) return;
            processedSignals.add(signalId);

            const fromSessionKey = data.fromSession;
            console.log(`[Voice] Signal processed: ${data.type} from ${fromSessionKey} (${signalId})`);

            if (data.type === 'offer') {
                handleOffer(fromSessionKey, data.offer, signalId);
            } else if (data.type === 'answer') {
                const pc = peerConnections.current[fromSessionKey];
                if (pc) {
                    await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
                    remove(ref(db, `signals/${roomId}/${mySessionKey}/${signalId}`));

                    if (candidateQueue.current[fromSessionKey]) {
                        candidateQueue.current[fromSessionKey].forEach(async (candidate) => {
                            await pc.addIceCandidate(new RTCIceCandidate(candidate));
                        });
                        delete candidateQueue.current[fromSessionKey];
                    }
                }
            } else if (data.type === 'candidate') {
                const pc = peerConnections.current[fromSessionKey];
                if (pc && pc.remoteDescription) {
                    await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
                    remove(ref(db, `signals/${roomId}/${mySessionKey}/${signalId}`));
                } else {
                    if (!candidateQueue.current[fromSessionKey]) candidateQueue.current[fromSessionKey] = [];
                    candidateQueue.current[fromSessionKey].push(data.candidate);
                    remove(ref(db, `signals/${roomId}/${mySessionKey}/${signalId}`));
                }
            }
        };

        const unsubscribe = onChildAdded(mySignalsRef, (snapshot) => {
            sdkLoaded = true;
            handleSignal(snapshot.val(), snapshot.key);
        });

        const checkSignalsREST = async () => {
            if (sdkLoaded) return;
            try {
                const response = await fetch(`https://crispconnect-default-rtdb.firebaseio.com/signals/${roomId}/${mySessionKey}.json`);
                if (response.ok) {
                    const data = await response.json();
                    if (data) {
                        Object.entries(data).forEach(([id, signal]) => {
                            handleSignal(signal, id);
                        });
                    }
                }
            } catch (err) {
                // Polling error ignored
            }
        };

        // Poll for signals every 2 seconds
        const pollInterval = setInterval(checkSignalsREST, 2000);

        return () => {
            unsubscribe();
            clearInterval(pollInterval);
            Object.values(peerConnections.current).forEach(pc => pc.close());
            if (audioContext.current && audioContext.current.state !== 'closed') {
                audioContext.current.close();
            }
        };
    }, [roomId, sessionId]);

    useEffect(() => {
        if (!isCalling || !localStream) {
            setMicLevel(0);
            return;
        }

        let animationFrame;
        const startVisualizer = async () => {
            if (!audioContext.current) {
                audioContext.current = new (window.AudioContext || window.webkitAudioContext)();
            }
            if (audioContext.current.state === 'suspended') {
                await audioContext.current.resume();
            }

            analyser.current = audioContext.current.createAnalyser();
            const source = audioContext.current.createMediaStreamSource(localStream);
            source.connect(analyser.current);
            analyser.current.fftSize = 512;
            analyser.current.smoothingTimeConstant = 0.8;

            const bufferLength = analyser.current.frequencyBinCount;
            const dataArray = new Uint8Array(bufferLength);

            let lastLog = 0;
            const updateLevel = () => {
                if (!analyser.current) return;
                analyser.current.getByteFrequencyData(dataArray);
                const average = dataArray.reduce((p, c) => p + c, 0) / bufferLength;
                setMicLevel(average);

                if (Date.now() - lastLog > 2000) {
                    console.log(`[Voice] Current Mic Level: ${average.toFixed(2)}`);
                    lastLog = Date.now();
                }

                animationFrame = requestAnimationFrame(updateLevel);
            };
            updateLevel();
        };

        startVisualizer();

        return () => {
            if (animationFrame) cancelAnimationFrame(animationFrame);
            if (analyser.current) {
                analyser.current.disconnect();
                analyser.current = null;
            }
        };
    }, [isCalling, localStream]);

    const clearGhosts = async () => {
        try {
            const sessionRef = ref(db, `voice/${roomId}`);
            const snapshot = await get(sessionRef);
            if (snapshot.exists()) {
                const sessions = snapshot.val();
                Object.keys(sessions).forEach((key) => {
                    if (key !== mySessionKey) {
                        remove(ref(db, `voice/${roomId}/${key}`));
                    }
                });
            }
        } catch (err) {
            console.error("Failed to clear ghosts:", err);
        }
    };

    const refreshAudio = async () => {
        console.log("[Voice] Manual audio refresh triggered");
        try {
            if (!audioContext.current || audioContext.current.state === 'closed') {
                audioContext.current = new (window.AudioContext || window.webkitAudioContext)();
            }
            await audioContext.current.resume();

            const audios = document.querySelectorAll('audio');
            for (const a of audios) {
                try {
                    a.muted = false;
                    await a.play();
                } catch (e) {
                    console.warn("[Voice] Playback failed for audio element:", e);
                }
            }
        } catch (err) {
            console.error("[Voice] Refresh failed:", err);
        }
    };

    const CONNECTED_SOUND_URL = 'https://www.soundjay.com/buttons/button-3.mp3';

    const sendSignal = async (toSessionKey, signalData) => {
        const signalRef = ref(db, `signals/${roomId}/${toSessionKey}`);
        try {
            // Try SDK first
            const pushPromise = push(signalRef, {
                ...signalData,
                fromSession: mySessionKey
            });
            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Signal Timeout')), 3000)
            );
            await Promise.race([pushPromise, timeoutPromise]);
            // console.log(`[Voice] Signal ${signalData.type} sent via SDK to ${toSessionKey}`);
        } catch (err) {
            console.warn(`[Voice] SDK signal ${signalData.type} failed/timed out, trying REST...`);
            try {
                const response = await fetch(`https://crispconnect-default-rtdb.firebaseio.com/signals/${roomId}/${toSessionKey}.json`, {
                    method: 'POST',
                    body: JSON.stringify({
                        ...signalData,
                        fromSession: mySessionKey
                    })
                });
                if (!response.ok) throw new Error('REST signal failed');
                console.log(`[Voice] Signal ${signalData.type} sent via REST to ${toSessionKey}`);
            } catch (restErr) {
                console.error('[Voice] All signaling attempts failed:', restErr);
            }
        }
    };

    const startVoice = async () => {
        try {
            console.log("[Voice] Initializing session:", mySessionKey);
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                }
            });

            if (!audioContext.current || audioContext.current.state === 'closed') {
                audioContext.current = new (window.AudioContext || window.webkitAudioContext)();
            }
            await audioContext.current.resume();

            // Sync Mute State using Ref
            stream.getAudioTracks().forEach(track => {
                track.enabled = !isMutedRef.current;
            });

            setLocalStream(stream);
            setIsCalling(true);

            // Register session in Firebase
            const sessionData = {
                id: user.id,
                sessionId: sessionId,
                name: user.name,
                timestamp: Date.now()
            };
            const sessionRef = ref(db, `voice/${roomId}/${mySessionKey}`);

            try {
                await set(sessionRef, sessionData);
            } catch (err) {
                await fetch(`https://crispconnect-default-rtdb.firebaseio.com/voice/${roomId}/${mySessionKey}.json`, {
                    method: 'PUT',
                    body: JSON.stringify(sessionData)
                });
            }

            onDisconnect(sessionRef).remove();

            // Add window unload listener for aggressive cleanup
            const cleanup = () => remove(sessionRef);
            window.addEventListener('beforeunload', cleanup);

            const activeVoiceRef = ref(db, `voice/${roomId}`);
            const voiceListener = onValue(activeVoiceRef, (snapshot) => {
                if (snapshot.exists()) {
                    const sessions = snapshot.val();
                    const sessionList = Object.entries(sessions);

                    // Check if we're alone in the room (other person left) - INSTANT DETECTION
                    const otherSessions = sessionList.filter(([key]) => key !== mySessionKey);

                    // Only end if we HAD a remote peer before and now we're alone
                    if (otherSessions.length === 0 && hadRemotePeer.current) {
                        console.log("[Voice] Peer left room. Ending call instantly.");
                        endCallWithMessage('Call ended');
                        return;
                    }

                    sessionList.forEach(([remoteSessionKey, data]) => {
                        if (remoteSessionKey !== mySessionKey && !peerConnections.current[remoteSessionKey]) {
                            if (mySessionKey > remoteSessionKey) {
                                createOffer(remoteSessionKey, stream);
                            }
                        }
                    });
                    setActiveCallers(sessionList.map(([key, val]) => ({ ...val, sessionKey: key })));
                } else {
                    // Room is completely empty - end call instantly
                    if (isCallingRef.current) {
                        console.log("[Voice] Voice room empty, ending call instantly.");
                        endCallWithMessage('Call ended');
                    }
                    setActiveCallers([]);
                }
            });

            return () => window.removeEventListener('beforeunload', cleanup);

        } catch (err) {
            console.error("[Voice] Failed to start voice:", err);
            alert("Microphone error: " + err.message);
        }
    };


    const createPC = (remoteSessionKey, stream) => {
        if (peerConnections.current[remoteSessionKey]) return peerConnections.current[remoteSessionKey];

        const pc = new RTCPeerConnection(iceServers);
        peerConnections.current[remoteSessionKey] = pc;

        stream.getTracks().forEach(track => pc.addTrack(track, stream));

        pc.onicecandidate = (event) => {
            if (event.candidate) {
                sendSignal(remoteSessionKey, {
                    type: 'candidate',
                    candidate: event.candidate.toJSON()
                });
            }
        };

        pc.ontrack = (event) => {
            console.log(`[Voice] Remote track from session ${remoteSessionKey}`);
            hadRemotePeer.current = true; // Mark that we successfully connected to a peer
            setRemoteStreams(prev => ({
                ...prev,
                [remoteSessionKey]: event.streams[0]
            }));
        };

        pc.onconnectionstatechange = () => {
            console.log(`[Voice] Connection ${remoteSessionKey}: ${pc.connectionState}`);
            setPcStates(prev => ({ ...prev, [remoteSessionKey]: pc.connectionState }));

            if (pc.connectionState === 'connected') {
                console.log("[Voice] Connection established! Playing tone.");
                const audio = new Audio(CONNECTED_SOUND_URL);
                audio.volume = 0.5;
                audio.play().catch(e => console.warn("Connection sound blocked:", e));
                if (!callStartTimeRef.current) {
                    callStartTimeRef.current = Date.now();
                }
            }

            // Detect disconnect or failure
            if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
                console.log(`[Voice] Peer ${remoteSessionKey} disconnected/failed. Ending call.`);
                endCallWithMessage('Call ended');
            }
        };

        return pc;
    };

    const endCallWithMessage = (message) => {
        setCallError(message);
        endCall();
        // Clear error after 3 seconds
        setTimeout(() => setCallError(null), 3000);
    };

    const createOffer = async (remoteSessionKey, stream) => {
        console.log(`[Voice] Creating offer for ${remoteSessionKey}`);
        const pc = createPC(remoteSessionKey, stream);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        sendSignal(remoteSessionKey, {
            type: 'offer',
            offer: { sdp: offer.sdp, type: offer.type }
        });
    };

    const handleOffer = async (fromSessionKey, offer, signalId) => {
        console.log(`[Voice] Handling offer from ${fromSessionKey}`);
        let stream = localStream;
        if (!stream) {
            try {
                stream = await navigator.mediaDevices.getUserMedia({
                    audio: {
                        echoCancellation: true,
                        noiseSuppression: true,
                        autoGainControl: true
                    }
                });

                // Sync Mute State immediately using Ref
                stream.getAudioTracks().forEach(track => {
                    track.enabled = !isMutedRef.current;
                });

                setLocalStream(stream);
                setIsCalling(true);
                isCallingRef.current = true;
            } catch (err) {
                console.error("Failed to get stream for answer:", err);
                return;
            }
        }

        const pc = createPC(fromSessionKey, stream);
        await pc.setRemoteDescription(new RTCSessionDescription(offer));

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        sendSignal(fromSessionKey, {
            type: 'answer',
            answer: { sdp: answer.sdp, type: answer.type }
        });

        remove(ref(db, `signals/${roomId}/${mySessionKey}/${signalId}`));

        if (candidateQueue.current[fromSessionKey]) {
            candidateQueue.current[fromSessionKey].forEach(async (candidate) => {
                await pc.addIceCandidate(new RTCIceCandidate(candidate));
            });
            delete candidateQueue.current[fromSessionKey];
        }
    };



    const endCall = () => {
        if (localStream) {
            localStream.getTracks().forEach(track => track.stop());
        }
        Object.values(peerConnections.current).forEach(pc => pc.close());
        peerConnections.current = {};
        hadRemotePeer.current = false; // Reset for next call
        setRemoteStreams({});
        setPcStates({});
        setLocalStream(null);
        remove(ref(db, `voice/${roomId}/${mySessionKey}`));
        setIsCalling(false);
        isCallingRef.current = false;
        setActiveCallers([]);
        const duration = callStartTimeRef.current ? Math.floor((Date.now() - callStartTimeRef.current) / 1000) : 0;
        if (onEnd) onEnd(duration);
    };

    // Auto-Join on mount if prop is set
    useEffect(() => {
        if (autoJoin && !isCalling && roomId) {
            startVoice();
        }
    }, [autoJoin, roomId]);

    return (
        <div className="fixed bottom-10 right-10 z-[100] flex flex-col items-end gap-4">
            {/* Call Error/Status Message */}
            {callError && (
                <div className="bg-[#202c33] text-[#e9edef] px-6 py-3 rounded-xl shadow-xl border border-[#323b42] animate-fade-in">
                    <span className="text-sm">{callError}</span>
                    <span className="block text-xs text-[#8696a0] mt-1">Call again later</span>
                </div>
            )}

            {/* Audio Elements */}
            {Object.entries(remoteStreams).map(([sessionKey, stream]) => (
                <audio
                    key={sessionKey}
                    autoPlay
                    muted={false}
                    ref={el => { if (el) { el.srcObject = stream; el.volume = 1.0; } }}
                    className="hidden"
                />
            ))}
            {isLoopback && localStream && (
                <audio
                    autoPlay
                    muted={false}
                    ref={el => { if (el) { el.srcObject = localStream; el.volume = 0.5; } }}
                    className="hidden"
                />
            )}

            {isCalling && (
                <div className="glass p-6 pr-8 rounded-[28px] border-white/10 shadow-2xl animate-fade-in relative overflow-hidden group min-w-[240px]">
                    <div className="absolute top-0 right-0 p-3 flex gap-2">
                        <button
                            onClick={() => setIsLoopback(!isLoopback)}
                            className={`p-1 transition-opacity ${isLoopback ? 'text-emerald-400 opacity-100' : 'text-slate-400 opacity-20 hover:opacity-100'}`}
                            title="Echo Test (Hear Yourself)"
                        >
                            <SignalHigh className="w-4 h-4" />
                        </button>
                        <button
                            onClick={refreshAudio}
                            className="p-1 opacity-20 hover:opacity-100 transition-opacity text-slate-400 hover:text-white"
                            title="Reset Audio engine"
                        >
                            <Radio className="w-4 h-4" />
                        </button>
                        <button
                            onClick={clearGhosts}
                            className="p-1 opacity-20 hover:opacity-100 transition-opacity text-slate-400 hover:text-rose-500"
                            title="Clear Ghost Users (Keeps You Connected)"
                        >
                            <Trash2 className="w-4 h-4" />
                        </button>
                    </div>

                    <div className="flex items-center gap-3 mb-5">
                        <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_10px_rgba(16,185,129,0.5)]" />
                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em]">Voice Activity</span>
                    </div>

                    <div className="space-y-4 mb-2">
                        {activeCallers.map(c => (
                            <div key={c.sessionKey} className="flex items-center gap-3">
                                <div className="relative">
                                    <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center border border-white/5 overflow-hidden">
                                        <span className="text-[10px] font-bold text-slate-400">{c.name.charAt(0)}</span>
                                        {/* Activity Meter */}
                                        {c.sessionKey === mySessionKey && (
                                            <div
                                                className="absolute bottom-0 left-0 w-full bg-emerald-500/50 transition-all duration-100"
                                                style={{ height: `${Math.min(100, micLevel * 10)}%` }}
                                            />
                                        )}
                                    </div>
                                    <div className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 border-2 border-[#020617] rounded-full
                                        ${c.sessionKey === mySessionKey ? 'bg-indigo-500' : (pcStates[c.sessionKey] === 'connected' ? 'bg-emerald-500' : 'bg-slate-700')}`}
                                    />
                                </div>
                                <div className="flex flex-col">
                                    <span className="text-xs font-medium text-slate-200">
                                        {c.name} {c.sessionKey === mySessionKey && '(Me)'}
                                    </span>
                                    {c.sessionKey !== mySessionKey && (
                                        <span className="text-[9px] uppercase font-bold tracking-tighter opacity-40">
                                            {pcStates[c.sessionKey] || 'Handshaking...'}
                                        </span>
                                    )}
                                </div>
                                {c.sessionKey !== mySessionKey && remoteStreams[c.sessionKey] && (
                                    <span className="ml-auto text-[8px] bg-emerald-500/20 text-emerald-400 px-1 py-0.5 rounded font-black">LIVE</span>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Controls: only show when calling */}
            {isCalling && (
                <div className="flex items-center gap-2 glass px-3 py-3 rounded-full border-white/10 shadow-2xl">
                    <button
                        onClick={toggleMute}
                        className={`w-12 h-12 rounded-full flex items-center justify-center transition-all duration-300 ${isMuted ? 'bg-rose-500/20 text-rose-500' : 'bg-white/5 text-slate-300 hover:bg-white/10'}`}
                    >
                        {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                    </button>
                    <button
                        onClick={endCall}
                        className="w-12 h-12 rounded-full bg-rose-500 text-white flex items-center justify-center transition-all duration-300 hover:scale-105 active:scale-95 shadow-xl shadow-rose-500/20"
                    >
                        <PhoneOff className="w-5 h-5" />
                    </button>
                </div>
            )}
        </div>
    );
}

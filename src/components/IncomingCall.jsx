import React, { useState, useEffect, useRef } from 'react';
import { LocalNotifications } from '@capacitor/local-notifications';
import { db } from '../lib/firebase';
import { ref, onValue, update, remove } from 'firebase/database';
import { Phone, PhoneOff, X, Minimize2, VolumeX, Volume2, Maximize2 } from 'lucide-react';

// Ringtone URL (loopable)
const RINGTONE_URL = '/ringtone.mp3';

// Helper to validate if a string is a valid URL or data URL (excludes blob: URLs which expire)
const isValidAvatarUrl = (url) => {
    if (!url || typeof url !== 'string') return false;
    if (url.startsWith('blob:')) return false;
    return url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:');
};

export default function IncomingCall({ currentUser, onAccept, onDecline, onMissed, ringtone }) {
    const [incomingCall, setIncomingCall] = useState(null);
    const [isMinimized, setIsMinimized] = useState(false);
    const [isSilent, setIsSilent] = useState(false);
    const ringtoneRef = useRef(null);

    const interactionRef = useRef(false);
    const callStateRef = useRef(null);

    useEffect(() => {
        if (!currentUser) return;

        let sdkLoaded = false;
        const callRef = ref(db, `calls/${currentUser.id}`);

        const unsubscribe = onValue(callRef, (snapshot) => {
            sdkLoaded = true;
            const data = snapshot.exists() ? snapshot.val() : null;
            const prevCall = callStateRef.current;
            callStateRef.current = data;

            if (data && data.status === 'ringing') {
                setIncomingCall(data);
                interactionRef.current = false; // Reset interaction flag

                // Trigger Local Notification for Call
                try {
                    LocalNotifications.schedule({
                        notifications: [
                            {
                                title: 'Incoming Notification Call',
                                body: `Voice call from ${data.callerName}`,
                                id: Math.floor(Math.random() * 1000000),
                                schedule: { at: new Date(Date.now() + 100) },
                                sound: null,
                                extra: null
                            }
                        ]
                    });
                } catch (e) {
                    console.error("Failed to schedule call notification", e);
                }
            } else {
                // Call ended or status changed
                if (prevCall && prevCall.status === 'ringing' && !interactionRef.current) {
                    // It was ringing, now it's gone or stopped ringing, and no interaction
                    if (onMissed) onMissed(prevCall);
                }
                setIncomingCall(null);
                setIsMinimized(false);
                setIsSilent(false);
            }
        });

        const checkCallREST = async () => {
            if (sdkLoaded) return;
            try {
                const response = await fetch(`https://crispconnect-default-rtdb.firebaseio.com/calls/${currentUser.id}.json`);
                if (response.ok) {
                    const data = await response.json();
                    const prevCall = callStateRef.current;
                    callStateRef.current = data;

                    if (data && data.status === 'ringing') {
                        setIncomingCall(data);
                        interactionRef.current = false;
                    } else {
                        if (prevCall && prevCall.status === 'ringing' && !interactionRef.current) {
                            if (onMissed) onMissed(prevCall);
                        }
                        setIncomingCall(null);
                    }
                }
            } catch (err) { }
        };

        const pollInterval = setInterval(checkCallREST, 3500);

        return () => {
            unsubscribe();
            clearInterval(pollInterval);
        };
    }, [currentUser]);

    // Play/Stop Ringtone
    useEffect(() => {
        if (incomingCall && !isSilent) {
            if (!ringtoneRef.current) {
                ringtoneRef.current = new Audio(ringtone || RINGTONE_URL);
                ringtoneRef.current.loop = true;
            }
            ringtoneRef.current.play().catch(e => console.warn("Ringtone autoplay blocked:", e));
        } else {
            if (ringtoneRef.current) {
                ringtoneRef.current.pause();
                if (!incomingCall) {
                    ringtoneRef.current.currentTime = 0;
                    ringtoneRef.current = null;
                }
            }
        }
        return () => {
            if (ringtoneRef.current) {
                ringtoneRef.current.pause();
            }
        };
    }, [incomingCall, isSilent, ringtone]);

    const handleAccept = () => {
        if (!incomingCall || !currentUser) return;
        interactionRef.current = true;
        const callRef = ref(db, `calls/${currentUser.id}`);
        update(callRef, { status: 'accepted' });
        onAccept({
            roomId: incomingCall.roomId,
            callerName: incomingCall.callerName,
            callerId: incomingCall.callerId
        });
        setIncomingCall(null);
    };

    const handleDecline = () => {
        if (!incomingCall || !currentUser) return;
        interactionRef.current = true;
        const callRef = ref(db, `calls/${currentUser.id}`);
        update(callRef, { status: 'declined' }).then(() => remove(callRef));
        onDecline(incomingCall);
        setIncomingCall(null);
    };

    if (!incomingCall) return null;

    if (isMinimized) {
        return (
            <div className="fixed top-4 right-4 z-[300] animate-bounce-subtle">
                <div
                    onClick={() => setIsMinimized(false)}
                    className="bg-[#00a884] text-white px-4 py-3 rounded-2xl shadow-2xl border border-white/20 flex items-center gap-3 cursor-pointer hover:scale-105 transition-transform"
                >
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#00a884] to-[#02d98b] overflow-hidden flex items-center justify-center text-white text-lg font-bold shrink-0">
                        {isValidAvatarUrl(incomingCall.callerAvatar) ? (
                            <img src={incomingCall.callerAvatar} alt="DP" className="w-full h-full object-cover" />
                        ) : (
                            incomingCall.callerName?.[0]?.toUpperCase()
                        )}
                    </div>
                    <div className="flex flex-col">
                        <span className="text-xs font-bold whitespace-nowrap">Call from {incomingCall.callerName}</span>
                        <span className="text-[10px] opacity-80">Click to expand</span>
                    </div>
                    <Maximize2 className="w-4 h-4 ml-2" />
                </div>
            </div>
        );
    }

    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-sm animate-fade-in p-4">
            <div className="bg-[#111b21] rounded-3xl p-8 w-full max-w-[320px] shadow-2xl border border-[#323b42] text-center relative overflow-hidden">
                {/* Header Controls */}
                <div className="absolute top-4 right-4 flex gap-2">
                    <button
                        onClick={() => setIsMinimized(true)}
                        className="p-2 text-[#8696a0] hover:text-white transition-colors"
                        title="Minimize"
                    >
                        <Minimize2 className="w-5 h-5" />
                    </button>
                </div>

                {/* Caller Avatar */}
                <div className="w-24 h-24 mx-auto rounded-full bg-gradient-to-br from-[#00a884] to-[#02d98b] flex items-center justify-center text-white text-4xl font-bold mb-6 shadow-lg animate-pulse overflow-hidden">
                    {isValidAvatarUrl(incomingCall.callerAvatar) ? (
                        <img src={incomingCall.callerAvatar} alt="DP" className="w-full h-full object-cover" />
                    ) : (
                        incomingCall.callerName?.[0]?.toUpperCase() || '?'
                    )}
                </div>

                <h2 className="text-xl font-semibold text-[#e9edef] mb-1">
                    {incomingCall.callerName || 'Unknown'}
                </h2>
                <p className="text-sm text-[#8696a0] mb-8">Incoming voice call...</p>

                {/* Action Buttons */}
                <div className="flex flex-col gap-4">
                    <div className="flex justify-center gap-6">
                        <button
                            onClick={handleDecline}
                            className="w-16 h-16 rounded-full bg-rose-500 text-white flex items-center justify-center transition-transform hover:scale-110 active:scale-95 shadow-xl"
                            title="Decline"
                        >
                            <PhoneOff className="w-7 h-7" />
                        </button>
                        <button
                            onClick={handleAccept}
                            className="w-16 h-16 rounded-full bg-[#00a884] text-white flex items-center justify-center transition-transform hover:scale-110 active:scale-95 shadow-xl"
                            title="Accept"
                        >
                            <Phone className="w-7 h-7" />
                        </button>
                    </div>

                    <button
                        onClick={() => setIsSilent(!isSilent)}
                        className={`flex items-center justify-center gap-2 py-2 px-4 rounded-xl transition-all ${isSilent ? 'bg-amber-500/20 text-amber-500' : 'bg-white/5 text-[#8696a0] hover:bg-white/10'}`}
                    >
                        {isSilent ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                        <span className="text-xs font-semibold">{isSilent ? 'Silent' : 'Silence Ringtone'}</span>
                    </button>
                </div>
            </div>
        </div>
    );
}

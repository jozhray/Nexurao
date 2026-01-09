import React, { useState, useEffect, useRef } from 'react';
import { db, storage } from '../lib/firebase';
import { ref, push, onValue, serverTimestamp, query, limitToLast, set, get, remove } from 'firebase/database';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { Send, Image as ImageIcon, Plus, Check, Phone, Mic, Square, FileText, Video, Play, Pause, X, MapPin, UserPlus, UserMinus, Trash2, RotateCcw, CornerUpLeft } from 'lucide-react';

// Helper to validate if a string is a valid URL or data URL (excludes blob: URLs which expire)
const isValidAvatarUrl = (url) => {
    if (!url || typeof url !== 'string') return false;
    if (url.startsWith('blob:')) return false;
    return url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:');
};

export default function Chat({ user, roomId, onBack, chatName, chatAvatar, peerId, onStartCall, chatBackground, unreadCount = 0, initialMessageId = null }) {

    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState('');
    const [previewUser, setPreviewUser] = useState(null);
    const [confirmModal, setConfirmModal] = useState(null); // { type: 'delete'|'clear', target: id|null, title, message, action }
    const [replyTo, setReplyTo] = useState(null); // { id, text, userName }
    const [highlightedMessageId, setHighlightedMessageId] = useState(null);
    const scrollRef = useRef(null);
    const inputRef = useRef(null);

    // ... (refs and state unchanged) ...
    // Note: I will only replace the top distinct part to add imports and prop.
    // The handleSend logic is further down, I will use a separate replacement for that to be safe.

    // File input refs
    const docInputRef = useRef(null);
    const mediaInputRef = useRef(null);

    // Voice recording state
    const [isRecording, setIsRecording] = useState(false);
    const [recordingTime, setRecordingTime] = useState(0);
    const mediaRecorderRef = useRef(null);
    const audioChunksRef = useRef([]);
    const recordingTimerRef = useRef(null);

    // Pending attachment for confirmation (type, data, preview info)
    const [pendingAttachment, setPendingAttachment] = useState(null);

    // Preview modal state for viewing files before download
    const [previewFile, setPreviewFile] = useState(null); // { type, url, name, size }

    // Contact state
    const [isContact, setIsContact] = useState(false);

    // Peer presence/online status
    const [peerStatus, setPeerStatus] = useState({ online: false, lastSeen: null });

    // Check if peer is in contacts
    useEffect(() => {
        if (!user || !peerId) return;
        const contactRef = ref(db, `user_contacts/${user.id}/${peerId}`);
        const unsubscribe = onValue(contactRef, (snapshot) => {
            setIsContact(snapshot.exists());
        });
        return () => unsubscribe();
    }, [user, peerId]);

    // Extract peerId from roomId if not provided (dm_user1_user2 format)
    const effectivePeerId = peerId || (() => {
        if (roomId && roomId.startsWith('dm_')) {
            const parts = roomId.replace('dm_', '').split('_');
            // Return the ID that is not the current user
            return parts.find(id => id !== user?.id) || null;
        }
        return null;
    })();

    // Listen to peer's presence status
    useEffect(() => {
        if (!effectivePeerId) return;
        console.log('[Chat] Listening to presence for:', effectivePeerId);
        const presenceRef = ref(db, `users/${effectivePeerId}`);
        const unsubscribe = onValue(presenceRef, (snapshot) => {
            console.log('[Chat] Presence snapshot:', snapshot.exists(), snapshot.val());
            if (snapshot.exists()) {
                const data = snapshot.val();
                setPeerStatus({
                    online: data.online || false,
                    lastSeen: data.lastSeen || null
                });
            }
        });
        return () => unsubscribe();
    }, [effectivePeerId]);

    // Format last seen time
    const formatLastSeen = (timestamp) => {
        if (!timestamp) return 'Offline';
        const date = new Date(timestamp);
        const now = new Date();
        const isToday = date.toDateString() === now.toDateString();
        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        const isYesterday = date.toDateString() === yesterday.toDateString();

        const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        if (isToday) {
            return `Last seen at ${timeStr}`;
        } else if (isYesterday) {
            return `Last seen yesterday at ${timeStr}`;
        } else {
            const dateStr = date.toLocaleDateString([], { month: 'short', day: 'numeric' });
            return `Last seen ${dateStr} at ${timeStr}`;
        }
    };

    const handleAddToContacts = () => {
        if (!peerId) return;
        const contactRef = ref(db, `user_contacts/${user.id}/${peerId}`);
        set(contactRef, {
            id: peerId,
            name: chatName,
            displayName: chatName,
            avatarUrl: isValidAvatarUrl(chatAvatar) ? chatAvatar : null,
            addedAt: Date.now()
        });
    };

    const handleRemoveFromContacts = () => {
        if (!peerId) return;
        const contactRef = ref(db, `user_contacts/${user.id}/${peerId}`);
        remove(contactRef);
    };

    useEffect(() => {
        if (!roomId) return;

        let sdkLoaded = false;
        const chatRef = ref(db, `messages/${roomId}`);
        const q = query(chatRef, limitToLast(100));

        console.log(`[Chat] Initializing messages load for room: ${roomId}`);

        const unsubscribe = onValue(q, (snapshot) => {
            console.log('[Chat] Messages SDK snapshot received');
            sdkLoaded = true;
            if (snapshot.exists()) {
                const data = snapshot.val();
                const list = Object.entries(data).map(([id, msg]) => ({
                    id,
                    ...msg
                }));
                setMessages(list.sort((a, b) => a.timestamp - b.timestamp));
            } else {
                setMessages([]);
            }
        }, (error) => {
            console.error('[Chat] Messages SDK error:', error);
            if (!sdkLoaded) fetchMessagesREST();
        });

        const fetchMessagesREST = async () => {
            if (sdkLoaded) return;
            console.warn('[Chat] SDK timeout/error for messages, trying REST...');
            try {
                const response = await fetch(`https://crispconnect-default-rtdb.firebaseio.com/messages/${roomId}.json?orderBy="$key"&limitToLast=100`);
                if (response.ok) {
                    const data = await response.json();
                    if (data) {
                        const list = Object.entries(data).map(([id, msg]) => ({
                            id,
                            ...msg
                        }));
                        setMessages(list.sort((a, b) => a.timestamp - b.timestamp));
                        console.log('[Chat] REST messages fetch success');
                    } else {
                        setMessages([]);
                    }
                }
            } catch (err) {
                console.error('[Chat] REST messages fetch failed:', err);
            }
        };

        const timeoutId = setTimeout(fetchMessagesREST, 5000);

        // Clear reply state when room changes
        setReplyTo(null);

        return () => {
            unsubscribe();
            clearTimeout(timeoutId);
        };
    }, [roomId]);

    useEffect(() => {
        if (replyTo && inputRef.current) {
            inputRef.current.focus();
        }
    }, [replyTo]);

    const jumpToMessage = (msgId) => {
        const el = document.getElementById(`msg-${msgId}`);
        if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            setHighlightedMessageId(msgId);
            setTimeout(() => setHighlightedMessageId(null), 2500);
        }
    };

    useEffect(() => {
        if (scrollRef.current && !initialMessageId) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages, initialMessageId]);

    // Jump to initial message if provided
    useEffect(() => {
        if (initialMessageId && messages.length > 0) {
            const hasMessage = messages.some(m => m.id === initialMessageId);
            if (hasMessage) {
                const timer = setTimeout(() => {
                    jumpToMessage(initialMessageId);
                }, 600);
                return () => clearTimeout(timer);
            }
        }
    }, [initialMessageId, messages]);

    const handleDeleteMessage = (msgId) => {
        setConfirmModal({
            type: 'delete',
            target: msgId,
            title: 'Delete Message',
            message: 'Are you sure you want to delete this message? This action cannot be undone.',
            action: () => {
                remove(ref(db, `messages/${roomId}/${msgId}`));
                setConfirmModal(null);
            }
        });
    };

    const handleClearChat = () => {
        setConfirmModal({
            type: 'clear',
            target: null,
            title: 'Clear Chat History',
            message: 'This will permanently delete all messages in this conversation. Are you sure?',
            action: () => {
                remove(ref(db, `messages/${roomId}`));
                setConfirmModal(null);
            }
        });
    };

    const updateChatHistory = () => {
        if (!peerId || !user.id) return;

        // Update Sender's History
        const senderHistoryRef = ref(db, `user_chats/${user.id}/${peerId}`);
        set(senderHistoryRef, { id: peerId, lastActive: serverTimestamp() });

        // Update Recipient's History
        const recipientHistoryRef = ref(db, `user_chats/${peerId}/${user.id}`);
        set(recipientHistoryRef, { id: user.id, lastActive: serverTimestamp() });

        // Signal user to open/focus chat
        const invokeRef = ref(db, `users/${peerId}/invokeChat`);
        set(invokeRef, {
            roomId: roomId,
            fromName: user.name,
            timestamp: Date.now()
        });
    };

    const handleSend = async (e) => {
        e.preventDefault();

        const currentReplyTo = replyTo;
        setReplyTo(null);

        // If there's a pending attachment, send it with optional caption
        if (pendingAttachment) {
            updateChatHistory(); // Persist chat on attachment send
            const chatRef = ref(db, `messages/${roomId}`);
            const { type, ...data } = pendingAttachment;
            push(chatRef, {
                userId: user.id,
                userName: user.name,
                ...data,
                caption: input.trim() || null,
                timestamp: serverTimestamp(),
                type,
                replyTo: currentReplyTo
            });
            setPendingAttachment(null);
            setInput('');
            return;
        }

        if (!input.trim() || !roomId) return;

        updateChatHistory(); // Persist chat on text send

        const currentInput = input;
        setInput('');

        const messageData = {
            userId: user.id,
            userName: user.name,
            text: currentInput,
            timestamp: Date.now(), // Fallback to local time for REST
            type: 'text',
            replyTo: currentReplyTo
        };

        const chatRef = ref(db, `messages/${roomId}`);

        try {
            // Try SDK first with a small timeout
            const pushPromise = push(chatRef, {
                ...messageData,
                timestamp: serverTimestamp() // Use actual server timestamp for SDK
            });

            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Push Timeout')), 3000)
            );

            await Promise.race([pushPromise, timeoutPromise]);
            console.log('[Chat] Message sent via SDK');
        } catch (err) {
            console.warn('[Chat] SDK push failed or timed out, trying REST POST...', err.message);

            try {
                const response = await fetch(`https://crispconnect-default-rtdb.firebaseio.com/messages/${roomId}.json`, {
                    method: 'POST',
                    body: JSON.stringify(messageData)
                });
                if (response.ok) {
                    console.log('[Chat] Message sent via REST POST');
                    // Manually update local state if REST succeeded but listener might be lagging
                    setMessages(prev => [...prev, { id: Date.now().toString(), ...messageData }]);
                } else {
                    throw new Error('REST POST failed');
                }
            } catch (postErr) {
                console.error('[Chat] All send attempts failed:', postErr);
                alert('Failed to send message. Please check your connection.');
                setInput(currentInput); // Restore input on failure
            }
        }
    };

    // Document Upload Handler
    const handleDocumentClick = () => {
        docInputRef.current?.click();
    };

    const [isUploading, setIsUploading] = useState(false);
    const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB limit for Base64 encoding

    // Confirmation handlers for pending attachments
    const cancelPendingAttachment = () => {
        setPendingAttachment(null);
    };

    const handleDocumentChange = async (e) => {
        const file = e.target.files?.[0];
        if (!file || !roomId) return;

        if (file.size > MAX_FILE_SIZE) {
            alert(`File too large! Maximum size is 5MB. Your file is ${(file.size / 1024 / 1024).toFixed(1)}MB.`);
            e.target.value = '';
            return;
        }

        const reader = new FileReader();
        reader.onload = () => {
            const dataUrl = reader.result;
            // Stage for confirmation
            setPendingAttachment({
                type: 'document',
                fileName: file.name,
                fileSize: file.size,
                fileType: file.type,
                fileUrl: dataUrl
            });
        };
        reader.onerror = () => {
            alert('Failed to process file. Please try again.');
        };
        reader.readAsDataURL(file);
        e.target.value = '';
    };

    const handleMediaClick = () => {
        mediaInputRef.current?.click();
    };

    const handleMediaChange = async (e) => {
        const file = e.target.files?.[0];
        if (!file || !roomId) return;

        const isVideo = file.type.startsWith('video/');
        const maxSize = isVideo ? 10 * 1024 * 1024 : 5 * 1024 * 1024;

        if (file.size > maxSize) {
            alert(`File too large! Maximum size is ${isVideo ? '10MB' : '5MB'}. Your file is ${(file.size / 1024 / 1024).toFixed(1)}MB.`);
            e.target.value = '';
            return;
        }

        const reader = new FileReader();
        reader.onload = () => {
            const dataUrl = reader.result;
            // Stage for confirmation
            setPendingAttachment({
                type: isVideo ? 'video' : 'image',
                mediaUrl: dataUrl,
                mediaType: isVideo ? 'video' : 'image'
            });
        };
        reader.onerror = () => {
            alert('Failed to process file. Please try again.');
        };
        reader.readAsDataURL(file);
        e.target.value = '';
    };


    // Voice Recording Handlers
    const startRecording = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorderRef.current = new MediaRecorder(stream);
            audioChunksRef.current = [];

            mediaRecorderRef.current.ondataavailable = (event) => {
                audioChunksRef.current.push(event.data);
            };

            mediaRecorderRef.current.onstop = () => {
                const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });

                // Convert blob to Base64 data URL for cross-browser sharing
                const reader = new FileReader();
                reader.onload = () => {
                    const dataUrl = reader.result;
                    sendVoiceMessage(dataUrl);
                };
                reader.onerror = () => {
                    console.error('[Chat] Failed to convert audio to Base64');
                    alert('Failed to process voice message. Please try again.');
                };
                reader.readAsDataURL(audioBlob);

                stream.getTracks().forEach(track => track.stop());
            };

            mediaRecorderRef.current.start();
            setIsRecording(true);
            setRecordingTime(0);

            recordingTimerRef.current = setInterval(() => {
                setRecordingTime(prev => prev + 1);
            }, 1000);

        } catch (err) {
            console.error('Failed to start recording:', err);
            alert('Could not access microphone');
        }
    };

    const stopRecording = () => {
        if (mediaRecorderRef.current && isRecording) {
            mediaRecorderRef.current.stop();
            setIsRecording(false);
            clearInterval(recordingTimerRef.current);
        }
    };

    const sendVoiceMessage = (audioDataUrl) => {
        if (!roomId) return;
        // Stage voice message for confirmation
        setPendingAttachment({
            type: 'voice',
            audioUrl: audioDataUrl,
            duration: recordingTime
        });
        setRecordingTime(0);
    };

    // Location Sharing Handler
    const shareLocation = () => {
        if (!navigator.geolocation) {
            alert('Geolocation is not supported by your browser');
            return;
        }

        navigator.geolocation.getCurrentPosition(
            (position) => {
                const { latitude, longitude } = position.coords;
                // Stage location for confirmation
                setPendingAttachment({
                    type: 'location',
                    latitude,
                    longitude
                });
            },
            (error) => {
                console.error('Geolocation error:', error);
                alert('Could not get your location. Please enable location permissions.');
            },
            { enableHighAccuracy: true }
        );
    };


    const formatTime = (seconds) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    const formatDateDivider = (timestamp) => {
        const date = new Date(timestamp);
        const now = new Date();

        // Remove time part for comparison
        const dDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        const dNow = new Date(now.getFullYear(), now.getMonth(), now.getDate());

        const diffDays = Math.round((dNow - dDate) / (1000 * 60 * 60 * 24));

        if (diffDays === 0) return 'Today';
        if (diffDays === 1) return 'Yesterday';

        return date.toLocaleDateString([], {
            month: 'long',
            day: 'numeric',
            year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
        });
    };

    const [playingVoice, setPlayingVoice] = useState(null); // URL of the currently playing voice message
    const audioRef = useRef(null);

    const toggleVoicePlayback = (url) => {
        if (playingVoice === url) {
            audioRef.current?.pause();
            setPlayingVoice(null);
        } else {
            if (audioRef.current) {
                audioRef.current.pause();
            }
            audioRef.current = new Audio(url);
            audioRef.current.play();
            setPlayingVoice(url);
            audioRef.current.onended = () => setPlayingVoice(null);
        }
    };

    // Download handler for documents
    const handleDownload = (fileUrl, fileName) => {
        const link = document.createElement('a');
        link.href = fileUrl;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    // Render message based on type
    const renderMessage = (msg) => {
        const isMsgOwn = msg.userId === user.id;
        const attachmentBg = isMsgOwn ? 'bg-cyan-500/10 hover:bg-cyan-500/20 border-cyan-500/30' : 'bg-white/5 hover:bg-white/10 border-white/10';
        const attachmentText = isMsgOwn ? 'text-cyan-100 font-medium' : 'text-slate-200 font-medium';
        const attachmentSubText = isMsgOwn ? 'text-cyan-400/80' : 'text-slate-400';
        const iconColor = isMsgOwn ? 'text-cyan-400' : 'text-slate-400';

        // Helper to render caption if present
        const renderCaption = () => msg.caption ? (
            <p className={`text-sm mt-3 whitespace-pre-wrap ${isMsgOwn ? 'text-cyan-50 opacity-90' : 'text-slate-300'}`}>{msg.caption}</p>
        ) : null;

        switch (msg.type) {
            case 'document':
                return (
                    <div>
                        <button
                            onClick={() => setPreviewFile({ type: 'document', url: msg.fileUrl, name: msg.fileName, size: msg.fileSize })}
                            className={`flex items-center gap-3 ${attachmentBg} rounded-lg p-3 transition-all text-left w-full cursor-pointer border backdrop-blur-sm`}
                        >
                            <div className={`p-2.5 rounded-md ${isMsgOwn ? 'bg-cyan-500/20' : 'bg-white/10'}`}>
                                <FileText className={`w-5 h-5 ${iconColor}`} />
                            </div>
                            <div className="min-w-0 flex-1">
                                <p className={`text-sm truncate ${attachmentText}`}>{msg.fileName}</p>
                                <p className={`text-xs font-mono mt-0.5 ${attachmentSubText}`}>{(msg.fileSize / 1024).toFixed(1)} KB • Click to preview</p>
                            </div>
                        </button>
                        {renderCaption()}
                    </div>
                );
            case 'image':
                return (
                    <div className="space-y-1">
                        {isValidAvatarUrl(msg.mediaUrl) ? (
                            <div
                                className="cursor-pointer overflow-hidden rounded-xl bg-black/20"
                                onClick={() => setPreviewFile({ type: 'image', url: msg.mediaUrl, name: 'Image' })}
                            >
                                <img src={msg.mediaUrl} alt="Shared image" className="max-w-full rounded-lg max-h-[300px] object-cover" />
                            </div>
                        ) : (
                            <div className="bg-slate-700/50 rounded-xl p-4 text-center text-slate-400 text-sm">
                                <p>📷 Image no longer available</p>
                            </div>
                        )}
                        {renderCaption()}
                    </div>
                );
            case 'video':
                return (
                    <div className="space-y-1">
                        {isValidAvatarUrl(msg.mediaUrl) ? (
                            <div
                                className="cursor-pointer overflow-hidden rounded-xl relative bg-black/50 aspect-video flex items-center justify-center group"
                                onClick={() => setPreviewFile({ type: 'video', url: msg.mediaUrl, name: 'Video' })}
                            >
                                <video src={msg.mediaUrl} className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" />
                                <div className="absolute inset-0 flex items-center justify-center">
                                    <div className="w-12 h-12 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center border border-white/20 group-hover:scale-110 transition-transform">
                                        <Play className="w-5 h-5 text-white fill-white ml-0.5" />
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div className="bg-slate-700/50 rounded-xl p-4 text-center text-slate-400 text-sm">
                                <p>🎬 Video no longer available</p>
                            </div>
                        )}
                        {renderCaption()}
                    </div>
                );
            case 'voice':
                return (
                    <div className="min-w-[220px]">
                        <div className={`flex items-center gap-3 ${attachmentBg} p-3 rounded-xl border border-white/5`}>
                            <button
                                onClick={() => toggleVoicePlayback(msg.audioUrl)}
                                className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 transition-all ${isMsgOwn ? 'bg-white text-cyan-600 hover:bg-white/90' : 'bg-cyan-500 text-white hover:bg-cyan-400'}`}
                            >
                                {playingVoice === msg.audioUrl ? (
                                    <Pause className="w-4 h-4 fill-current" />
                                ) : (
                                    <Play className="w-4 h-4 fill-current ml-0.5" />
                                )}
                            </button>
                            <div className="flex-1 space-y-1">
                                <div className={`h-1 rounded-full overflow-hidden ${isMsgOwn ? 'bg-black/20' : 'bg-white/10'}`}>
                                    <div className={`h-full w-1/3 rounded-full ${isMsgOwn ? 'bg-white' : 'bg-cyan-500'}`} />
                                </div>
                                <p className={`text-xs font-mono ${attachmentSubText}`}>{formatTime(msg.duration || 0)}</p>
                            </div>
                        </div>
                        {renderCaption()}
                    </div>
                );
            case 'location':
                return (
                    <div className="space-y-1">
                        <a
                            href={`https://www.google.com/maps?q=${msg.latitude},${msg.longitude}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={`flex items-center gap-3 ${attachmentBg} p-3 rounded-xl border border-white/5`}
                        >
                            <div className={`p-2.5 rounded-lg ${isMsgOwn ? 'bg-white/20' : 'bg-cyan-500/10'}`}>
                                <MapPin className={`w-6 h-6 ${iconColor}`} />
                            </div>
                            <div className="min-w-0 flex-1">
                                <p className={`text-sm font-medium ${attachmentText}`}>Shared Location</p>
                                <p className={`text-xs ${attachmentSubText}`}>Bottom opens in Maps</p>
                            </div>
                        </a>
                        {renderCaption()}
                    </div>
                );
            case 'call_log':
                return (
                    <div className="flex flex-col items-center justify-center py-2 px-4 bg-slate-800/40 rounded-xl border border-white/5 backdrop-blur-sm mx-auto my-1 max-w-[80%]">
                        <div className="flex items-center gap-2 text-cyan-400 mb-1">
                            <Phone className="w-4 h-4" />
                            <span className="text-xs font-bold uppercase tracking-wider">Voice Call</span>
                        </div>
                        <p className="text-[13px] text-slate-300 text-center font-medium">{msg.text}</p>
                    </div>
                );
            case 'text':
            default:
                return <p className={`whitespace-pre-wrap ${isMsgOwn ? 'text-white' : 'text-slate-200'} text-[15px]`}>{msg.text}</p>;
        }
    };



    return (
        <div className="flex-1 flex flex-col h-full relative bg-[#0b141a]">
            {/* Background Pattern */}
            {chatBackground?.url ? (
                <div
                    className="absolute inset-0 bg-cover bg-center pointer-events-none"
                    style={{ backgroundImage: `url(${chatBackground.url})` }}
                />
            ) : (
                <div className="wa-chat-bg pointer-events-none" />
            )}



            {/* Hidden File Inputs */}
            <input
                type="file"
                ref={docInputRef}
                onChange={handleDocumentChange}
                accept=".pdf,.doc,.docx,.txt,.xls,.xlsx,.ppt,.pptx"
                className="hidden"
            />
            <input
                type="file"
                ref={mediaInputRef}
                onChange={handleMediaChange}
                accept="image/*,video/*,.gif"
                className="hidden"
            />

            {/* Full-screen Preview Modal */}
            {previewFile && (
                <div
                    className="fixed inset-0 bg-black/95 z-50 flex flex-col items-center justify-center"
                    onClick={() => setPreviewFile(null)}
                >
                    {/* Header with close and download */}
                    <div className="absolute top-0 left-0 right-0 p-4 flex items-center justify-between bg-gradient-to-b from-black/80 to-transparent z-10">
                        <div className="text-white">
                            <p className="font-medium truncate max-w-[200px] sm:max-w-md">{previewFile.name}</p>
                            {previewFile.size && (
                                <p className="text-sm text-white/60">{(previewFile.size / 1024).toFixed(1)} KB</p>
                            )}
                        </div>
                        <div className="flex items-center gap-3">
                            <button
                                onClick={(e) => { e.stopPropagation(); handleDownload(previewFile.url, previewFile.name); }}
                                className="px-4 py-2 bg-[#00a884] text-white rounded-lg hover:bg-[#008f70] transition-colors flex items-center gap-2"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                    <polyline points="7 10 12 15 17 10" />
                                    <line x1="12" y1="15" x2="12" y2="3" />
                                </svg>
                                Download
                            </button>
                            <button
                                onClick={() => setPreviewFile(null)}
                                className="p-2 text-white/80 hover:text-white hover:bg-white/10 rounded-full transition-colors"
                            >
                                <X className="w-6 h-6" />
                            </button>
                        </div>
                    </div>

                    {/* Preview content */}
                    <div className="flex-1 flex items-center justify-center p-8 w-full" onClick={(e) => e.stopPropagation()}>
                        {previewFile.type === 'image' && (
                            <img
                                src={previewFile.url}
                                alt={previewFile.name}
                                className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
                            />
                        )}
                        {previewFile.type === 'document' && (
                            <div className="w-full max-w-4xl h-[80vh] bg-white rounded-lg overflow-hidden shadow-2xl">
                                {previewFile.name.endsWith('.pdf') ? (
                                    previewFile.url.startsWith('blob:') ? (
                                        <div className="flex flex-col items-center justify-center h-full text-center p-8 bg-slate-100 dark:bg-[#0b141a]">
                                            <FileText className="w-16 h-16 text-slate-400 mb-4" />
                                            <p className="text-lg font-medium text-slate-700 dark:text-slate-200">Preview Expired</p>
                                            <p className="text-sm text-slate-500 mt-2 max-w-sm">
                                                This file link is no longer valid. Determining current file link status...
                                            </p>
                                        </div>
                                    ) : (
                                        <iframe
                                            src={previewFile.url}
                                            className="w-full h-full"
                                            title="Document Preview"
                                        />
                                    )
                                ) : (() => {
                                    // Text-based formats that can be previewed
                                    const textFormats = ['.txt', '.json', '.csv', '.xml', '.html', '.htm', '.md', '.js', '.jsx', '.ts', '.tsx', '.css', '.scss', '.yaml', '.yml', '.ini', '.log', '.py', '.java', '.c', '.cpp', '.h', '.sql'];
                                    const isTextFile = textFormats.some(ext => previewFile.name.toLowerCase().endsWith(ext));

                                    if (previewFile.url.startsWith('blob:')) {
                                        return (
                                            <div className="flex flex-col items-center justify-center h-full text-center p-8 bg-[#1a1a1a]">
                                                <FileText className="w-16 h-16 text-slate-400 mb-4" />
                                                <p className="text-lg font-medium text-white mb-2">Preview Expired</p>
                                                <p className="text-sm text-white/50 max-w-sm">
                                                    This file uses a temporary link that has expired. Please re-upload the file to view it.
                                                </p>
                                            </div>
                                        );
                                    }

                                    if (isTextFile) {
                                        try {
                                            const base64Content = previewFile.url.split(',')[1];
                                            const decodedContent = atob(base64Content);
                                            return (
                                                <div className="w-full h-full bg-[#1e1e1e] p-4 overflow-auto">
                                                    <pre className="text-[#d4d4d4] font-mono text-sm whitespace-pre-wrap break-words">
                                                        {decodedContent}
                                                    </pre>
                                                </div>
                                            );
                                        } catch (e) {
                                            // Fall through to "not available" if decode fails
                                        }
                                    }

                                    return (
                                        <div className="flex flex-col items-center justify-center h-full bg-[#1a1a1a] text-white">
                                            <FileText className="w-20 h-20 text-[#00a884] mb-4" />
                                            <p className="text-lg font-medium mb-2">{previewFile.name}</p>
                                            <p className="text-white/60 mb-6">Preview not available for this file type</p>
                                            <button
                                                onClick={(e) => { e.stopPropagation(); handleDownload(previewFile.url, previewFile.name); }}
                                                className="px-6 py-3 bg-[#00a884] text-white rounded-lg hover:bg-[#008f70] transition-colors"
                                            >
                                                Download to View
                                            </button>
                                        </div>
                                    );
                                })()
                                }
                            </div>
                        )}


                    </div>
                </div>
            )
            }


            {/* Header */}
            <div className="wa-header shrink-0 z-20 bg-slate-900/90 backdrop-blur-md border-b border-white/5 gap-3 shadow-sm">
                <button
                    onClick={onBack}
                    className="md:hidden p-2 -ml-2 text-slate-400 hover:bg-white/5 rounded-full"
                >
                    <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
                </button>
                <div
                    className="w-10 h-10 rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center text-white font-medium overflow-hidden cursor-pointer hover:ring-2 hover:ring-cyan-500/30 transition-all shadow-lg shadow-cyan-500/20"
                    onClick={() => setPreviewUser({ name: chatName, avatarUrl: chatAvatar })}
                >
                    {isValidAvatarUrl(chatAvatar) ? (
                        <img src={chatAvatar} alt={chatName} className="w-full h-full object-cover" />
                    ) : (
                        chatName ? chatName[0].toUpperCase() : '?'
                    )}
                </div>
                <div
                    className="flex flex-col cursor-pointer flex-1"
                    onClick={() => setPreviewUser({ name: chatName, avatarUrl: chatAvatar })}
                >
                    <span className="text-white text-[16px] leading-tight font-medium tracking-wide">{chatName || 'Unknown'}</span>
                    <span className={`text-[13px] leading-tight font-medium ${peerStatus.online ? 'text-green-400' : 'text-slate-400'}`}>
                        {peerStatus.online ? 'Online' : formatLastSeen(peerStatus.lastSeen)}
                    </span>
                </div>
                <div className="flex items-center gap-2 text-slate-400">
                    {peerId && (
                        isContact ? (
                            <button
                                onClick={handleRemoveFromContacts}
                                className="p-2 hover:bg-white/10 rounded-full text-cyan-400 hover:text-rose-400 transition-colors"
                                title="Remove from Contacts"
                            >
                                <UserMinus className="w-5 h-5" />
                            </button>
                        ) : (
                            <button
                                onClick={handleAddToContacts}
                                className="p-2 hover:bg-white/10 rounded-full hover:text-cyan-400 transition-colors"
                                title="Add to Contacts"
                            >
                                <UserPlus className="w-5 h-5" />
                            </button>
                        )
                    )}
                    <button
                        onClick={onStartCall}
                        className="p-2 hover:bg-white/10 rounded-full hover:text-cyan-400 transition-colors"
                        title="Start Voice Call"
                    >
                        <Phone className="w-5 h-5" />
                    </button>
                    <button
                        onClick={handleClearChat}
                        className="p-2 hover:bg-white/10 rounded-full hover:text-rose-400 transition-colors"
                        title="Clear Chat"
                    >
                        <Trash2 className="w-5 h-5" />
                    </button>
                </div>
            </div>

            {/* Messages */}
            <div
                ref={scrollRef}
                className="flex-1 overflow-y-auto overflow-x-hidden px-[10px] pt-[10px] pb-4 flex flex-col gap-3 custom-scrollbar"
            >
                {messages.map((msg, index) => {
                    const isOwn = msg.userId === user.id;
                    const prevMsg = messages[index - 1];
                    const nextMsg = messages[index + 1];
                    const isLastInGroup = !nextMsg || nextMsg.userId !== msg.userId;

                    // Date divider logic
                    const msgDate = new Date(msg.timestamp).toDateString();
                    const prevMsgDate = prevMsg ? new Date(prevMsg.timestamp).toDateString() : null;
                    const showDateDivider = msgDate !== prevMsgDate;

                    // Unread Highlighting Logic
                    // If unreadCount is 3, the last 3 messages should be checked.
                    // However, messages are fetched in order. So index >= messages.length - unreadCount
                    const isUnread = unreadCount > 0 && (index >= messages.length - unreadCount) && !isOwn;
                    const showUnreadMarker = unreadCount > 0 && (index === messages.length - unreadCount);

                    return (
                        <React.Fragment key={msg.id}>
                            {showDateDivider && (
                                <div className="flex justify-center py-4 first:pt-2 relative z-10">
                                    <div className="bg-slate-900/60 text-cyan-200/70 text-[11px] px-4 py-1.5 rounded-full shadow-sm uppercase font-bold tracking-widest border border-cyan-500/10 backdrop-blur-md">
                                        {formatDateDivider(msg.timestamp)}
                                    </div>
                                </div>
                            )}

                            {showUnreadMarker && (
                                <div className="flex justify-center py-4 relative z-10">
                                    <div className="bg-cyan-500/10 text-cyan-400 text-[10px] px-6 py-1 rounded-full border border-cyan-500/30 font-bold tracking-widest uppercase animate-pulse">
                                        New Messages Below
                                    </div>
                                </div>
                            )}

                            <div id={`msg-${msg.id}`} className={`flex flex-col ${isOwn ? 'items-end' : 'items-start'} w-full mb-1 ${isUnread ? 'animate-unread-pulse' : ''}`}>
                                {/* Sender name for incoming messages */}
                                {!isOwn && isLastInGroup && (
                                    <span className="text-[11px] text-cyan-400 font-bold mb-1 ml-3 tracking-wide">{msg.userName || 'Unknown'}</span>
                                )}
                                <div className={`
                                        flex flex-col rounded-lg shadow-sm max-w-[85%] md:max-w-[65%] group backdrop-blur-sm transition-all overflow-hidden
                                        ${isOwn
                                        ? 'bg-slate-900/80 border border-cyan-500/30 border-l-4 border-l-cyan-500'
                                        : isUnread
                                            ? 'bg-cyan-500/10 border border-cyan-400/50 border-l-4 border-l-cyan-400 shadow-[0_0_15px_rgba(34,211,238,0.2)]'
                                            : 'bg-slate-900/80 border border-white/10 border-l-4 border-l-slate-500'}
                                        ${highlightedMessageId === msg.id ? 'bg-cyan-500/20 shadow-[inset_0_0_20px_rgba(6,182,212,0.2)] animate-flash-highlight' : ''}
                                    `}>

                                    {/* Quote Block (Reply) */}
                                    {msg.replyTo && (
                                        <div
                                            className="mx-2 mt-2 p-2 px-3 bg-black/20 rounded-lg border-l-4 border-l-cyan-500 cursor-pointer hover:bg-black/30 transition-colors"
                                            onClick={() => jumpToMessage(msg.replyTo.id)}
                                        >
                                            <p className="text-cyan-400 text-[10px] font-bold uppercase tracking-wider mb-0.5">{msg.replyTo.userName}</p>
                                            <p className="text-slate-300 text-xs truncate opacity-70 italic">"{msg.replyTo.text}"</p>
                                        </div>
                                    )}

                                    {/* Message Content */}
                                    <div className={`p-4 pt-3 pb-2 text-[15px] leading-relaxed text-white font-light tracking-wide break-words transition-all duration-500 ${highlightedMessageId === msg.id ? 'bg-cyan-500/20 shadow-[inset_0_0_20px_rgba(6,182,212,0.2)] animate-flash-highlight' : ''}`}>
                                        {renderMessage(msg)}
                                    </div>

                                    {/* Footer: Time & Status */}
                                    <div className={`px-4 py-1.5 flex justify-end items-center gap-1.5 bg-black/20 ${isOwn ? 'text-cyan-400' : isUnread ? 'text-cyan-300' : 'text-slate-500'}`}>
                                        <button
                                            onClick={() => {
                                                const replyText = msg.text || (msg.type === 'voice' ? 'Voice Message' : msg.type === 'image' ? 'Image' : msg.type === 'video' ? 'Video' : msg.type === 'document' ? msg.fileName : 'Attachment');
                                                setReplyTo({ id: msg.id, text: replyText, userName: msg.userName });
                                            }}
                                            className="opacity-0 group-hover:opacity-100 p-1 hover:text-cyan-400 transition-all mr-1"
                                            title="Reply"
                                        >
                                            <CornerUpLeft className="w-3 h-3" />
                                        </button>
                                        <button
                                            onClick={() => handleDeleteMessage(msg.id)}
                                            className="opacity-0 group-hover:opacity-100 p-1 hover:text-rose-400 transition-all mr-auto"
                                            title="Delete Message"
                                        >
                                            <Trash2 className="w-3 h-3" />
                                        </button>
                                        <span className="text-[10px] font-mono uppercase tracking-wider opacity-80">
                                            {msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                                        </span>
                                        {isOwn && <Check className="w-3 h-3 opacity-100" />}
                                    </div>
                                </div>
                            </div>
                        </React.Fragment>
                    );
                })}
            </div>

            {/* Inline Attachment Preview */}
            {
                pendingAttachment && (
                    <div className="px-4 py-2 bg-[var(--wa-panel)] border-t border-[var(--wa-border)] z-20">
                        <div className="flex items-center gap-3 bg-white/5 rounded-lg p-2 pr-3">
                            {/* Preview thumbnail based on type */}
                            {pendingAttachment.type === 'document' && (
                                <div className="w-12 h-12 rounded-lg bg-[#00a884]/20 flex items-center justify-center shrink-0">
                                    <FileText className="w-6 h-6 text-[#00a884]" />
                                </div>
                            )}
                            {pendingAttachment.type === 'image' && (
                                <img src={pendingAttachment.mediaUrl} alt="Preview" className="w-12 h-12 rounded-lg object-cover shrink-0" />
                            )}
                            {pendingAttachment.type === 'video' && (
                                <div className="w-12 h-12 rounded-lg bg-[#00a884]/20 flex items-center justify-center shrink-0 relative overflow-hidden">
                                    <video src={pendingAttachment.mediaUrl} className="absolute inset-0 w-full h-full object-cover" />
                                    <Video className="w-5 h-5 text-white z-10" />
                                </div>
                            )}
                            {pendingAttachment.type === 'voice' && (
                                <div className="w-12 h-12 rounded-full bg-[#00a884] flex items-center justify-center shrink-0">
                                    <Mic className="w-5 h-5 text-white" />
                                </div>
                            )}
                            {pendingAttachment.type === 'location' && (
                                <div className="w-12 h-12 rounded-full bg-[#00a884] flex items-center justify-center shrink-0">
                                    <MapPin className="w-5 h-5 text-white" />
                                </div>
                            )}

                            {/* Info */}
                            <div className="flex-1 min-w-0">
                                <p className="text-[var(--wa-text)] text-sm font-medium truncate">
                                    {pendingAttachment.type === 'document' && pendingAttachment.fileName}
                                    {pendingAttachment.type === 'image' && 'Image'}
                                    {pendingAttachment.type === 'video' && 'Video'}
                                    {pendingAttachment.type === 'voice' && `Voice message (${formatTime(pendingAttachment.duration || 0)})`}
                                    {pendingAttachment.type === 'location' && 'Location'}
                                </p>
                                <p className="text-[var(--wa-text-muted)] text-xs">
                                    {pendingAttachment.type === 'document' && `${(pendingAttachment.fileSize / 1024).toFixed(1)} KB`}
                                    {pendingAttachment.type !== 'document' && 'Type a caption and press send'}
                                </p>
                            </div>

                            {/* Cancel button */}
                            <button
                                onClick={cancelPendingAttachment}
                                className="p-1.5 rounded-full hover:bg-white/10 text-[var(--wa-text-muted)] hover:text-[var(--wa-text)] transition-colors"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                    </div>
                )
            }

            {/* Reply Preview */}
            {replyTo && (
                <div className="px-4 py-2 bg-slate-900/40 border-t border-white/5 z-20 animate-in slide-in-from-bottom-2 duration-200">
                    <div className="flex items-center gap-3 bg-cyan-500/5 rounded-lg p-3 border-l-4 border-l-cyan-500 relative group overflow-hidden">
                        <div className="flex-1 min-w-0">
                            <p className="text-cyan-400 text-[11px] font-bold mb-0.5 uppercase tracking-wider">{replyTo.userName}</p>
                            <p className="text-slate-300 text-sm truncate opacity-80">{replyTo.text}</p>
                        </div>
                        <button
                            onClick={() => setReplyTo(null)}
                            className="p-1 px-1.5 rounded-md hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                </div>
            )}

            {/* Input Area */}
            <div className="px-3 sm:px-6 py-2 z-20 shrink-0 border-t border-white/10 bg-slate-900/60 backdrop-blur-xl relative min-h-[70px] flex items-center">
                {/* Subtle top glow line */}
                <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-cyan-500/20 to-transparent" />

                {isRecording ? (
                    /* Recording UI */
                    <div className="flex-1 flex items-center gap-3 sm:gap-6 bg-slate-800/80 backdrop-blur-md rounded-2xl px-4 sm:px-6 py-3 sm:py-4 border border-white/10 shadow-inner">
                        <div className="w-3 h-3 sm:w-4 sm:h-4 rounded-full bg-rose-500 animate-pulse shadow-[0_0_15px_rgba(244,63,94,0.6)]" />
                        <span className="text-base sm:text-lg font-mono tracking-widest">{formatTime(recordingTime)}</span>
                        <div className="flex-1 flex items-center gap-1 sm:gap-2 px-1 sm:px-2">
                            {[...Array(window.innerWidth < 640 ? 12 : 24)].map((_, i) => (
                                <div key={i} className="w-1 sm:w-1.5 bg-cyan-500 rounded-full opacity-60 animate-bounce" style={{ height: Math.random() * (window.innerWidth < 640 ? 20 : 30) + 6, animationDelay: `${i * 40}ms`, animationDuration: '0.8s' }} />
                            ))}
                        </div>
                        <button
                            onClick={stopRecording}
                            className="w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-rose-500 flex items-center justify-center text-white hover:bg-rose-600 transition-all shadow-xl hover:scale-110 active:scale-95 group"
                        >
                            <Square className="w-5 h-5 sm:w-6 sm:h-6 text-white fill-current group-hover:scale-90 transition-transform" />
                        </button>
                    </div>
                ) : (
                    /* Normal Input UI */
                    <div className="flex items-center gap-1 sm:gap-2 max-w-[1400px] mx-auto w-full">
                        <div className="flex items-center gap-0.5 sm:gap-1">
                            <button
                                onClick={handleDocumentClick}
                                className="text-slate-400 hover:text-cyan-400 transition-all p-2 sm:p-3 hover:bg-white/5 rounded-full hover:scale-110 active:scale-90"
                                title="Attach Document"
                            >
                                <Plus className="w-7 h-7 sm:w-8 sm:h-8" />
                            </button>
                            <button
                                onClick={handleMediaClick}
                                className="text-slate-400 hover:text-cyan-400 transition-all p-2 sm:p-3 hover:bg-white/5 rounded-full hover:scale-110 active:scale-90"
                                title="Send Image/Video/GIF"
                            >
                                <ImageIcon className="w-7 h-7 sm:w-8 sm:h-8" />
                            </button>
                        </div>

                        <form onSubmit={handleSend} className="flex-1 flex gap-2 sm:gap-4 items-center">
                            <div className="flex-1 bg-slate-800/40 backdrop-blur-sm rounded-2xl flex items-center px-4 sm:px-6 py-3 sm:py-4 border border-white/10 focus-within:border-cyan-500/40 focus-within:ring-4 focus-within:ring-cyan-500/10 focus-within:bg-slate-800/60 transition-all duration-300 shadow-inner relative group">
                                <input
                                    ref={inputRef}
                                    type="text"
                                    value={input}
                                    onChange={(e) => setInput(e.target.value)}
                                    placeholder={pendingAttachment ? "Add a caption..." : "Type a message..."}
                                    className="flex-1 bg-transparent border-none outline-none text-white placeholder-slate-500 text-[16px] sm:text-[17px] font-light tracking-wide"
                                />
                                {/* Bottom hover highlight */}
                                <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-0 h-[2px] bg-cyan-500/50 group-focus-within:w-full transition-all duration-500" />
                            </div>

                            {(input.trim() || pendingAttachment) ? (
                                <button
                                    type="submit"
                                    onClick={handleSend}
                                    className="w-12 h-12 sm:w-14 sm:h-14 shrink-0 rounded-full flex items-center justify-center bg-gradient-to-tr from-cyan-600 to-cyan-400 text-white shadow-[0_4px_15px_rgba(6,182,212,0.3)] hover:shadow-[0_6px_20px_rgba(6,182,212,0.4)] hover:scale-110 active:scale-95 transition-all duration-300 transform"
                                >
                                    <Send className="w-5 h-5 sm:w-6 sm:h-6 sm:ml-1" />
                                </button>
                            ) : (
                                <div className="flex items-center gap-1 sm:gap-2">
                                    <button
                                        type="button"
                                        onClick={shareLocation}
                                        className="p-2 sm:p-3 rounded-full flex items-center justify-center text-slate-400 hover:text-cyan-400 hover:bg-white/5 transition-all hover:scale-110 active:scale-90"
                                        title="Share Location"
                                    >
                                        <MapPin className="w-7 h-7 sm:w-8 sm:h-8" />
                                    </button>
                                    <button
                                        type="button"
                                        onClick={startRecording}
                                        className="p-2 sm:p-3 rounded-full flex items-center justify-center text-slate-400 hover:text-cyan-400 hover:bg-white/5 transition-all hover:scale-110 active:scale-90"
                                        title="Record Voice Message"
                                    >
                                        <Mic className="w-7 h-7 sm:w-8 sm:h-8" />
                                    </button>
                                </div>
                            )}
                        </form>
                    </div>
                )}
            </div>

            {/* Profile Preview Modal */}
            {
                previewUser && (
                    <div
                        className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200"
                        onClick={() => setPreviewUser(null)}
                    >
                        <div
                            className="bg-[#2a3942] rounded-lg shadow-2xl overflow-hidden max-w-sm w-full animate-in zoom-in-95 duration-200"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="relative aspect-square w-full bg-[#111b21]">
                                {isValidAvatarUrl(previewUser.avatarUrl) ? (
                                    <img src={previewUser.avatarUrl} alt={previewUser.name} className="w-full h-full object-cover" />
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center text-8xl text-white font-bold bg-slate-700">
                                        {previewUser.name?.[0]?.toUpperCase()}
                                    </div>
                                )}
                                <div className="absolute top-0 left-0 right-0 p-4 bg-gradient-to-b from-black/40 to-transparent">
                                    <h2 className="text-white text-lg font-medium drop-shadow-md">{previewUser.name}</h2>
                                    <p className="text-white/90 text-sm mt-1 drop-shadow-md line-clamp-2">{previewUser.about || 'Hey there! I am using Nexurao.'}</p>

                                </div>

                                <button
                                    onClick={() => setPreviewUser(null)}
                                    className="absolute top-4 right-4 text-white/80 hover:text-white transition-colors"
                                >
                                    <X className="w-6 h-6" />
                                </button>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* Confirmation Modal */}
            {confirmModal && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-[#1f2c34] rounded-2xl p-6 w-full max-w-sm shadow-2xl border border-white/5 animate-in zoom-in-95 duration-200">
                        <h3 className="text-xl font-bold text-white mb-2">{confirmModal.title}</h3>
                        <p className="text-slate-400 text-sm mb-6 leading-relaxed">
                            {confirmModal.message}
                        </p>
                        <div className="flex gap-3">
                            <button
                                onClick={() => setConfirmModal(null)}
                                className="flex-1 px-4 py-2.5 rounded-xl bg-white/5 text-slate-300 font-medium hover:bg-white/10 transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={confirmModal.action}
                                className="flex-1 px-4 py-2.5 rounded-xl bg-rose-500 text-white font-medium hover:bg-rose-600 transition-colors shadow-lg shadow-rose-500/20"
                            >
                                {confirmModal.type === 'clear' ? 'Clear All' : 'Delete'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div >
    );
}

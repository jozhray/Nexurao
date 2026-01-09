import React, { useState, useEffect, useRef } from 'react';
import { db } from './lib/firebase';
import { ref, onValue, set, serverTimestamp, onDisconnect, get, remove, update, push, query, limitToLast } from 'firebase/database';
import Auth from './components/Auth';
import Chat from './components/Chat';
import VoiceCall from './components/VoiceCall';
import UserSearch from './components/UserSearch';
import IncomingCall from './components/IncomingCall';
import Settings from './components/Settings';
import WeatherEffects from './components/WeatherEffects';
import { Phone, PhoneOff, Lock, MessageCircle, Settings as SettingsIcon, LogOut, Check, X, Sun, Moon, Minimize2, Maximize2, Users } from 'lucide-react';

// Ringback sound for caller
const RINGBACK_URL = '/ringback.mp3';

// Helper to validate if a string is a valid URL or data URL (excludes blob: URLs which expire)
const isValidAvatarUrl = (url) => {
  if (!url || typeof url !== 'string') return false;
  if (url.startsWith('blob:')) return false;
  return url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:');
};

function App() {
  const [user, setUser] = useState(null);
  const [showOnline, setShowOnline] = useState(false);
  const [onlineUsers, setOnlineUsers] = useState({});
  const [activeChat, setActiveChat] = useState(() => {
    const savedUser = localStorage.getItem('nexurao_user');
    if (savedUser) {
      try {
        const userId = JSON.parse(savedUser).id;
        const savedChat = localStorage.getItem(`nexurao_active_chat_${userId}`);
        return savedChat ? JSON.parse(savedChat) : null;
      } catch (e) { return null; }
    }
    return null;
  }); // { id: roomId, name: otherUserName, peerId: otherUserId }
  const [showSidebar, setShowSidebar] = useState(false);
  const [isVoiceActive, setIsVoiceActive] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [missedCallUsers, setMissedCallUsers] = useState(() => {
    const savedUser = localStorage.getItem('nexurao_user');
    if (savedUser) {
      try {
        const userId = JSON.parse(savedUser).id;
        const saved = localStorage.getItem(`nexurao_missed_calls_${userId}`);
        return saved ? JSON.parse(saved) : [];
      } catch (e) { return []; }
    }
    return [];
  }); // Array of unique caller IDs for missed calls
  const [searchViewMode, setSearchViewMode] = useState('history'); // 'history' or 'directory'
  const [previewUser, setPreviewUser] = useState(null);
  const [theme, setTheme] = useState('dark'); // 'dark' or 'light'
  const toggleTheme = () => setTheme(prev => prev === 'light' ? 'dark' : 'light');
  const [chatBackground, setChatBackground] = useState(() => {
    const saved = localStorage.getItem('nexurao_chat_background');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        // Fix for "Not allowed to load local resource: blob:..." error
        if (parsed.url && parsed.url.startsWith('blob:')) {
          return { id: 'light-chat', url: '/bg-light-chat.png' };
        }
        return parsed;
      } catch (e) {
        return { id: 'light-chat', url: '/bg-light-chat.png' };
      }
    }
    return { id: 'light-chat', url: '/bg-light-chat.png' };
  });

  // Call Ringing State
  const [outgoingCall, setOutgoingCall] = useState(null); // { recipientId, status, startTime }
  const [isOutgoingMinimized, setIsOutgoingMinimized] = useState(false);
  const [unreadCounts, setUnreadCounts] = useState(() => {
    const savedUser = localStorage.getItem('nexurao_user');
    if (savedUser) {
      try {
        const userId = JSON.parse(savedUser).id;
        const saved = localStorage.getItem(`nexurao_unread_counts_${userId}`);
        return saved ? JSON.parse(saved) : {};
      } catch (e) { return {}; }
    }
    return {};
  }); // { roomId: count }
  const [currentChatUnreadCount, setCurrentChatUnreadCount] = useState(0);
  const [notificationPopup, setNotificationPopup] = useState(null); // { title, body, id, user, roomId }
  const [activeCallType, setActiveCallType] = useState('outgoing'); // 'incoming' or 'outgoing'
  const [appLaunchTime] = useState(Date.now()); // Track launch time to avoid notifying old messages

  const callTimeoutRef = useRef(null);
  const ringbackRef = useRef(null);

  // Request Notification Permission
  useEffect(() => {
    if ('Notification' in window && Notification.permission !== 'granted') {
      Notification.requestPermission();
    }
  }, []);

  const sendNotification = (title, body, icon, tag) => {
    if ('Notification' in window && Notification.permission === 'granted') {
      const n = new Notification(title, { body, icon, tag });
      n.onclick = function () {
        window.focus();
        this.close();
      };

      // Play sound
      const audio = new Audio('/notification.mp3'); // Assuming you have one, or use a default URL or existing sound
      // For now, let's reuse a simple beep or just rely on system sound if possible, or silence if no file.
      // We'll leave audio out for now to avoid 404s until a file is added, or use a data URI sound if wanted.
    }
  };

  useEffect(() => {
    const savedUser = localStorage.getItem('nexurao_user');
    if (savedUser) {
      try {
        const parsed = JSON.parse(savedUser);
        // Fix for "Not allowed to load local resource: blob:..." error for avatar
        if (parsed.avatarUrl && parsed.avatarUrl.startsWith('blob:')) {
          parsed.avatarUrl = null;
        }
        setUser(parsed);
      } catch (e) {
        console.error("Failed to parse saved user", e);
      }
    }
  }, []);

  // One-time cleanup: Remove blob URLs from all users in Firebase
  useEffect(() => {
    const cleanupBlobUrls = async () => {
      console.log('[Cleanup] Starting blob URL cleanup...');
      try {
        // Clean users
        const usersRef = ref(db, 'users');
        const snapshot = await get(usersRef);
        if (snapshot.exists()) {
          const users = snapshot.val();
          for (const [userId, userData] of Object.entries(users)) {
            if (userData.avatarUrl && (userData.avatarUrl.startsWith('blob:') || !isValidAvatarUrl(userData.avatarUrl))) {
              console.log(`[Cleanup] Removing invalid avatarUrl for user ${userId}:`, userData.avatarUrl?.substring(0, 50));
              await update(ref(db, `users/${userId}`), { avatarUrl: null });
            }
          }
        }
        // Clean user_contacts
        const contactsRef = ref(db, 'user_contacts');
        const contactsSnap = await get(contactsRef);
        if (contactsSnap.exists()) {
          const allContacts = contactsSnap.val();
          for (const [ownerId, contacts] of Object.entries(allContacts)) {
            if (contacts && typeof contacts === 'object') {
              for (const [contactId, contactData] of Object.entries(contacts)) {
                if (contactData?.avatarUrl && (contactData.avatarUrl.startsWith('blob:') || !isValidAvatarUrl(contactData.avatarUrl))) {
                  console.log(`[Cleanup] Removing invalid avatarUrl from contact ${contactId}:`, contactData.avatarUrl?.substring(0, 50));
                  await update(ref(db, `user_contacts/${ownerId}/${contactId}`), { avatarUrl: null });
                }
              }
            }
          }
        }
        // Clean user_chats
        const chatsRef = ref(db, 'user_chats');
        const chatsSnap = await get(chatsRef);
        if (chatsSnap.exists()) {
          const allChats = chatsSnap.val();
          for (const [ownerId, chats] of Object.entries(allChats)) {
            if (chats && typeof chats === 'object') {
              for (const [chatId, chatData] of Object.entries(chats)) {
                if (chatData?.avatarUrl && (chatData.avatarUrl.startsWith('blob:') || !isValidAvatarUrl(chatData.avatarUrl))) {
                  console.log(`[Cleanup] Removing invalid avatarUrl from chat ${chatId}:`, chatData.avatarUrl?.substring(0, 50));
                  await update(ref(db, `user_chats/${ownerId}/${chatId}`), { avatarUrl: null });
                }
              }
            }
          }
        }
        console.log('[Cleanup] Blob URL cleanup complete');
      } catch (err) {
        console.warn('[Cleanup] Failed to cleanup blob URLs:', err);
      }
    };
    cleanupBlobUrls();
  }, []);

  useEffect(() => {
    if (!user) return;

    const userPresenceRef = ref(db, `presence/global/${user.id}`);
    const onlineRef = ref(db, `presence/global`);
    const userStatusRef = ref(db, `users/${user.id}`);

    // Update presence
    set(userPresenceRef, {
      id: user.id,
      name: user.name,
      lastActive: serverTimestamp()
    });

    // Set user as online
    update(userStatusRef, {
      online: true,
      lastSeen: serverTimestamp()
    });

    // On disconnect: remove presence and set offline with lastSeen timestamp
    onDisconnect(userPresenceRef).remove();
    onDisconnect(userStatusRef).update({
      online: false,
      lastSeen: serverTimestamp()
    });

    const unsubscribe = onValue(onlineRef, (snapshot) => {
      if (snapshot.exists()) {
        setOnlineUsers(snapshot.val());
      } else {
        setOnlineUsers({});
      }
    });

    return () => {
      unsubscribe();
      remove(userPresenceRef);
      // Set offline when component unmounts
      update(userStatusRef, {
        online: false,
        lastSeen: Date.now()
      });
    };
  }, [user]);

  const handleLogout = () => {
    if (user) {
      if (!showLogoutConfirm) {
        setShowLogoutConfirm(true);
        return;
      }

      const userPresenceRef = ref(db, `presence/global/${user.id}`);
      remove(userPresenceRef);
      const userId = user.id;
      setUser(null);
      setActiveChat(null);
      localStorage.removeItem('nexurao_user');
      localStorage.removeItem(`nexurao_active_chat_${userId}`);
      setShowLogoutConfirm(false);
      window.location.reload();
    }
  };

  const startDirectChat = (otherUser, allowAutoCall = true, initialMessageId = null) => {
    const ids = [user.id, otherUser.id].sort();
    const dmRoomId = `dm_${ids[0]}_${ids[1]}`;
    const newChat = {
      id: dmRoomId,
      name: otherUser.displayName || otherUser.name,
      peerId: otherUser.id,
      avatarUrl: isValidAvatarUrl(otherUser.avatarUrl) ? otherUser.avatarUrl : null,
      initialMessageId
    };
    setActiveChat(newChat);
    setShowSidebar(false);

    if (allowAutoCall && searchViewMode === 'call') {
      // Small delay to ensure activeChat is updated before initiation
      setTimeout(() => {
        initiateCallFromActiveChat(newChat);
      }, 100);
    }
  };

  const initiateCallFromActiveChat = async (chat) => {
    if (!chat || !chat.peerId) return;

    const recipientId = chat.peerId;
    const callData = {
      callerId: user.id,
      callerName: user.name,
      roomId: chat.id,
      status: 'ringing',
      timestamp: Date.now()
    };
    const callRef = ref(db, `calls/${recipientId}`);
    try {
      await set(callRef, callData);
    } catch (err) {
      await fetch(`https://crispconnect-default-rtdb.firebaseio.com/calls/${recipientId}.json`, {
        method: 'PUT',
        body: JSON.stringify(callData)
      });
    }
    setOutgoingCall({ recipientId, status: 'ringing', startTime: Date.now() });
    ringbackRef.current = new Audio(RINGBACK_URL);
    ringbackRef.current.loop = true;
    ringbackRef.current.play().catch(e => console.warn("Ringback failed:", e));

    callTimeoutRef.current = setTimeout(() => {
      handleCallTimeout(recipientId, callRef);
    }, 45000);
  };


  // Refs for tracking state inside listeners without triggering re-renders
  const activeChatRef = useRef(null);
  const notifiedMessagesRef = useRef(new Set());
  const persistenceLoadedForRef = useRef(null);

  // Load user-specific persistence on login
  useEffect(() => {
    if (!user) {
      persistenceLoadedForRef.current = null;
      return;
    }

    if (persistenceLoadedForRef.current !== user.id) {
      console.log(`[Persistence] Loading state for user ${user.id}`);

      // Load active chat
      const savedChat = localStorage.getItem(`nexurao_active_chat_${user.id}`);
      if (savedChat) {
        try { setActiveChat(JSON.parse(savedChat)); } catch (e) { }
      }

      // Load unread counts
      const savedCounts = localStorage.getItem(`nexurao_unread_counts_${user.id}`);
      if (savedCounts) {
        try { setUnreadCounts(JSON.parse(savedCounts)); } catch (e) { }
      }

      // Load missed calls
      const savedMissed = localStorage.getItem(`nexurao_missed_calls_${user.id}`);
      if (savedMissed) {
        try { setMissedCallUsers(JSON.parse(savedMissed)); } catch (e) { }
      }

      persistenceLoadedForRef.current = user.id;
    }
  }, [user?.id]);

  // Update ref whenever activeChat changes
  useEffect(() => {
    activeChatRef.current = activeChat;

    // Clear unread count for the opened chat
    if (activeChat) {
      // Clear popup if it's for this room
      if (notificationPopup?.roomId === activeChat.id) {
        setNotificationPopup(null);
      }

      const count = unreadCounts[activeChat.id] || 0;
      if (count > 0) {
        setCurrentChatUnreadCount(count);
        setUnreadCounts(prev => {
          const updated = { ...prev };
          delete updated[activeChat.id];
          return updated;
        });
      } else {
        setCurrentChatUnreadCount(0);
      }
    } else {
      setCurrentChatUnreadCount(0);
    }

    // Persistence: activeChat (User Specific)
    if (user && persistenceLoadedForRef.current === user.id) {
      if (activeChat) {
        localStorage.setItem(`nexurao_active_chat_${user.id}`, JSON.stringify(activeChat));
      } else {
        localStorage.removeItem(`nexurao_active_chat_${user.id}`);
      }
    }
  }, [activeChat, user?.id]);

  // Persistence: Notification counts (keyed by user ID)
  useEffect(() => {
    if (!user || persistenceLoadedForRef.current !== user.id) return;
    localStorage.setItem(`nexurao_unread_counts_${user.id}`, JSON.stringify(unreadCounts));
  }, [unreadCounts, user?.id]);

  useEffect(() => {
    if (!user || persistenceLoadedForRef.current !== user.id) return;
    localStorage.setItem(`nexurao_missed_calls_${user.id}`, JSON.stringify(missedCallUsers));
  }, [missedCallUsers, user?.id]);

  // Helper - Handle New Message Logic
  const handleNewMessage = (lastMsg, roomId) => {
    // Validate message
    if (!lastMsg || !lastMsg.id || !lastMsg.timestamp) return;

    // Notification Logic
    // 1. Must be from someone else
    // 2. Must be newer than app launch (real-time only)
    // 3. Must NOT have been notified already (deduping)
    if (lastMsg.userId !== user.id &&
      lastMsg.timestamp > appLaunchTime &&
      !notifiedMessagesRef.current.has(lastMsg.id)) {

      // Mark as handled
      notifiedMessagesRef.current.add(lastMsg.id);

      // Check if we are already in this chat (using Ref to be always current)
      if (activeChatRef.current?.id !== roomId) {
        // Update unread count
        setUnreadCounts(prev => ({
          ...prev,
          [roomId]: (prev[roomId] || 0) + 1
        }));

        // Trigger In-App Popup
        // Skip popup if it's a missed call (the call history listener handles this popup locally)
        if (lastMsg.type === 'system_call_missed') {
          console.log("Skipping duplicate popup for missed call message");
          return;
        }

        console.log("Triggering In-App Popup for msg:", lastMsg.id);
        const senderUser = {
          id: lastMsg.userId,
          name: lastMsg.userName || 'User',
          displayName: lastMsg.userName || 'User',
          avatarUrl: null
        };

        setNotificationPopup({
          title: lastMsg.userName || 'New Message',
          body: lastMsg.text || 'Sent a file',
          id: lastMsg.id,
          roomId: roomId,
          user: senderUser
        });
      }
    }
  };

  // Global Message Listener for Notifications & Unread Counts
  useEffect(() => {
    if (!user) return;

    // 1. Listen to user's chat list to get all room IDs
    const chatListRef = ref(db, `user_chats/${user.id}`);
    const unsubscribeChatList = onValue(chatListRef, (snapshot) => {
      const chats = snapshot.val() || {};

      // For each chat room, listen to the last message
      Object.keys(chats).forEach(userId => {
        const ids = [user.id, userId].sort();
        const roomId = `dm_${ids[0]}_${ids[1]}`;

        const lastMsgRef = query(ref(db, `messages/${roomId}`), limitToLast(1));
        onValue(lastMsgRef, (msgSnap) => {
          if (msgSnap.exists()) {
            const msgs = msgSnap.val();
            // Get ID from the key
            const lastMsgId = Object.keys(msgs)[0];
            const lastMsgData = msgs[lastMsgId];

            // Construct full message object
            const lastMsg = { id: lastMsgId, ...lastMsgData };

            handleNewMessage(lastMsg, roomId);
          }
        });
      });
    });

    return () => unsubscribeChatList();
  }, [user]); // Removed activeChat logic from dependencies to prevent re-subscribing

  // Missed Call Listener
  useEffect(() => {
    if (!user) return;
    const callHistoryRef = ref(db, `user_call_history/${user.id}`);
    const q = query(callHistoryRef, limitToLast(1)); // Listen for newest call log

    const unsubscribe = onValue(q, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.val();
        const logId = Object.keys(data)[0];
        const log = data[logId];

        // If it's a new missed call (timestamp > launch check)
        // Ideally we track "lastViewedCalls" but for now let's just create a runtime counter
        // that increments on real-time updates.
        if (log.type === 'missed' && log.timestamp > appLaunchTime) {
          // Check if we haven't already counted this log ID
          if (!notifiedMessagesRef.current.has(logId)) {
            notifiedMessagesRef.current.add(logId);

            // Add to unique missed call users if not already there
            if (log.userId && log.userId !== user.id) {
              setMissedCallUsers(prev => prev.includes(log.userId) ? prev : [...prev, log.userId]);
            }

            // Trigger In-App Popup for Missed Call
            const callerUser = {
              id: log.userId,
              name: 'Caller', // We might not have the name handy here without fetching
              displayName: 'Caller',
              avatarUrl: null
            };

            setNotificationPopup({
              title: 'Missed Call',
              body: 'You missed a call',
              id: logId,
              roomId: null,
              user: callerUser,
              type: 'missed_call'
            });
          }
        }
      }
    });
    return () => unsubscribe();
  }, [user, appLaunchTime]);

  // Calculate total unread messages (user count instead of message count)
  const totalUnread = Object.keys(unreadCounts).length;

  const toggleSidebar = () => setShowSidebar(!showSidebar);

  const initiateCall = async () => {
    if (!activeChat || !activeChat.peerId) {
      alert("Cannot call without a recipient.");
      return;
    }
    const recipientId = activeChat.peerId;
    const callData = {
      callerId: user.id,
      callerName: user.name,
      roomId: activeChat.id,
      status: 'ringing',
      timestamp: Date.now()
    };
    const callRef = ref(db, `calls/${recipientId}`);
    try {
      const setPromise = set(callRef, callData);
      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Call Initiation Timeout')), 3000));
      await Promise.race([setPromise, timeoutPromise]);
    } catch (err) {
      try {
        const response = await fetch(`https://crispconnect-default-rtdb.firebaseio.com/calls/${recipientId}.json`, {
          method: 'PUT',
          body: JSON.stringify(callData)
        });
        if (!response.ok) throw new Error('REST call initiation failed');
      } catch (restErr) {
        alert('Failed to initiate call. Connection error.');
        return;
      }
    }
    setOutgoingCall({ recipientId, status: 'ringing', startTime: Date.now() });
    ringbackRef.current = new Audio(RINGBACK_URL);
    ringbackRef.current.loop = true;
    ringbackRef.current.play().catch(e => console.warn("Ringback blocked:", e));
    callTimeoutRef.current = setTimeout(() => handleCallTimeout(recipientId), 30000);
  };

  const handleCallTimeout = (recipientId) => {
    const callRef = ref(db, `calls/${recipientId}`);
    update(callRef, { status: 'timeout' }).then(() => {
      setTimeout(() => remove(callRef), 1000);
    });
    if (ringbackRef.current) {
      ringbackRef.current.pause();
      ringbackRef.current = null;
    }
    setOutgoingCall({ recipientId, status: 'no_answer', startTime: Date.now() });
    setIsOutgoingMinimized(false);
    logCallToHistory(recipientId, 'outgoing', 0);
    setTimeout(() => setOutgoingCall(null), 3000);
  };

  const cancelOutgoingCall = () => {
    if (outgoingCall) {
      setOutgoingCall(null); // Reset outgoing call state
      setIsOutgoingMinimized(false); // Reset minimization state
      const callRef = ref(db, `calls/${outgoingCall.recipientId}`);
      remove(callRef);
      clearTimeout(callTimeoutRef.current);
      if (ringbackRef.current) {
        ringbackRef.current.pause();
        ringbackRef.current = null;
      }
      setOutgoingCall(null);
      logCallToHistory(outgoingCall.recipientId, 'outgoing', 0);
    }
  };

  const handleCallAccepted = (refToCleanup) => {
    clearTimeout(callTimeoutRef.current);
    if (ringbackRef.current) {
      ringbackRef.current.pause();
      ringbackRef.current = null;
    }
    setOutgoingCall(null);
    setIsOutgoingMinimized(false);
    setIsVoiceActive(true);
    setActiveCallType('outgoing');
    remove(refToCleanup);
  };

  const handleCallDeclined = (refToCleanup) => {
    clearTimeout(callTimeoutRef.current);
    if (ringbackRef.current) {
      ringbackRef.current.pause();
      ringbackRef.current = null;
    }
    setOutgoingCall(prev => prev ? { ...prev, status: 'declined' } : null);
    setIsOutgoingMinimized(false);
    if (outgoingCall) {
      logCallToHistory(outgoingCall.recipientId, 'outgoing', 0);
    }
    setTimeout(() => setOutgoingCall(null), 3000);
    remove(refToCleanup);
  };

  const logCallEnd = (roomId, duration) => {
    if (!duration || duration <= 0) return;

    const chatRef = ref(db, `messages/${roomId}`);
    push(chatRef, {
      userId: 'system',
      userName: 'Nexurao',
      text: `Voice call ended • ${formatDuration(duration)}`,
      duration: duration,
      timestamp: serverTimestamp(),
      type: 'call_log'
    });

    // Also log to user's call history
    if (activeChat?.peerId) {
      logCallToHistory(activeChat.peerId, activeCallType, duration);
    }
  };

  const logCallToHistory = (otherUserId, type, duration) => {
    if (!user || !otherUserId || otherUserId === user.id) return;
    const historyRef = ref(db, `user_call_history/${user.id}`);
    const newLogRef = push(historyRef);
    set(newLogRef, {
      userId: otherUserId, // Keep both for safety
      oderId: otherUserId, // UserSearch.jsx expects this
      type, // 'incoming', 'outgoing', 'missed'
      timestamp: Date.now(),
      duration: duration || 0
    });
  };

  const formatDuration = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  };

  useEffect(() => {
    if (!outgoingCall || !outgoingCall.recipientId) return;
    const callRef = ref(db, `calls/${outgoingCall.recipientId}`);
    const unsubscribe = onValue(callRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.val();
        if (data.status === 'accepted') {
          handleCallAccepted(callRef);
        } else if (data.status === 'declined') {
          handleCallDeclined(callRef);
        }
      }
    });

    return () => unsubscribe();
  }, [outgoingCall]);

  const handleAcceptCall = (callData) => {
    setActiveChat({ id: callData.roomId, name: callData.callerName, peerId: callData.callerId });
    setIsVoiceActive(true);
    setActiveCallType('incoming');
    if (user) {
      remove(ref(db, `calls/${user.id}`));
    }
  };

  if (!user) {
    return <Auth onLogin={setUser} />;
  }

  return (
    <div className={`h-[100dvh] w-full flex overflow-hidden relative transition-colors duration-300 ${theme === 'light' ? 'light-theme bg-[#f0f2f5]' : 'bg-[#111b21]'}`}>
      <WeatherEffects theme={theme} />
      <div className="absolute inset-0 top-0 h-32 bg-[#00a884] z-0 hidden md:block"></div>

      <IncomingCall
        currentUser={user}
        onAccept={handleAcceptCall}
        onDecline={(callData) => {
          if (callData && callData.callerId) {
            logCallToHistory(callData.callerId, 'missed');
          }
        }}
        onMissed={(callData) => {
          if (callData && callData.callerId) {
            logCallToHistory(callData.callerId, 'missed');
          }
        }}
      />

      {showSettings && (
        <Settings
          user={user}
          onClose={() => setShowSettings(false)}
          onUpdate={(updatedUser) => setUser(updatedUser)}
          chatBackground={chatBackground.id}
          onBackgroundChange={(bgData) => setChatBackground(bgData)}
        />
      )}

      {outgoingCall && !isOutgoingMinimized && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <div className="bg-[#111b21] rounded-3xl p-8 w-[320px] shadow-2xl border border-[#323b42] flex flex-col items-center text-center relative overflow-hidden">
            <button
              onClick={() => setIsOutgoingMinimized(true)}
              className="absolute top-4 right-4 p-2 text-[#8696a0] hover:text-white transition-colors"
              title="Minimize"
            >
              <Minimize2 className="w-5 h-5" />
            </button>

            <div className="w-24 h-24 mx-auto rounded-full bg-gradient-to-br from-[#00a884] to-[#02d98b] flex items-center justify-center text-white text-4xl font-bold mb-6 shadow-lg animate-pulse">
              {activeChat?.name?.[0]?.toUpperCase() || '?'}
            </div>
            <h2 className="text-xl font-semibold text-[#e9edef] mb-1">{activeChat?.name || 'Unknown'}</h2>
            <p className="text-sm text-[#8696a0] mb-8">
              {outgoingCall.status === 'ringing' && 'Calling...'}
              {outgoingCall.status === 'no_answer' && 'No answer'}
              {outgoingCall.status === 'declined' && 'Call declined'}
            </p>
            {outgoingCall.status === 'ringing' && (
              <button onClick={cancelOutgoingCall} className="w-16 h-16 mx-auto rounded-full bg-rose-500 text-white flex items-center justify-center transition-transform hover:scale-110 active:scale-95 shadow-xl">
                <PhoneOff className="w-7 h-7" />
              </button>
            )}
          </div>
        </div>
      )}

      {outgoingCall && isOutgoingMinimized && (
        <div className="fixed top-4 right-4 z-[300] animate-bounce-subtle">
          <div
            onClick={() => setIsOutgoingMinimized(false)}
            className="bg-[#00a884] text-white px-4 py-3 rounded-2xl shadow-2xl border border-white/20 flex items-center gap-3 cursor-pointer hover:scale-105 transition-transform"
          >
            <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center font-bold">
              {activeChat?.name?.[0]?.toUpperCase() || '?'}
            </div>
            <div className="flex flex-col">
              <span className="text-xs font-bold whitespace-nowrap">Calling {activeChat?.name}</span>
              <span className="text-[10px] opacity-80 text-left">Click to expand</span>
            </div>
            <Maximize2 className="w-4 h-4 ml-2" />
          </div>
        </div>
      )}

      <div className="flex-1 z-10 flex h-full justify-center md:py-5 md:px-5 lg:px-14">
        <div className="w-full h-full max-w-[1600px] bg-transparent flex flex-col md:flex-row shadow-2xl overflow-hidden rounded-none md:rounded-xl border-none md:border border-[#323b42]">

          {/* LEFT PANEL */}
          <div className={`flex flex-col border-r border-[#323b42] h-full w-full md:w-[35%] lg:w-[30%] min-w-[300px] ${activeChat ? 'hidden md:flex' : 'flex'} ${theme === 'light' ? 'bg-white' : 'bg-[#111b21]'}`}>
            <div className="h-[60px] bg-[var(--wa-panel)] flex items-center justify-between px-4 border-b border-[var(--wa-border)] shrink-0">
              <div className="flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-full bg-slate-600 overflow-hidden cursor-pointer hover:ring-2 hover:ring-[var(--wa-teal)]/30 transition-all shrink-0"
                  onClick={() => setPreviewUser(user)}
                >
                  {isValidAvatarUrl(user.avatarUrl) ? (
                    <img src={user.avatarUrl} alt="Avatar" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full bg-slate-500 flex items-center justify-center text-white font-bold">
                      {(user.displayName || user.name)[0].toUpperCase()}
                    </div>
                  )}
                </div>
                <div className="flex flex-col min-w-0">
                  <span className="font-medium text-sm text-[var(--wa-text)] leading-tight truncate">{user.displayName || user.name}</span>
                  <span className="text-[10px] text-[var(--wa-text-muted)] truncate">@{user.name}</span>
                </div>
              </div>
              <div className="flex gap-1 text-[var(--wa-text-muted)]">
                <button
                  className={`p-2 hover:bg-[var(--wa-border)] rounded-full transition-colors relative ${searchViewMode === 'directory' ? 'text-[var(--wa-teal)]' : ''}`}
                  onClick={() => {
                    setSearchViewMode('directory');
                    // Note: We don't clear individual unread counts here as they are cleared when opening the specific chat.
                    // But the user might want to see the list.
                  }}
                  title="New Chat"
                >
                  <MessageCircle className="w-5 h-5" />
                  {totalUnread > 0 && (
                    <span className="absolute -top-1 -right-1 bg-[#00a884] text-[#111b21] text-[10px] font-bold px-1.5 h-4 min-w-[16px] flex items-center justify-center rounded-full shadow-sm ring-2 ring-[var(--wa-panel)]">
                      {totalUnread > 99 ? '99+' : totalUnread}
                    </span>
                  )}
                </button>
                <button
                  className={`p-2 hover:bg-[var(--wa-border)] rounded-full transition-colors relative ${searchViewMode === 'call' ? 'text-[var(--wa-teal)]' : ''}`}
                  onClick={() => {
                    setSearchViewMode('call');
                    setMissedCallUsers([]); // Clear missed call users when viewing call tab
                  }}
                  title="Call"
                >
                  <Phone className="w-5 h-5" />
                  {missedCallUsers.length > 0 && (
                    <span className="absolute -top-1 -right-1 bg-rose-500 text-white text-[10px] font-bold px-1.5 h-4 min-w-[16px] flex items-center justify-center rounded-full shadow-sm ring-2 ring-[var(--wa-panel)]">
                      {missedCallUsers.length > 99 ? '99+' : missedCallUsers.length}
                    </span>
                  )}
                </button>
                <button className="p-2 hover:bg-[var(--wa-border)] rounded-full transition-colors" onClick={() => setShowSettings(true)} title="Settings"><SettingsIcon className="w-5 h-5" /></button>
                <button className="p-2 hover:bg-[var(--wa-border)] rounded-full transition-colors" onClick={handleLogout} title="Logout"><LogOut className="w-5 h-5" /></button>
              </div>
            </div>

            <UserSearch
              currentUser={user}
              onStartChat={startDirectChat}
              onStartCall={(otherUser) => {
                // Start call after chat is opened - initiateCall is already defined in this scope
                if (otherUser) {
                  initiateCall();
                }
              }}
              viewMode={searchViewMode}
              unreadCounts={unreadCounts}
              setViewMode={setSearchViewMode}
            />

            {/* Theme Switcher */}
            <div className="mt-auto border-t border-[var(--wa-border)] p-2 bg-[var(--wa-bg)] shrink-0 relative z-10">
              <div className="w-full grid grid-cols-[1fr_40px_1fr] gap-2 items-center bg-[var(--wa-panel)] rounded-full p-1 border border-[var(--wa-border)] group hover:border-[#00a884]/50 hover:shadow-lg hover:shadow-[#00a884]/10 transition-all duration-300 transform hover:scale-[1.02]">
                <button
                  onClick={toggleTheme}
                  className={`flex items-center justify-center gap-2 py-3 sm:py-4 px-2 sm:px-4 rounded-full text-[12px] sm:text-[14px] font-bold transition-all duration-300 relative overflow-hidden ${theme === 'light' ? 'bg-[#00a884] text-white shadow-[0_0_15px_rgba(0,168,132,0.5)] scale-105' : 'text-[var(--wa-text-muted)] hover:text-[var(--wa-text)]'}`}
                >
                  {theme === 'light' && <div className="animate-liquid"></div>}
                  <Sun className={`w-5 sm:w-6 h-5 sm:h-6 transition-transform duration-500 relative z-10 ${theme === 'light' ? 'animate-sun' : 'group-hover:rotate-180 group-hover:text-amber-500'}`} />
                  <span className="relative z-10">Light</span>
                </button>
                <span className="px-1 text-[10px] sm:text-[11px] uppercase tracking-widest text-[var(--wa-text-muted)] font-black pointer-events-none transition-all duration-300 group-hover:tracking-[0.3em] group-hover:text-[#00a884] whitespace-nowrap z-10 text-center block">Mode</span>
                <button
                  onClick={toggleTheme}
                  className={`flex items-center justify-center gap-2 py-3 sm:py-4 px-2 sm:px-4 rounded-full text-[12px] sm:text-[14px] font-bold transition-all duration-300 relative overflow-hidden ${theme === 'dark' ? 'bg-[#00a884] text-white shadow-[0_0_15px_rgba(0,168,132,0.5)] scale-105' : 'text-[var(--wa-text-muted)] hover:text-[var(--wa-text)]'}`}
                >
                  {theme === 'dark' && <div className="animate-liquid"></div>}
                  <span className="relative z-10">Dark</span>
                  <Moon className={`w-5 sm:w-6 h-5 sm:h-6 transition-transform duration-500 relative z-10 ${theme === 'dark' ? 'animate-moon' : 'group-hover:-rotate-12 group-hover:text-blue-400'}`} />
                </button>
              </div>
            </div>
          </div>

          {/* RIGHT PANEL */}
          <div className={`flex-1 flex flex-col bg-[var(--wa-chat-bg)] h-full relative min-w-0 ${activeChat ? 'flex' : 'hidden md:flex'}`}>
            {activeChat ? (
              <>
                <Chat
                  user={user}
                  roomId={activeChat.id}
                  onBack={() => { setActiveChat(null); setIsVoiceActive(false); }}
                  chatName={activeChat.name}
                  chatAvatar={isValidAvatarUrl(activeChat.avatarUrl) ? activeChat.avatarUrl : null}
                  peerId={activeChat.peerId}
                  onStartCall={initiateCall}
                  chatBackground={chatBackground}
                  unreadCount={currentChatUnreadCount}
                  initialMessageId={activeChat.initialMessageId}
                />
                {isVoiceActive && (
                  <VoiceCall
                    user={user}
                    roomId={activeChat.id}
                    autoJoin={true}
                    onEnd={(duration) => {
                      logCallEnd(activeChat.id, duration);
                      setIsVoiceActive(false);
                    }}
                  />
                )}
              </>
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center bg-[var(--wa-chat-bg)] relative overflow-hidden">
                <div className="wa-chat-bg absolute inset-0 opacity-[0.06]"></div>
                <div className="max-w-[560px] text-center flex flex-col items-center relative z-10 animate-fade-in-up">
                  <div className="w-64 flex items-center justify-center relative -mb-4">
                    <img src="/logo.png" alt="Nexurao" className="w-full h-auto object-contain drop-shadow-[0_0_30px_rgba(0,168,132,0.3)] animate-pulse-slow" />
                  </div>
                  <div className="flex flex-col items-center gap-2">
                    <h1 className="text-3xl font-light text-[var(--wa-text)]">Nexurao for Web</h1>
                    <p className="text-sm text-[var(--wa-text-muted)]">Send and receive messages without keeping your phone online.</p>
                  </div>
                  <div className="text-xs flex items-center justify-center gap-2 mt-8 opacity-60">
                    <Lock className="w-3 h-3" /> End-to-end encrypted
                  </div>
                </div>
                <div className="absolute bottom-0 w-full h-2 bg-[#00a884]"></div>
              </div>
            )}
          </div>
        </div>
      </div>

      {showSettings && (
        <Settings
          user={user}
          onUpdateUser={(updated) => {
            setUser(updated);
            localStorage.setItem('nexurao_user', JSON.stringify(updated));
          }}
          onClose={() => setShowSettings(false)}
          currentBackground={chatBackground}
          onBackgroundChange={(bg) => {
            setChatBackground(bg);
            localStorage.setItem('nexurao_chat_background', JSON.stringify(bg));
          }}
        />
      )}

      {/* Logout Confirmation Modal */}
      {showLogoutConfirm && (
        <div className="fixed inset-0 z-[400] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-in fade-in duration-300" onClick={() => setShowLogoutConfirm(false)} />
          <div className="relative bg-slate-900 border border-white/10 rounded-2xl w-full max-w-[320px] overflow-hidden shadow-2xl animate-in zoom-in-95 duration-300">
            <div className="p-6 text-center">
              <div className="w-16 h-16 bg-rose-500/10 border border-rose-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                <LogOut className="w-8 h-8 text-rose-500" />
              </div>
              <h3 className="text-xl font-bold text-white mb-2">Logout?</h3>
              <p className="text-slate-400 text-sm mb-6">Are you sure you want to end your session?</p>

              <div className="flex flex-col gap-3">
                <button
                  onClick={handleLogout}
                  className="w-full py-3 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-xl transition-all shadow-lg shadow-rose-500/20"
                >
                  Confirm Logout
                </button>
                <button
                  onClick={() => setShowLogoutConfirm(false)}
                  className="w-full py-3 bg-white/5 hover:bg-white/10 text-white font-medium rounded-xl transition-all"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {previewUser && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in" onClick={() => setPreviewUser(null)}>
          <div className="bg-[#2a3942] rounded-lg shadow-2xl overflow-hidden max-w-sm w-full animate-in zoom-in-95" onClick={(e) => e.stopPropagation()}>
            <div className="relative aspect-square w-full bg-[#111b21]">
              {isValidAvatarUrl(previewUser.avatarUrl) ? <img src={previewUser.avatarUrl} alt={previewUser.displayName || previewUser.name} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-8xl text-white font-bold bg-slate-700">{(previewUser.displayName || previewUser.name)?.[0]?.toUpperCase()}</div>}
              <button onClick={() => setPreviewUser(null)} className="absolute top-4 right-4 text-white/50 hover:text-white transition-colors"><X size={24} /></button>
              <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/80 to-transparent">
                <h2 className="text-white text-lg font-medium">{previewUser.displayName || previewUser.name}</h2>
                <p className="text-white/50 text-xs mb-1">@{previewUser.name}</p>
                <p className="text-white/70 text-sm mt-1">{previewUser.about || 'Hey there! I am using Nexurao.'}</p>
              </div>
            </div>
          </div>
        </div>
      )
      }
    </div >
  );
}

export default App;


import React, { useState, useEffect, useRef } from 'react';
import { LocalNotifications } from '@capacitor/local-notifications';
import { PushNotifications } from '@capacitor/push-notifications';
import { App as CapApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { db } from './lib/firebase';
import { ref, onValue, set, serverTimestamp, onDisconnect, get, remove, update, push, query, limitToLast } from 'firebase/database';
import Auth from './components/Auth';
import Chat from './components/Chat';
import VoiceCall from './components/VoiceCall';
import UserSearch from './components/UserSearch';
import IncomingCall from './components/IncomingCall';
import Settings from './components/Settings';
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
  const [activeChat, setActiveChat] = useState(null); // { id: roomId, name: otherUserName, peerId: otherUserId }
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
  const [phoneRingtone, setPhoneRingtone] = useState(() => {
    const saved = localStorage.getItem('nexurao_phone_ringtone');
    return saved || '/ringtone.mp3';
  });
  const [messageRingtone, setMessageRingtone] = useState(() => {
    const saved = localStorage.getItem('nexurao_message_ringtone');
    return saved || '/ringtones/message_default.mp3';
  });

  const callTimeoutRef = useRef(null);
  const ringbackRef = useRef(null);
  const messageAudioRef = useRef(null);
  const chatListenersRef = useRef(new Map()); // Map to track per-room unsubscribers

  const sendLocalNotification = async (title, body, id) => {
    try {
      if (Capacitor.getPlatform() === 'web') return;
      await LocalNotifications.schedule({
        notifications: [
          {
            title: title,
            body: body,
            id: typeof id === 'number' ? id : Math.floor(Math.random() * 1000000),
            schedule: { at: new Date() }, // Delivery now instead of 1s delay
            smallIcon: 'ic_stat_notification', // Use the dedicated notification icon
            iconColor: '#22d3ee', // Cyan color to match theme
            channelId: 'messages', // Required for Android 8.0+
            importance: 5, // High importance for pop-up behavior
            sound: null,
            attachments: null,
            actionTypeId: '',
            extra: null,
          }
        ]
      });
    } catch (e) {
      console.error('Notification failed', e);
    }
  };

  // System Back Button Handling (Android)
  useEffect(() => {
    let handler;
    const setupHandler = async () => {
      if (Capacitor.getPlatform() === 'web') return;
      handler = await CapApp.addListener('backButton', () => {
        // Prioritize closing the active chat
        if (activeChat) {
          setActiveChat(null);
          return;
        }
        // Then close modals
        if (showSettings) {
          setShowSettings(false);
          return;
        }
        if (previewUser) {
          setPreviewUser(null);
          return;
        }
        if (showOnline) {
          setShowOnline(false);
          return;
        }
        // If none of the above are active, exit the app
        CapApp.exitApp();
      });
    };
    setupHandler();
    return () => {
      if (handler) handler.remove();
    };
  }, [activeChat, showSettings, previewUser, showOnline]);

  // Permissions and Event Handlers
  useEffect(() => {
    // Request Notification Permission
    if ('Notification' in window && Notification.permission !== 'granted') {
      Notification.requestPermission();
    }

    const requestCapacitorPerms = async () => {
      try {
        if (Capacitor.getPlatform() === 'web') return; // Skip on web to avoid "Not implemented" errors

        // Create Notification Channel for Android (Required for 8.0+)
        await LocalNotifications.createChannel({
          id: 'messages',
          name: 'Messages',
          description: 'Chat message notifications',
          importance: 5,
          visibility: 1,
          vibration: true
        });

        const perms = await LocalNotifications.checkPermissions();
        if (perms.display !== 'granted') {
          await LocalNotifications.requestPermissions();
        }
      } catch (e) {
        // Only warn if it's not the unrelated web implementation error
        if (e?.message !== 'Not implemented on web.') {
          console.warn("Capacitor Notifications setup failed", e);
        }
      }
    };
    requestCapacitorPerms();
  }, []);

  // Push Notification Registration & Listeners
  useEffect(() => {
    if (!user?.id) return;

    const setupPush = async () => {
      if (Capacitor.getPlatform() === 'web') return;
      try {
        if (!PushNotifications) {
          console.warn("PushNotifications plugin not available");
          return;
        }

        // Request permissions
        const permStatus = await PushNotifications.requestPermissions();
        if (permStatus.receive === 'granted') {
          await PushNotifications.register();
        }

        // Handle successful registration
        const regListener = await PushNotifications.addListener('registration', async (token) => {
          console.log('Push registration success, token: ' + token.value);
          // Save token to user's profile in Realtime Database
          await update(ref(db, `users/${user.id}`), {
            fcmToken: token.value,
            lastTokenUpdate: serverTimestamp()
          });
        });

        // Handle registration error
        const errListener = await PushNotifications.addListener('registrationError', (error) => {
          console.error('Push registration error: ', error);
        });

        // Handle incoming push notification
        const recListener = await PushNotifications.addListener('pushNotificationReceived', (notification) => {
          console.log('Push received: ', notification);
        });

        // Handle tap on notification
        const actListener = await PushNotifications.addListener('pushNotificationActionPerformed', (notification) => {
          console.log('Push action performed: ', notification);
          const data = notification.notification.data;
          if (data && data.roomId) {
            setActiveChat({
              id: data.roomId,
              name: data.senderName,
              peerId: data.senderId
            });
          }
        });

        return () => {
          regListener.remove();
          errListener.remove();
          recListener.remove();
          actListener.remove();
        };
      } catch (e) {
        console.warn("Push Notification setup failed", e);
      }
    };

    const cleanup = setupPush();
    return () => {
      if (Capacitor.getPlatform() !== 'web') {
        cleanup.then(fn => fn && fn());
        PushNotifications.removeAllListeners();
      }
    };
  }, [user?.id]);

  // Vibration Priming
  useEffect(() => {
    const enableVibration = () => {
      try {
        if (window.navigator?.vibrate) {
          window.navigator.vibrate(0);
        }
      } catch (err) { }
      window.removeEventListener('touchstart', enableVibration);
      window.removeEventListener('mousedown', enableVibration);
      window.removeEventListener('pointerdown', enableVibration);
      window.removeEventListener('click', enableVibration);
    };
    window.addEventListener('touchstart', enableVibration, { once: true });
    window.addEventListener('mousedown', enableVibration, { once: true });
    window.addEventListener('pointerdown', enableVibration, { once: true });
    window.addEventListener('click', enableVibration, { once: true });
    return () => {
      window.removeEventListener('touchstart', enableVibration);
      window.removeEventListener('mousedown', enableVibration);
      window.removeEventListener('pointerdown', enableVibration);
      window.removeEventListener('click', enableVibration);
    };
  }, []);

  useEffect(() => {
    const savedUser = localStorage.getItem('nexurao_user');
    if (savedUser) {
      try {
        const parsed = JSON.parse(savedUser);
        if (parsed.avatarUrl && parsed.avatarUrl.startsWith('blob:')) {
          parsed.avatarUrl = null;
        }
        setUser(parsed);
      } catch (e) {
        console.error("Failed to parse saved user", e);
      }
    }
  }, []);

  // One-time cleanup: Remove blob URLs and legacy data
  useEffect(() => {
    const cleanupLegacyData = async () => {
      try {
        const usersRef = ref(db, 'users');
        const snapshot = await get(usersRef);
        if (snapshot.exists()) {
          const users = snapshot.val();
          for (const [userId, userData] of Object.entries(users)) {
            if (userData.avatarUrl && (userData.avatarUrl.startsWith('blob:') || !isValidAvatarUrl(userData.avatarUrl))) {
              await update(ref(db, `users/${userId}`), { avatarUrl: null });
            }
          }
        }
      } catch (err) { }
    };
    cleanupLegacyData();
  }, []);

  useEffect(() => {
    if (!user) return;

    const userPresenceRef = ref(db, `presence/global/${user.id}`);
    const onlineRef = ref(db, `presence/global`);
    const userStatusRef = ref(db, `users/${user.id}`);

    set(userPresenceRef, {
      id: user.id,
      name: user.name,
      lastActive: serverTimestamp()
    });

    update(userStatusRef, {
      online: true,
      lastSeen: serverTimestamp()
    });

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

  const startDirectChat = (item, allowAutoCall = true, initialMessageId = null, matchingMsgIds = [], searchTerm = '') => {
    let newChat;

    if (item.type === 'group') {
      newChat = {
        id: item.id,
        name: item.name,
        peerId: null,
        type: 'group',
        avatarUrl: null,
        initialMessageId,
        matchingMsgIds,
        searchTerm
      };
    } else if (item.type === 'broadcast') {
      newChat = {
        id: item.id,
        name: item.name,
        peerId: null,
        type: 'broadcast',
        recipients: item.recipients,
        avatarUrl: null,
        initialMessageId
      };
    } else {
      const ids = [user.id, item.id].sort();
      const dmRoomId = `dm_${ids[0]}_${ids[1]}`;
      newChat = {
        id: dmRoomId,
        name: item.displayName || item.name,
        peerId: item.id,
        avatarUrl: isValidAvatarUrl(item.avatarUrl) ? item.avatarUrl : null,
        initialMessageId,
        matchingMsgIds,
        searchTerm,
        type: 'direct'
      };
    }

    setActiveChat(newChat);
    setShowSidebar(false);

    if (allowAutoCall && searchViewMode === 'call' && (!item.type || item.type === 'user' || item.type === 'direct')) {
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

  const activeChatRef = useRef(null);
  const notifiedMessagesRef = useRef(new Set());
  const persistenceLoadedForRef = useRef(null);

  useEffect(() => {
    if (!user) {
      persistenceLoadedForRef.current = null;
      return;
    }

    if (persistenceLoadedForRef.current !== user.id) {
      const savedChat = localStorage.getItem(`nexurao_active_chat_${user.id}`);
      if (savedChat) {
        try { setActiveChat(JSON.parse(savedChat)); } catch (e) { }
      }

      const savedCounts = localStorage.getItem(`nexurao_unread_counts_${user.id}`);
      if (savedCounts) {
        try { setUnreadCounts(JSON.parse(savedCounts)); } catch (e) { }
      }

      const savedMissed = localStorage.getItem(`nexurao_missed_calls_${user.id}`);
      if (savedMissed) {
        try { setMissedCallUsers(JSON.parse(savedMissed)); } catch (e) { }
      }

      persistenceLoadedForRef.current = user.id;
    }
  }, [user?.id]);

  useEffect(() => {
    activeChatRef.current = activeChat;

    if (activeChat) {
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

    if (user && persistenceLoadedForRef.current === user.id) {
      if (activeChat) {
        localStorage.setItem(`nexurao_active_chat_${user.id}`, JSON.stringify(activeChat));
      } else {
        localStorage.removeItem(`nexurao_active_chat_${user.id}`);
      }
    }
  }, [activeChat, user?.id]);

  useEffect(() => {
    if (!user || persistenceLoadedForRef.current !== user.id) return;
    localStorage.setItem(`nexurao_unread_counts_${user.id}`, JSON.stringify(unreadCounts));
  }, [unreadCounts, user?.id]);

  useEffect(() => {
    if (!user || persistenceLoadedForRef.current !== user.id) return;
    localStorage.setItem(`nexurao_missed_calls_${user.id}`, JSON.stringify(missedCallUsers));
  }, [missedCallUsers, user?.id]);

  useEffect(() => {
    localStorage.setItem('nexurao_phone_ringtone', phoneRingtone);
  }, [phoneRingtone]);

  useEffect(() => {
    if (messageRingtone) {
      localStorage.setItem('nexurao_message_ringtone', messageRingtone);
    } else {
      localStorage.removeItem('nexurao_message_ringtone');
    }
  }, [messageRingtone]);

  const handleNewMessage = (lastMsg, roomId) => {
    if (!lastMsg || !lastMsg.id || !lastMsg.timestamp) return;

    if (lastMsg.userId !== user.id &&
      lastMsg.timestamp > appLaunchTime &&
      !notifiedMessagesRef.current.has(lastMsg.id)) {

      notifiedMessagesRef.current.add(lastMsg.id);

      if (activeChatRef.current?.id !== roomId) {
        setUnreadCounts(prev => ({
          ...prev,
          [roomId]: (prev[roomId] || 0) + 1
        }));

        setNotificationPopup({
          title: lastMsg.userName || 'New Message',
          body: lastMsg.text || (lastMsg.type === 'image' ? '📷 Photo' : lastMsg.type === 'video' ? '🎥 Video' : 'File'),
          id: lastMsg.id,
          user: { id: lastMsg.userId, name: lastMsg.userName, avatarUrl: lastMsg.avatarUrl },
          roomId: roomId
        });

        sendLocalNotification(
          lastMsg.userName || 'New Message',
          lastMsg.text || (lastMsg.type === 'image' ? '📷 Photo' : lastMsg.type === 'video' ? '🎥 Video' : 'File'),
          lastMsg.id
        );

        if (messageRingtone) {
          try {
            if (!messageAudioRef.current || messageAudioRef.current.src !== messageRingtone) {
              messageAudioRef.current = new Audio(messageRingtone);
            } else {
              messageAudioRef.current.currentTime = 0;
            }
            messageAudioRef.current.play().catch(e => console.warn("Message sound blocked", e));
          } catch (e) { }
        }
      }
    }
  };

  // Global Message Listener for Notifications & Unread Counts
  useEffect(() => {
    if (!user) return;

    const currentRoomIds = new Set();

    // 1. Listen to user's chat list
    const chatListRef = ref(db, `user_chats/${user.id}`);
    const unsubscribeChatList = onValue(chatListRef, (snapshot) => {
      const chats = snapshot.val() || {};
      Object.keys(chats).forEach(userId => {
        const ids = [user.id, userId].sort();
        const roomId = `dm_${ids[0]}_${ids[1]}`;
        currentRoomIds.add(roomId);

        if (!chatListenersRef.current.has(roomId)) {
          const lastMsgRef = query(ref(db, `messages/${roomId}`), limitToLast(1));
          const unsub = onValue(lastMsgRef, (msgSnap) => {
            if (msgSnap.exists()) {
              const msgs = msgSnap.val();
              const lastMsgId = Object.keys(msgs)[0];
              handleNewMessage({ id: lastMsgId, ...msgs[lastMsgId] }, roomId);
            }
          });
          chatListenersRef.current.set(roomId, unsub);
        }
      });
    });

    // 2. Listen to user's groups list
    const groupListRef = ref(db, `user_groups/${user.id}`);
    const unsubscribeGroupList = onValue(groupListRef, (snapshot) => {
      const gList = snapshot.val() || {};
      Object.keys(gList).forEach(groupId => {
        currentRoomIds.add(groupId);
        if (!chatListenersRef.current.has(groupId)) {
          const lastMsgRef = query(ref(db, `messages/${groupId}`), limitToLast(1));
          const unsub = onValue(lastMsgRef, (msgSnap) => {
            if (msgSnap.exists()) {
              const msgs = msgSnap.val();
              const lastMsgId = Object.keys(msgs)[0];
              handleNewMessage({ id: lastMsgId, ...msgs[lastMsgId] }, groupId);
            }
          });
          chatListenersRef.current.set(groupId, unsub);
        }
      });
    });

    const cleanupInterval = setInterval(() => {
      chatListenersRef.current.forEach((unsub, roomId) => {
        if (!currentRoomIds.has(roomId)) {
          unsub();
          chatListenersRef.current.delete(roomId);
        }
      });
    }, 10000);

    return () => {
      clearInterval(cleanupInterval);
      unsubscribeChatList();
      unsubscribeGroupList();
      chatListenersRef.current.forEach(unsub => unsub());
      chatListenersRef.current.clear();
    };
  }, [user?.id, appLaunchTime]);

  // Missed Call Listener
  useEffect(() => {
    if (!user) return;
    const callHistoryRef = ref(db, `user_call_history/${user.id}`);
    const q = query(callHistoryRef, limitToLast(1));

    const unsubscribe = onValue(q, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.val();
        const logId = Object.keys(data)[0];
        const log = data[logId];

        if (log.type === 'missed' && log.timestamp > appLaunchTime) {
          if (!notifiedMessagesRef.current.has(logId)) {
            notifiedMessagesRef.current.add(logId);
            if (log.userId && log.userId !== user.id) {
              setMissedCallUsers(prev => prev.includes(log.userId) ? prev : [...prev, log.userId]);
            }
            setNotificationPopup({
              title: 'Missed Call',
              body: 'You missed a call',
              id: logId,
              roomId: null,
              user: { id: log.userId, name: 'Caller', displayName: 'Caller', avatarUrl: null },
              type: 'missed_call'
            });
            sendLocalNotification('Missed Call', 'You have a missed voice call', logId);
          }
        }
      }
    });
    return () => unsubscribe();
  }, [user, appLaunchTime]);

  const totalUnread = Object.keys(unreadCounts).length;

  const initiateCall = async () => {
    if (!activeChat) return;

    if (activeChat.type === 'group') {
      setIsVoiceActive(true);
      // Log starting the room
      const chatRef = ref(db, `messages/${activeChat.id}`);
      push(chatRef, {
        text: `${user.displayName || user.name} started a group voice call`,
        type: 'system',
        timestamp: Date.now(),
        userId: 'system'
      });
      return;
    }

    if (!activeChat.peerId) {
      alert("Cannot call without a recipient.");
      return;
    }
    const recipientId = activeChat.peerId;
    const callData = {
      callerId: user.id,
      callerName: user.displayName || user.name,
      callerAvatar: isValidAvatarUrl(user.avatarUrl) ? user.avatarUrl : null,
      roomId: activeChat.id,
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
      const callRef = ref(db, `calls/${outgoingCall.recipientId}`);
      remove(callRef);
      clearTimeout(callTimeoutRef.current);
      if (ringbackRef.current) {
        ringbackRef.current.pause();
        ringbackRef.current = null;
      }
      setOutgoingCall(null);
      setIsOutgoingMinimized(false);
      logCallToHistory(outgoingCall.recipientId, 'outgoing', 0);
    }
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
    if (activeChat?.peerId) {
      logCallToHistory(activeChat.peerId, activeCallType, duration);
    }
  };

  const logCallToHistory = (otherUserId, type, duration) => {
    if (!user || !otherUserId || otherUserId === user.id) return;
    const historyRef = ref(db, `user_call_history/${user.id}`);
    const newLogRef = push(historyRef);
    set(newLogRef, {
      userId: otherUserId,
      type,
      timestamp: Date.now(),
      duration: duration || 0
    });
  };

  const formatDuration = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  };

  useEffect(() => {
    if (!outgoingCall || !outgoingCall.recipientId) return;
    const callRef = ref(db, `calls/${outgoingCall.recipientId}`);
    const unsubscribe = onValue(callRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.val();
        if (data.status === 'accepted') {
          clearTimeout(callTimeoutRef.current);
          if (ringbackRef.current) { ringbackRef.current.pause(); ringbackRef.current = null; }
          setOutgoingCall(null);
          setIsVoiceActive(true);
          setActiveCallType('outgoing');
          remove(callRef);
        } else if (data.status === 'declined') {
          clearTimeout(callTimeoutRef.current);
          if (ringbackRef.current) { ringbackRef.current.pause(); ringbackRef.current = null; }
          setOutgoingCall(prev => prev ? { ...prev, status: 'declined' } : null);
          if (outgoingCall) logCallToHistory(outgoingCall.recipientId, 'outgoing', 0);
          setTimeout(() => setOutgoingCall(null), 3000);
          remove(callRef);
        }
      }
    });
    return () => unsubscribe();
  }, [outgoingCall]);

  const handleAcceptCall = (callData) => {
    setActiveChat({ id: callData.roomId, name: callData.callerName, peerId: callData.callerId });
    setIsVoiceActive(true);
    setActiveCallType('incoming');
    if (user) remove(ref(db, `calls/${user.id}`));
  };

  if (!user) {
    return <Auth onLogin={setUser} />;
  }

  return (
    <div className={`h-[100dvh] w-full flex overflow-hidden relative transition-colors duration-300 ${theme === 'light' ? 'light-theme bg-[#f0f2f5]' : 'bg-[#111b21]'}`}>
      <svg width="0" height="0" className="absolute invisible pointer-events-none">
        <defs>
          <linearGradient id="retro-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#06b6d4" />
            <stop offset="50%" stopColor="#8b5cf6" />
            <stop offset="100%" stopColor="#f97316" />
          </linearGradient>
          <linearGradient id="retro-gradient-orange" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#f97316" />
            <stop offset="50%" stopColor="#facc15" />
            <stop offset="100%" stopColor="#ef4444" />
          </linearGradient>
        </defs>
      </svg>

      <div className="absolute inset-0 top-0 h-32 bg-[#00a884] z-0 hidden md:block"></div>

      <IncomingCall
        currentUser={user}
        onAccept={handleAcceptCall}
        onDecline={(callData) => callData && callData.callerId && logCallToHistory(callData.callerId, 'missed')}
        onMissed={(callData) => callData && callData.callerId && logCallToHistory(callData.callerId, 'missed')}
        ringtone={phoneRingtone}
      />

      {showSettings && (
        <Settings
          user={user}
          onClose={() => setShowSettings(false)}
          onUpdate={(updatedUser) => setUser(updatedUser)}
          chatBackground={chatBackground.id}
          onBackgroundChange={(bgData) => setChatBackground(bgData)}
          phoneRingtone={phoneRingtone}
          onPhoneRingtoneChange={setPhoneRingtone}
          messageRingtone={messageRingtone}
          onMessageRingtoneChange={setMessageRingtone}
        />
      )}

      {outgoingCall && !isOutgoingMinimized && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <div className="bg-[#111b21] rounded-3xl p-8 w-[320px] shadow-2xl border border-[#323b42] flex flex-col items-center text-center relative overflow-hidden">
            <button onClick={() => setIsOutgoingMinimized(true)} className="absolute top-4 right-4 p-2 text-[#8696a0] hover:text-white"><Minimize2 size={20} /></button>
            <div className="w-24 h-24 mx-auto rounded-full bg-gradient-to-br from-[#00a884] to-[#02d98b] flex items-center justify-center text-white text-4xl mb-6 shadow-lg animate-pulse overflow-hidden">
              {isValidAvatarUrl(activeChat?.avatarUrl) ? <img src={activeChat.avatarUrl} className="w-full h-full object-cover" /> : activeChat?.name?.[0]?.toUpperCase()}
            </div>
            <h2 className="text-xl font-semibold text-[#e9edef] mb-1">{activeChat?.name}</h2>
            <p className="text-sm text-[#8696a0] mb-8">{outgoingCall.status === 'ringing' ? 'Calling...' : outgoingCall.status}</p>
            {outgoingCall.status === 'ringing' && (
              <button onClick={cancelOutgoingCall} className="w-16 h-16 rounded-full bg-rose-500 text-white flex items-center justify-center shadow-xl hover:scale-110 transition-transform">
                <PhoneOff size={28} />
              </button>
            )}
          </div>
        </div>
      )}

      {outgoingCall && isOutgoingMinimized && (
        <div className="fixed top-4 right-4 z-[300] bg-[#00a884] text-white px-4 py-3 rounded-2xl shadow-2xl flex items-center gap-3 cursor-pointer" onClick={() => setIsOutgoingMinimized(false)}>
          <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center font-bold overflow-hidden shrink-0">
            {isValidAvatarUrl(activeChat?.avatarUrl) ? <img src={activeChat.avatarUrl} className="w-full h-full object-cover" /> : activeChat?.name?.[0]?.toUpperCase()}
          </div>
          <span className="text-xs font-bold">Calling {activeChat?.name}</span>
          <Maximize2 size={16} />
        </div>
      )}

      <div className="flex-1 z-10 flex h-full justify-center md:py-5 md:px-5 lg:px-14">
        <div className="w-full h-full max-w-[1600px] flex flex-col md:flex-row shadow-2xl overflow-hidden rounded-none md:rounded-xl md:border border-[#323b42]">
          <div className={`flex flex-col border-r border-[#323b42] h-full w-full md:w-[35%] lg:w-[30%] min-w-[300px] ${activeChat ? 'hidden md:flex' : 'flex'} ${theme === 'light' ? 'bg-white' : 'bg-[#111b21]'}`}>
            <div className="wa-header justify-between shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-slate-600 overflow-hidden cursor-pointer" onClick={() => setPreviewUser(user)}>
                  {isValidAvatarUrl(user.avatarUrl) ? <img src={user.avatarUrl} className="w-full h-full object-cover" /> : <div className="w-full h-full bg-slate-500 flex items-center justify-center text-white">{(user.displayName || user.name)[0].toUpperCase()}</div>}
                </div>
                <div className="flex flex-col min-w-0">
                  <span className="font-medium text-sm text-[var(--wa-text)] truncate">{user.displayName || user.name}</span>
                  <span className="text-[10px] text-[var(--wa-text-muted)] truncate">@{user.name}</span>
                </div>
              </div>
              <div className="flex gap-1 text-[var(--wa-text-muted)]">
                <button className={`p-2 hover:bg-[var(--wa-border)] rounded-full relative group/btn ${searchViewMode === 'directory' ? 'text-[var(--wa-teal)]' : ''}`} onClick={() => setSearchViewMode('directory')} title="New Chat">
                  <MessageCircle size={20} className="retro-iridescent" />
                  {totalUnread > 0 && <span className="absolute -top-1 -right-1 bg-[#00a884] text-[#111b21] text-[10px] font-bold px-1.5 h-4 min-w-[16px] flex items-center justify-center rounded-full ring-2 ring-[var(--wa-panel)]">{totalUnread}</span>}
                </button>
                <button className={`p-2 hover:bg-[var(--wa-border)] rounded-full relative group/btn ${searchViewMode === 'call' ? 'text-[var(--wa-teal)]' : ''}`} onClick={() => { setSearchViewMode('call'); setMissedCallUsers([]); }} title="Call">
                  <Phone size={20} className="retro-iridescent" />
                  {missedCallUsers.length > 0 && <span className="absolute -top-1 -right-1 bg-rose-500 text-white text-[10px] font-bold px-1.5 h-4 min-w-[16px] flex items-center justify-center rounded-full ring-2 ring-[var(--wa-panel)]">{missedCallUsers.length}</span>}
                </button>
                <button className="p-2 hover:bg-[var(--wa-border)] rounded-full group/btn" onClick={() => setShowSettings(true)}><SettingsIcon size={20} className="retro-iridescent" /></button>
                <button className="p-2 hover:bg-[var(--wa-border)] rounded-full group/btn" onClick={handleLogout}><LogOut size={20} className="retro-iridescent-orange" /></button>
              </div>
            </div>

            <UserSearch
              currentUser={user}
              onStartChat={startDirectChat}
              onStartCall={initiateCall}
              viewMode={searchViewMode}
              unreadCounts={unreadCounts}
              setViewMode={setSearchViewMode}
            />

            <div className="wa-input-area mt-auto border-t border-[var(--wa-border)] p-2 bg-[var(--wa-bg)] shrink-0">
              <div className="w-full grid grid-cols-[1fr_40px_1fr] gap-2 items-center bg-[var(--wa-panel)] rounded-full p-1 border border-[var(--wa-border)]">
                <button onClick={toggleTheme} className={`flex items-center justify-center gap-2 py-3 rounded-full text-xs font-bold transition-all ${theme === 'light' ? 'bg-[#00a884] text-white shadow-lg' : 'text-[var(--wa-text-muted)]'}`}>
                  <Sun size={20} className="retro-iridescent" /> Light
                </button>
                <span className="text-[10px] uppercase text-center text-[var(--wa-text-muted)] font-black">Mode</span>
                <button onClick={toggleTheme} className={`flex items-center justify-center gap-2 py-3 rounded-full text-xs font-bold transition-all ${theme === 'dark' ? 'bg-[#00a884] text-white shadow-lg' : 'text-[var(--wa-text-muted)]'}`}>
                  Dark <Moon size={20} className="retro-iridescent" />
                </button>
              </div>
            </div>
          </div>

          <div className={`flex-1 flex flex-col bg-[var(--wa-chat-bg)] h-full relative min-w-0 ${activeChat ? 'flex' : 'hidden md:flex'}`}>
            {activeChat ? (
              <>
                <Chat
                  key={activeChat.id}
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
                  chatType={activeChat.type}
                  recipients={activeChat.recipients}
                />
                {isVoiceActive && (
                  <VoiceCall
                    user={user}
                    roomId={activeChat.id}
                    autoJoin={true}
                    onEnd={(duration) => { logCallEnd(activeChat.id, duration); setIsVoiceActive(false); }}
                  />
                )}
              </>
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center relative">
                <div className="max-w-[560px] text-center flex flex-col items-center z-10">
                  <img src="/logo.png" className="w-64 h-auto mb-4" />
                  <h1 className="text-3xl font-light text-[var(--wa-text)]">Nexurao for Web</h1>
                  <p className="text-sm text-[var(--wa-text-muted)]">Send and receive messages without keeping your phone online.</p>
                  <div className="text-xs flex items-center justify-center gap-2 mt-8 opacity-60">
                    <Lock size={12} /> End-to-end encrypted
                  </div>
                </div>
                <div className="absolute bottom-0 w-full h-2 bg-[#00a884]"></div>
              </div>
            )}
          </div>
        </div>
      </div>

      {notificationPopup && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[500] bg-[#1c2c33] text-white px-6 py-4 rounded-2xl shadow-2xl border border-white/10 flex items-center gap-4 animate-in slide-in-from-top cursor-pointer hover:bg-[#203038] transition-colors" onClick={() => {
          if (notificationPopup.roomId) {
            startDirectChat({ id: notificationPopup.roomId, name: notificationPopup.title, type: notificationPopup.roomId.startsWith('group_') ? 'group' : 'user' });
          }
          setNotificationPopup(null);
        }}>
          <div className="w-12 h-12 rounded-full overflow-hidden shrink-0">
            {isValidAvatarUrl(notificationPopup.user?.avatarUrl) ? <img src={notificationPopup.user.avatarUrl} className="w-full h-full object-cover" /> : <div className="w-full h-full bg-slate-600 flex items-center justify-center text-lg font-bold">{notificationPopup.title[0]}</div>}
          </div>
          <div>
            <h4 className="font-bold text-sm">{notificationPopup.title}</h4>
            <p className="text-xs text-white/70 line-clamp-1">{notificationPopup.body}</p>
          </div>
          <button onClick={(e) => { e.stopPropagation(); setNotificationPopup(null); }} className="ml-4 p-1 hover:bg-white/10 rounded-full"><X size={16} /></button>
        </div>
      )}

      {showLogoutConfirm && (
        <div className="fixed inset-0 z-[400] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowLogoutConfirm(false)} />
          <div className="relative bg-slate-900 border border-white/10 rounded-2xl w-full max-w-[320px] p-6 text-center">
            <h3 className="text-xl font-bold text-white mb-2">Logout?</h3>
            <p className="text-slate-400 text-sm mb-6">Are you sure you want to end your session?</p>
            <div className="flex flex-col gap-3">
              <button onClick={handleLogout} className="w-full py-3 bg-rose-600 text-white font-bold rounded-xl shadow-lg">Confirm Logout</button>
              <button onClick={() => setShowLogoutConfirm(false)} className="w-full py-3 bg-white/5 text-white font-medium rounded-xl">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {previewUser && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setPreviewUser(null)}>
          <div className="bg-[#2a3942] rounded-lg shadow-2xl overflow-hidden max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
            <div className="relative aspect-square w-full bg-[#111b21]">
              {isValidAvatarUrl(previewUser.avatarUrl) ? <img src={previewUser.avatarUrl} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-8xl text-white font-bold bg-slate-700">{(previewUser.displayName || previewUser.name)?.[0]?.toUpperCase()}</div>}
              <button onClick={() => setPreviewUser(null)} className="absolute top-4 right-4 text-white/50 hover:text-white"><X size={24} /></button>
              <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/80 to-transparent">
                <h2 className="text-white text-lg font-medium">{previewUser.displayName || previewUser.name}</h2>
                <p className="text-white/50 text-xs">@{previewUser.name}</p>
                <p className="text-white/70 text-sm mt-1">{previewUser.about || 'Hey there! I am using Nexurao.'}</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;

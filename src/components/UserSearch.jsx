import React, { useState, useEffect, useRef } from 'react';
import { db } from '../lib/firebase';
import { ref, onValue, set, remove, get, query, limitToLast } from 'firebase/database';
import { Search, Trash, X, UserPlus, UserMinus, Users, Phone, MessageCircle, Info, ChevronDown, ChevronUp, MoreVertical, Plus, Megaphone, Trash2 } from 'lucide-react';
import CreateGroupModal from './CreateGroupModal';
import CreateBroadcastListModal from './CreateBroadcastListModal';

// Helper to validate if a string is a valid URL or data URL (excludes blob: URLs which expire)
const isValidAvatarUrl = (url) => {
    if (!url || typeof url !== 'string') return false;
    if (url.startsWith('blob:')) return false; // Blob URLs are temporary and expire
    return url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:');
};

// Sanitize user data to remove invalid avatarUrls
const sanitizeUser = (user) => {
    if (!user) return user;
    return {
        ...user,
        avatarUrl: isValidAvatarUrl(user.avatarUrl) ? user.avatarUrl : null
    };
};

export default function UserSearch({ currentUser, onStartChat, onStartCall, viewMode = 'directory', setViewMode, unreadCounts = {} }) {
    const [searchTerm, setSearchTerm] = useState('');
    const [previewUser, setPreviewUser] = useState(null);
    const [allUsers, setAllUsers] = useState([]);
    const [chatHistoryIds, setChatHistoryIds] = useState([]);
    const [contactIds, setContactIds] = useState([]);
    const [callHistory, setCallHistory] = useState([]); // Array of { oderId, timestamp, type: 'outgoing' | 'incoming' | 'missed', duration }
    // viewMode is now coming from props
    const [loading, setLoading] = useState(true);
    const [messagesByRoom, setMessagesByRoom] = useState({});
    const searchInputRef = React.useRef(null);
    const [isContactsExpanded, setIsContactsExpanded] = useState(false);

    // Group & Broadcast State
    const [showGroupModal, setShowGroupModal] = useState(false);
    const [showBroadcastModal, setShowBroadcastModal] = useState(false);
    const [userGroups, setUserGroups] = useState({}); // { groupId: { name, addedAt } }
    const [broadcastLists, setBroadcastLists] = useState({}); // { listId: { name, recipients... } }
    const [showMenu, setShowMenu] = useState(false);

    // Confirmation modal state: { type: 'delete' | 'remove' | 'call', user: {...}, action: fn }
    const [confirmAction, setConfirmAction] = useState(null);

    // Active actions overlay state
    const [actionsUserId, setActionsUserId] = useState(null);
    const longPressTimerRef = useRef(null);
    const isLongPressActiveRef = useRef(false);

    const handlePressStart = (e, userId) => {
        // Prevent default only for touch to stop system menu if possible, 
        // but carefully as it might block scroll. 
        // Better to just rely on onContextMenu preventDefault.

        isLongPressActiveRef.current = false;
        // Clear any existing timer
        if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);

        longPressTimerRef.current = setTimeout(() => {
            setActionsUserId(userId);
            isLongPressActiveRef.current = true;
            // Vibrate if available (haptic feedback)
            try {
                if (window.navigator?.vibrate) {
                    window.navigator.vibrate(50);
                }
            } catch (err) { }
        }, 600); // 600ms for long press
    };

    const handlePressEnd = () => {
        if (longPressTimerRef.current) {
            clearTimeout(longPressTimerRef.current);
            longPressTimerRef.current = null;
        }
    };

    const handleTouchMove = () => {
        // If the user moves their finger significantly, cancel the long press
        if (longPressTimerRef.current) {
            clearTimeout(longPressTimerRef.current);
            longPressTimerRef.current = null;
        }
    };

    // Clear actions on view mode or search change
    useEffect(() => {
        setActionsUserId(null);
    }, [viewMode, searchTerm]);

    // Auto-focus search input when switching to directory mode
    useEffect(() => {
        if (viewMode === 'directory' && searchInputRef.current) {
            searchInputRef.current.focus();
        }
    }, [viewMode]);



    // Load All Users with SDK + REST Fallback
    useEffect(() => {
        let sdkLoaded = false;
        const usersRef = ref(db, 'users');

        // SDK Listener
        const unsubscribe = onValue(usersRef, (snapshot) => {

            sdkLoaded = true;
            if (snapshot.exists()) {
                setAllUsers(Object.values(snapshot.val()).map(sanitizeUser));
            } else {
                setAllUsers([]);
            }
            setLoading(false);
        }, (error) => {
            console.error('[UserSearch] Users SDK error:', error);
            if (!sdkLoaded) fetchUsersREST();
        });

        // REST Fallback Function
        const fetchUsersREST = async () => {
            if (sdkLoaded) return;

            try {
                const response = await fetch('https://crispconnect-default-rtdb.firebaseio.com/users.json');
                if (response.ok) {
                    const data = await response.json();
                    if (data) {

                        setAllUsers(Object.values(data).map(sanitizeUser));
                    }
                    setLoading(false);
                }
            } catch (err) {
                console.error('[UserSearch] REST users fetch failed:', err);
                setLoading(false);
            }
        };

        const timeoutId = setTimeout(fetchUsersREST, 5000);

        return () => {
            unsubscribe();
            clearTimeout(timeoutId);
        };
    }, []);

    // Load Chat History IDs with SDK + REST Fallback
    const [userChats, setUserChats] = useState({}); // { userId: { lastActive, ... } }
    useEffect(() => {
        if (!currentUser) return;

        let sdkLoaded = false;
        const historyRef = ref(db, `user_chats/${currentUser.id}`);

        const unsubscribe = onValue(historyRef, (snapshot) => {
            sdkLoaded = true;
            if (snapshot.exists()) {
                const data = snapshot.val();
                setUserChats(data);
                const sortedIds = Object.entries(data)
                    .sort(([, a], [, b]) => (b.lastActive || 0) - (a.lastActive || 0))
                    .map(([id]) => id);
                setChatHistoryIds(sortedIds);
            } else {
                setUserChats({});
                setChatHistoryIds([]);
            }
        }, (error) => {
            console.error('[UserSearch] History SDK error:', error);
            if (!sdkLoaded) fetchHistoryREST();
        });

        const fetchHistoryREST = async () => {
            if (sdkLoaded) return;

            try {
                const response = await fetch(`https://crispconnect-default-rtdb.firebaseio.com/user_chats/${currentUser.id}.json`);
                if (response.ok) {
                    const data = await response.json();
                    if (data) {
                        setUserChats(data);
                        const sortedIds = Object.entries(data)
                            .sort(([, a], [, b]) => (b.lastActive || 0) - (a.lastActive || 0))
                            .map(([id]) => id);
                        setChatHistoryIds(sortedIds);
                    }
                }
            } catch (err) {
                console.error('[UserSearch] REST history fetch failed:', err);
            }
        };

        const timeoutId = setTimeout(fetchHistoryREST, 5000);

        return () => {
            unsubscribe();
            clearTimeout(timeoutId);
        };
    }, [currentUser]);

    // Load User's Contacts
    useEffect(() => {
        if (!currentUser) return;

        const contactsRef = ref(db, `user_contacts/${currentUser.id}`);
        const unsubscribe = onValue(contactsRef, (snapshot) => {
            if (snapshot.exists()) {
                setContactIds(Object.keys(snapshot.val()));
            } else {
                setContactIds([]);
            }
        });

        return () => unsubscribe();
    }, [currentUser]);

    // Load User's Groups
    useEffect(() => {
        if (!currentUser) return;
        const groupsRef = ref(db, `user_groups/${currentUser.id}`);
        return onValue(groupsRef, (snapshot) => {
            setUserGroups(snapshot.exists() ? snapshot.val() : {});
        });
    }, [currentUser]);

    // Load User's Broadcast Lists
    useEffect(() => {
        if (!currentUser) return;
        const listsRef = ref(db, `broadcast_lists/${currentUser.id}`);
        return onValue(listsRef, (snapshot) => {
            setBroadcastLists(snapshot.exists() ? snapshot.val() : {});
        });
    }, [currentUser]);

    // Load User's Call History
    useEffect(() => {
        if (!currentUser) return;

        const callHistoryRef = ref(db, `user_call_history/${currentUser.id}`);
        const unsubscribe = onValue(callHistoryRef, (snapshot) => {
            if (snapshot.exists()) {
                const data = snapshot.val();
                const historyArray = Object.entries(data).map(([key, value]) => ({
                    id: key,
                    ...value
                })).sort((a, b) => b.timestamp - a.timestamp);
                setCallHistory(historyArray);
            } else {
                setCallHistory([]);
            }
        });

        return () => unsubscribe();
    }, [currentUser]);

    // Fetch messages for search when searchTerm is entered
    useEffect(() => {
        if (!searchTerm || chatHistoryIds.length === 0) return;

        const fetchMessagesForSearch = async () => {
            const newMessages = { ...messagesByRoom };
            let updated = false;

            for (const otherId of chatHistoryIds) {
                const ids = [currentUser.id, otherId].sort();
                const roomId = `dm_${ids[0]}_${ids[1]}`;
                if (!newMessages[roomId]) {
                    try {
                        // Use SDK get() + query to ensure auth is handled
                        const msgRef = query(ref(db, `messages/${roomId}`), limitToLast(50));
                        const snapshot = await get(msgRef);

                        if (snapshot.exists()) {
                            // Use Object.entries to preserve message IDs (Firebase keys)
                            newMessages[roomId] = Object.entries(snapshot.val()).map(([id, msg]) => ({
                                ...msg,
                                id
                            }));
                            updated = true;
                        } else {
                            newMessages[roomId] = [];
                            updated = true;
                        }
                    } catch (err) {
                        console.error('[UserSearch] Failed to fetch search messages (SDK):', err);
                        // Fallback to empty to avoid re-fetching
                        newMessages[roomId] = [];
                        updated = true;
                    }
                }
            }
            if (updated) setMessagesByRoom(newMessages);
        };

        const timer = setTimeout(fetchMessagesForSearch, 500);
        return () => clearTimeout(timer);
    }, [searchTerm, viewMode, chatHistoryIds, currentUser]);

    // Combined list logic for display
    const mergedListItems = React.useMemo(() => {
        let items = [];

        // 1. Groups
        Object.entries(userGroups).forEach(([id, data]) => {
            items.push({
                id,
                name: data.name,
                type: 'group',
                timestamp: data.timestamp || data.lastActive || data.addedAt || 0,
                avatarUrl: data.avatarUrl || null
            });
        });

        // 2. Broadcast Lists
        Object.entries(broadcastLists).forEach(([id, data]) => {
            items.push({
                id,
                name: data.name,
                type: 'broadcast',
                timestamp: data.timestamp || data.lastActive || data.createdAt || 0,
                recipients: data.recipients
            });
        });

        // 3. Direct Chats (People)
        chatHistoryIds.forEach(id => {
            const user = allUsers.find(u => u.id === id);
            const chatData = userChats[id] || {};
            if (user) {
                items.push({
                    ...user,
                    type: 'user',
                    timestamp: chatData.lastActive || chatData.timestamp || 0
                });
            }
        });

        // Sort everything by timestamp descending
        return items.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    }, [userGroups, broadcastLists, chatHistoryIds, allUsers, userChats]);

    // Filter users - exclude current user and get chat history users
    const otherUsers = allUsers.filter(u => u.id !== currentUser?.id);
    const chatHistoryUsers = chatHistoryIds.map(id => allUsers.find(u => u.id === id)).filter(Boolean);
    const contactUsers = allUsers.filter(u => contactIds.includes(u.id));

    let displayedItems = [];

    // Legacy support alias (so we don't break existing code that uses displayedUsers if any remains)
    let displayedUsers = [];

    if (viewMode === 'history' || viewMode === 'directory') {
        // Show mixed list in history/directory views
        if (!searchTerm && viewMode === 'directory') {
            displayedItems = mergedListItems;
        } else if (searchTerm) {
            displayedItems = mergedListItems.filter(item =>
                item.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                item.displayName?.toLowerCase().includes(searchTerm.toLowerCase())
            );

            if (viewMode === 'directory') {
                const matchingContacts = contactUsers.filter(u =>
                    !chatHistoryIds.includes(u.id) &&
                    (u.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                        u.displayName?.toLowerCase().includes(searchTerm.toLowerCase()))
                ).map(u => ({ ...u, type: 'user' }));
                displayedItems = [...displayedItems, ...matchingContacts];
            }
        } else {
            displayedItems = mergedListItems;
        }
    } else if (viewMode === 'contacts') {
        displayedItems = contactUsers.map(u => ({ ...u, type: 'user' })).filter(u =>
            !searchTerm ||
            u.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            u.displayName?.toLowerCase().includes(searchTerm.toLowerCase())
        );
    } else if (viewMode === 'call') {
        // Call mode logic: populate displayedItems
        if (searchTerm) {
            displayedItems = otherUsers.filter(u => {
                const searchLower = searchTerm.toLowerCase();
                const nameMatch = (u.displayName || u.name)?.toLowerCase().includes(searchLower) ||
                    u.name?.toLowerCase().includes(searchLower);
                if (nameMatch) return true;
                const ids = [currentUser.id, u.id].sort();
                const roomId = `dm_${ids[0]}_${ids[1]}`;
                const messages = messagesByRoom[roomId] || [];
                return messages.some(m => m.text?.toLowerCase().includes(searchLower));
            }).map(u => ({ ...u, type: 'user' }));
        } else {
            const callHistoryUserIds = [...new Set(callHistory.map(c => c.userId || c.oderId).filter(id => id && id !== currentUser.id))];
            displayedItems = otherUsers.filter(u => callHistoryUserIds.includes(u.id))
                .sort((a, b) => {
                    const aCalls = callHistory.filter(c => (c.userId || c.oderId) === a.id).sort((x, y) => (y.timestamp || 0) - (x.timestamp || 0));
                    const bCalls = callHistory.filter(c => (c.userId || c.oderId) === b.id).sort((x, y) => (y.timestamp || 0) - (x.timestamp || 0));
                    const aLast = aCalls[0]?.timestamp || 0;
                    const bLast = bCalls[0]?.timestamp || 0;
                    return bLast - aLast;
                }).map(u => ({ ...u, type: 'user' }));
        }
    }

    // Assign to displayedUsers for back-compat
    displayedUsers = displayedItems;

    // Exact match sorting
    if (searchTerm) {
        displayedItems.sort((a, b) => {
            const aName = a.displayName || a.name;
            const bName = b.displayName || b.name;
            const aExact = aName?.toLowerCase() === searchTerm.toLowerCase();
            const bExact = bName?.toLowerCase() === searchTerm.toLowerCase();
            if (aExact && !bExact) return -1;
            if (!aExact && bExact) return 1;
            return 0;
        });
    }

    // Helper to get display props
    const getItemProps = (item) => {
        if (item.type === 'group') {
            return {
                id: item.id,
                name: item.name,
                subtext: 'Group',
                avatar: item.avatarUrl,
                isGroup: true
            };
        } else if (item.type === 'broadcast') {
            return {
                id: item.id,
                name: item.name,
                subtext: `${item.recipients?.length || 0} recipients`,
                avatar: null,
                isBroadcast: true
            };
        } else {
            const lastCall = viewMode === 'call' ? getLastCallInfo(item.id) : null;
            let subtext = `@${item.name}`;
            if (viewMode === 'call' && lastCall) {
                const typeLabel = lastCall.type === 'incoming' ? '↙ Incoming' : lastCall.type === 'missed' ? '✗ Missed' : '↗ Outgoing';
                subtext = `${typeLabel} • ${formatCallTime(lastCall.timestamp)}`;
            }
            return {
                id: item.id,
                name: item.displayName || item.name,
                subtext: subtext,
                avatar: item.avatarUrl,
                isUser: true,
                timestamp: lastCall ? lastCall.timestamp : (item.timestamp || 0)
            };
        }
    };

    const handleSelectUser = (otherUser, allowCall = true) => {
        let matchingMsgIds = [];
        let currentSearchTerm = searchTerm; // Save before clearing
        if (searchTerm) {
            const ids = [currentUser.id, otherUser.id].sort();
            const roomId = `dm_${ids[0]}_${ids[1]}`;
            const messages = messagesByRoom[roomId] || [];

            // Find ALL matching messages
            const matches = messages.filter(m => m.text?.toLowerCase().includes(searchTerm.toLowerCase()));
            matchingMsgIds = matches.map(m => m.id);

        }

        // Just start the chat UI without writing to DB yet
        // Pass all matching IDs and the search term for navigation

        setSearchTerm('');
        onStartChat(otherUser, allowCall, matchingMsgIds.length > 0 ? matchingMsgIds[0] : null, matchingMsgIds, currentSearchTerm);
    };

    const handleDeleteChat = (e, userId) => {
        e.stopPropagation();
        const user = allUsers.find(u => u.id === userId);
        setConfirmAction({
            type: 'delete',
            user: user || { id: userId, name: 'this chat' },
            action: () => {
                const historyRef = ref(db, `user_chats/${currentUser.id}/${userId}`);
                remove(historyRef);
                setConfirmAction(null);
            }
        });
    };

    const handleAddContact = (e, user) => {
        e.stopPropagation();
        const contactRef = ref(db, `user_contacts/${currentUser.id}/${user.id}`);
        set(contactRef, {
            id: user.id,
            name: user.name,
            displayName: user.displayName || user.name,
            avatarUrl: isValidAvatarUrl(user.avatarUrl) ? user.avatarUrl : null,
            addedAt: Date.now()
        });
    };

    const handleRemoveContact = (e, userId) => {
        e.stopPropagation();
        const user = allUsers.find(u => u.id === userId);
        setConfirmAction({
            type: 'remove',
            user: user || { id: userId, name: 'this contact' },
            action: () => {
                const contactRef = ref(db, `user_contacts/${currentUser.id}/${userId}`);
                remove(contactRef);
                setConfirmAction(null);
            }
        });
    };

    const handleQuickCall = (e, user) => {
        e.stopPropagation();
        setConfirmAction({
            type: 'call',
            user: user,
            action: () => {
                onStartChat(user);
                if (onStartCall) {
                    setTimeout(() => onStartCall(user), 200);
                }
                setConfirmAction(null);
            }
        });
    };

    const isContact = (userId) => contactIds.includes(userId);

    // State for call history detail modal
    const [callHistoryDetail, setCallHistoryDetail] = useState(null); // { user, calls: [] }

    // Get all calls for a specific user
    const getCallsForUser = (userId) => {
        return callHistory.filter(c => (c.userId || c.oderId) === userId).sort((a, b) => b.timestamp - a.timestamp);
    };

    // Get last call info for a user
    const getLastCallInfo = (userId) => {
        const userCalls = getCallsForUser(userId);
        return userCalls.length > 0 ? userCalls[0] : null;
    };

    // Format call time
    const formatCallTime = (timestamp) => {
        if (!timestamp) return '';
        const date = new Date(timestamp);
        const now = new Date();
        const isToday = date.toDateString() === now.toDateString();
        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        const isYesterday = date.toDateString() === yesterday.toDateString();

        const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        if (isToday) {
            return timeStr;
        } else if (isYesterday) {
            return `Yesterday ${timeStr}`;
        } else {
            return date.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + timeStr;
        }
    };

    // Format call duration
    const formatCallDuration = (seconds) => {
        if (!seconds || seconds <= 0) return '';
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
    };

    // Handle clicking on a call history user to show detail
    const handleShowCallHistory = (e, user) => {
        e.stopPropagation();
        const userCalls = getCallsForUser(user.id);
        setCallHistoryDetail({ user, calls: userCalls });
    };

    return (
        <div className="h-full min-h-0 flex flex-col bg-[var(--wa-bg)]">
            {/* Header */}
            <div className="p-2 border-b border-[var(--wa-border)] shrink-0 flex items-center gap-2">
                <div className="relative flex-1">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                        {loading ? (
                            <div className="w-4 h-4 border-2 border-[#00a884] border-t-transparent rounded-full animate-spin"></div>
                        ) : (
                            <Search className="h-5 w-5 text-[#aebac1]" />
                        )}
                    </div>
                    <input
                        ref={searchInputRef}
                        type="text"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        placeholder="Search user or content"
                        style={{ paddingLeft: '38px' }}
                        className="block w-full pr-10 py-2 border-none rounded-lg leading-5 bg-[var(--wa-panel)] text-[var(--wa-text)] placeholder-[var(--wa-text-muted)] focus:outline-none focus:ring-1 focus:ring-[#00a884] sm:text-sm"
                    />
                    {searchTerm && (
                        <button
                            onClick={() => setSearchTerm('')}
                            className="absolute inset-y-0 right-0 pr-3 flex items-center text-[#8696a0] hover:text-[#e9edef]"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    )}
                </div>

                {/* Header Menu Actions */}
                <div className="relative">
                    <button
                        onClick={() => setShowMenu(!showMenu)}
                        className="p-2 hover:bg-white/5 rounded-full text-[#aebac1] transition-colors"
                    >
                        <MoreVertical className="w-5 h-5" />
                    </button>

                    {showMenu && (
                        <div className="absolute right-0 top-full mt-1 w-48 bg-[var(--wa-panel)] rounded-lg shadow-xl border border-[var(--wa-border)] z-50 py-1 animate-in fade-in zoom-in-95 duration-150">
                            <button
                                onClick={() => { setShowGroupModal(true); setShowMenu(false); }}
                                className="w-full text-left px-4 py-2 text-sm text-[var(--wa-text)] hover:bg-[var(--wa-bg)] flex items-center gap-2"
                            >
                                <Users className="w-4 h-4" />
                                New Group
                            </button>
                            <button
                                onClick={() => { setShowBroadcastModal(true); setShowMenu(false); }}
                                className="w-full text-left px-4 py-2 text-sm text-[var(--wa-text)] hover:bg-[var(--wa-bg)] flex items-center gap-2"
                            >
                                <Megaphone className="w-4 h-4" />
                                New Broadcast
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {/* Modals */}
            {showGroupModal && (
                <CreateGroupModal
                    onClose={() => setShowGroupModal(false)}
                    currentUser={currentUser}
                    contacts={contactUsers}
                />
            )}
            {showBroadcastModal && (
                <CreateBroadcastListModal
                    onClose={() => setShowBroadcastModal(false)}
                    currentUser={currentUser}
                    contacts={contactUsers}
                />
            )}

            {/* List */}
            <div className="flex-1 overflow-y-auto custom-scrollbar">
                {viewMode === 'history' && (
                    <div className="px-4 py-3 border-b border-[var(--wa-border)] bg-[var(--wa-bg)] sticky top-0 z-10 flex items-center">
                        <span className="text-xs font-bold text-[#00a884] uppercase tracking-wider">Recent Chat ({chatHistoryUsers.length})</span>
                    </div>
                )}
                {viewMode === 'directory' && (
                    <div className="px-4 py-3 border-b border-[var(--wa-border)] bg-[var(--wa-bg)] sticky top-0 z-10 flex items-center">
                        <span className="text-xs font-bold text-[#00a884] uppercase tracking-wider">
                            {searchTerm ? `Search Results (${displayedItems.length})` : `Recent Chat (${chatHistoryUsers.length})`}
                        </span>
                    </div>
                )}

                {viewMode === 'call' && (
                    <>
                        {searchTerm ? (
                            <div className="px-4 py-3 border-b border-[var(--wa-border)] bg-[var(--wa-bg)] sticky top-0 z-10 flex items-center">
                                <span className="text-xs font-bold text-[#00a884] uppercase tracking-wider">
                                    Search Results ({displayedItems.length})
                                </span>
                            </div>
                        ) : (
                            <>
                                {/* My Contacts Expandable Section */}
                                <div
                                    className="px-4 py-3 border-b border-[var(--wa-border)] bg-[var(--wa-bg)] sticky top-0 z-10 flex items-center justify-between cursor-pointer hover:bg-[var(--wa-panel)] transition-colors"
                                    onClick={() => setIsContactsExpanded(!isContactsExpanded)}
                                >
                                    <div className="flex items-center gap-2">
                                        <Users className="w-4 h-4 text-[#00a884]" />
                                        <span className="text-xs font-bold text-[#00a884] uppercase tracking-wider">
                                            My Contacts ({contactUsers.length})
                                        </span>
                                    </div>
                                    {isContactsExpanded ? <ChevronUp className="w-4 h-4 text-[#8696a0]" /> : <ChevronDown className="w-4 h-4 text-[#8696a0]" />}
                                </div>

                                {isContactsExpanded && (
                                    <div className="bg-[var(--wa-bg)] border-b border-[var(--wa-border)]/50">
                                        {contactUsers.length > 0 ? (
                                            contactUsers.map(user => (
                                                <div
                                                    key={`contact-${user.id}`}
                                                    onContextMenu={(e) => e.preventDefault()}
                                                    onMouseDown={(e) => handlePressStart(e, user.id)}
                                                    onMouseUp={handlePressEnd}
                                                    onMouseLeave={handlePressEnd}
                                                    onTouchStart={(e) => handlePressStart(e, user.id)}
                                                    onTouchMove={handleTouchMove}
                                                    onTouchEnd={handlePressEnd}
                                                    onClick={() => {
                                                        if (isLongPressActiveRef.current) {
                                                            isLongPressActiveRef.current = false;
                                                            return;
                                                        }
                                                        if (actionsUserId === user.id) {
                                                            setActionsUserId(null);
                                                        } else if (!actionsUserId) {
                                                            handleSelectUser(user);
                                                        }
                                                    }}
                                                    className="flex items-center px-4 hover:bg-[var(--wa-panel)] cursor-pointer group transition-colors border-b border-[var(--wa-border)]/30 last:border-b-0 relative"
                                                    style={{ gap: '2px' }}
                                                >
                                                    <div className="shrink-0 py-2">
                                                        <div className="w-10 h-10 rounded-full bg-slate-600 flex items-center justify-center text-white font-medium text-base overflow-hidden ring-1 ring-white/10 group-hover:ring-white/30 transition-all">
                                                            {isValidAvatarUrl(user.avatarUrl) ? (
                                                                <img src={user.avatarUrl} alt={user.displayName || user.name} className="w-full h-full object-cover" />
                                                            ) : (
                                                                (user.displayName || user.name)?.[0]?.toUpperCase() || '?'
                                                            )}
                                                        </div>
                                                    </div>
                                                    <div className="flex-1 min-w-0 py-2 pl-2">
                                                        <h3 className="text-[15px] font-normal text-[var(--wa-text)] truncate">{user.displayName || user.name}</h3>
                                                        <p className="text-[11px] text-[var(--wa-text-muted)] truncate">@{user.name}</p>
                                                    </div>
                                                    {/* Action Overlay */}
                                                    {actionsUserId === user.id && (
                                                        <div
                                                            className="absolute inset-0 bg-[var(--wa-panel)]/95 z-40 flex items-stretch animate-in fade-in zoom-in-95 duration-200 backdrop-blur-sm"
                                                            onClick={(e) => e.stopPropagation()}
                                                        >
                                                            <div className="flex-1 flex items-center justify-around px-2">
                                                                <button
                                                                    onClick={() => { handleSelectUser(user); setActionsUserId(null); }}
                                                                    className="flex flex-col items-center justify-center gap-1 flex-1 py-1 hover:bg-white/5 transition-colors rounded-lg active:scale-95 group/btn"
                                                                >
                                                                    <MessageCircle className="retro-iridescent" />
                                                                    <span className="text-[9px] text-[#00a884] font-bold uppercase tracking-tighter">Chat</span>
                                                                </button>
                                                                <button
                                                                    onClick={(e) => { handleQuickCall(e, user); setActionsUserId(null); }}
                                                                    className="flex flex-col items-center justify-center gap-1 flex-1 py-1 hover:bg-white/5 transition-colors rounded-lg active:scale-95 group/btn"
                                                                >
                                                                    <Phone className="retro-iridescent" />
                                                                    <span className="text-[9px] text-[#00a884] font-bold uppercase tracking-tighter">Call</span>
                                                                </button>
                                                                <button
                                                                    onClick={(e) => { handleRemoveContact(e, user.id); setActionsUserId(null); }}
                                                                    className="flex flex-col items-center justify-center gap-1 flex-1 py-1 hover:bg-white/5 transition-colors rounded-lg active:scale-95 group/btn"
                                                                >
                                                                    <UserMinus className="retro-iridescent-orange" />
                                                                    <span className="text-[9px] text-rose-500 font-bold uppercase tracking-tighter">Remove</span>
                                                                </button>
                                                            </div>
                                                            <button
                                                                onClick={() => setActionsUserId(null)}
                                                                className="px-4 flex items-center justify-center border-l border-white/5 hover:bg-white/5 text-[#8696a0]"
                                                            >
                                                                <X className="w-5 h-5" />
                                                            </button>
                                                        </div>
                                                    )}
                                                </div>
                                            ))
                                        ) : (
                                            <div className="p-4 text-center text-xs text-[var(--wa-text-muted)] italic">
                                                No contacts saved yet
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Recent Calls Section */}
                                <div className="px-4 py-3 border-b border-[var(--wa-border)] bg-[var(--wa-bg)] flex items-center">
                                    <span className="text-xs font-bold text-[#00a884] uppercase tracking-wider">
                                        Recent Calls ({displayedItems.length})
                                    </span>
                                </div>
                            </>
                        )}
                    </>
                )}
                {viewMode === 'contacts' && (
                    <div className="px-4 py-3 border-b border-[var(--wa-border)] bg-[var(--wa-bg)] sticky top-0 z-10 flex items-center">
                        <span className="text-xs font-bold text-[#00a884] uppercase tracking-wider">My Contacts ({contactUsers.length})</span>
                    </div>
                )}

                {(viewMode === 'history' || viewMode === 'directory' || viewMode === 'contacts' || viewMode === 'call') ? (
                    // UNIFIED LIST RENDERING
                    displayedItems.map(item => {
                        const props = getItemProps(item);
                        return (
                            <div
                                key={item.id}
                                onContextMenu={(e) => e.preventDefault()}
                                onMouseDown={(e) => item.type === 'user' && handlePressStart(e, item.id)}
                                onMouseUp={handlePressEnd}
                                onMouseLeave={handlePressEnd}
                                onTouchStart={(e) => item.type === 'user' && handlePressStart(e, item.id)}
                                onTouchMove={handleTouchMove}
                                onTouchEnd={handlePressEnd}
                                onClick={() => {
                                    if (isLongPressActiveRef.current) {
                                        isLongPressActiveRef.current = false;
                                        return;
                                    }
                                    if (item.type === 'user') {
                                        handleSelectUser(item);
                                    } else {
                                        onStartChat(item);
                                    }
                                }}
                                className="flex items-center px-4 hover:bg-[var(--wa-panel)] cursor-pointer group transition-colors border-b border-[var(--wa-border)]/50 relative"
                            >
                                <div
                                    className="shrink-0 py-3"
                                    onClick={(e) => {
                                        if (item.type === 'user') {
                                            e.stopPropagation();
                                            setPreviewUser(item);
                                        }
                                    }}
                                >
                                    <div className="w-12 h-12 rounded-full bg-slate-600 flex items-center justify-center text-white font-medium text-lg overflow-hidden ring-1 ring-white/10 hover:ring-white/30 transition-all cursor-pointer">
                                        {item.type === 'group' ? (
                                            <Users className="w-6 h-6" />
                                        ) : item.type === 'broadcast' ? (
                                            <Megaphone className="w-6 h-6" />
                                        ) : props.avatar ? (
                                            <img src={props.avatar} alt={props.name} className="w-full h-full object-cover" />
                                        ) : (
                                            props.name?.[0]?.toUpperCase() || '?'
                                        )}
                                    </div>
                                </div>
                                <div className="flex-1 min-w-0 py-3 ml-3 group-hover:border-transparent transition-colors">
                                    <div className="flex justify-between items-baseline mb-1">
                                        <div className="flex flex-col min-w-0">
                                            <div className="flex items-center gap-2">
                                                <h3 className="text-[17px] font-normal text-[var(--wa-text)] truncate">{props.name}</h3>
                                                {(() => {
                                                    // Unread count logic only for direct chats for now, or groups if extended
                                                    // Assuming unreadCounts handles basic group IDs too if keys match
                                                    // But for now keeping it simple
                                                    // If it's a DM, id format is user ID. Room ID is dm_...
                                                    if (item.type === 'user') {
                                                        const ids = [currentUser.id, item.id].sort();
                                                        const roomId = `dm_${ids[0]}_${ids[1]}`;
                                                        const count = unreadCounts[roomId];
                                                        if (count > 0) {
                                                            return (
                                                                <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-[#00a884] text-[#111b21] text-[10px] font-black shadow-sm shrink-0">
                                                                    {count}
                                                                </span>
                                                            );
                                                        }
                                                    }
                                                    return null;
                                                })()}
                                            </div>
                                            <span className={`text-xs truncate ${viewMode === 'call' && props.subtext.includes('Missed') ? 'text-rose-400' : 'text-[var(--wa-text-muted)]'}`}>
                                                {props.subtext}
                                            </span>
                                        </div>
                                        {props.timestamp > 0 && (
                                            <div className="flex flex-col items-end shrink-0 ml-2">
                                                <span className="text-[11px] text-[var(--wa-text-muted)]">
                                                    {formatCallTime(props.timestamp)}
                                                </span>
                                            </div>
                                        )}
                                    </div>

                                    {/* Action Overlay Only for Users for now */}
                                    {item.type === 'user' && actionsUserId === item.id && (
                                        <div
                                            className="absolute inset-0 bg-[var(--wa-panel)]/95 z-40 flex items-stretch animate-in fade-in zoom-in-95 duration-200 backdrop-blur-md"
                                            onClick={(e) => e.stopPropagation()}
                                        >
                                            <div className="flex-1 flex items-center justify-around px-2">
                                                <button
                                                    onClick={() => { handleSelectUser(item); setActionsUserId(null); }}
                                                    className="flex flex-col items-center justify-center gap-1 flex-1 py-1 hover:bg-white/5 transition-colors rounded-lg active:scale-95 group/btn"
                                                >
                                                    <MessageCircle className="retro-iridescent" />
                                                    <span className="text-[9px] text-[#00a884] font-bold uppercase tracking-tighter">Chat</span>
                                                </button>

                                                <button
                                                    onClick={(e) => { handleQuickCall(e, item); setActionsUserId(null); }}
                                                    className="flex flex-col items-center justify-center gap-1 flex-1 py-1 hover:bg-white/5 transition-colors rounded-lg active:scale-95 group/btn"
                                                >
                                                    <Phone className="retro-iridescent" />
                                                    <span className="text-[9px] text-[#00a884] font-bold uppercase tracking-tighter">Call</span>
                                                </button>

                                                {isContact(item.id) ? (
                                                    <button
                                                        onClick={(e) => { handleRemoveContact(e, item.id); setActionsUserId(null); }}
                                                        className="flex flex-col items-center justify-center gap-1 flex-1 py-1 hover:bg-white/5 transition-colors rounded-lg active:scale-95 group/btn"
                                                    >
                                                        <UserMinus className="retro-iridescent-orange" />
                                                        <span className="text-[9px] text-rose-500 font-bold uppercase tracking-tighter">Remove</span>
                                                    </button>
                                                ) : (
                                                    <button
                                                        onClick={(e) => { handleAddContact(e, item); setActionsUserId(null); }}
                                                        className="flex flex-col items-center justify-center gap-1 flex-1 py-1 hover:bg-white/5 transition-colors rounded-lg active:scale-95 group/btn"
                                                    >
                                                        <UserPlus className="retro-iridescent" />
                                                        <span className="text-[9px] text-[#00a884] font-bold uppercase tracking-tighter">Add</span>
                                                    </button>
                                                )}

                                                {(viewMode === 'history' || (viewMode === 'directory' && !searchTerm) || (viewMode === 'directory' && chatHistoryIds.includes(item.id))) && (
                                                    <button
                                                        onClick={(e) => { handleDeleteChat(e, item.id); setActionsUserId(null); }}
                                                        className="flex flex-col items-center justify-center gap-1 flex-1 py-1 hover:bg-white/5 transition-colors rounded-lg active:scale-95 group/btn"
                                                    >
                                                        <Trash className="retro-iridescent-orange" />
                                                        <span className="text-[9px] text-rose-500 font-bold uppercase tracking-tighter">Delete</span>
                                                    </button>
                                                )}
                                            </div>
                                            <button
                                                onClick={() => setActionsUserId(null)}
                                                className="px-4 flex items-center justify-center border-l border-white/5 hover:bg-white/5 text-[#8696a0]"
                                            >
                                                <X className="w-5 h-5" />
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })
                ) : (
                    <div className="p-4 text-center text-[#8696a0]">No items found</div>
                )}
            </div>

            {/* Profile Preview Modal */}
            {
                previewUser && (
                    <div
                        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200"
                        onClick={() => setPreviewUser(null)}
                    >
                        <div
                            className="bg-[#2a3942] rounded-lg shadow-2xl overflow-hidden max-w-sm w-full animate-in zoom-in-95 duration-200"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="relative aspect-square w-full bg-[#111b21]">
                                {isValidAvatarUrl(previewUser.avatarUrl) ? (
                                    <img src={previewUser.avatarUrl} alt={previewUser.displayName || previewUser.name} className="w-full h-full object-cover" />
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center text-8xl text-white font-bold bg-slate-700">
                                        {(previewUser.displayName || previewUser.name)?.[0]?.toUpperCase()}
                                    </div>
                                )}
                                <div className="wa-header absolute top-0 left-0 right-0 p-4 bg-gradient-to-b from-black/40 to-transparent border-none">
                                    <h2 className="text-white text-lg font-medium drop-shadow-md">{previewUser.displayName || previewUser.name}</h2>
                                    <p className="text-white/60 text-xs drop-shadow-md">@{previewUser.name}</p>
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
            {
                confirmAction && (
                    <div
                        className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200"
                        onClick={() => setConfirmAction(null)}
                    >
                        <div
                            className="bg-[#2a3942] rounded-lg shadow-2xl overflow-hidden max-w-sm w-full animate-in zoom-in-95 duration-200 p-6"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="text-center">
                                {/* Icon based on action type */}
                                <div className={`w-16 h-16 mx-auto rounded-full flex items-center justify-center mb-4 ${confirmAction.type === 'call' ? 'bg-[#00a884]/20' :
                                    confirmAction.type === 'delete' ? 'bg-rose-500/20' : 'bg-rose-500/20'
                                    }`}>
                                    {confirmAction.type === 'call' && <Phone className="w-8 h-8 text-[#00a884]" />}
                                    {confirmAction.type === 'delete' && <Trash2 className="w-8 h-8 text-rose-500" />}
                                    {confirmAction.type === 'remove' && <UserMinus className="w-8 h-8 text-rose-500" />}
                                </div>

                                {/* Title */}
                                <h3 className="text-white text-lg font-medium mb-2">
                                    {confirmAction.type === 'call' && `Call ${confirmAction.user?.displayName || confirmAction.user?.name}?`}
                                    {confirmAction.type === 'delete' && 'Delete Chat?'}
                                    {confirmAction.type === 'remove' && 'Remove Contact?'}
                                </h3>

                                {/* Description */}
                                <p className="text-[#8696a0] text-sm mb-6">
                                    {confirmAction.type === 'call' && 'This will open a chat and start a voice call.'}
                                    {confirmAction.type === 'delete' && `Are you sure you want to delete your chat with ${confirmAction.user?.displayName || confirmAction.user?.name}? This cannot be undone.`}
                                    {confirmAction.type === 'remove' && `Are you sure you want to remove ${confirmAction.user?.displayName || confirmAction.user?.name} from your contacts?`}
                                </p>

                                {/* Buttons */}
                                <div className="flex gap-3">
                                    <button
                                        onClick={() => setConfirmAction(null)}
                                        className="flex-1 py-2.5 px-4 rounded-lg bg-[#3b4a54] text-white font-medium hover:bg-[#4a5b66] transition-colors"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        onClick={confirmAction.action}
                                        className={`flex-1 py-2.5 px-4 rounded-lg font-medium transition-colors ${confirmAction.type === 'call'
                                            ? 'bg-[#00a884] text-white hover:bg-[#008f70]'
                                            : 'bg-rose-500 text-white hover:bg-rose-600'
                                            }`}
                                    >
                                        {confirmAction.type === 'call' ? 'Call' : confirmAction.type === 'delete' ? 'Delete' : 'Remove'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* Call History Detail Modal */}
            {
                callHistoryDetail && (
                    <div
                        className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200"
                        onClick={() => setCallHistoryDetail(null)}
                    >
                        <div
                            className="bg-[#2a3942] rounded-lg shadow-2xl overflow-hidden max-w-sm w-full animate-in zoom-in-95 duration-200"
                            onClick={(e) => e.stopPropagation()}
                        >
                            {/* Header */}
                            <div className="wa-header p-4 border-b border-[var(--wa-border)] flex items-center gap-3">
                                <div className="w-12 h-12 rounded-full bg-slate-600 flex items-center justify-center text-white font-semibold text-xl shrink-0">
                                    {isValidAvatarUrl(callHistoryDetail.user?.avatarUrl) ? (
                                        <img src={callHistoryDetail.user.avatarUrl} alt="" className="w-full h-full rounded-full object-cover" />
                                    ) : (
                                        (callHistoryDetail.user?.displayName || callHistoryDetail.user?.name)?.[0]?.toUpperCase()
                                    )}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <h3 className="text-white text-lg font-medium truncate">
                                        {callHistoryDetail.user?.displayName || callHistoryDetail.user?.name}
                                    </h3>
                                    <p className="text-[#8696a0] text-sm">{callHistoryDetail.calls.length} call{callHistoryDetail.calls.length !== 1 ? 's' : ''}</p>
                                </div>
                                <button
                                    onClick={() => setCallHistoryDetail(null)}
                                    className="p-2 text-[#8696a0] hover:text-white transition-colors"
                                >
                                    <X className="w-5 h-5" />
                                </button>
                            </div>

                            {/* Call List */}
                            <div className="max-h-80 overflow-y-auto">
                                {callHistoryDetail.calls.map((call, index) => (
                                    <div key={call.id || index} className="px-4 py-3 border-b border-[var(--wa-border)]/50 flex items-center gap-3">
                                        <div className={`w-10 h-10 rounded-full flex items-center justify-center ${call.type === 'incoming' ? 'bg-green-500/20 text-green-400' :
                                            call.type === 'missed' ? 'bg-rose-500/20 text-rose-400' :
                                                'bg-[#00a884]/20 text-[#00a884]'
                                            }`}>
                                            <Phone className="w-5 h-5" />
                                        </div>
                                        <div className="flex-1">
                                            <div className="flex items-center gap-2">
                                                <span className={`text-sm font-medium ${call.type === 'incoming' ? 'text-green-400' :
                                                    call.type === 'missed' ? 'text-rose-400' :
                                                        'text-[#00a884]'
                                                    }`}>
                                                    {call.type === 'incoming' ? '↙ Incoming' : call.type === 'missed' ? '✗ Missed' : '↗ Outgoing'}
                                                </span>
                                                {call.duration > 0 && (
                                                    <span className="text-xs text-[var(--wa-text-muted)]">
                                                        {formatCallDuration(call.duration)}
                                                    </span>
                                                )}
                                            </div>
                                            <p className="text-xs text-[var(--wa-text-muted)]">{formatCallTime(call.timestamp)}</p>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            {/* Footer Actions */}
                            <div className="p-4 border-t border-[var(--wa-border)] flex gap-3">
                                <button
                                    onClick={() => {
                                        setCallHistoryDetail(null);
                                        handleSelectUser(callHistoryDetail.user, false);
                                    }}
                                    className="flex-1 py-2.5 px-4 rounded-lg bg-[#3b4a54] text-white font-medium hover:bg-[#4a5b66] transition-colors flex items-center justify-center gap-2"
                                >
                                    <MessageCircle className="w-4 h-4" />
                                    Message
                                </button>
                                <button
                                    onClick={() => {
                                        const user = callHistoryDetail.user;
                                        setCallHistoryDetail(null);
                                        onStartChat(user);
                                        if (onStartCall) {
                                            setTimeout(() => onStartCall(user), 200);
                                        }
                                    }}
                                    className="flex-1 py-2.5 px-4 rounded-lg bg-[#00a884] text-white font-medium hover:bg-[#008f70] transition-colors flex items-center justify-center gap-2"
                                >
                                    <Phone className="w-4 h-4" />
                                    Call
                                </button>
                            </div>
                        </div>
                    </div>
                )}
        </div>
    );
}

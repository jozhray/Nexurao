import React, { useState, useEffect, useRef } from 'react';
import { db } from '../lib/firebase';
import { ref, onValue, remove, update, get, push, serverTimestamp, set } from 'firebase/database';
import { X, Users, LogOut, Trash2, Shield, User, Edit3, Camera, Bell, BellOff, UserPlus, UserMinus, ShieldCheck, Check, Search, Plus, ShieldOff, Link as LinkIcon } from 'lucide-react';

export default function GroupInfoModal({ onClose, groupId, currentUser }) {
    const [groupData, setGroupData] = useState(null);
    const [members, setMembers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isAdmin, setIsAdmin] = useState(false);
    const [isMuted, setIsMuted] = useState(false);

    // Edit state
    const [isEditingName, setIsEditingName] = useState(false);
    const [isEditingAvatar, setIsEditingAvatar] = useState(false);
    const [newName, setNewName] = useState('');
    const [newAvatarUrl, setNewAvatarUrl] = useState('');

    // Add member state
    const [showAddMember, setShowAddMember] = useState(false);
    const [contacts, setContacts] = useState([]);
    const [searchTerm, setSearchTerm] = useState('');

    useEffect(() => {
        if (!groupId) return;

        // Listen for group data
        const groupRef = ref(db, `groups/${groupId}`);
        const unsubscribeGroup = onValue(groupRef, async (snapshot) => {
            if (snapshot.exists()) {
                const data = snapshot.val();
                setGroupData(data);
                setNewName(data.name);

                const userRole = data.members?.[currentUser.id]?.role;
                setIsAdmin(userRole === 'admin');

                // Fetch member details
                if (data.members) {
                    const memberIds = Object.keys(data.members).filter(id => data.members[id] !== null);
                    const memberPromises = memberIds.map(async (uid) => {
                        const userSnap = await get(ref(db, `users/${uid}`));
                        if (userSnap.exists()) {
                            return {
                                id: uid,
                                ...userSnap.val(),
                                role: data.members[uid].role || 'member'
                            };
                        }
                        return null;
                    });
                    const memberList = (await Promise.all(memberPromises)).filter(Boolean);
                    setMembers(memberList);
                }
            } else {
                setGroupData(null);
            }
            setLoading(false);
        });

        // Listen for user settings (mute)
        const settingsRef = ref(db, `user_chat_settings/${currentUser.id}/${groupId}/muted`);
        const unsubscribeSettings = onValue(settingsRef, (snapshot) => {
            setIsMuted(snapshot.val() === true);
        });

        return () => {
            unsubscribeGroup();
            unsubscribeSettings();
        };
    }, [groupId, currentUser.id]);

    // Fetch contacts for adding members
    useEffect(() => {
        if (!showAddMember) return;
        const contactsRef = ref(db, `user_contacts/${currentUser.id}`);
        return onValue(contactsRef, (snapshot) => {
            if (snapshot.exists()) {
                setContacts(Object.values(snapshot.val()));
            }
        });
    }, [showAddMember, currentUser.id]);

    const sendSystemMessage = async (text) => {
        const msgRef = push(ref(db, `messages/${groupId}`));
        await set(msgRef, {
            type: 'system',
            text,
            timestamp: serverTimestamp(),
            userId: 'system'
        });
    };

    const syncGroupUpdate = async (updates) => {
        if (!groupData?.members) return;
        const memberIds = Object.keys(groupData.members).filter(id => groupData.members[id] !== null);
        const syncPromises = memberIds.map(uid => {
            const memberGroupRef = ref(db, `user_groups/${uid}/${groupId}`);
            return update(memberGroupRef, updates);
        });
        await Promise.all(syncPromises);
    };

    const handleUpdateName = async () => {
        if (!newName.trim() || newName === groupData.name) {
            setIsEditingName(false);
            return;
        }
        try {
            await update(ref(db, `groups/${groupId}`), { name: newName.trim() });
            await syncGroupUpdate({ name: newName.trim() });
            await sendSystemMessage(`${currentUser.displayName || currentUser.name} changed the group name to "${newName.trim()}"`);
            setIsEditingName(false);
        } catch (error) {
            alert("Failed to update name");
        }
    };

    const handleUpdateAvatar = async () => {
        if (newAvatarUrl === groupData.avatarUrl) {
            setIsEditingAvatar(false);
            return;
        }
        try {
            await update(ref(db, `groups/${groupId}`), { avatarUrl: newAvatarUrl.trim() || null });
            await syncGroupUpdate({ avatarUrl: newAvatarUrl.trim() || null });
            await sendSystemMessage(`${currentUser.displayName || currentUser.name} updated the group profile picture`);
            setIsEditingAvatar(false);
        } catch (error) {
            alert("Failed to update picture");
        }
    };

    const toggleMute = async () => {
        try {
            await set(ref(db, `user_chat_settings/${currentUser.id}/${groupId}/muted`), !isMuted);
        } catch (error) {
            alert("Failed to update settings");
        }
    };

    const toggleAdminOnly = async () => {
        if (!isAdmin) return;
        const newValue = !groupData.adminOnlyMessageMode;
        try {
            await update(ref(db, `groups/${groupId}`), { adminOnlyMessageMode: newValue });
            await sendSystemMessage(`${currentUser.displayName || currentUser.name} ${newValue ? 'restricted' : 'allowed'} messaging for everyone`);
        } catch (error) {
            alert("Failed to update group settings");
        }
    };

    const handlePromote = async (memberId, memberName) => {
        if (!isAdmin) return;
        try {
            await update(ref(db, `groups/${groupId}/members/${memberId}`), { role: 'admin' });
            await sendSystemMessage(`${currentUser.displayName || currentUser.name} made ${memberName} an admin`);
        } catch (error) {
            alert("Failed to promote member");
        }
    };

    const handleDemote = async (memberId, memberName) => {
        if (!isAdmin) return;
        if (!confirm(`Revoke admin status from ${memberName}?`)) return;
        try {
            await update(ref(db, `groups/${groupId}/members/${memberId}`), { role: 'member' });
            await sendSystemMessage(`${currentUser.displayName || currentUser.name} removed ${memberName} as admin`);
        } catch (error) {
            alert("Failed to demote member");
        }
    };

    const handleRemoveMember = async (memberId, memberName) => {
        if (!isAdmin) return;
        if (!confirm(`Remove ${memberName} from group?`)) return;
        try {
            await remove(ref(db, `groups/${groupId}/members/${memberId}`));
            await remove(ref(db, `user_groups/${memberId}/${groupId}`));
            await sendSystemMessage(`${currentUser.displayName || currentUser.name} removed ${memberName}`);
        } catch (error) {
            alert("Failed to remove member");
        }
    };

    const handleAddMember = async (contact) => {
        try {
            await update(ref(db, `groups/${groupId}/members/${contact.id}`), {
                role: 'member',
                joinedAt: serverTimestamp()
            });
            await set(ref(db, `user_groups/${contact.id}/${groupId}`), {
                id: groupId,
                name: groupData.name,
                addedAt: serverTimestamp(),
                joinedAt: serverTimestamp()
            });
            await sendSystemMessage(`${currentUser.displayName || currentUser.name} added ${contact.name}`);
        } catch (error) {
            alert("Failed to add member");
        }
    };

    const handleExitGroup = async () => {
        if (!confirm("Are you sure you want to leave this group?")) return;

        try {
            await remove(ref(db, `groups/${groupId}/members/${currentUser.id}`));
            await remove(ref(db, `user_groups/${currentUser.id}/${groupId}`));
            await sendSystemMessage(`${currentUser.displayName || currentUser.name} left the group`);
            onClose();
        } catch (error) {
            alert("Failed to leave group.");
        }
    };

    const handleDeleteGroup = async () => {
        if (!confirm("Are you sure you want to DELETE this group? This cannot be undone.")) return;

        try {
            for (const member of members) {
                await remove(ref(db, `user_groups/${member.id}/${groupId}`));
            }
            await remove(ref(db, `groups/${groupId}`));
            onClose();
        } catch (error) {
            alert("Failed to delete group.");
        }
    };

    if (!groupId) return null;

    const filteredContacts = contacts.filter(c =>
        !groupData?.members?.[c.id] &&
        c.name.toLowerCase().includes(searchTerm.toLowerCase())
    );

    return (
        <div className="fixed inset-0 z-[5000] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-in fade-in" onClick={onClose} />
            <div className="relative bg-[#0b141a] w-full max-w-md rounded-xl shadow-2xl flex flex-col max-h-[90vh] animate-in zoom-in-95 border border-white/10 overflow-hidden">

                {/* Header */}
                <div className="bg-[#202c33] p-6 pb-8 flex flex-col items-center relative">
                    <button onClick={onClose} className="absolute top-4 left-4 text-slate-400 hover:text-white">
                        <X className="w-6 h-6" />
                    </button>

                    <div
                        className="w-24 h-24 rounded-full bg-slate-700 flex items-center justify-center mb-4 ring-4 ring-[#0b141a] shadow-lg overflow-hidden relative group"
                    >
                        {groupData?.avatarUrl ? (
                            <img src={groupData.avatarUrl} alt="Group" className="w-full h-full object-cover" />
                        ) : (
                            <Users className="w-10 h-10 text-slate-300" />
                        )}
                        <div
                            className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                            onClick={() => {
                                setNewAvatarUrl(groupData.avatarUrl || '');
                                setIsEditingAvatar(true);
                            }}
                        >
                            <LinkIcon className="w-8 h-8 text-white" />
                        </div>
                    </div>

                    {isEditingAvatar && (
                        <div className="absolute inset-x-0 top-0 bottom-0 bg-[#0b141a]/95 z-50 flex flex-col items-center justify-center p-6 space-y-4">
                            <h3 className="text-white font-bold">Update Icon URL</h3>
                            <div className="w-full flex items-center gap-2 bg-[#111b21] p-2 rounded-lg border border-[#00a884]">
                                <input
                                    className="bg-transparent text-white outline-none px-2 py-1 flex-1 text-sm"
                                    placeholder="Paste image URL here..."
                                    value={newAvatarUrl}
                                    onChange={e => setNewAvatarUrl(e.target.value)}
                                    autoFocus
                                />
                                <button onClick={handleUpdateAvatar} className="text-[#00a884]"><Check className="w-5 h-5" /></button>
                                <button onClick={() => setIsEditingAvatar(false)} className="text-slate-400"><X className="w-5 h-5" /></button>
                            </div>
                            <p className="text-xs text-slate-500">Paste any image link from the web to update the group icon.</p>
                        </div>
                    )}

                    <div className="flex items-center gap-2 max-w-full">
                        {isEditingName ? (
                            <div className="flex items-center gap-2 bg-[#111b21] p-1 rounded-lg border border-[#00a884]">
                                <input
                                    className="bg-transparent text-white outline-none px-2 py-1 w-48"
                                    value={newName}
                                    onChange={e => setNewName(e.target.value)}
                                    autoFocus
                                    onKeyDown={e => e.key === 'Enter' && handleUpdateName()}
                                />
                                <button onClick={handleUpdateName} className="text-[#00a884]"><Check className="w-5 h-5" /></button>
                                <button onClick={() => setIsEditingName(false)} className="text-slate-400"><X className="w-5 h-5" /></button>
                            </div>
                        ) : (
                            <>
                                <h2 className="text-xl font-bold text-white truncate">{groupData?.name || 'Group Info'}</h2>
                                <button onClick={() => setIsEditingName(true)} className="text-slate-400 hover:text-white"><Edit3 className="w-4 h-4" /></button>
                            </>
                        )}
                    </div>
                    <p className="text-sm text-slate-400 mt-1">Group • {members.length} participants</p>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto custom-scrollbar p-0 bg-[#111b21]">

                    {/* Quick Settings */}
                    <div className="p-4 space-y-4 border-b border-white/5">
                        <div className="flex items-center justify-between p-3 bg-white/5 rounded-xl">
                            <div className="flex items-center gap-3">
                                {isMuted ? <BellOff className="w-5 h-5 text-rose-500" /> : <Bell className="w-5 h-5 text-[#00a884]" />}
                                <div>
                                    <p className="text-sm font-medium text-white">Mute Notifications</p>
                                    <p className="text-xs text-slate-500">{isMuted ? 'Notifications are off' : 'Message tones enabled'}</p>
                                </div>
                            </div>
                            <button
                                onClick={toggleMute}
                                className={`w-10 h-5 rounded-full relative transition-colors ${isMuted ? 'bg-rose-500' : 'bg-slate-600'}`}
                            >
                                <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-transform ${isMuted ? 'translate-x-6' : 'translate-x-1'}`} />
                            </button>
                        </div>

                        {isAdmin && (
                            <div className="flex items-center justify-between p-3 bg-white/5 rounded-xl">
                                <div className="flex items-center gap-3">
                                    <Shield className="w-5 h-5 text-[#00a884]" />
                                    <div>
                                        <p className="text-sm font-medium text-white">Admin-only Messages</p>
                                        <p className="text-xs text-slate-500">Allow only admins to send messages</p>
                                    </div>
                                </div>
                                <button
                                    onClick={toggleAdminOnly}
                                    className={`w-10 h-5 rounded-full relative transition-colors ${groupData?.adminOnlyMessageMode ? 'bg-[#00a884]' : 'bg-slate-600'}`}
                                >
                                    <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-transform ${groupData?.adminOnlyMessageMode ? 'translate-x-6' : 'translate-x-1'}`} />
                                </button>
                            </div>
                        )}
                    </div>

                    {/* Participants */}
                    <div className="p-2">
                        <div className="px-4 py-2 flex items-center justify-between">
                            <span className="text-xs font-bold text-[#00a884] uppercase tracking-wider">{members.length} Participants</span>
                            {isAdmin && (
                                <button
                                    onClick={() => setShowAddMember(true)}
                                    className="flex items-center gap-1 text-xs text-[#00a884] hover:bg-[#00a884]/10 px-2 py-1 rounded"
                                >
                                    <UserPlus className="w-3 h-3" /> Add Participant
                                </button>
                            )}
                        </div>

                        {showAddMember && (
                            <div className="mx-2 mb-4 p-3 bg-white/5 rounded-xl animate-in fade-in slide-in-from-top-2">
                                <div className="flex items-center gap-2 mb-3">
                                    <Search className="w-4 h-4 text-slate-500" />
                                    <input
                                        placeholder="Search contacts..."
                                        className="bg-transparent border-none outline-none text-sm text-white w-full"
                                        value={searchTerm}
                                        onChange={e => setSearchTerm(e.target.value)}
                                        autoFocus
                                    />
                                    <button onClick={() => setShowAddMember(false)} className="text-slate-400"><X className="w-4 h-4" /></button>
                                </div>
                                <div className="max-h-40 overflow-y-auto custom-scrollbar space-y-1">
                                    {filteredContacts.map(c => (
                                        <div
                                            key={c.id}
                                            className="flex items-center justify-between p-2 hover:bg-white/5 rounded-lg cursor-pointer group"
                                            onClick={() => handleAddMember(c)}
                                        >
                                            <div className="flex items-center gap-2">
                                                <div className="w-8 h-8 rounded-full bg-slate-600 overflow-hidden text-xs flex items-center justify-center text-white">
                                                    {c.avatarUrl ? <img src={c.avatarUrl} className="w-full h-full object-cover" /> : c.name[0]}
                                                </div>
                                                <span className="text-sm text-white">{c.name}</span>
                                            </div>
                                            <Plus className="w-4 h-4 text-[#00a884] opacity-0 group-hover:opacity-100" />
                                        </div>
                                    ))}
                                    {filteredContacts.length === 0 && <p className="text-xs text-slate-500 text-center py-2">No contacts to add</p>}
                                </div>
                            </div>
                        )}

                        <div className="space-y-1">
                            {members.map(member => (
                                <div key={member.id} className="flex items-center gap-3 p-3 hover:bg-white/5 rounded-lg group">
                                    <div className="w-10 h-10 rounded-full bg-slate-600 overflow-hidden flex items-center justify-center text-white relative">
                                        {member.avatarUrl ? <img src={member.avatarUrl} className="w-full h-full object-cover" /> : (member.displayName || member.name)?.[0]?.toUpperCase()}
                                        {member.online && <div className="absolute bottom-0 right-0 w-3 h-3 bg-[#00a884] rounded-full border-2 border-[#111b21]" />}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex justify-between items-center">
                                            <h3 className="text-white font-medium truncate">
                                                {member.id === currentUser.id ? "You" : (member.displayName || member.name)}
                                            </h3>
                                            {member.role === 'admin' && (
                                                <span className="text-[10px] bg-[#00a884]/20 text-[#00a884] px-1.5 py-0.5 rounded border border-[#00a884]/30">Admin</span>
                                            )}
                                        </div>
                                        <p className="text-xs text-slate-500 truncate">@{member.name}</p>
                                    </div>

                                    {/* Member Actions (Only for admins, on other members) */}
                                    {isAdmin && member.id !== currentUser.id && (
                                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                            {member.role === 'admin' ? (
                                                <button
                                                    onClick={() => handleDemote(member.id, member.displayName || member.name)}
                                                    className="p-1.5 hover:bg-rose-500/10 text-rose-500 rounded-full"
                                                    title="Dismiss as Admin"
                                                >
                                                    <ShieldOff className="w-4 h-4" />
                                                </button>
                                            ) : (
                                                <button
                                                    onClick={() => handlePromote(member.id, member.displayName || member.name)}
                                                    className="p-1.5 hover:bg-[#00a884]/10 text-[#00a884] rounded-full"
                                                    title="Make Admin"
                                                >
                                                    <ShieldCheck className="w-4 h-4" />
                                                </button>
                                            )}
                                            <button
                                                onClick={() => handleRemoveMember(member.id, member.displayName || member.name)}
                                                className="p-1.5 hover:bg-rose-500/10 text-rose-500 rounded-full"
                                                title="Remove Participant"
                                            >
                                                <UserMinus className="w-4 h-4" />
                                            </button>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Meta Info */}
                    <div className="p-4 border-t border-white/5">
                        <p className="text-xs text-slate-500 text-center italic">
                            Created by {groupData?.createdBy === currentUser.id ? 'you' : 'an admin'} on {new Date(groupData?.createdAt).toLocaleDateString()}
                        </p>
                    </div>

                    {/* Danger Zone */}
                    <div className="p-4 mt-2 space-y-2 bg-[#0b141a]">
                        <button
                            onClick={handleExitGroup}
                            className="w-full flex items-center gap-3 text-rose-500 hover:bg-rose-500/10 p-4 rounded-xl transition-colors font-medium text-left"
                        >
                            <LogOut className="w-5 h-5" />
                            Exit Group
                        </button>

                        {isAdmin && (
                            <button
                                onClick={handleDeleteGroup}
                                className="w-full flex items-center gap-3 text-rose-500 hover:bg-rose-500/10 p-4 rounded-xl transition-colors font-medium text-left"
                            >
                                <Trash2 className="w-5 h-5" />
                                Delete Group
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

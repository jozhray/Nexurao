import React, { useState, useEffect } from 'react';
import { db } from '../lib/firebase';
import { ref, onValue, remove, update, get, serverTimestamp, set } from 'firebase/database';
import { X, Search, Check, Megaphone, Edit3, Trash2, UserPlus, UserMinus, User } from 'lucide-react';

const isValidAvatarUrl = (url) => {
    if (!url || typeof url !== 'string') return false;
    if (url.startsWith('blob:')) return false;
    return url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:');
};

export default function BroadcastInfoModal({ onClose, listId, currentUser }) {
    const [listData, setListData] = useState(null);
    const [recipients, setRecipients] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isEditingName, setIsEditingName] = useState(false);
    const [newName, setNewName] = useState('');
    const [showAddMember, setShowAddMember] = useState(false);
    const [contacts, setContacts] = useState([]);
    const [searchTerm, setSearchTerm] = useState('');

    useEffect(() => {
        if (!listId || !currentUser?.id) return;

        const listRef = ref(db, `broadcast_lists/${currentUser.id}/${listId}`);
        const unsubscribe = onValue(listRef, async (snapshot) => {
            if (snapshot.exists()) {
                const data = snapshot.val();
                setListData(data);
                setNewName(data.name);

                // Fetch recipient details
                if (data.recipients) {
                    const memberPromises = data.recipients.map(async (uid) => {
                        const userSnap = await get(ref(db, `users/${uid}`));
                        if (userSnap.exists()) {
                            return { id: uid, ...userSnap.val() };
                        }
                        return { id: uid, name: 'Unknown User' };
                    });
                    const memberList = await Promise.all(memberPromises);
                    setRecipients(memberList.filter(Boolean));
                }
            } else {
                setListData(null);
            }
            setLoading(false);
        });

        return () => unsubscribe();
    }, [listId, currentUser?.id]);

    useEffect(() => {
        if (!showAddMember || !currentUser?.id) return;
        const contactsRef = ref(db, `user_contacts/${currentUser.id}`);
        return onValue(contactsRef, (snapshot) => {
            if (snapshot.exists()) {
                setContacts(Object.values(snapshot.val()));
            } else {
                setContacts([]);
            }
        });
    }, [showAddMember, currentUser?.id]);

    const handleUpdateName = async () => {
        if (!newName.trim() || newName === listData.name) {
            setIsEditingName(false);
            return;
        }
        try {
            await update(ref(db, `broadcast_lists/${currentUser.id}/${listId}`), { name: newName.trim() });
            setIsEditingName(false);
        } catch (error) {
            alert("Failed to update name");
        }
    };

    const handleRemoveRecipient = async (userId) => {
        if (listData.recipients.length <= 2) {
            alert("Broadcast lists must have at least 2 recipients.");
            return;
        }
        if (!confirm("Remove this recipient?")) return;

        const newRecipients = listData.recipients.filter(id => id !== userId);
        try {
            await update(ref(db, `broadcast_lists/${currentUser.id}/${listId}`), { recipients: newRecipients });
        } catch (error) {
            alert("Failed to remove recipient");
        }
    };

    const handleAddRecipient = async (contact) => {
        if (listData.recipients.includes(contact.id)) {
            alert("Already in the list");
            return;
        }
        const newRecipients = [...listData.recipients, contact.id];
        try {
            await update(ref(db, `broadcast_lists/${currentUser.id}/${listId}`), { recipients: newRecipients });
            setShowAddMember(false);
        } catch (error) {
            alert("Failed to add recipient");
        }
    };

    const handleDeleteList = async () => {
        if (!confirm("Are you sure you want to delete this broadcast list? This cannot be undone.")) return;
        try {
            await remove(ref(db, `broadcast_lists/${currentUser.id}/${listId}`));
            onClose();
        } catch (error) {
            alert("Failed to delete list");
        }
    };

    if (loading) return null;
    if (!listData) return null;

    return (
        <div className="fixed inset-0 z-[4000] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/70 backdrop-blur-md animate-in fade-in" onClick={onClose} />
            <div className="relative bg-[#111b21] w-full max-w-md rounded-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden border border-white/10 animate-in zoom-in-95 duration-200">

                {/* Header */}
                <div className="p-4 border-b border-white/5 flex items-center justify-between bg-[#202c33]/50">
                    <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-full text-slate-400 transition-colors"><X size={20} /></button>
                    <h2 className="text-lg font-semibold text-white">Broadcast List Info</h2>
                    <div className="w-10 h-10" /> {/* Spacer */}
                </div>

                <div className="flex-1 overflow-y-auto custom-scrollbar">
                    {/* List Identity */}
                    <div className="p-8 flex flex-col items-center gap-6 bg-gradient-to-b from-[#202c33]/30 to-transparent">
                        <div className="w-24 h-24 rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center text-white ring-4 ring-[#111b21] shadow-2xl shadow-cyan-500/10">
                            <Megaphone size={40} />
                        </div>

                        <div className="w-full flex flex-col items-center gap-2">
                            {isEditingName ? (
                                <div className="flex items-center gap-2 w-full max-w-[300px]">
                                    <input
                                        type="text"
                                        className="flex-1 bg-[#2a3942] text-white px-4 py-2 rounded-lg outline-none border-b-2 border-cyan-500 font-medium"
                                        value={newName}
                                        onChange={(e) => setNewName(e.target.value)}
                                        autoFocus
                                    />
                                    <button onClick={handleUpdateName} className="p-2 bg-cyan-500 text-white rounded-lg"><Check size={20} /></button>
                                </div>
                            ) : (
                                <div className="flex items-center gap-2 group cursor-pointer" onClick={() => setIsEditingName(true)}>
                                    <h1 className="text-2xl font-bold text-white text-center">{listData.name}</h1>
                                    <Edit3 size={18} className="text-slate-500 group-hover:text-cyan-400 opacity-0 group-hover:opacity-100 transition-all" />
                                </div>
                            )}
                            <p className="text-cyan-400 font-medium text-sm tracking-wide uppercase">{listData.recipients?.length || 0} Recipients</p>
                        </div>
                    </div>

                    {/* Actions */}
                    <div className="px-4 py-2 flex flex-col gap-1">
                        <button onClick={() => setShowAddMember(true)} className="w-full flex items-center gap-4 p-4 hover:bg-white/5 text-[#00a884] rounded-xl transition-colors font-medium">
                            <div className="w-10 h-10 rounded-full bg-[#00a884]/10 flex items-center justify-center"><UserPlus size={20} /></div>
                            Add Recipient
                        </button>
                        <button onClick={handleDeleteList} className="w-full flex items-center gap-4 p-4 hover:bg-rose-500/10 text-rose-500 rounded-xl transition-colors font-medium">
                            <div className="w-10 h-10 rounded-full bg-rose-500/10 flex items-center justify-center"><Trash2 size={20} /></div>
                            Delete Broadcast List
                        </button>
                    </div>

                    {/* Recipient List */}
                    <div className="mt-4 px-4 pb-8">
                        <h3 className="px-4 mb-3 text-xs font-bold text-slate-500 uppercase tracking-widest">Recipients</h3>
                        <div className="flex flex-col gap-1">
                            {recipients.map(member => (
                                <div key={member.id} className="flex items-center gap-4 p-3 hover:bg-white/5 rounded-2xl group transition-all border border-transparent hover:border-white/5">
                                    <div className="w-12 h-12 rounded-full bg-slate-700 flex items-center justify-center text-white font-bold ring-1 ring-white/10 overflow-hidden">
                                        {isValidAvatarUrl(member.avatarUrl) ? (
                                            <img src={member.avatarUrl} className="w-full h-full object-cover" />
                                        ) : (
                                            member.name?.[0].toUpperCase()
                                        )}
                                    </div>
                                    <div className="flex-1">
                                        <h4 className="text-white font-medium">{member.displayName || member.name}</h4>
                                        <p className="text-xs text-slate-500">@{member.name}</p>
                                    </div>
                                    <button onClick={() => handleRemoveRecipient(member.id)} className="p-2 text-slate-600 hover:text-rose-500 hover:bg-rose-500/10 rounded-full opacity-0 group-hover:opacity-100 transition-all">
                                        <UserMinus size={18} />
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Add Recipient Overlay */}
                {showAddMember && (
                    <div className="absolute inset-0 bg-[#111b21] z-50 flex flex-col animate-in slide-in-from-bottom-5 duration-300">
                        <div className="p-4 border-b border-white/5 flex items-center gap-4 bg-[#202c33]/50">
                            <button onClick={() => setShowAddMember(false)} className="p-2 hover:bg-white/5 rounded-full text-slate-400"><X size={20} /></button>
                            <h2 className="text-lg font-semibold text-white">Add Recipients</h2>
                        </div>
                        <div className="p-4">
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                                <input
                                    type="text"
                                    placeholder="Search contacts..."
                                    className="w-full bg-[#2a3942] text-white pl-10 pr-4 py-3 rounded-xl outline-none"
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                />
                            </div>
                        </div>
                        <div className="flex-1 overflow-y-auto custom-scrollbar px-2">
                            {contacts
                                .filter(c => c.name.toLowerCase().includes(searchTerm.toLowerCase()))
                                .filter(c => !listData.recipients.includes(c.id))
                                .map(contact => (
                                    <div key={contact.id} onClick={() => handleAddRecipient(contact)} className="flex items-center gap-4 p-3 hover:bg-white/5 rounded-2xl cursor-pointer group transition-all">
                                        <div className="w-12 h-12 rounded-full bg-slate-700 flex items-center justify-center text-white font-bold ring-1 ring-white/10 overflow-hidden">
                                            {isValidAvatarUrl(contact.avatarUrl) ? (
                                                <img src={contact.avatarUrl} className="w-full h-full object-cover" />
                                            ) : (
                                                contact.name?.[0].toUpperCase()
                                            )}
                                        </div>
                                        <div className="flex-1">
                                            <h4 className="text-white font-medium">{contact.name}</h4>
                                            <p className="text-xs text-slate-500">@{contact.displayName || contact.name}</p>
                                        </div>
                                        <div className="p-2 bg-cyan-500/10 text-cyan-500 rounded-full opacity-0 group-hover:opacity-100 transition-all">
                                            <Plus size={18} />
                                        </div>
                                    </div>
                                ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

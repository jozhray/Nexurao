import React, { useState, useEffect } from 'react';
import { db } from '../lib/firebase';
import { ref, push, set, serverTimestamp, onValue } from 'firebase/database';
import { X, Search, Check, Users, Camera, Link as LinkIcon } from 'lucide-react';

export default function CreateGroupModal({ currentUser, onClose, onGroupCreated }) {
    const [groupName, setGroupName] = useState('');
    const [contacts, setContacts] = useState([]);
    const [selectedContactIds, setSelectedContactIds] = useState(new Set());
    const [searchTerm, setSearchTerm] = useState('');
    const [avatarUrl, setAvatarUrl] = useState('');

    useEffect(() => {
        if (!currentUser) return;
        const contactsRef = ref(db, `user_contacts/${currentUser.id}`);
        return onValue(contactsRef, (snapshot) => {
            if (snapshot.exists()) {
                const data = snapshot.val();
                setContacts(Object.values(data));
            } else {
                setContacts([]);
            }
        });
    }, [currentUser]);

    const toggleSelection = (contactId) => {
        const newSet = new Set(selectedContactIds);
        if (newSet.has(contactId)) {
            newSet.delete(contactId);
        } else {
            newSet.add(contactId);
        }
        setSelectedContactIds(newSet);
    };

    const handleCreate = async () => {
        if (!groupName.trim()) {
            alert("Please enter a group name");
            return;
        }
        if (selectedContactIds.size === 0) {
            alert("Please select at least one member");
            return;
        }

        const memberIds = Array.from(selectedContactIds);
        const membersData = {
            [currentUser.id]: { role: 'admin', joinedAt: serverTimestamp() }
        };
        memberIds.forEach(id => {
            membersData[id] = { role: 'member', joinedAt: serverTimestamp() };
        });

        const groupsRef = ref(db, 'groups');
        const newGroupRef = push(groupsRef);
        const groupId = newGroupRef.key;

        try {
            const groupData = {
                id: groupId,
                name: groupName.trim(),
                createdBy: currentUser.id,
                createdAt: serverTimestamp(),
                members: membersData,
                avatarUrl: avatarUrl.trim() || null,
                adminOnlyMessageMode: false
            };

            await set(newGroupRef, groupData);

            // 2. Add to user_groups for ALL members
            const allMemberIds = [currentUser.id, ...memberIds];
            for (const id of allMemberIds) {
                await set(ref(db, `user_groups/${id}/${groupId}`), {
                    id: groupId,
                    name: groupName.trim(),
                    avatarUrl: avatarUrl.trim() || null,
                    addedAt: serverTimestamp(),
                    joinedAt: serverTimestamp()
                });
            }

            // Initial System Message
            const msgRef = push(ref(db, `messages/${groupId}`));
            await set(msgRef, {
                type: 'system',
                text: `${currentUser.displayName || currentUser.name} created group "${groupName}"`,
                timestamp: serverTimestamp(),
                userId: 'system'
            });

            if (onGroupCreated) onGroupCreated(groupId);
            onClose();
        } catch (error) {
            console.error("Group creation failed:", error);
            alert("Failed to create group. Please try again.");
        }
    };

    const filteredContacts = contacts.filter(c =>
        c.name.toLowerCase().includes(searchTerm.toLowerCase())
    );

    return (
        <div className="fixed inset-0 z-[3000] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-in fade-in" onClick={onClose} />
            <div className="relative bg-[#111b21] w-full max-w-md rounded-xl shadow-2xl flex flex-col max-h-[90vh] animate-in zoom-in-95 border border-white/10">

                {/* Header */}
                <div className="p-4 border-b border-white/10 flex items-center gap-3">
                    <button onClick={onClose}><X className="text-slate-400" /></button>
                    <h2 className="text-lg font-medium text-white">New Group</h2>
                </div>

                {/* Group Info */}
                <div className="p-6 flex flex-col items-center gap-4 bg-white/5">
                    <div className="w-20 h-20 rounded-full bg-slate-700/50 flex items-center justify-center ring-1 ring-white/10 relative text-slate-300 overflow-hidden">
                        {avatarUrl ? (
                            <img src={avatarUrl} className="w-full h-full object-cover" alt="Preview" />
                        ) : (
                            <Users className="w-8 h-8" />
                        )}
                    </div>

                    <div className="w-full space-y-3">
                        <div className="relative group">
                            <input
                                type="text"
                                placeholder="Group Subject"
                                className="w-full bg-[#202c33] border-b-2 border-slate-600 focus:border-[#00a884] rounded-t-lg outline-none text-white px-4 py-3 text-center placeholder:text-slate-500 transition-all font-medium"
                                value={groupName}
                                onChange={e => setGroupName(e.target.value)}
                            />
                        </div>

                        <div className="relative group">
                            <div className="absolute left-3 top-1/2 -translate-y-1/2">
                                <LinkIcon className="w-4 h-4 text-slate-500" />
                            </div>
                            <input
                                type="text"
                                placeholder="Group Icon URL (Optional)"
                                className="w-full bg-[#202c33]/50 border-b border-white/10 focus:border-[#00a884] outline-none text-white pl-10 pr-4 py-2 text-sm placeholder:text-slate-600 transition-all italic rounded-md"
                                value={avatarUrl}
                                onChange={e => setAvatarUrl(e.target.value)}
                            />
                        </div>
                    </div>
                </div>

                {/* Member Selection */}
                <div className="flex-1 overflow-y-auto custom-scrollbar p-2">
                    <div className="px-2 mb-2">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                            <input
                                type="text"
                                placeholder="Add members"
                                className="w-full bg-[#202c33] rounded-lg py-2 pl-10 pr-4 text-white text-sm outline-none focus:ring-1 focus:ring-[#00a884]/50"
                                value={searchTerm}
                                onChange={e => setSearchTerm(e.target.value)}
                            />
                        </div>
                    </div>

                    <div className="space-y-1">
                        {filteredContacts.map(contact => (
                            <div
                                key={contact.id}
                                onClick={() => toggleSelection(contact.id)}
                                className="flex items-center gap-3 p-3 hover:bg-white/5 rounded-lg cursor-pointer transition-colors group"
                            >
                                <div className="w-10 h-10 rounded-full bg-slate-700 overflow-hidden">
                                    {contact.avatarUrl ? (
                                        <img src={contact.avatarUrl} className="w-full h-full object-cover" alt="" />
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center text-slate-400 capitalize">
                                            {contact.name[0]}
                                        </div>
                                    )}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="text-white font-medium truncate">{contact.name}</div>
                                    <div className="text-slate-500 text-xs truncate">@{contact.identity}</div>
                                </div>
                                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${selectedContactIds.has(contact.id)
                                    ? 'bg-[#00a884] border-[#00a884]'
                                    : 'border-slate-600 group-hover:border-slate-500'
                                    }`}>
                                    {selectedContactIds.has(contact.id) && <Check className="w-3 h-3 text-white" />}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-white/10 flex justify-center">
                    <button
                        onClick={handleCreate}
                        disabled={!groupName.trim() || selectedContactIds.size === 0}
                        className="bg-[#00a884] hover:bg-[#008f70] disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-full w-12 h-12 flex items-center justify-center shadow-lg transition-transform active:scale-95"
                    >
                        <Check className="w-6 h-6" />
                    </button>
                </div>

            </div>
        </div>
    );
}

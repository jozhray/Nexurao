import React, { useState, useEffect } from 'react';
import { db } from '../lib/firebase';
import { ref, push, set, serverTimestamp, onValue } from 'firebase/database';
import { X, Search, Check, Megaphone } from 'lucide-react';

export default function CreateBroadcastListModal({ currentUser, onClose, onListCreated }) {
    const [listName, setListName] = useState('');
    const [contacts, setContacts] = useState([]);
    const [selectedContactIds, setSelectedContactIds] = useState(new Set());
    const [searchTerm, setSearchTerm] = useState('');

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
        if (!listName.trim()) {
            alert("Please enter a list name");
            return;
        }
        if (selectedContactIds.size < 2) {
            alert("Please select at least two recipients");
            return;
        }

        const recipients = Array.from(selectedContactIds);

        // Create Broadcast List (Private to User)
        const listRef = push(ref(db, `broadcast_lists/${currentUser.id}`));
        const listId = listRef.key;

        const listData = {
            id: listId,
            name: listName.trim(),
            createdAt: serverTimestamp(),
            recipients: recipients, // Array of user IDs
            lastActive: serverTimestamp() // For sorting
        };

        await set(listRef, listData);

        if (onListCreated) onListCreated(listId);
        onClose();
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
                    <h2 className="text-lg font-medium text-white">New Broadcast</h2>
                </div>

                {/* Info */}
                <div className="p-6 flex flex-col items-center gap-6 bg-white/5">
                    <div className="w-20 h-20 rounded-full bg-slate-700/50 flex items-center justify-center ring-1 ring-white/10">
                        <Megaphone className="w-8 h-8 text-slate-300" />
                    </div>
                    <div className="w-full relative group">
                        <input
                            type="text"
                            placeholder="List Name (e.g., Friends, Work)"
                            className="w-full bg-[#202c33] border-b-2 border-slate-600 focus:border-[#00a884] rounded-t-lg outline-none text-white px-4 py-3 text-center placeholder:text-slate-500 transition-all"
                            value={listName}
                            onChange={e => setListName(e.target.value)}
                        />
                        <div className="absolute bottom-0 left-0 w-full h-[2px] bg-[#00a884] scale-x-0 group-focus-within:scale-x-100 transition-transform duration-300 origin-center" />
                    </div>
                    <p className="text-xs text-slate-400 text-center max-w-xs leading-relaxed">
                        Only recipients who have your number in their address book will receive your broadcast messages.
                    </p>
                </div>

                {/* Selection Stats */}
                <div className="p-4 bg-[#111b21] border-b border-white/5">
                    <div className="relative mb-3">
                        <div className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center pointer-events-none">
                            <Search className="w-5 h-5 text-slate-500" />
                        </div>
                        <input
                            type="text"
                            placeholder="Search contacts..."
                            className="w-full bg-[#202c33] rounded-lg py-3 pl-10 pr-4 text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-[#00a884] transition-all"
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                        />
                    </div>
                    <p className="text-xs text-[#00a884] font-medium px-1 tracking-wide uppercase">
                        Selected: {selectedContactIds.size} of {contacts.length}
                    </p>
                </div>

                {/* Contact List */}
                <div className="flex-1 overflow-y-auto px-2 custom-scrollbar">
                    {filteredContacts.map(contact => (
                        <div
                            key={contact.id}
                            onClick={() => toggleSelection(contact.id)}
                            className="flex items-center gap-3 p-3 hover:bg-white/5 rounded-lg cursor-pointer group transition-colors"
                        >
                            <div className="relative">
                                <div className="w-10 h-10 rounded-full bg-slate-600 overflow-hidden">
                                    {contact.avatarUrl ? (
                                        <img src={contact.avatarUrl} className="w-full h-full object-cover" alt="" />
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center text-white font-bold">
                                            {contact.name[0]?.toUpperCase()}
                                        </div>
                                    )}
                                </div>
                                {selectedContactIds.has(contact.id) && (
                                    <div className="absolute -bottom-1 -right-1 bg-[#00a884] rounded-full p-0.5 border-2 border-[#111b21]">
                                        <Check className="w-3 h-3 text-white" />
                                    </div>
                                )}
                            </div>
                            <div className="flex-1 min-w-0">
                                <h3 className={`font-medium truncate ${selectedContactIds.has(contact.id) ? 'text-[#00a884]' : 'text-white'}`}>
                                    {contact.name}
                                </h3>
                                <p className="text-xs text-slate-500 truncate">@{contact.displayName || contact.name}</p>
                            </div>
                        </div>
                    ))}
                    {filteredContacts.length === 0 && (
                        <div className="text-center py-8 text-slate-500">
                            No contacts found
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-white/10 flex justify-center">
                    <button
                        onClick={handleCreate}
                        disabled={!listName.trim() || selectedContactIds.size < 2}
                        className="bg-[#00a884] hover:bg-[#008f70] disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-full w-12 h-12 flex items-center justify-center shadow-lg transition-transform active:scale-95"
                    >
                        <Check className="w-6 h-6" />
                    </button>
                </div>

            </div>
        </div>
    );
}

import React from 'react';
import { User, Shield, Gamepad } from 'lucide-react';

export default function OnlineList({ users, currentUser, roomId }) {
    const userList = Object.values(users);

    return (
        <div className="flex flex-col h-full">
            {/* Removed redundant header to fix overlap */}

            <div className="flex-1 overflow-y-auto px-4 py-6 custom-scrollbar">
                <div className="flex flex-col gap-1">
                    {userList.map((u) => {
                        const isMe = u.id === currentUser.id;
                        return (
                            <div
                                key={u.id}
                                className={`
                  group flex items-center gap-4 p-4 rounded-2xl transition-all duration-300
                  ${isMe ? 'bg-white/[0.03]' : 'hover:bg-white/[0.02] cursor-pointer'}
                `}
                            >
                                <div className="relative">
                                    <div className="w-10 h-10 rounded-full bg-slate-900 border border-white/[0.05] flex items-center justify-center overflow-hidden transition-transform duration-500 group-hover:scale-105">
                                        {isMe ? (
                                            <div className="w-full h-full bg-indigo-500/10 flex items-center justify-center">
                                                <User className="w-5 h-5 text-indigo-400 stroke-[1.5]" />
                                            </div>
                                        ) : (
                                            <User className="w-5 h-5 text-slate-700 stroke-[1.5]" />
                                        )}
                                    </div>
                                    <div className="absolute bottom-0 right-0 w-3 h-3 bg-emerald-500 border-[3px] border-[#020617] rounded-full" />
                                </div>

                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-1.5">
                                        <p className={`text-[14px] font-medium truncate ${isMe ? 'text-white' : 'text-slate-400 group-hover:text-slate-200'}`}>
                                            {u.name}
                                        </p>
                                        {isMe && <Shield className="w-3 h-3 text-indigo-500/50" />}
                                    </div>
                                    <p className="text-[10px] text-slate-600 font-medium uppercase tracking-wider mt-0.5">
                                        Central Hub
                                    </p>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            <div className="p-6 mt-auto">
                <div className="p-4 rounded-2xl border border-dashed border-white/5 bg-white/[0.01] opacity-40 group cursor-not-allowed transition-opacity hover:opacity-100">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="p-2 rounded-lg bg-white/5 text-slate-500">
                            <Gamepad className="w-4 h-4" />
                        </div>
                        <p className="text-[10px] font-bold text-slate-400 tracking-widest uppercase">Gaming Suite</p>
                    </div>
                    <p className="text-[9px] text-slate-600 font-medium leading-relaxed">
                        Integration with Crisp Reality Gaming coming in v2.0
                    </p>
                </div>
            </div>
        </div>
    );
}

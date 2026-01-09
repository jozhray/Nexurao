import React, { useState } from 'react';
import { db } from '../lib/firebase';
import { ref, get, set } from 'firebase/database';
import { MessageSquare, ArrowRight, Lock, User, Loader2 } from 'lucide-react';

export default function Auth({ onLogin }) {
    const [isRegister, setIsRegister] = useState(false);
    const [username, setUsername] = useState('');
    const [displayName, setDisplayName] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!username.trim() || !password.trim()) return;
        if (isRegister && !displayName.trim()) {
            setError('Display Name is required for registration');
            return;
        }

        setLoading(true);
        setError('');
        console.log('[Auth] Starting login for:', username);

        const userId = username.toLowerCase().replace(/[^a-z0-9]/g, '');
        const userRef = ref(db, `users/${userId}`);

        const fetchUserData = async () => {
            try {
                // Try SDK first with a shorter timeout
                const timeoutPromise = new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('SDK Timeout')), 5000)
                );
                console.log('[Auth] Attempting SDK fetch...');
                const snapshot = await Promise.race([get(userRef), timeoutPromise]);
                return snapshot.exists() ? snapshot.val() : null;
            } catch (err) {
                console.warn('[Auth] SDK Fetch failed or timed out. Falling back to REST...', err.message);

                // REST Fallback
                try {
                    const dbUrl = "https://crispconnect-default-rtdb.firebaseio.com";
                    const response = await fetch(`${dbUrl}/users/${userId}.json`);
                    if (!response.ok) throw new Error('REST API failed');
                    const data = await response.json();
                    console.log('[Auth] REST Fetch success:', data ? 'User found' : 'User not found');
                    return data;
                } catch (restErr) {
                    console.error('[Auth] REST Fallback failed:', restErr);
                    throw new Error('All connection attempts failed');
                }
            }
        };

        try {
            const userData = await fetchUserData();

            if (isRegister) {
                if (userData) {
                    setError('Username already taken');
                    setLoading(false);
                    return;
                }

                const newUserData = {
                    id: userId,
                    name: username, // Identity
                    displayName: displayName.trim(),
                    password: password,
                    about: 'Hey there! I am using Nexurao.',
                    createdAt: Date.now()
                };

                await set(userRef, newUserData);
                localStorage.setItem('nexurao_user', JSON.stringify(newUserData));
                onLogin(newUserData);

            } else {
                if (!userData) {
                    setError('User not found');
                    setLoading(false);
                    return;
                }

                if (userData.password !== password) {
                    setError('Invalid password');
                    setLoading(false);
                    return;
                }

                localStorage.setItem('nexurao_user', JSON.stringify(userData));
                onLogin(userData);

            }
        } catch (err) {
            console.error("[Auth] Error during submission:", err);
            setError('Connection failed. Please check your network or try again.');
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen w-full flex items-center justify-center font-sans relative overflow-hidden">
            {/* Background Image & Overlay */}
            <div className="absolute inset-0 bg-[url('/login-bg.png')] bg-cover bg-center">
                <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]"></div>
                <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-black/40"></div>
            </div>

            {/* Central Card - Glassmorphism */}
            <div className="relative z-10 w-full max-w-[400px] p-4 flex flex-col items-center animate-in zoom-in-95 duration-500 fade-in">
                <div className="w-full bg-black/30 backdrop-blur-xl border border-white/10 rounded-2xl shadow-[0_0_40px_-10px_rgba(0,0,0,0.5)] overflow-hidden ring-1 ring-white/5 flex flex-col relative">

                    {/* Decorative Top Line */}
                    <div className="h-1 w-full bg-gradient-to-r from-cyan-500 via-blue-500 to-purple-500"></div>

                    {/* Header */}
                    <div className="pt-8 pb-6 px-6 flex flex-col items-center text-center">
                        <div className="p-3 bg-white/5 border border-white/10 rounded-2xl shadow-lg mb-4 backdrop-blur-md group relative overflow-hidden">
                            <div className="absolute inset-0 bg-cyan-500/20 blur-xl opacity-50 group-hover:opacity-100 transition-opacity" />
                            <img src="/logo.png" alt="Nexurao Logo" className="w-12 h-12 object-contain relative z-10 drop-shadow-[0_0_15px_rgba(6,182,212,0.5)] group-hover:scale-110 transition-transform duration-300" />
                        </div>
                        <h1 className="text-3xl font-bold tracking-tight text-white drop-shadow-lg font-display">
                            Nexurao
                        </h1>
                        <p className="text-cyan-200/70 text-[11px] uppercase tracking-[0.2em] font-medium mt-2">
                            Next Gen Communication
                        </p>
                    </div>

                    {/* Form */}
                    <div className="p-8 space-y-6 pt-2">
                        <form onSubmit={handleSubmit} className="space-y-5">
                            <div className="space-y-1.5">
                                <label className="text-[10px] font-bold text-cyan-100/60 uppercase tracking-widest pl-1">Identity (Unique ID)</label>
                                <div className="relative group">
                                    <div className="absolute inset-y-0 left-0 pl-10 flex items-center pointer-events-none z-20">
                                        <User className="w-5 h-5 text-slate-400 group-focus-within:text-cyan-400 transition-colors" />
                                    </div>

                                    <input
                                        type="text"
                                        value={username}
                                        onChange={(e) => setUsername(e.target.value)}
                                        style={{ paddingLeft: '66px' }}
                                        className="block w-full pl-[66px] pr-4 py-3.5 bg-white/5 border border-white/10 rounded-xl text-white text-sm placeholder-white/20 focus:outline-none focus:border-cyan-500/50 focus:ring-2 focus:ring-cyan-500/20 transition-all font-medium selection:bg-cyan-500/30 backdrop-blur-sm"
                                        placeholder="username (cannot be changed)"
                                        autoFocus
                                    />
                                </div>
                            </div>

                            {isRegister && (
                                <div className="space-y-1.5 animate-in slide-in-from-top-2 duration-300">
                                    <label className="text-[10px] font-bold text-cyan-100/60 uppercase tracking-widest pl-1">Display Name</label>
                                    <div className="relative group">
                                        <div className="absolute inset-y-0 left-0 pl-10 flex items-center pointer-events-none z-20">
                                            <User className="w-5 h-5 text-slate-400 group-focus-within:text-cyan-400 transition-colors" />
                                        </div>

                                        <input
                                            type="text"
                                            value={displayName}
                                            onChange={(e) => setDisplayName(e.target.value)}
                                            style={{ paddingLeft: '66px' }}
                                            className="block w-full pl-[66px] pr-4 py-3.5 bg-white/5 border border-white/10 rounded-xl text-white text-sm placeholder-white/20 focus:outline-none focus:border-cyan-500/50 focus:ring-2 focus:ring-cyan-500/20 transition-all font-medium selection:bg-cyan-500/30 backdrop-blur-sm"
                                            placeholder="Your public name"
                                        />
                                    </div>
                                </div>
                            )}

                            <div className="space-y-1.5">
                                <label className="text-[10px] font-bold text-cyan-100/60 uppercase tracking-widest pl-1">Access Key</label>
                                <div className="relative group">
                                    <div className="absolute inset-y-0 left-0 pl-10 flex items-center pointer-events-none z-20">
                                        <Lock className="w-5 h-5 text-slate-400 group-focus-within:text-cyan-400 transition-colors" />
                                    </div>

                                    <input
                                        type="password"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        style={{ paddingLeft: '66px' }}
                                        className="block w-full pl-[66px] pr-4 py-3.5 bg-white/5 border border-white/10 rounded-xl text-white text-sm placeholder-white/20 focus:outline-none focus:border-cyan-500/50 focus:ring-2 focus:ring-cyan-500/20 transition-all font-medium selection:bg-cyan-500/30 backdrop-blur-sm"
                                        placeholder="••••••••"
                                    />
                                </div>
                            </div>

                            {error && (
                                <div className="p-3 bg-red-500/20 border border-red-500/30 rounded-xl flex items-center gap-2 text-red-200 text-xs font-medium backdrop-blur-md animate-in slide-in-from-top-2">
                                    <div className="w-1.5 h-1.5 rounded-full bg-red-400 shadow-[0_0_8px_rgba(248,113,113,0.8)]" />
                                    {error}
                                </div>
                            )}

                            <div className="pt-2">
                                <button
                                    type="submit"
                                    disabled={loading}
                                    className="w-full py-3.5 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-bold rounded-xl transition-all shadow-lg hover:shadow-cyan-500/25 flex items-center justify-center gap-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed group relative overflow-hidden"
                                >
                                    <div className="absolute inset-0 bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                                    {loading ? (
                                        <Loader2 className="w-5 h-5 animate-spin" />
                                    ) : (
                                        <>
                                            <span className="tracking-wide">{isRegister ? 'INITIALIZE ACCOUNT' : 'AUTHENTICATE'}</span>
                                            <ArrowRight className="w-4 h-4 ml-0.5 group-hover:translate-x-1 transition-transform" />
                                        </>
                                    )}
                                </button>
                            </div>
                        </form>
                    </div>

                    {/* Footer Actions */}
                    <div className="bg-black/20 border-t border-white/5 py-4 text-center backdrop-blur-md">
                        <button
                            onClick={() => { setIsRegister(!isRegister); setError(''); }}
                            className="text-cyan-100/60 hover:text-white text-xs font-medium tracking-wide transition-colors"
                        >
                            {isRegister ? 'Already registered? Login' : "New user? Create Access"}
                        </button>
                    </div>
                </div>

                <div className="mt-8 flex items-center gap-2 opacity-50">
                    <div className="h-1 w-1 rounded-full bg-cyan-400 shadow-[0_0_8px_cyan]"></div>
                    <span className="text-[10px] text-cyan-100 font-mono tracking-[0.2em] uppercase">
                        NEXURAO SECURE SYSTEM
                    </span>
                    <div className="h-1 w-1 rounded-full bg-cyan-400 shadow-[0_0_8px_cyan]"></div>
                </div>
            </div>

            {/* Fixed Footer */}
            <div
                style={{ position: 'fixed', bottom: '24px', left: 0, right: 0, width: '100%', textAlign: 'center', zIndex: 100 }}
                className="pointer-events-none"
            >
                <span className="text-[10px] text-white/20 font-mono tracking-[0.2em] uppercase mix-blend-overlay">
                    BUILD_2026.1.0 • ENCRYPTED CONNECTION
                </span>
            </div>
        </div>
    );

}

import React, { useState, useRef } from 'react';
import { db } from '../lib/firebase';
import { ref, update } from 'firebase/database';
import { X, Camera, User, Save, Upload, Check, Pencil, Image } from 'lucide-react';

// Preset backgrounds
const PRESET_BACKGROUNDS = [
    { id: 'default', name: 'Default', url: null, thumbnail: 'linear-gradient(135deg, #0b141a 0%, #111b21 100%)' },
    { id: 'dark-circuit', name: 'Dark Circuit', url: '/bg-dark-circuit.png', thumbnail: '/bg-dark-circuit.png' },
    { id: 'light-chat', name: 'Light Chat', url: '/bg-light-chat.png', thumbnail: '/bg-light-chat.png' },
    { id: 'cute-pattern', name: 'Cute Pattern', url: '/bg-cute-pattern.png', thumbnail: '/bg-cute-pattern.png' },
];

// Helper to validate if a string is a valid URL or data URL (excludes blob: URLs which expire)
const isValidAvatarUrl = (url) => {
    if (!url || typeof url !== 'string') return false;
    if (url.startsWith('blob:')) return false;
    return url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:');
};

export default function Settings({ user, onClose, onUpdate, chatBackground, onBackgroundChange }) {
    const [activeTab, setActiveTab] = useState('profile'); // 'profile' or 'background'
    const [displayName, setDisplayName] = useState(user.displayName || user.name || '');
    const [about, setAbout] = useState(user.about || 'Hey there! I am using Nexurao.');
    const [avatarUrl, setAvatarUrl] = useState(user.avatarUrl || '');


    const [avatarPreview, setAvatarPreview] = useState(user.avatarUrl || '');
    const [saving, setSaving] = useState(false);
    const [selectedBg, setSelectedBg] = useState(chatBackground || 'default');
    const [customBg, setCustomBg] = useState(null);

    const fileInputRef = useRef(null);
    const bgInputRef = useRef(null);

    const handleFileChange = (e) => {
        const file = e.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onloadend = () => {
                setAvatarPreview(reader.result);
                setAvatarUrl(reader.result);
            };
            reader.readAsDataURL(file);
        }
    };

    const handleBgFileChange = (e) => {
        const file = e.target.files?.[0];
        if (file) {
            // Compress image using canvas to fit localStorage
            const img = document.createElement('img');
            const reader = new FileReader();
            reader.onloadend = () => {
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    // Resize to max 800px while maintaining aspect ratio
                    const maxSize = 800;
                    let width = img.width;
                    let height = img.height;
                    if (width > height && width > maxSize) {
                        height = (height * maxSize) / width;
                        width = maxSize;
                    } else if (height > maxSize) {
                        width = (width * maxSize) / height;
                        height = maxSize;
                    }
                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);
                    // Compress to JPEG with 70% quality
                    const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.7);
                    setCustomBg(compressedDataUrl);
                    setSelectedBg('custom');
                };
                img.src = reader.result;
            };
            reader.readAsDataURL(file);
        }
    };


    const handleSaveProfile = async () => {
        if (!displayName.trim()) return;

        setSaving(true);
        try {
            const userRef = ref(db, `users/${user.id}`);
            await update(userRef, {
                displayName: displayName.trim(),
                about: about.trim() || 'Hey there! I am using Nexurao.',
                avatarUrl: isValidAvatarUrl(avatarUrl) ? avatarUrl : null
            });


            const updatedUser = {
                ...user,
                displayName: displayName.trim(),
                about: about.trim() || 'Hey there! I am using Nexurao.',
                avatarUrl: isValidAvatarUrl(avatarUrl) ? avatarUrl : null
            };
            localStorage.setItem('nexurao_user', JSON.stringify(updatedUser));
            onUpdate(updatedUser);


            onClose();
        } catch (err) {
            console.error('Failed to save settings:', err);
            alert('Failed to save settings');
        } finally {
            setSaving(false);
        }
    };

    const handleSaveBackground = () => {
        const bgData = {
            id: selectedBg,
            url: selectedBg === 'custom' ? customBg : PRESET_BACKGROUNDS.find(b => b.id === selectedBg)?.url
        };
        localStorage.setItem('nexurao_chat_background', JSON.stringify(bgData));
        onBackgroundChange?.(bgData);
        onClose();

    };

    return (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/80 backdrop-blur-sm animate-fade-in p-4">
            <div className="bg-[#111b21] rounded-2xl w-full max-w-[400px] shadow-2xl border border-[#323b42] overflow-hidden max-h-[90vh] flex flex-col">
                {/* Header */}
                <div className="bg-[#202c33] px-5 py-4 flex items-center justify-between">
                    <h2 className="text-lg font-medium text-[#e9edef]">Settings</h2>
                    <button
                        onClick={onClose}
                        className="p-2 text-[#aebac1] hover:bg-white/5 rounded-full transition-colors"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Tabs */}
                <div className="flex border-b border-[#323b42]">
                    <button
                        onClick={() => setActiveTab('profile')}
                        className={`flex-1 py-3 px-4 flex items-center justify-center gap-2 text-sm font-medium transition-colors ${activeTab === 'profile'
                            ? 'text-[#00a884] border-b-2 border-[#00a884] bg-white/5'
                            : 'text-[#8696a0] hover:bg-white/5'
                            }`}
                    >
                        <Pencil className="w-4 h-4 opacity-90" />
                        Edit Profile
                    </button>
                    <button
                        onClick={() => setActiveTab('background')}
                        className={`flex-1 py-3 px-4 flex items-center justify-center gap-2 text-sm font-medium transition-colors ${activeTab === 'background'
                            ? 'text-[#00a884] border-b-2 border-[#00a884] bg-white/5'
                            : 'text-[#8696a0] hover:bg-white/5'
                            }`}
                    >
                        <Image className="w-4 h-4 opacity-90" />
                        Chat Background
                    </button>
                </div>

                {/* Content */}
                <div className="p-6 overflow-y-auto flex-1 custom-scrollbar">
                    {activeTab === 'profile' ? (
                        /* Edit Profile Tab */
                        <div className="space-y-6">
                            {/* Avatar */}
                            <div className="flex flex-col items-center gap-3">
                                <div className="relative">
                                    <div className="w-28 h-28 rounded-full bg-slate-600 flex items-center justify-center text-white text-4xl font-medium overflow-hidden">
                                        {isValidAvatarUrl(avatarPreview) ? (
                                            <img src={avatarPreview} alt="Avatar" className="w-full h-full object-cover" />
                                        ) : (
                                            user.name[0]?.toUpperCase() || <User className="w-12 h-12" />
                                        )}
                                    </div>
                                    <input
                                        type="file"
                                        ref={fileInputRef}
                                        onChange={handleFileChange}
                                        accept="image/*"
                                        className="hidden"
                                    />
                                    <button
                                        onClick={() => fileInputRef.current?.click()}
                                        className="absolute bottom-0 right-0 w-10 h-10 rounded-full bg-[#00a884] flex items-center justify-center cursor-pointer hover:bg-[#02d98b] transition-colors"
                                    >
                                        <Camera className="w-5 h-5 text-white" />
                                    </button>
                                </div>
                                <p className="text-xs text-[#8696a0]">Click the camera to change photo</p>
                            </div>

                            {/* Identity Input (Read Only) */}
                            <div className="space-y-2 opacity-60">
                                <label className="text-sm text-[#8696a0] font-medium">Identity (Unique)</label>
                                <input
                                    type="text"
                                    value={user.name}
                                    readOnly
                                    className="w-full bg-transparent border-b border-[#323b42] py-2 text-[#aebac1] text-md focus:outline-none cursor-not-allowed"
                                />
                                <p className="text-[10px] text-[#8696a0]">Your unique identifier. Cannot be changed.</p>
                            </div>

                            {/* Display Name Input */}
                            <div className="space-y-2">
                                <label className="text-sm text-[#00a884] font-medium">Display Name</label>
                                <input
                                    type="text"
                                    value={displayName}
                                    onChange={(e) => setDisplayName(e.target.value)}
                                    maxLength={25}
                                    className="w-full bg-transparent border-b-2 border-[#00a884] py-2 text-[#e9edef] text-lg focus:outline-none"
                                />
                                <p className="text-xs text-[#8696a0] text-right">{displayName.length}/25</p>
                            </div>

                            {/* About Input */}
                            <div className="space-y-2">
                                <label className="text-sm text-[#8696a0] font-medium">Info</label>
                                <input
                                    type="text"
                                    value={about}
                                    onChange={(e) => setAbout(e.target.value)}
                                    maxLength={100}
                                    className="w-full bg-transparent border-b-2 border-[#323b42] focus:border-[#00a884] py-2 text-[#e9edef] text-sm focus:outline-none transition-colors"
                                    placeholder="Hey there! I am using Nexurao."
                                />
                            </div>



                            {/* Or paste URL */}
                            <div className="space-y-2">
                                <label className="text-sm text-[#8696a0] font-medium">Or paste image URL</label>
                                <input
                                    type="text"
                                    value={avatarUrl.startsWith('data:') ? '' : avatarUrl}
                                    onChange={(e) => {
                                        setAvatarUrl(e.target.value);
                                        setAvatarPreview(e.target.value);
                                    }}
                                    placeholder="https://example.com/avatar.jpg"
                                    className="w-full bg-[#202c33] rounded-lg px-4 py-3 text-[#e9edef] text-sm placeholder-[#8696a0] focus:outline-none focus:ring-1 focus:ring-[#00a884]"
                                />
                            </div>

                            {/* Save Button */}
                            <button
                                onClick={handleSaveProfile}
                                disabled={saving || !displayName.trim()}
                                className="w-full bg-[#00a884] hover:bg-[#02d98b] disabled:opacity-50 text-white py-3 rounded-lg font-medium flex items-center justify-center gap-2 transition-colors"
                            >
                                {saving ? (
                                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                ) : (
                                    <>
                                        <Save className="w-5 h-5" />
                                        Save Changes
                                    </>
                                )}
                            </button>
                        </div>
                    ) : (
                        /* Change Background Tab */
                        <div className="space-y-4">
                            <p className="text-sm text-[#8696a0]">Choose a chat background</p>

                            {/* Background Grid */}
                            <div className="grid grid-cols-2 gap-3">
                                {PRESET_BACKGROUNDS.map((bg) => (
                                    <button
                                        key={bg.id}
                                        onClick={() => setSelectedBg(bg.id)}
                                        className={`relative aspect-video rounded-lg overflow-hidden border-2 transition-all ${selectedBg === bg.id
                                            ? 'border-[#00a884] ring-2 ring-[#00a884]/30'
                                            : 'border-[#323b42] hover:border-[#8696a0]'
                                            }`}
                                    >
                                        {bg.url ? (
                                            <img src={bg.thumbnail} alt={bg.name} className="w-full h-full object-cover" />
                                        ) : (
                                            <div className="w-full h-full" style={{ background: bg.thumbnail }} />
                                        )}
                                        {selectedBg === bg.id && (
                                            <div className="absolute inset-0 bg-[#00a884]/30 flex items-center justify-center">
                                                <div className="w-6 h-6 rounded-full bg-[#00a884] flex items-center justify-center">
                                                    <Check className="w-4 h-4 text-white" />
                                                </div>
                                            </div>
                                        )}
                                        <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-2 py-1">
                                            <p className="text-xs text-white truncate">{bg.name}</p>
                                        </div>
                                    </button>
                                ))}

                                {/* Custom Upload */}
                                <button
                                    onClick={() => customBg ? setSelectedBg('custom') : bgInputRef.current?.click()}
                                    className={`relative aspect-video rounded-lg overflow-hidden border-2 transition-all ${selectedBg === 'custom'
                                        ? 'border-[#00a884] ring-2 ring-[#00a884]/30'
                                        : 'border-dashed border-[#323b42] hover:border-[#8696a0]'
                                        }`}
                                >
                                    {customBg ? (
                                        <>
                                            <img src={customBg} alt="Custom" className="w-full h-full object-cover" />
                                            {selectedBg === 'custom' && (
                                                <div className="absolute inset-0 bg-[#00a884]/30 flex items-center justify-center">
                                                    <div className="w-6 h-6 rounded-full bg-[#00a884] flex items-center justify-center">
                                                        <Check className="w-4 h-4 text-white" />
                                                    </div>
                                                </div>
                                            )}
                                            <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-2 py-1 flex items-center justify-between">
                                                <p className="text-xs text-white truncate">Custom</p>
                                                <span
                                                    onClick={(e) => { e.stopPropagation(); bgInputRef.current?.click(); }}
                                                    className="text-white/70 hover:text-white cursor-pointer"
                                                >
                                                    <Upload className="w-3 h-3" />
                                                </span>
                                            </div>

                                        </>
                                    ) : (
                                        <div className="w-full h-full flex flex-col items-center justify-center gap-2 bg-[#202c33]">
                                            <Upload className="w-6 h-6 text-[#8696a0]" />
                                            <p className="text-xs text-[#8696a0]">Upload Image</p>
                                        </div>
                                    )}
                                </button>

                                <input
                                    type="file"
                                    ref={bgInputRef}
                                    onChange={handleBgFileChange}
                                    accept="image/*"
                                    className="hidden"
                                />
                            </div>

                            {/* Apply Button */}
                            <button
                                onClick={handleSaveBackground}
                                className="w-full bg-[#00a884] hover:bg-[#02d98b] text-white py-3 rounded-lg font-medium flex items-center justify-center gap-2 transition-colors mt-4"
                            >
                                <Check className="w-5 h-5" />
                                Apply Background
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

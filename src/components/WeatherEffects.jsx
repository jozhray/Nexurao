import React, { useEffect, useState } from 'react';

const WeatherEffects = ({ theme }) => {
    const [elements, setElements] = useState([]);

    useEffect(() => {
        // Generate random elements based on theme
        const count = theme === 'light' ? 15 : 40; // Fewer leaves, more snow/rain
        const newElements = Array.from({ length: count }).map((_, i) => ({
            id: i,
            left: Math.random() * 100, // Random horizontal position
            delay: Math.random() * 5,  // Random animation delay
            duration: Math.random() * 5 + 5, // Random duration (5-10s)
            size: Math.random() * 10 + 5, // Random size
            type: theme === 'light' ? 'leaf' : (Math.random() > 0.5 ? 'snow' : 'rain')
        }));
        setElements(newElements);
    }, [theme]);

    return (
        <div className="absolute inset-0 pointer-events-none overflow-hidden z-0 select-none">
            {elements.map((el) => (
                <div
                    key={el.id}
                    className={`absolute ${el.type === 'leaf' ? 'leaf' : el.type === 'snow' ? 'snow' : 'rain'}`}
                    style={{
                        left: `${el.left}%`,
                        animationDelay: `${el.delay}s`,
                        animationDuration: `${el.duration}s`,
                        width: el.type === 'rain' ? '1px' : `${el.size}px`,
                        height: el.type === 'rain' ? `${el.size * 2}px` : `${el.size}px`,
                        top: '-20px', // Start slightly above
                        opacity: el.type === 'rain' ? 0.4 : 0.7
                    }}
                >
                    {el.type === 'leaf' && (
                        <span style={{ fontSize: `${el.size}px` }}>🍃</span>
                    )}
                    {el.type === 'snow' && (
                        <div className="w-full h-full bg-white rounded-full blur-[1px]" />
                    )}
                    {el.type === 'rain' && (
                        <div className="w-full h-full bg-blue-300/40" />
                    )}
                </div>
            ))}
        </div>
    );
};

export default WeatherEffects;

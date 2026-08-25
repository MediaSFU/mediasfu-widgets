import { useState, useEffect, useMemo } from "react";

const AudioLevelBars: React.FC<{ audioLevel: number }> = ({ audioLevel }) => {
  const [level, setLevel] = useState(0);
  const [peakLevel, setPeakLevel] = useState(0);

  useEffect(() => {
    // Smoothly animate the audio level with easing
    const animation = setInterval(() => {
      setLevel((prev) => {
        if (Math.abs(prev - audioLevel) < 2) return audioLevel;

        // Use exponential easing for more natural movement
        const diff = audioLevel - prev;
        const step = diff * 0.3; // Adjust for smoothness (0.1 = very smooth, 0.5 = fast)

        return prev + step;
      });
    }, 16); // 60fps for smooth animation

    return () => clearInterval(animation);
  }, [audioLevel]);

  // Track peak levels for visual feedback
  useEffect(() => {
    if (level > peakLevel) {
      setPeakLevel(level);
    } else {
      // Slowly decay peak level
      const decay = setTimeout(() => {
        setPeakLevel(prev => Math.max(prev - 2, level));
      }, 100);
      return () => clearTimeout(decay);
    }
  }, [level, peakLevel]);

  // Memoize bar calculations for performance
  const barData = useMemo(() => {
    // Improved normalization with better sensitivity
    const normalizedLevel = Math.max(0, Math.min(10,
      ((level - 127.5) / (275 - 127.5)) * 12
    ));

    const normalizedPeak = Math.max(0, Math.min(10,
      ((peakLevel - 127.5) / (275 - 127.5)) * 12
    ));

    return Array.from({ length: 10 }, (_, i) => ({
      filled: i < normalizedLevel,
      isPeak: Math.abs(i - normalizedPeak) < 0.5,
      intensity: Math.max(0, 1 - Math.abs(i - normalizedLevel) / 3) // Gradient intensity
    }));
  }, [level, peakLevel]);

  // Dynamic color calculation
  const getBarColor = (index: number, filled: boolean, isPeak: boolean, intensity: number) => {
    if (!filled && !isPeak) return 'rgba(156, 163, 175, 0.3)';

    // Create a more sophisticated color gradient
    const hue = Math.max(0, 120 - (index * 12)); // Green to red gradient
    const saturation = 70 + (intensity * 30); // More saturated when active
    const lightness = 50 + (intensity * 10);

    if (isPeak) {
      return `hsla(${hue}, ${saturation + 20}%, ${lightness + 20}%, 0.9)`;
    }

    return `hsla(${hue}, ${saturation}%, ${lightness}%, ${0.7 + intensity * 0.3})`;
  };

  return (
    <div className="audio-bars-container">
      {barData.map(({ filled, isPeak, intensity }, index) => (
        <div
          key={index}
          className={`audio-bar ${filled ? "filled" : ""} ${isPeak ? "peak" : ""}`}
          style={{
            backgroundColor: getBarColor(index, filled, isPeak, intensity),
            height: filled ? `${60 + (intensity * 40)}%` : '20%',
            transform: filled ? 'scaleY(1.1)' : 'scaleY(1)',
            boxShadow: filled
              ? `0 0 ${4 + intensity * 8}px ${getBarColor(index, filled, isPeak, intensity)}40`
              : 'none'
          }}
        />
      ))}
    </div>
  );
};

export default AudioLevelBars;
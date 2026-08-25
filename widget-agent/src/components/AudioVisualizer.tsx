import React, { useEffect, useRef } from "react";
import "./AudioVisualizer.css";

interface AudioVisualizerProps {
  animate: boolean;
}

const AudioVisualizer: React.FC<AudioVisualizerProps> = ({ animate }) => {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const animationIdRef = useRef<number | null>(null);

    useEffect(() => {
      const canvas = canvasRef.current;
      const canvasCtx = canvas?.getContext("2d");
      if (!canvas || !canvasCtx) return;

      const bufferLength = 64;
      const bars = new Array(bufferLength).fill(0).map(() => Math.random() * 255);

      const resizeCanvas = () => {
        canvas.width = canvas.parentElement?.clientWidth || 600;
        canvas.height = 150;
      };
      resizeCanvas();
      window.addEventListener("resize", resizeCanvas);

      // ** NEW: throttle to 30 FPS **
      const targetFps = 10;
      const frameInterval = 1000 / targetFps; // ≈33ms per frame
      let lastFrameTime = performance.now();

      const draw = () => {
        animationIdRef.current = requestAnimationFrame(draw);

        const now = performance.now();
        const elapsed = now - lastFrameTime;
        if (elapsed < frameInterval) {
          // too soon → skip this frame
          return;
        }
        lastFrameTime = now - (elapsed % frameInterval);

        // --- your existing draw logic below ---
        canvasCtx.clearRect(0, 0, canvas.width, canvas.height);
        const barWidth = (canvas.width / bufferLength) * 2.5;
        let x = 0;

        for (let i = 0; i < bufferLength; i++) {
          const barHeight = animate
            ? bars[i] * (0.5 + Math.random() * 0.5)
            : bars[i];

          const gradient = canvasCtx.createLinearGradient(0, 0, 0, canvas.height);
          gradient.addColorStop(0, `rgba(255, 0, 0, ${barHeight / 255})`);
          gradient.addColorStop(0.5, `rgba(255, 255, 0, ${barHeight / 255})`);
          gradient.addColorStop(1, `rgba(0, 255, 0, ${barHeight / 255})`);

          canvasCtx.fillStyle = gradient;
          canvasCtx.fillRect(
            x,
            canvas.height - barHeight / 2,
            barWidth,
            barHeight / 2
          );

          x += barWidth + 1;

          if (animate) {
            bars[i] = Math.max(10, bars[i] + (Math.random() * 10 - 5));
            if (bars[i] > 255) bars[i] = 255;
          } else {
            bars[i] = 0;
          }
        }
      };

      draw();

      return () => {
        if (animationIdRef.current) cancelAnimationFrame(animationIdRef.current);
        window.removeEventListener("resize", resizeCanvas);
      };
    }, [animate]);


    return (
      <div className="audio-visualizer-card">
        <h3>Audio Visualizer</h3>
        <canvas ref={canvasRef} width={600} height={150}></canvas>
      </div>
    );
  };

  export default AudioVisualizer;
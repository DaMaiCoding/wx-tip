const { ipcRenderer } = require('electron');

const container = document.getElementById('danmaku-container');
const tracks = []; // Array of { y: number, nextAvailableTime: number }
const TRACK_HEIGHT = 40; // Height of each track in pixels
const MARGIN_TOP = 50; // Top margin to avoid menu bars etc.

// Configuration (can be updated via IPC)
let config = {
    speed: 10, // seconds to cross screen
    opacity: 0.9,
    fontSize: 20,
    showAvatar: false
};

function initTracks() {
    const screenHeight = window.innerHeight;
    const maxTracks = Math.floor((screenHeight - MARGIN_TOP) / TRACK_HEIGHT);
    tracks.length = 0;
    for (let i = 0; i < maxTracks; i++) {
        tracks.push({
            y: MARGIN_TOP + i * TRACK_HEIGHT,
            nextAvailableTime: 0
        });
    }
}

// Re-init tracks on resize
window.addEventListener('resize', initTracks);
initTracks();

function getAvailableTrack() {
    const now = Date.now();
    // Sort tracks by availability to fill from top or randomly?
    // Let's try to find the first available track from top
    for (let i = 0; i < tracks.length; i++) {
        if (tracks[i].nextAvailableTime <= now) {
            return tracks[i];
        }
    }
    // If all full, return a random track (overlap might occur but better than dropping)
    return tracks[Math.floor(Math.random() * tracks.length)];
}

function createDanmaku(text, sender) {
    const el = document.createElement('div');
    el.className = 'danmaku-item';
    el.style.opacity = config.opacity;
    el.style.fontSize = `${config.fontSize}px`;
    
    // Content
    const content = sender ? `${sender}: ${text}` : text;
    el.textContent = content;

    // Measure width (we need to append to DOM to measure, but invisible first?)
    // Or just set it up and measure after.
    
    // Find track
    const track = getAvailableTrack();
    if (!track) return; // Should happen rarely given the random fallback

    el.style.top = `${track.y}px`;
    
    // Animation
    // We use Web Animations API for better control than CSS transitions
    container.appendChild(el);
    
    const width = el.offsetWidth;
    const screenWidth = window.innerWidth;
    const duration = config.speed * 1000; // ms

    // Start from right edge (screenWidth), end at -width
    const animation = el.animate([
        { transform: `translateX(${screenWidth}px)` },
        { transform: `translateX(-${width}px)` }
    ], {
        duration: duration,
        easing: 'linear'
    });

    // Calculate when the track is free for the next danmaku
    // Distance = screenWidth + width
    // Speed = Distance / duration
    // We want the next one to start when this one has moved enough so they don't overlap.
    // Safe distance = some gap (e.g. 50px)
    // Time to clear entrance = (width + 50) / Speed
    // Speed (px/ms) = (screenWidth + width) / duration
    
    const speed = (screenWidth + width) / duration;
    const timeToClear = (width + 50) / speed;
    
    track.nextAvailableTime = Date.now() + timeToClear;

    animation.onfinish = () => {
        el.remove();
    };
}

ipcRenderer.on('danmaku:new', (event, data) => {
    // data: { title, content, ... }
    const sender = data.title; // Sender nickname
    const text = data.content; // Message content
    createDanmaku(text, sender);
});

ipcRenderer.on('danmaku:config', (event, newConfig) => {
    config = { ...config, ...newConfig };
    // Optionally re-style existing items? No, just apply to new ones.
});

// Initial config request
// ipcRenderer.invoke('danmaku:get-config').then(c => config = { ...config, ...c });

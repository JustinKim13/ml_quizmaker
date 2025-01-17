import React, { createContext, useContext, useEffect, useRef } from "react";

// Create WebSocket context
const WebSocketContext = createContext(null);

// WebSocket Provider
export const WebSocketProvider = ({ children }) => {
    const ws = useRef(null);

    useEffect(() => {
        // Initialize WebSocket connection
        ws.current = new WebSocket("ws://localhost:5000");

        ws.current.onopen = () => console.log("WebSocket connected");
        ws.current.onclose = () => console.log("WebSocket disconnected");
        ws.current.onerror = (error) => console.error("WebSocket error:", error);

        return () => {
            if (ws.current.readyState === WebSocket.OPEN) {
                ws.current.close();
            }
        };
    }, []);

    return (
        <WebSocketContext.Provider value={ws.current}>
            {children}
        </WebSocketContext.Provider>
    );
};

// Hook to access WebSocket
export const useWebSocket = () => useContext(WebSocketContext);

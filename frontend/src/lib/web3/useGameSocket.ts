import { useEffect, useCallback, useRef } from "react";
import {
  initializeSocket,
  onGameEvent,
  isSocketConnected,
  type GameEventMap,
} from "./socket";

export function useGameSocket(
  walletAddress?: string,
  walletProvider?: string,
  enabled: boolean = true
) {
  const socketInitializedRef = useRef(false);

  useEffect(() => {
    if (!enabled || !walletAddress) {
      return;
    }

    
    if (socketInitializedRef.current) {
      return;
    }

    socketInitializedRef.current = true;

    const initSocket = async () => {
      try {
        await initializeSocket(walletAddress, walletProvider);
      } catch (error) {
        console.error("Failed to initialize socket:", error);
        socketInitializedRef.current = false;
      }
    };

    initSocket();

    return () => {
      
      
    };
  }, [enabled, walletAddress, walletProvider]);

  const subscribe = useCallback(
    <K extends keyof GameEventMap>(
      event: K,
      callback: GameEventMap[K]
    ): (() => void) => {
      return onGameEvent(event, callback);
    },
    []
  );

  const isConnected = isSocketConnected();

  return {
    isConnected,
    subscribe,
  };
}


export function useGameEvent<K extends keyof GameEventMap>(
  event: K,
  callback: GameEventMap[K],
  enabled: boolean = true
) {
  useEffect(() => {
    if (!enabled) {
      return;
    }

    const unsubscribe = onGameEvent(event, callback);
    return unsubscribe;
  }, [event, callback, enabled]);
}

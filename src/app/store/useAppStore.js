import { create } from "zustand";
import { detectInitialLocale } from "../../i18n/index.js";

const DEFAULT_WINDOW_US = 8 * 1000000;

export const useAppStore = create((set) => ({
  flights: [],
  selectedFlightId: null,
  currentTimeUs: 0,
  visibleWindowUs: DEFAULT_WINDOW_US,
  locale: detectInitialLocale(),
  stickMode: "mode2",
  selectedReviewEventId: null,
  playback: {
    isPlaying: false,
    rate: 1,
  },
  videoSync: {},
  compareSession: {
    flightAId: null,
    flightBId: null,
    alignment: "time",
    selectedEventType: null,
  },
  exportState: {
    status: "idle",
    progress: 0,
    message: "",
    downloadUrl: null,
    mimeType: null,
    hadAudio: false,
    warnings: [],
  },
  overlayState: {
    compareOpen: true,
    historyOpen: true,
    topBarVisible: true,
    summaryVisible: true,
    attitudeVisible: true,
    stickOverlayVisible: true,
    bottomMetricsVisible: true,
    stickMiniGraphEnabled: true,
    stickMiniGraphWindowUs: 1000000,
    viewerFullscreen: false,
  },
  addFlight(flight) {
    set((state) => {
      const flights = [...state.flights, flight];
      return {
        flights,
        selectedFlightId: state.selectedFlightId ?? flight.id,
        currentTimeUs: state.selectedFlightId ? state.currentTimeUs : flight.minTimeUs,
        compareSession: {
          ...state.compareSession,
          flightAId: state.compareSession.flightAId ?? flight.id,
          flightBId:
            state.compareSession.flightAId && !state.compareSession.flightBId
              ? flight.id
              : state.compareSession.flightBId,
        },
      };
    });
  },
  assignVideo(flightId, video) {
    set((state) => ({
      flights: state.flights.map((flight) =>
        flight.id === flightId ? { ...flight, video } : flight
      ),
    }));
  },
  selectFlight(flightId) {
    set((state) => {
      const flight = state.flights.find((item) => item.id === flightId);
      return flight
        ? {
            selectedFlightId: flightId,
            selectedReviewEventId: null,
            currentTimeUs: Math.min(
              Math.max(state.currentTimeUs, flight.minTimeUs),
              flight.maxTimeUs
            ),
          }
        : {};
    });
  },
  setCurrentTimeUs(currentTimeUs) {
    set((state) => ({
      currentTimeUs:
        typeof currentTimeUs === "function"
          ? currentTimeUs(state.currentTimeUs)
          : currentTimeUs,
    }));
  },
  setVisibleWindowUs(visibleWindowUs) {
    set({ visibleWindowUs });
  },
  setLocale(locale) {
    set({ locale });
  },
  setStickMode(stickMode) {
    set({ stickMode });
  },
  setSelectedReviewEventId(selectedReviewEventId) {
    set({ selectedReviewEventId });
  },
  setPlayback(isPlaying) {
    set((state) => ({ playback: { ...state.playback, isPlaying } }));
  },
  setPlaybackRate(rate) {
    set((state) => ({ playback: { ...state.playback, rate } }));
  },
  setVideoOffset(flightId, offsetSeconds) {
    set((state) => ({
      videoSync: {
        ...state.videoSync,
        [flightId]: {
          ...(state.videoSync[flightId] ?? {}),
          offsetSeconds,
        },
      },
    }));
  },
  setVideoSyncMeta(flightId, patch) {
    set((state) => ({
      videoSync: {
        ...state.videoSync,
        [flightId]: {
          ...(state.videoSync[flightId] ?? {}),
          ...patch,
        },
      },
    }));
  },
  setCompareFlight(slot, flightId) {
    set((state) => ({
      compareSession: {
        ...state.compareSession,
        [slot]: flightId,
      },
    }));
  },
  setCompareAlignment(alignment) {
    set((state) => ({
      compareSession: {
        ...state.compareSession,
        alignment,
      },
    }));
  },
  setCompareEventType(selectedEventType) {
    set((state) => ({
      compareSession: {
        ...state.compareSession,
        selectedEventType,
      },
    }));
  },
  setExportState(patch) {
    set((state) => ({
      exportState: {
        ...state.exportState,
        ...patch,
      },
    }));
  },
  resetExportState() {
    set(() => ({
      exportState: {
        status: "idle",
        progress: 0,
        message: "",
        downloadUrl: null,
        mimeType: null,
        hadAudio: false,
        warnings: [],
      },
    }));
  },
  setStickMiniGraphEnabled(stickMiniGraphEnabled) {
    set((state) => ({
      overlayState: {
        ...state.overlayState,
        stickMiniGraphEnabled,
      },
    }));
  },
  setStickMiniGraphWindowUs(stickMiniGraphWindowUs) {
    set((state) => ({
      overlayState: {
        ...state.overlayState,
        stickMiniGraphWindowUs,
      },
    }));
  },
  setOverlayVisibility(key, value) {
    set((state) => ({
      overlayState: {
        ...state.overlayState,
        [key]: value,
      },
    }));
  },
  resetOverlayVisibility() {
    set((state) => ({
      overlayState: {
        ...state.overlayState,
        compareOpen: true,
        historyOpen: true,
        topBarVisible: true,
        summaryVisible: true,
        attitudeVisible: true,
        stickOverlayVisible: true,
        bottomMetricsVisible: true,
        viewerFullscreen: false,
      },
    }));
  },
}));

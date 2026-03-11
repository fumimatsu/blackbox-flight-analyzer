import { FlightLog } from "../../../vendor/log-core/flightlog.js";

let nextId = 1;

function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => resolve(event.target.result);
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file."));
    reader.readAsArrayBuffer(file);
  });
}

export async function loadFlightSessionFromFile(file) {
  const result = await loadFlightSessionsFromFile(file);
  if (!result.sessions.length) {
    throw new Error("No readable log section was found in this file.");
  }
  return result.sessions[0];
}

export async function loadFlightSessionsFromFile(file) {
  const bytes = await readFileAsArrayBuffer(file);
  const logData = new Uint8Array(bytes);
  const probeLog = new FlightLog(logData);
  const baseName = file.name.replace(/\.[^.]+$/, "");
  const sessions = [];
  const unreadableSections = [];

  for (let index = 0; index < probeLog.getLogCount(); index += 1) {
    const logError = probeLog.getLogError(index);

    if (logError) {
      unreadableSections.push({
        logIndex: index,
        reason: String(logError),
      });
      continue;
    }

    const log = new FlightLog(logData);
    if (!log.openLog(index)) {
      unreadableSections.push({
        logIndex: index,
        reason: `Failed to open log section #${index + 1}.`,
      });
      continue;
    }

    const logCount = probeLog.getLogCount();
    const sectionLabel = `Section ${index + 1}`;

    sessions.push({
      id: `flight-${nextId++}`,
      name: logCount > 1 ? `${baseName} · ${sectionLabel}` : baseName,
      shortName: sectionLabel,
      fileName: file.name,
      sourceFile: file,
      log,
      logIndex: index,
      logSectionLabel: sectionLabel,
      totalLogSections: logCount,
      fieldNames: log.getMainFieldNames(),
      fieldIndex: log.getMainFieldIndexes(),
      minTimeUs: log.getMinTime(),
      maxTimeUs: log.getMaxTime(),
      durationUs: log.getMaxTime() - log.getMinTime(),
      numMotors: log.getNumMotors(),
      createdAt: Date.now(),
      video: null,
    });
  }

  return {
    sessions,
    unreadableSections,
    totalLogSections: probeLog.getLogCount(),
  };
}

export function createVideoAsset(file) {
  return {
    id: `video-${nextId++}`,
    fileName: file.name,
    file,
    url: URL.createObjectURL(file),
  };
}

export function disposeVideoAsset(video) {
  if (video?.url) {
    URL.revokeObjectURL(video.url);
  }
}
